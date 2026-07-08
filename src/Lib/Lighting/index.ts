// lighting/index.ts
// ---------------------------------------------------------
// Public API — import everything from this single file.
// ---------------------------------------------------------
export { DarknessComponent, AmbientLightComponent } from "./LightingComponents";
export { PointLightComponent, ConeLightComponent } from "./LightingComponents";
export { LightOccluderComponent } from "./LightingComponents";
export type { FlickerOptions, OccluderShape } from "./LightingComponents";
export { LightingSystem } from "./LightingSystem";
export { FlickerSystem } from "./FlickerSystem";
