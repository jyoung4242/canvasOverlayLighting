import { Component, Color, Vector } from "excalibur";

// ---------------------------------------------------------------------------
// DarknessComponent
// Attach to a single "world" actor (or the scene itself via a singleton actor).
// Controls the global darkness veil drawn over the entire scene.
// ---------------------------------------------------------------------------
export class DarknessComponent extends Component {
  readonly type = "Darkness";

  constructor(
    public color: Color = Color.fromRGB(0, 0, 10),
    public intensity: number = 0.85, // 0 = no darkness, 1 = pitch black
    /** Width of the darkness region in world-space pixels (match your room actor) */
    public width: number = Infinity,
    /** Height of the darkness region in world-space pixels (match your room actor) */
    public height: number = Infinity,
  ) {
    super();
  }
}

// ---------------------------------------------------------------------------
// AmbientLightComponent
// Attach to the same world actor as DarknessComponent.
// Raises the brightness floor uniformly — the darkness is never fully black.
// ---------------------------------------------------------------------------
export class AmbientLightComponent extends Component {
  readonly type = "AmbientLight";

  constructor(
    public color: Color = Color.White,
    public intensity: number = 0.05, // 0 = no ambient, 1 = fully lit
    public enabled: boolean = true, // <-- ADDED
  ) {
    super();
  }
}

// ---------------------------------------------------------------------------
// PointLightComponent
// Attach to any actor. The light origin tracks the actor's world position.
// ---------------------------------------------------------------------------
export interface FlickerOptions {
  /** Frequency of the flicker oscillation in Hz */
  speed: number;
  /** Max deviation from base intensity (0–1). 0.3 = ±30% */
  amplitude: number;
  /** Add a second sine at a different freq for organic feel */
  secondarySpeed?: number;
}

export class PointLightComponent extends Component {
  readonly type = "PointLight";

  /** Runtime-computed intensity after flicker is applied (written by FlickerSystem) */
  currentIntensity: number;

  constructor(
    public color: Color = Color.White,
    public intensity: number = 1.0,
    public radius: number = 150, // world-space pixels
    public flicker?: FlickerOptions,
    public enabled: boolean = true, // <-- ADDED
  ) {
    super();
    this.currentIntensity = intensity;
  }
}

// ---------------------------------------------------------------------------
// ConeLightComponent
// Like a point light but restricted to an angular wedge.
// Attach to any actor; direction is in world space (radians, 0 = right).
// ---------------------------------------------------------------------------
export class ConeLightComponent extends Component {
  readonly type = "ConeLight";

  currentIntensity: number;

  constructor(
    public color: Color = Color.White,
    public intensity: number = 1.0,
    public radius: number = 200,
    /** Full cone angle in radians. Math.PI / 4 = 45°, Math.PI / 2 = 90° */
    public angle: number = Math.PI / 3,
    /** Direction the cone faces, in radians (world space) */
    public direction: number = 0,
    /** 0 = hard edge, 1 = fully soft edge */
    public softness: number = 0.25,
    public flicker?: FlickerOptions,
    public enabled: boolean = true, // <-- ADDED
  ) {
    super();
    this.currentIntensity = intensity;
  }
}

// ---------------------------------------------------------------------------
// LightOccluderComponent
// Attach to any actor that should cast shadows / block light.
// The shape is defined in LOCAL space; LightingSystem transforms to world space.
// ---------------------------------------------------------------------------
export type OccluderShape =
  | { kind: "box"; width: number; height: number }
  | { kind: "polygon"; vertices: Vector[] }
  | { kind: "circle"; radius: number };

export class LightOccluderComponent extends Component {
  readonly type = "LightOccluder";

  constructor(
    public shape: OccluderShape,
    /** If false the occluder blocks the canvas gradient but skips shadow polygon calc */
    public castShadows: boolean = true,
  ) {
    super();
  }

  /** Returns vertices in local space for box/polygon shapes. Returns [] for circles. */
  localVertices(): Vector[] {
    if (this.shape.kind === "circle") return [];
    if (this.shape.kind === "polygon") return this.shape.vertices;
    const hw = this.shape.width / 2;
    const hh = this.shape.height / 2;
    return [new Vector(-hw, -hh), new Vector(hw, -hh), new Vector(hw, hh), new Vector(-hw, hh)];
  }
}
