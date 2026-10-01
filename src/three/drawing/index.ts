import type { PencilExperience } from '../experience'
import { MechanismModule } from './mechanism'
import { OverlayModule } from './overlay'
import { DrawingState } from './state'
import { XrayModule } from './xray'

/**
 * Technical drawing + X-ray scan + mechanism (DRAWING agent).
 * Order matters: parts move first, then the x-ray reads their matrices,
 * then the overlay projects anchors from the final pose.
 */
export function registerDrawing(exp: PencilExperience): DrawingState {
  const st = new DrawingState()
  exp.addModule(new MechanismModule(st))
  exp.addModule(new XrayModule(st))
  exp.addModule(new OverlayModule(st))
  return st
}
