import type { PencilExperience } from './experience'
import { registerLook } from './look'

/**
 * Single place where scene modules are attached to the experience.
 * Each feature area owns its own block — keep them separate.
 */
export function registerModules(exp: PencilExperience): void {
  void exp

  // ---- look: pointer rig / light sweep / post FX / contact shadows ----
  registerLook(exp)

  // ---- drawing: technical-drawing overlay / x-ray scan / mechanism ----

  // ---- lineup: 3D variant ring ---------------------------------------
}
