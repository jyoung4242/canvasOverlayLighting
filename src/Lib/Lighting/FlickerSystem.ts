import { System, SystemType, World, Query } from "excalibur";
import { PointLightComponent, ConeLightComponent } from "./LightingComponents";

/**
 * FlickerSystem
 *
 * Runs every tick (before LightingSystem draws).
 * Modulates `currentIntensity` on PointLightComponent and ConeLightComponent
 * using layered sine waves so lights feel organic without any draw calls.
 */
export class FlickerSystem extends System {
  readonly systemType = SystemType.Update;
  readonly priority = 50; // before LightingSystem (which draws at postdraw time)

  private pointQuery!: Query<typeof PointLightComponent>;
  private coneQuery!: Query<typeof ConeLightComponent>;
  private elapsed = 0;

  initialize(world: World): void {
    this.pointQuery = world.query([PointLightComponent]);
    this.coneQuery = world.query([ConeLightComponent]);
  }

  update(delta: number): void {
    this.elapsed += delta / 1000; // convert ms → seconds
    const t = this.elapsed;

    for (const entity of this.pointQuery.entities) {
      const light = entity.get(PointLightComponent)!;
      if (!light.flicker) {
        light.currentIntensity = light.intensity;
        continue;
      }
      const { speed, amplitude, secondarySpeed } = light.flicker;
      let offset = Math.sin(t * speed * Math.PI * 2) * amplitude;
      if (secondarySpeed) {
        offset += Math.sin(t * secondarySpeed * Math.PI * 2) * amplitude * 0.4;
        offset /= 1.4; // normalize so total range stays within amplitude
      }
      light.currentIntensity = Math.max(0, light.intensity + offset);
    }

    for (const entity of this.coneQuery.entities) {
      const light = entity.get(ConeLightComponent)!;
      if (!light.flicker) {
        light.currentIntensity = light.intensity;
        continue;
      }
      const { speed, amplitude, secondarySpeed } = light.flicker;
      let offset = Math.sin(t * speed * Math.PI * 2) * amplitude;
      if (secondarySpeed) {
        offset += Math.sin(t * secondarySpeed * Math.PI * 2) * amplitude * 0.4;
        offset /= 1.4;
      }
      light.currentIntensity = Math.max(0, light.intensity + offset);
    }
  }
}
