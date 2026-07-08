// main.ts
import { Crate, Lamp, Player, Room } from "./Actors/actors";
import { FlickerSystem, LightingSystem } from "./Lib/Lighting/";
import { loader } from "./resources";
import { LightingScene } from "./Scenes/lightingScene";
import { TestScene } from "./Scenes/testScene";
import "./style.css";

import { Engine, DisplayMode, vec, Vector } from "excalibur";

const game = new Engine({
  width: 800, // the width of the canvas
  height: 600, // the height of the canvas
  displayMode: DisplayMode.Fixed, // the display mode
  pixelArt: true,
  scenes: {
    light: new LightingScene(),
    test: new TestScene(),
  },
});

await game.start(loader);
game.goToScene("light");
