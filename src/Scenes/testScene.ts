import { Scene, SceneActivationContext } from "excalibur";

export class TestScene extends Scene {
  onActivate(context: SceneActivationContext<unknown, undefined>): void {
    if (!this.engine) return;
    setTimeout(() => this.engine.goToScene("light"), 3000);
  }
}
