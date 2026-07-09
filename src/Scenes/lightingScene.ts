import { Engine, Scene, SceneActivationContext, vec } from "excalibur";
import { Room, Lamp, Crate, Player } from "../Actors/actors";
import { FlickerSystem, LightingSystem } from "../Lib/Lighting";

export class LightingScene extends Scene {
  lighting: LightingSystem | null = null;

  onInitialize(engine: Engine): void {
    //Room 1 stuff
    this.add(new Room(vec(0, 0)));
    this.add(new Lamp(vec(150, -100)));
    this.add(new Crate(vec(100, 100)));
    this.add(new Crate(vec(-100, 150)));
    this.add(new Crate(vec(0, -140)));
    this.add(new Crate(vec(0, 150)));

    //Room2 stuff
    this.add(new Room(vec(900, 0)));

    //Player
    this.add(new Player(vec(925, -100)));

    this.lighting = new LightingSystem({
      scene: this,
      engine: this.engine,
      pos: vec(0, 0),
    });
    this.world.add(FlickerSystem);
    this.world.add(this.lighting);
    this.camera.zoom = 0.5;
    this.camera.pos = vec(925, 0);
  }

  onActivate(context: SceneActivationContext<unknown, undefined>): void {
    // setTimeout(() => {
    //   this.engine.goToScene("test");
    // }, 3000);
  }

  onDeactivate(context: SceneActivationContext) {}
}
