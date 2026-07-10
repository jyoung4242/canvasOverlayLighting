import { Component, Color, Vector } from "excalibur";

/**
 * Controls the global darkness veil drawn over a scene or room.
 * Attach this to a single world entity or room manager.
 */
export class DarknessComponent extends Component {
  readonly type = "Darkness";

  constructor(
    public color: Color = Color.fromRGB(0, 0, 10),
    public intensity: number = 0.85,
    /** Width of the darkness boundary in world pixels. Set to Infinity for global coverage. */
    public width: number = Infinity,
    /** Height of the darkness boundary in world pixels. Set to Infinity for global coverage. */
    public height: number = Infinity,
  ) {
    super();
  }
}

/**
 * Raises the uniform minimum brightness floor, ensuring absolute darkness is never pitch black.
 */
export class AmbientLightComponent extends Component {
  readonly type = "AmbientLight";

  constructor(
    public color: Color = Color.White,
    public intensity: number = 0.05,
    public enabled: boolean = true,
  ) {
    super();
  }
}

export interface FlickerOptions {
  /** Frequency of the flicker oscillation in Hz. */
  speed: number;
  /** Maximum deviation from base intensity (0.0 to 1.0). */
  amplitude: number;
  /** Optional secondary wave frequency for asymmetrical, organic modulation. */
  secondarySpeed?: number;
}

/**
 * Emits light uniformly in all directions from the parent entity's position.
 */
export class PointLightComponent extends Component {
  readonly type = "PointLight";
  /** Runtime intensity after flicker calculations are applied. */
  currentIntensity: number;

  constructor(
    public color: Color = Color.White,
    public intensity: number = 1.0,
    public radius: number = 150,
    public flicker?: FlickerOptions,
    public enabled: boolean = true,
  ) {
    super();
    this.currentIntensity = intensity;
  }
}

/**
 * Emits light restricted to a directional angular wedge.
 */
export class ConeLightComponent extends Component {
  readonly type = "ConeLight";
  /** Runtime intensity after flicker calculations are applied. */
  currentIntensity: number;

  constructor(
    public color: Color = Color.White,
    public intensity: number = 1.0,
    public radius: number = 200,
    /** Total angle arc of the wedge in radians. */
    public angle: number = Math.PI / 3,
    /** World-space heading angle in radians (0 = Right). */
    public direction: number = 0,
    /** Edge smoothing ratio. 0.0 represents hard cuts, 1.0 represents full dissipation. */
    public softness: number = 0.25,
    public flicker?: FlickerOptions,
    public enabled: boolean = true,
  ) {
    super();
    this.currentIntensity = intensity;
  }
}

export type OccluderShape =
  | { kind: "box"; width: number; height: number }
  | { kind: "polygon"; vertices: Vector[] }
  | { kind: "circle"; radius: number };

/**
 * Marks an entity as a light-blocking obstacle that projects dynamic shadows.
 */
export class LightOccluderComponent extends Component {
  readonly type = "LightOccluder";

  constructor(
    public shape: OccluderShape,
    /** When false, blocks the canvas light buffer directly but skips shadow volume geometry generation. */
    public castShadows: boolean = true,
    /** Local space coordinate offset shifting the occluder geometry away from the transform origin. */
    public offset: Vector = Vector.Zero,
  ) {
    super();
  }

  /**
   * Evaluates the bounding shape vertices in local space, factoring in local offsets.
   * Returns an empty array for circular primitives.
   */
  localVertices(): Vector[] {
    if (this.shape.kind === "circle") return [];

    let baseVerts: Vector[] = [];
    if (this.shape.kind === "polygon") {
      baseVerts = this.shape.vertices;
    } else {
      const hw = this.shape.width / 2;
      const hh = this.shape.height / 2;
      baseVerts = [new Vector(-hw, -hh), new Vector(hw, -hh), new Vector(hw, hh), new Vector(-hw, hh)];
    }

    return baseVerts.map(v => v.add(this.offset));
  }
}
