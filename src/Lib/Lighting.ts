import { System, SystemType } from "excalibur";

export class Lighting extends System {
  systemType: SystemType = SystemType.Update;

  constructor() {
    super();
  }

  update(elapsed: number): void {
    throw new Error("Method not implemented.");
  }
}
