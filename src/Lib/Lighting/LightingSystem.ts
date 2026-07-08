import { System, SystemType, World, Query, Engine, Scene, Camera, Vector, Color, TransformComponent } from "excalibur";
import {
  DarknessComponent,
  AmbientLightComponent,
  PointLightComponent,
  ConeLightComponent,
  LightOccluderComponent,
} from "./LightingComponents";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Project a world-space Vector to screen/canvas-BUFFER-space pixels.
 *
 * `pixelRatio` must be included here because `canvasWidth`/`canvasHeight` are
 * the physical drawing-buffer resolution (canvas.width/height), which on
 * HiDPI displays is `pixelRatio`x larger than the logical resolution that
 * `camera.zoom` operates in. Excalibur's own renderer folds this in
 * automatically; since we're drawing to our own overlay canvas outside
 * Excalibur's pipeline, we have to do it ourselves. Omitting it produces a
 * screen position that's correct at the camera's exact focal point (error
 * zero at distance zero) but increasingly wrong the further a light is from
 * camera center — exactly the "actor outruns the light" symmetric drift.
 */
function worldToScreen(worldPos: Vector, camera: Camera, canvasWidth: number, canvasHeight: number, pixelRatio: number): Vector {
  // Excalibur's camera transform: screen = (world - camPos) * zoom * pixelRatio + canvasCenter
  const effectiveZoom = camera.zoom * pixelRatio;
  const camPos = camera.pos;
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  return new Vector((worldPos.x - camPos.x) * effectiveZoom + cx, (worldPos.y - camPos.y) * effectiveZoom + cy);
}

/** Convert an Excalibur Color to a CSS rgba string with overridden alpha. */
function colorToRgba(color: Color, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** Transform local vertices to world space given world position and rotation. */
function localToWorld(vertices: Vector[], worldPos: Vector, rotation: number): Vector[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return vertices.map(v => new Vector(worldPos.x + v.x * cos - v.y * sin, worldPos.y + v.x * sin + v.y * cos));
}

/**
 * Compute a simple 2D shadow polygon from an occluder's world-space vertices
 * against a light source. Returns screen-space polygon points ready for Canvas2D.
 *
 * Strategy: for each vertex, project a ray from the light through it to `reach`
 * distance. The shadow polygon is the near face + the two projected far vertices,
 * forming a quad (or fan) that blocks the light behind the occluder.
 */
function shadowPolygon(
  lightScreen: Vector,
  occluderVerts: Vector[], // world space
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  reach: number,
  pixelRatio: number,
): Vector[] {
  // Project occluder vertices to screen space
  const screenVerts = occluderVerts.map(v => worldToScreen(v, camera, canvasWidth, canvasHeight, pixelRatio));

  // Find the two "silhouette" vertices — the ones at the angular extremes
  // relative to the light position.
  let minAngle = Infinity;
  let maxAngle = -Infinity;
  let minIdx = 0;
  let maxIdx = 0;

  for (let i = 0; i < screenVerts.length; i++) {
    const angle = Math.atan2(screenVerts[i].y - lightScreen.y, screenVerts[i].x - lightScreen.x);
    if (angle < minAngle) {
      minAngle = angle;
      minIdx = i;
    }
    if (angle > maxAngle) {
      maxAngle = angle;
      maxIdx = i;
    }
  }

  // Project the two silhouette verts far behind the occluder
  const project = (v: Vector): Vector => {
    const dx = v.x - lightScreen.x;
    const dy = v.y - lightScreen.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return new Vector(v.x + (dx / len) * reach, v.y + (dy / len) * reach);
  };

  const farMin = project(screenVerts[minIdx]);
  const farMax = project(screenVerts[maxIdx]);

  return [screenVerts[minIdx], farMin, farMax, screenVerts[maxIdx]];
}

/**
 * Compute the shadow wedge for a circular occluder.
 * Finds the two tangent points from the light to the circle edge, then
 * draws a filled arc + projected trapezoid to block the light behind it.
 */
function drawShadowCircle(
  ctx: CanvasRenderingContext2D,
  lightScreen: Vector,
  centerWorld: Vector,
  worldRadius: number,
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  reach: number,
  grad: CanvasGradient,
  pixelRatio: number,
): void {
  const center = worldToScreen(centerWorld, camera, canvasWidth, canvasHeight, pixelRatio);
  const effectiveZoom = camera.zoom * pixelRatio;
  const screenRadius = worldRadius * effectiveZoom;

  const dx = center.x - lightScreen.x;
  const dy = center.y - lightScreen.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Light is inside the circle — no shadow
  if (dist <= screenRadius) return;

  const angleToCenter = Math.atan2(dy, dx);
  // Half-angle of the tangent cone from the light
  const halfAngle = Math.asin(Math.min(1, screenRadius / dist));

  const t1 = angleToCenter - halfAngle;
  const t2 = angleToCenter + halfAngle;

  // Tangent points on the circle edge (screen space)
  const tp1 = new Vector(center.x + Math.cos(t1 + Math.PI / 2) * screenRadius, center.y + Math.sin(t1 + Math.PI / 2) * screenRadius);
  const tp2 = new Vector(center.x + Math.cos(t2 - Math.PI / 2) * screenRadius, center.y + Math.sin(t2 - Math.PI / 2) * screenRadius);

  // Project tangent points away from light to `reach`
  const project = (v: Vector): Vector => {
    const ex = v.x - lightScreen.x;
    const ey = v.y - lightScreen.y;
    const len = Math.sqrt(ex * ex + ey * ey) || 1;
    return new Vector(v.x + (ex / len) * reach, v.y + (ey / len) * reach);
  };

  const far1 = project(tp1);
  const far2 = project(tp2);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(tp1.x, tp1.y);
  ctx.lineTo(far1.x, far1.y);
  ctx.lineTo(far2.x, far2.y);
  ctx.lineTo(tp2.x, tp2.y);
  // Close around the back of the circle
  ctx.arc(center.x, center.y, screenRadius, t2 - Math.PI / 2, t1 + Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// LightingSystem
// ---------------------------------------------------------------------------

export class LightingSystem extends System {
  readonly systemType = SystemType.Draw;
  // Run after Excalibur's built-in draw systems (they top out around 200)
  readonly priority = 900;

  private darknessQuery!: Query<typeof DarknessComponent>;
  private ambientQuery!: Query<typeof AmbientLightComponent>;
  private darknessXfQuery!: Query<typeof DarknessComponent | typeof TransformComponent>;

  // Joined queries — give us typed pos/rotation without casting
  private pointXfQuery!: Query<typeof PointLightComponent | typeof TransformComponent>;
  private coneXfQuery!: Query<typeof ConeLightComponent | typeof TransformComponent>;
  private occluderXfQuery!: Query<typeof LightOccluderComponent | typeof TransformComponent>;

  private overlay!: HTMLCanvasElement;
  private overlayCtx!: CanvasRenderingContext2D;
  private engine!: Engine;

  private offscreen: HTMLCanvasElement | null = null;
  private offscreenCTX: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;

  /** World-space radius beyond the camera bounds within which lights are culled */
  cullPadding = 50;

  initialize(world: World, scene: Scene): void {
    this.engine = scene.engine;
    this.darknessQuery = world.query([DarknessComponent]);
    this.ambientQuery = world.query([AmbientLightComponent]);
    this.darknessXfQuery = world.query([DarknessComponent, TransformComponent]);

    this.pointXfQuery = world.query([PointLightComponent, TransformComponent]);
    this.coneXfQuery = world.query([ConeLightComponent, TransformComponent]);
    this.occluderXfQuery = world.query([LightOccluderComponent, TransformComponent]);

    this._createOverlay();
  }

  private _syncOverlay(): void {
    const canvas = this.engine.canvas;

    // Match the canvas buffer resolution exactly
    if (this.overlay.width !== canvas.width) this.overlay.width = canvas.width;
    if (this.overlay.height !== canvas.height) this.overlay.height = canvas.height;

    // Position relative to offset parent — no viewport coordinate mismatch
    this.overlay.style.position = "absolute";
    this.overlay.style.left = `${canvas.offsetLeft}px`;
    this.overlay.style.top = `${canvas.offsetTop}px`;
    this.overlay.style.width = `${canvas.offsetWidth}px`;
    this.overlay.style.height = `${canvas.offsetHeight}px`;

    if (!this.offscreen) return;
    // Must match overlay's *buffer* resolution (canvas.width/height), NOT
    // canvas.offsetWidth/offsetHeight (CSS display size). update() computes
    // all light/shadow screen-space coordinates against overlay.width/height,
    // and drawImage() copies offscreen onto overlay at a straight 1:1 pixel
    // scale with no stretching — if these sizes diverge (which they will
    // whenever the canvas is CSS-scaled to fit its container, i.e. normally),
    // the copied content lands at the wrong scale/position.
    if (this.offscreen.width !== canvas.width) this.offscreen.width = canvas.width;
    if (this.offscreen.height !== canvas.height) this.offscreen.height = canvas.height;
  }

  private _createOverlay(): void {
    const canvas = this.engine.canvas;
    const parent = canvas.parentElement!;

    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText = `
    pointer-events: none;
    mix-blend-mode: multiply;
  `;

    if (getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    parent.appendChild(this.overlay);
    this.overlayCtx = this.overlay.getContext("2d")!;

    this.offscreen = document.createElement("canvas");
    this.offscreenCTX = this.offscreen.getContext("2d")!;

    // Sync once at creation, then only when the canvas actually resizes
    this._syncOverlay();
    this.resizeObserver = new ResizeObserver(() => this._syncOverlay());
    this.resizeObserver.observe(canvas);
  }

  update(delta: number): void {
    const engine = this.engine;
    const camera = engine.currentScene.camera;
    const w = this.overlay.width;
    const h = this.overlay.height;
    const ctx = this.overlayCtx;

    const pixelRatio = engine.screen.pixelRatio;
    const zoom = camera.zoom;
    const effectiveZoom = zoom * pixelRatio;

    // Clear previous frames completely
    ctx.clearRect(0, 0, w, h);

    // ------------------------------------------------------------------
    // 1. Read ambient settings
    // ------------------------------------------------------------------
    let ambientIntensity = 0.05;
    for (const e of this.ambientQuery.entities) {
      const a = e.get(AmbientLightComponent)!;
      ambientIntensity = a.intensity;
    }

    // ------------------------------------------------------------------
    // 2. Draw INDEPENDENT darkness rectangles & gather their bounds
    // ------------------------------------------------------------------
    const roomClips: { x: number; y: number; w: number; h: number }[] = [];

    for (const e of this.darknessXfQuery.entities) {
      const d = e.get(DarknessComponent)!;
      const xf = e.get(TransformComponent)!;

      // Handle unbounded global darkness
      if (d.width === Infinity || d.height === Infinity) {
        const effectiveAlpha = Math.max(0, d.intensity - ambientIntensity);
        ctx.fillStyle = colorToRgba(d.color, effectiveAlpha);
        ctx.fillRect(0, 0, w, h);
        continue;
      }

      // Compute individual room dimensions in screen space
      const hw = (d.width / 2) * effectiveZoom;
      const hh = (d.height / 2) * effectiveZoom;
      const center = worldToScreen(xf.pos, camera, w, h, pixelRatio);

      const rect = {
        x: center.x - hw,
        y: center.y - hh,
        w: hw * 2,
        h: hh * 2,
      };

      // Keep track of this room for light isolation
      roomClips.push(rect);

      // Draw this independent darkness rectangle right here in the loop
      const effectiveAlpha = Math.max(0, d.intensity - ambientIntensity);
      ctx.fillStyle = colorToRgba(d.color, effectiveAlpha);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    // ------------------------------------------------------------------
    // 3. Camera AABB for light culling
    // ------------------------------------------------------------------
    const camPos = camera.pos;
    const halfW = w / 2 / effectiveZoom + this.cullPadding;
    const halfH = h / 2 / effectiveZoom + this.cullPadding;
    const camMinX = camPos.x - halfW;
    const camMaxX = camPos.x + halfW;
    const camMinY = camPos.y - halfH;
    const camMaxY = camPos.y + halfH;

    const inCameraView = (worldPos: Vector, radius: number) =>
      worldPos.x + radius > camMinX && worldPos.x - radius < camMaxX && worldPos.y + radius > camMinY && worldPos.y - radius < camMaxY;

    // ------------------------------------------------------------------
    // 4. Collect visible occluders
    // ------------------------------------------------------------------
    type PolyOccluder = { kind: "poly"; verts: Vector[] };
    type CircleOccluder = { kind: "circle"; center: Vector; radius: number };
    type Occluder = PolyOccluder | CircleOccluder;

    const occluders: Occluder[] = [];
    for (const e of this.occluderXfQuery.entities) {
      const comp = e.get(LightOccluderComponent)!;
      if (!comp.castShadows) continue;
      const xf = e.get(TransformComponent)!;
      if (comp.shape.kind === "circle") {
        occluders.push({
          kind: "circle",
          center: xf.pos,
          radius: comp.shape.radius,
        });
      } else {
        occluders.push({
          kind: "poly",
          verts: localToWorld(comp.localVertices(), xf.pos, xf.rotation),
        });
      }
    }

    // ------------------------------------------------------------------
    // 5. Draw each visible light restricted to its container room
    // ------------------------------------------------------------------
    const drawLight = (screenPos: Vector, screenRadius: number, alpha: number, drawShape: (c: CanvasRenderingContext2D) => void) => {
      if (!this.offscreenCTX || !this.offscreen) return;
      this.offscreenCTX.clearRect(0, 0, w, h);

      // Match this light to the room it is currently placed inside
      const activeClip = roomClips.find(
        rect => screenPos.x >= rect.x && screenPos.x <= rect.x + rect.w && screenPos.y >= rect.y && screenPos.y <= rect.y + rect.h,
      );

      // Restrict offscreen shadow punching to the room bounds
      if (activeClip) {
        this.offscreenCTX.save();
        this.offscreenCTX.beginPath();
        this.offscreenCTX.rect(activeClip.x, activeClip.y, activeClip.w, activeClip.h);
        this.offscreenCTX.clip();
      }

      const shadowReach = activeClip ? Math.sqrt(activeClip.w ** 2 + activeClip.h ** 2) : Math.sqrt(w ** 2 + h ** 2);

      // a) Paint light hole stencil
      this.offscreenCTX.globalCompositeOperation = "source-over";
      drawShape(this.offscreenCTX);

      // b) Mask shadows out
      this.offscreenCTX.globalCompositeOperation = "destination-out";
      this._drawOccluderShadows(this.offscreenCTX, screenPos, occluders, shadowReach, camera, w, h, pixelRatio);

      if (activeClip) this.offscreenCTX.restore();

      // c) Punch out the final mask on the main overlay, respecting room lines
      ctx.save();
      if (activeClip) {
        ctx.beginPath();
        ctx.rect(activeClip.x, activeClip.y, activeClip.w, activeClip.h);
        ctx.clip();
      }
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(this.offscreen, 0, 0);
      ctx.restore();
    };

    // --- Point lights ---
    for (const e of this.pointXfQuery.entities) {
      const light = e.get(PointLightComponent)!;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;

      const screenPos = worldToScreen(xf.pos, camera, w, h, pixelRatio);
      const screenRadius = light.radius * effectiveZoom;
      const alpha = light.currentIntensity;

      drawLight(screenPos, screenRadius, alpha, c => {
        const grad = c.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, screenRadius);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.6})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = grad;
        c.beginPath();
        c.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
        c.fill();
      });
    }

    // --- Cone lights ---
    for (const e of this.coneXfQuery.entities) {
      const light = e.get(ConeLightComponent)!;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;

      const screenPos = worldToScreen(xf.pos, camera, w, h, pixelRatio);
      const screenRadius = light.radius * effectiveZoom;
      const halfAngle = light.angle / 2;
      const dir = light.direction;
      const alpha = light.currentIntensity;
      const startAngle = dir - halfAngle;
      const endAngle = dir + halfAngle;

      drawLight(screenPos, screenRadius, alpha, c => {
        const grad = c.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, screenRadius);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(0.7, `rgba(255,255,255,${alpha * 0.5})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(screenPos.x, screenPos.y);
        c.arc(screenPos.x, screenPos.y, screenRadius, startAngle, endAngle);
        c.closePath();
        c.fill();

        if (light.softness > 0) {
          const featherGrad = c.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, screenRadius);
          featherGrad.addColorStop(0, "rgba(0,0,0,0)");
          featherGrad.addColorStop(0.85, "rgba(0,0,0,0)");
          featherGrad.addColorStop(1, `rgba(0,0,0,${alpha * light.softness})`);
          c.globalCompositeOperation = "source-over";
          c.fillStyle = featherGrad;
          c.beginPath();
          c.moveTo(screenPos.x, screenPos.y);
          c.arc(screenPos.x, screenPos.y, screenRadius, startAngle - 0.15, endAngle + 0.15);
          c.closePath();
          c.fill();
        }
      });
    }

    // ------------------------------------------------------------------
    // 6. Colored light tint pass (Corrected for multi-room clips)
    // ------------------------------------------------------------------
    for (const e of this.pointXfQuery.entities) {
      const light = e.get(PointLightComponent)!;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;
      if (light.color.equal(Color.White)) continue;

      const screenPos = worldToScreen(xf.pos, camera, w, h, pixelRatio);
      const activeClip = roomClips.find(
        rect => screenPos.x >= rect.x && screenPos.x <= rect.x + rect.w && screenPos.y >= rect.y && screenPos.y <= rect.y + rect.h,
      );

      ctx.save();
      if (activeClip) {
        ctx.beginPath();
        ctx.rect(activeClip.x, activeClip.y, activeClip.w, activeClip.h);
        ctx.clip();
      }
      ctx.globalCompositeOperation = "source-over";

      const screenRadius = light.radius * effectiveZoom;
      const tintAlpha = light.currentIntensity * 0.35;

      const grad = ctx.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, screenRadius);
      grad.addColorStop(0, colorToRgba(light.color, tintAlpha));
      grad.addColorStop(0.5, colorToRgba(light.color, tintAlpha * 0.4));
      grad.addColorStop(1, colorToRgba(light.color, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(screenPos.x, screenPos.y, screenRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const e of this.coneXfQuery.entities) {
      const light = e.get(ConeLightComponent)!;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;
      if (light.color.equal(Color.White)) continue;

      const screenPos = worldToScreen(xf.pos, camera, w, h, pixelRatio);
      const activeClip = roomClips.find(
        rect => screenPos.x >= rect.x && screenPos.x <= rect.x + rect.w && screenPos.y >= rect.y && screenPos.y <= rect.y + rect.h,
      );

      ctx.save();
      if (activeClip) {
        ctx.beginPath();
        ctx.rect(activeClip.x, activeClip.y, activeClip.w, activeClip.h);
        ctx.clip();
      }
      ctx.globalCompositeOperation = "source-over";

      const screenRadius = light.radius * effectiveZoom;
      const tintAlpha = light.currentIntensity * 0.35;
      const halfAngle = light.angle / 2;
      const dir = light.direction;

      const grad = ctx.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, screenRadius);
      grad.addColorStop(0, colorToRgba(light.color, tintAlpha));
      grad.addColorStop(0.5, colorToRgba(light.color, tintAlpha * 0.4));
      grad.addColorStop(1, colorToRgba(light.color, 0));

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(screenPos.x, screenPos.y);
      ctx.arc(screenPos.x, screenPos.y, screenRadius, dir - halfAngle, dir + halfAngle);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------------
  // Shadow drawing — handles both polygon and circle occluders.
  // Reach is always the room diagonal; clip rect prevents bleed.
  // Radial gradient fades shadow from opaque near occluder to transparent.
  // ------------------------------------------------------------------------
  private _drawOccluderShadows(
    ctx: CanvasRenderingContext2D,
    lightScreen: Vector,
    occluders: ({ kind: "poly"; verts: Vector[] } | { kind: "circle"; center: Vector; radius: number })[],
    reach: number,
    camera: Camera,
    w: number,
    h: number,
    pixelRatio: number,
  ): void {
    for (const occ of occluders) {
      if (occ.kind === "circle") {
        // Build gradient from light outward through the circle
        const center = worldToScreen(occ.center, camera, w, h, pixelRatio);
        const dx = center.x - lightScreen.x;
        const dy = center.y - lightScreen.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nearDist = Math.max(0, dist - occ.radius * camera.zoom * pixelRatio);
        const grad = ctx.createRadialGradient(lightScreen.x, lightScreen.y, nearDist, lightScreen.x, lightScreen.y, reach);
        grad.addColorStop(0, "rgba(0,0,0,0.92)");
        grad.addColorStop(0.4, "rgba(0,0,0,0.6)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        drawShadowCircle(ctx, lightScreen, occ.center, occ.radius, camera, w, h, reach, grad, pixelRatio);
      } else {
        const poly = shadowPolygon(lightScreen, occ.verts, camera, w, h, reach, pixelRatio);
        if (poly.length < 3) continue;

        const nearMidX = (poly[0].x + poly[3].x) / 2;
        const nearMidY = (poly[0].y + poly[3].y) / 2;
        const nearDist = Math.sqrt((nearMidX - lightScreen.x) ** 2 + (nearMidY - lightScreen.y) ** 2);

        const grad = ctx.createRadialGradient(lightScreen.x, lightScreen.y, nearDist, lightScreen.x, lightScreen.y, reach);
        grad.addColorStop(0, "rgba(0,0,0,0.92)");
        grad.addColorStop(0.4, "rgba(0,0,0,0.6)");
        grad.addColorStop(1, "rgba(0,0,0,0)");

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /** Call this when the scene is deactivated to remove the overlay DOM node. */
  destroy(): void {
    this.overlay.remove();
    this.resizeObserver?.disconnect();
  }
}
