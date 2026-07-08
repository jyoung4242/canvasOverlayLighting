import { Actor, Color, Engine, vec, Vector } from "excalibur";
import { Resources } from "../resources";
import { ConeLightComponent, DarknessComponent, LightOccluderComponent } from "../Lib/Lighting/";
import { AmbientLightComponent } from "../Lib/Lighting/";
import { PointLightComponent } from "../Lib/Lighting/";
import { KeyboardControl } from "../Components/KeyboardControl";
import { FogActor } from "./fogActor";

export class Room extends Actor {
  darkness: DarknessComponent;
  ambient: AmbientLightComponent;
  // fog: FogActor;

  constructor() {
    super({
      width: 736,
      height: 461,
      pos: Vector.Zero,
    });
    // this.fog = new FogActor({
    //   fogWidth: 736,
    //   fogHeight: 461,
    //   offset: vec(-736 / 2, -461 / 2),
    //   scrollSpeedX: 15,
    //   scrollSpeedY: 0,
    // });
    // this.addChild(this.fog);
    this.graphics.use(Resources.room.toSprite());
    this.darkness = new DarknessComponent(
      Color.fromRGB(5, 5, 20),
      0.9,
      736, // ← match your room width
      461, // ← match your room height
    );
    this.ambient = new AmbientLightComponent(
      Color.fromRGB(60, 60, 200), // cool ambient
      0.05,
    );
    this.addComponent(this.darkness);
    this.addComponent(this.ambient);
  }

  onInitialize(engine: Engine): void {
    engine.currentScene.camera.strategy.lockToActor(this);
  }
}
export class Crate extends Actor {
  occluder: LightOccluderComponent;
  constructor(pos: Vector) {
    super({
      width: 29,
      height: 36,
      pos,
    });
    this.graphics.use(Resources.crate.toSprite());
    this.occluder = new LightOccluderComponent(
      { kind: "box", width: 29, height: 36 },
      true, // castShadows
    );
    this.addComponent(this.occluder);
  }
}
export class Lamp extends Actor {
  isPointerDown: boolean = false;
  pointLight: PointLightComponent;
  constructor(pos: Vector = vec(150, -100)) {
    super({
      width: 32,
      height: 32,
      pos,
    });
    this.graphics.use(Resources.lamp.toSprite());
    this.pointLight = new PointLightComponent(
      Color.fromRGB(255, 200, 80), // warm yellow
      0.45,
      250,
      { speed: 2.5, amplitude: 0.08, secondarySpeed: 5.1 }, // subtle torch flicker
    );
    this.addComponent(this.pointLight);
  }
}

export class Player extends Actor {
  kc: KeyboardControl;
  ConeLight: ConeLightComponent; //PointLightComponent
  constructor(pos: Vector = vec(150, -100)) {
    super({
      radius: 16,
      pos,
      color: Color.Red,
    });
    this.kc = new KeyboardControl(75);
    this.ConeLight = new ConeLightComponent(
      Color.fromRGB(255, 200, 80), // warm yellow
      0.25,
      325,
      Math.PI / 4,
      (Math.PI * 3) / 2,
      0.25,
      { speed: 2.5, amplitude: 0.08, secondarySpeed: 5.1 }, // subtle torch flicker
    );
    // this.addComponent(this.ConeLight);
    // this.ConeLight = new PointLightComponent(Color.fromRGB(255, 200, 80), 0.6, 100, {
    //   speed: 2.0,
    //   amplitude: 0.07,
    //   secondarySpeed: 5.1,
    // });
    this.addComponent(this.ConeLight);
  }

  onInitialize(engine: Engine): void {
    this.addComponent(this.kc);
    this.kc.init(this);
    this.body.enableFixedUpdateInterpolate = false;
  }

  onPostUpdate(engine: Engine, delta: number) {
    if (this.vel.magnitude > 0) {
      const targetAngle = Math.atan2(this.vel.y, this.vel.x);
      // t scales with delta so speed is frame-rate independent
      const t = 1 - Math.pow(0.01, delta / 1000);
      this.ConeLight.direction = lerpAngle(this.ConeLight.direction, targetAngle, t);
    }
  }
}

function lerpAngle(current: number, target: number, t: number): number {
  // Normalize the difference to [-π, π] so we always take the short path
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * t;
}
