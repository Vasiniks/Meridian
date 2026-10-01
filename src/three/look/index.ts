import type { PencilExperience } from '../experience'
import { ContactShadows } from './contactShadows'
import { LightSweep } from './light'
import { PostFx } from './postfx'
import { PointerRig } from './rig'
import { createShared } from './shared'

export { ContactShadows, LightSweep, PostFx, PointerRig }

/**
 * LOOK layer: how the 3D scene feels and is lit. Order matters — the rig
 * runs first each frame (it publishes scroll velocity + pointer state the
 * others read), the light follows the rig, post reads both.
 *
 * Other areas reach these through the experience:
 *   exp.getModule<PointerRig>('look:rig')        .group · .setWeight()
 *   exp.getModule<LightSweep>('look:light')      .streak() (or bus 'look:streak')
 *   exp.getModule<ContactShadows>('look:shadow') .addCaster() · .setFloor() · .setWeight()
 *   exp.getModule<PostFx>('look:post')           .state
 */
export function registerLook(exp: PencilExperience): void {
  // dev-only A/B switch: ?nolook renders the scene without the look layer
  if (import.meta.env.DEV && location.search.includes('nolook')) return
  const shared = createShared()
  const rig = new PointerRig(shared)
  const light = new LightSweep(shared)
  const shadow = new ContactShadows()
  const post = new PostFx(shared)
  exp.addModule(rig)
  exp.addModule(light)
  exp.addModule(shadow)
  exp.addModule(post)
  if (import.meta.env.DEV || location.search.includes('dbg')) {
    ;(window as unknown as { __look?: unknown }).__look = {
      shared,
      rig,
      light,
      shadow,
      post,
      debug: () => ({ ...shared, post: post.state, yaw: light.yaw, shadow: shadow.stats }),
    }
  }
}
