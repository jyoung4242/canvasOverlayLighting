import { System, SystemType, World, Query } from "excalibur";
import { PointLightComponent, ConeLightComponent } from "./LightingComponents";

/**
 * Modulates active light intensities ahead of the lighting render pass
 * utilizing deterministic layered sine waves.
 */
export class FlickerSystem extends System {
  readonly systemType = SystemType.Update;
  readonly priority = 50;

  private pointQuery!: Query<typeof PointLightComponent>;
  private coneQuery!: Query<typeof ConeLightComponent>;
  private elapsed = 0;

  initialize(world: World): void {
    this.pointQuery = world.query([PointLightComponent]);
    this.coneQuery = world.query([ConeLightComponent]);
  }

  update(delta: number): void {
    this.elapsed += delta / 1000;
    const t = this.elapsed;

    for (const entity of this.pointQuery.entities) {
      const light = entity.get(PointLightComponent)!;

      if (!light.enabled) {
        light.currentIntensity = 0;
        continue;
      }

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

    for (const entity of this.coneQuery.entities) {
      const light = entity.get(ConeLightComponent)!;

      if (!light.enabled) {
        light.currentIntensity = 0;
        continue;
      }

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
