import type { PencilExperience } from './experience'
import { registerLook } from './look'
import { registerDrawing } from './drawing'
import { RingModule } from './ring'

/**
 * Single place where scene modules are attached to the experience.
 * Each feature area owns its own block — keep them separate.
 */
export function registerModules(exp: PencilExperience): void {
  void exp

  // ---- look: pointer rig / light sweep / post FX / contact shadows ----
  registerLook(exp)

  // ---- drawing: technical-drawing overlay / x-ray scan / mechanism ----
  if (!location.search.includes('nodraw')) registerDrawing(exp)

  // ---- lineup: 3D variant ring ---------------------------------------
  exp.addModule(new RingModule({ lookup: (n) => exp.getModule(n) }))
}
