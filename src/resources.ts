// resources.ts
import { ImageSource, Loader } from "excalibur";
import crate from "./Assets/crate.png"; // replace this
import room from "./Assets/floor.png"; // replace this
import lamp from "./Assets/lamp.png"; // replace this

export const Resources = {
  crate: new ImageSource(crate),
  room: new ImageSource(room),
  lamp: new ImageSource(lamp),
};

export const loader = new Loader();

for (let res of Object.values(Resources)) {
  loader.addResource(res);
}
