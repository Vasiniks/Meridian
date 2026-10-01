import type { PencilExperience } from './experience'

/**
 * Single place where scene modules are attached to the experience.
 * Each feature area owns its own block — keep them separate.
 */
export function registerModules(exp: PencilExperience): void {
  void exp

  // ---- look: pointer rig / light sweep / post FX / contact shadows ----

  // ---- drawing: technical-drawing overlay / x-ray scan / mechanism ----

  // ---- lineup: 3D variant ring ---------------------------------------
}
