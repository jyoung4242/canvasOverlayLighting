// main.ts
import { Crate, Lamp, Player, Room } from "./Actors/actors";
import { FlickerSystem, LightingSystem } from "./Lib/Lighting/";
import { loader } from "./resources";
import "./style.css";

import { Engine, DisplayMode, vec } from "excalibur";

const game = new Engine({
  width: 800, // the width of the canvas
  height: 600, // the height of the canvas
  displayMode: DisplayMode.Fixed, // the display mode
  pixelArt: true,
});

await game.start(loader);

let scene = game.currentScene;
game.add(new Room());
game.add(new Lamp(vec(150, -100)));
game.add(new Crate(vec(100, 100)));
game.add(new Crate(vec(-100, 150)));
game.add(new Crate(vec(0, -140)));
game.add(new Crate(vec(0, 150)));
game.add(new Player(vec(-100, -100)));

scene.world.add(FlickerSystem);
scene.world.add(LightingSystem);
