import { System, SystemType, World, Query, Engine, Scene, Vector, Color, TransformComponent, ScreenElement, Canvas } from "excalibur";
import {
  DarknessComponent,
  AmbientLightComponent,
  PointLightComponent,
  ConeLightComponent,
  LightOccluderComponent,
} from "./LightingComponents";

export interface LightingSystemOptions {
  /** The composite canvas rendering stack z-index. Defaults to 100. */
  zIndex?: number;
  /** Fixed anchor screen positioning coordinate defaults to Vector.Zero. */
  pos?: Vector;
  /** Fixed resolution dimensions. Defaults to viewport screen dimensions when omitted. */
  size?: { width: number; height: number };
  /** Hook an external ScreenElement host rather than provisioning an independent one. */
  screenElement?: ScreenElement;
  engine: Engine;
  scene: Scene;
}

/** Projects a world position into unified viewport screen space pixels. */
function worldToScreen(worldPos: Vector, engine: Engine): Vector {
  return engine.screen.worldToScreenCoordinates(worldPos);
}

/** Projects local vertex chains out into full absolute world coordinates. */
function localToWorld(vertices: Vector[], worldPos: Vector, rotation: number): Vector[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return vertices.map(v => new Vector(worldPos.x + v.x * cos - v.y * sin, worldPos.y + v.x * sin + v.y * cos));
}

/** Translates an Excalibur Color object into standard CSS rgba string format. */
function colorToRgba(color: Color, alpha: number): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

/** Computes a 2D shadow volume polygon projecting away from a light source point. */
function shadowPolygon(lightScreen: Vector, occluderVerts: Vector[], engine: Engine, reach: number): Vector[] {
  const screenVerts = occluderVerts.map(v => worldToScreen(v, engine));

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

/** Renders a circular profile occlusion shadow block masking light distribution. */
function drawShadowCircle(
  ctx: CanvasRenderingContext2D,
  lightScreen: Vector,
  centerWorld: Vector,
  worldRadius: number,
  engine: Engine,
  reach: number,
  grad: CanvasGradient,
): void {
  const center = worldToScreen(centerWorld, engine);
  const screenRadius = worldRadius * engine.currentScene.camera.zoom;

  const dx = center.x - lightScreen.x;
  const dy = center.y - lightScreen.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist <= screenRadius) return;

  const angleToCenter = Math.atan2(dy, dx);
  const halfAngle = Math.asin(Math.min(1, screenRadius / dist));

  const t1 = angleToCenter - halfAngle;
  const t2 = angleToCenter + halfAngle;

  const tp1 = new Vector(center.x + Math.cos(t1 + Math.PI / 2) * screenRadius, center.y + Math.sin(t1 + Math.PI / 2) * screenRadius);
  const tp2 = new Vector(center.x + Math.cos(t2 - Math.PI / 2) * screenRadius, center.y + Math.sin(t2 - Math.PI / 2) * screenRadius);

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
  ctx.arc(center.x, center.y, screenRadius, t2 - Math.PI / 2, t1 + Math.PI / 2, true);
  ctx.closePath();
  ctx.fill();
}

/**
 * Composite canvas-driven visibility system tracking ambient, darkness,
 * light masks, and ray projected shadow volumes.
 */
export class LightingSystem extends System {
  readonly systemType = SystemType.Update;

  private lightingEntity!: ScreenElement;
  private lightingCanvas!: Canvas;
  private options: LightingSystemOptions;
  engine: Engine;
  scene: Scene;

  private cullPadding = 64;
  private offscreen: HTMLCanvasElement | null = null;
  private offscreenCTX: CanvasRenderingContext2D | null = null;

  private darknessXfQuery!: Query<typeof DarknessComponent | typeof TransformComponent>;
  private ambientQuery!: Query<typeof AmbientLightComponent>;
  private pointXfQuery!: Query<typeof PointLightComponent | typeof TransformComponent>;
  private coneXfQuery!: Query<typeof ConeLightComponent | typeof TransformComponent>;
  private occluderXfQuery!: Query<typeof LightOccluderComponent | typeof TransformComponent>;

  constructor(options: LightingSystemOptions) {
    super();
    this.engine = options.engine;
    this.scene = options.scene;
    this.options = options;
  }

  initialize(world: World, scene: Scene): void {
    const engine = scene.engine;

    this.darknessXfQuery = world.query([DarknessComponent, TransformComponent]);
    this.ambientQuery = world.query([AmbientLightComponent]);
    this.pointXfQuery = world.query([PointLightComponent, TransformComponent]);
    this.coneXfQuery = world.query([ConeLightComponent, TransformComponent]);
    this.occluderXfQuery = world.query([LightOccluderComponent, TransformComponent]);

    this.offscreen = document.createElement("canvas");
    this.offscreenCTX = this.offscreen.getContext("2d");

    const initialWidth = this.options.size?.width ?? engine.screen.drawWidth;
    const initialHeight = this.options.size?.height ?? engine.screen.drawHeight;

    this.offscreen.width = initialWidth;
    this.offscreen.height = initialHeight;

    this.lightingCanvas = new Canvas({
      width: initialWidth,
      height: initialHeight,
      draw: ctx => {
        this._renderLightingCanvas(ctx);
      },
    });

    if (this.options.screenElement) {
      this.lightingEntity = this.options.screenElement;
    } else {
      this.lightingEntity = new ScreenElement({
        name: "lighting",
        pos: this.options.pos ?? Vector.Zero,
        width: initialWidth,
        height: initialHeight,
        z: this.options.zIndex ?? 100,
        color: Color.Transparent,
      });
      scene.add(this.lightingEntity);
    }

    this.lightingEntity.graphics.use(this.lightingCanvas);
  }

  update(delta: number): void {
    const engine = this.engine;

    if (!this.options.size) {
      if (this.lightingCanvas.width !== engine.screen.drawWidth || this.lightingCanvas.height !== engine.screen.drawHeight) {
        const w = engine.screen.drawWidth;
        const h = engine.screen.drawHeight;

        this.lightingCanvas.width = w;
        this.lightingCanvas.height = h;

        if (this.lightingEntity.graphics.current) {
          this.lightingEntity.graphics.current.width = w;
          this.lightingEntity.graphics.current.height = h;
        }

        if (this.offscreen) {
          this.offscreen.width = w;
          this.offscreen.height = h;
        }
      }
    }

    this.lightingCanvas.flagDirty();
  }

  private _drawOccluderShadows(
    ctx: CanvasRenderingContext2D,
    lightScreen: Vector,
    occluders: any[],
    reach: number,
    w: number,
    h: number,
  ): void {
    const camera = this.scene.camera;
    for (const occ of occluders) {
      if (occ.kind === "circle") {
        const centerScreen = worldToScreen(occ.center, this.engine);
        const dx = centerScreen.x - lightScreen.x;
        const dy = centerScreen.y - lightScreen.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const nearDist = Math.max(0, dist - occ.radius * camera.zoom);
        const grad = ctx.createRadialGradient(lightScreen.x, lightScreen.y, nearDist, lightScreen.x, lightScreen.y, reach);
        grad.addColorStop(0, "rgba(0,0,0,0.92)");
        grad.addColorStop(0.4, "rgba(0,0,0,0.6)");
        grad.addColorStop(1, "rgba(0,0,0,0)");

        drawShadowCircle(ctx, lightScreen, occ.center, occ.radius, this.engine, reach, grad);
      } else {
        const poly = shadowPolygon(lightScreen, occ.verts, this.engine, reach);
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

  private _renderLightingCanvas(ctx: CanvasRenderingContext2D): void {
    // Add these type aliases right before using them:
    type PolyOccluder = { kind: "poly"; verts: Vector[] };
    type CircleOccluder = { kind: "circle"; center: Vector; radius: number };
    type Occluder = PolyOccluder | CircleOccluder;
    const engine = this.engine;
    const camera = this.scene.camera;

    const w = this.lightingCanvas.width;
    const h = this.lightingCanvas.height;
    const effectiveZoom = camera.zoom;

    ctx.clearRect(0, 0, w, h);

    let ambientIntensity = 0.05;
    for (const e of this.ambientQuery.entities) {
      const a = e.get(AmbientLightComponent)!;
      ambientIntensity = a.enabled ? a.intensity : 0;
    }

    const roomClips: { x: number; y: number; w: number; h: number }[] = [];

    for (const e of this.darknessXfQuery.entities) {
      const d = e.get(DarknessComponent)!;
      const xf = e.get(TransformComponent)!;

      if (d.width === Infinity || d.height === Infinity) {
        const effectiveAlpha = Math.max(0, d.intensity - ambientIntensity);
        ctx.fillStyle = colorToRgba(d.color, effectiveAlpha);
        ctx.fillRect(0, 0, w, h);
        continue;
      }

      const hw = (d.width / 2) * effectiveZoom;
      const hh = (d.height / 2) * effectiveZoom;
      const center = worldToScreen(xf.pos, engine);

      const rect = {
        x: center.x - hw,
        y: center.y - hh,
        w: hw * 2,
        h: hh * 2,
      };

      roomClips.push(rect);

      const effectiveAlpha = Math.max(0, d.intensity - ambientIntensity);
      ctx.fillStyle = colorToRgba(d.color, effectiveAlpha);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    const camPos = camera.pos;
    const halfW = w / 2 / effectiveZoom + this.cullPadding;
    const halfH = h / 2 / effectiveZoom + this.cullPadding;
    const camMinX = camPos.x - halfW;
    const camMaxX = camPos.x + halfW;
    const camMinY = camPos.y - halfH;
    const camMaxY = camPos.y + halfH;

    const inCameraView = (worldPos: Vector, radius: number) =>
      worldPos.x + radius > camMinX && worldPos.x - radius < camMaxX && worldPos.y + radius > camMinY && worldPos.y - radius < camMaxY;

    const occluders: Occluder[] = [];
    for (const e of this.occluderXfQuery.entities) {
      const comp = e.get(LightOccluderComponent)!;
      if (!comp.castShadows) continue;
      const xf = e.get(TransformComponent)!;

      if (comp.shape.kind === "circle") {
        const cos = Math.cos(xf.rotation);
        const sin = Math.sin(xf.rotation);
        const rotatedOffset = new Vector(comp.offset.x * cos - comp.offset.y * sin, comp.offset.x * sin + comp.offset.y * cos);

        occluders.push({
          kind: "circle",
          center: xf.pos.add(rotatedOffset),
          radius: comp.shape.radius,
        });
      } else {
        occluders.push({
          kind: "poly",
          verts: localToWorld(comp.localVertices(), xf.pos, xf.rotation),
        });
      }
    }

    const drawLight = (screenPos: Vector, screenRadius: number, alpha: number, drawShape: (c: CanvasRenderingContext2D) => void) => {
      if (!this.offscreenCTX || !this.offscreen) return;
      this.offscreenCTX.clearRect(0, 0, w, h);

      const activeClip = roomClips.find(
        rect => screenPos.x >= rect.x && screenPos.x <= rect.x + rect.w && screenPos.y >= rect.y && screenPos.y <= rect.y + rect.h,
      );

      if (activeClip) {
        this.offscreenCTX.save();
        this.offscreenCTX.beginPath();
        this.offscreenCTX.rect(activeClip.x, activeClip.y, activeClip.w, activeClip.h);
        this.offscreenCTX.clip();
      }

      const shadowReach = activeClip ? Math.sqrt(activeClip.w ** 2 + activeClip.h ** 2) : Math.sqrt(w ** 2 + h ** 2);

      this.offscreenCTX.globalCompositeOperation = "source-over";
      drawShape(this.offscreenCTX);

      this.offscreenCTX.globalCompositeOperation = "destination-out";
      this._drawOccluderShadows(this.offscreenCTX, screenPos, occluders, shadowReach, w, h);

      if (activeClip) this.offscreenCTX.restore();

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

    for (const e of this.pointXfQuery.entities) {
      const light = e.get(PointLightComponent)!;
      if (!light.enabled) continue;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;

      const screenPos = worldToScreen(xf.pos, engine);
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

    for (const e of this.coneXfQuery.entities) {
      const light = e.get(ConeLightComponent)!;
      if (!light.enabled) continue;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;

      const screenPos = worldToScreen(xf.pos, engine);
      const screenRadius = light.radius * effectiveZoom;
      const halfAngle = light.angle / 2;
      const dir = light.direction;
      const alpha = light.currentIntensity;
      const startAngle = dir - halfAngle;
      const endAngle = dir + halfAngle;

      drawLight(screenPos, screenRadius, alpha, c => {
        const softEdgeStart = Math.max(0, 1 - light.softness);

        const grad = c.createRadialGradient(screenPos.x, screenPos.y, 0, screenPos.x, screenPos.y, screenRadius);
        grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
        grad.addColorStop(softEdgeStart * 0.7, `rgba(255,255,255,${alpha * 0.5})`);
        grad.addColorStop(softEdgeStart, `rgba(255,255,255,${alpha * 0.2})`);
        grad.addColorStop(1, "rgba(255,255,255,0)");

        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(screenPos.x, screenPos.y);
        c.arc(screenPos.x, screenPos.y, screenRadius, startAngle, endAngle);
        c.closePath();
        c.fill();
      });
    }

    for (const e of this.pointXfQuery.entities) {
      const light = e.get(PointLightComponent)!;
      if (!light.enabled) continue;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;
      if (light.color.equal(Color.White)) continue;

      const screenPos = worldToScreen(xf.pos, engine);
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
      if (!light.enabled) continue;
      const xf = e.get(TransformComponent)!;
      if (!inCameraView(xf.pos, light.radius)) continue;
      if (light.color.equal(Color.White)) continue;

      const screenPos = worldToScreen(xf.pos, engine);
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
}
