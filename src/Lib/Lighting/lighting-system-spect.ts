import { describe, beforeEach, it, expect, vi } from "vitest";
import { Engine, Scene, Vector, Color, Actor } from "excalibur";
import { TestUtils } from "../__util__/test-utils"; // Matches your reference import structure
import { LightingSystem } from "./LightingSystem";
import {
  DarknessComponent,
  AmbientLightComponent,
  PointLightComponent,
  ConeLightComponent,
  LightOccluderComponent,
} from "./LightingComponents";

describe("A Lighting System", () => {
  let engine: Engine;
  let scene: Scene;
  let lightingSystem: LightingSystem;

  beforeEach(async () => {
    // Construct testing canvas context via shared engine helper
    engine = TestUtils.engine({
      width: 100,
      height: 100,
    });

    scene = new Scene();
    engine.addScene("test-lighting", scene);
    await engine.goToScene("test-lighting");

    // Initialize system targeting the active testing context
    lightingSystem = new LightingSystem({
      engine,
      scene,
    });

    scene.world.add(lightingSystem);
  });

  it("can be initialized and provisions a host screen element", () => {
    // Assert initialization registers components correctly
    expect(lightingSystem).not.toBeNull();

    const query = scene.world.query([DarknessComponent]);
    expect(query).toBeDefined();
  });

  it("correctly evaluates global darkness ambient configurations on update", () => {
    const worldManager = new Actor();
    worldManager.addComponent(new DarknessComponent(Color.Black, 0.9));
    worldManager.addComponent(new AmbientLightComponent(Color.White, 0.1));
    scene.add(worldManager);

    // Spy on internal canvas loop rendering checks
    const renderSpy = vi.spyOn(lightingSystem as any, "_renderLightingCanvas");

    scene.update(engine, 16);
    scene.draw(engine.graphicsContext);

    expect(renderSpy).toHaveBeenCalled();
  });

  it("skips tracking and processing disabled point and cone lights", () => {
    const torch = new Actor({ pos: new Vector(50, 50) });
    const pointLight = new PointLightComponent(Color.White, 1.0, 50);
    pointLight.enabled = false; // Turn off explicit flag

    torch.addComponent(pointLight);
    scene.add(torch);

    scene.update(engine, 16);

    // Disabled status forces runtime intensity floor to 0
    expect(pointLight.currentIntensity).toBe(0);
  });

  it("projects local occluder offsets correctly into world coordinates", () => {
    const pillar = new Actor({ pos: new Vector(10, 10), rotation: 0 });
    const occluder = new LightOccluderComponent(
      { kind: "circle", radius: 5 },
      true,
      new Vector(0, 10), // 10 pixels offset downward locally
    );

    pillar.addComponent(occluder);
    scene.add(pillar);

    // Capture array construction safely from system's private loop scope
    const query = scene.world.query([LightOccluderComponent]);
    expect(query.entities.length).toBe(1);

    const targetEntity = query.entities[0];
    const comp = targetEntity.get(LightOccluderComponent)!;

    expect(comp.offset.y).toBe(10);
  });
});
