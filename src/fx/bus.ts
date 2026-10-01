import type { VariantName } from '../three/finishes'

/**
 * Tiny typed event bus shared by the DOM effects layer (src/fx) and the 3D
 * experience (src/three). Keeps the two sides decoupled: e.g. the 3D ring
 * announces the variant in front, the DOM overlay and buy form listen.
 */
/**
 * Cursor states. `link` (alias `hover`): hairline ring; `drag`/`view`/`part`:
 * ink pill or disc with a mono label; `text`: caret; `hidden`: custom cursor
 * off, native cursor back. `default` clears a state you set.
 */
export type CursorMode =
  | 'default'
  | 'hover'
  | 'link'
  | 'drag'
  | 'view'
  | 'part'
  | 'text'
  | 'hidden'

export interface BusEvents {
  /** Request a cursor state (label shown inside the cursor ring). */
  cursor: { mode: CursorMode; label?: string }
  /** The variant currently presented (e.g. in front of the lineup ring). */
  'variant:active': { name: VariantName }
  /** The user chose a variant (ring click, buy radio). */
  'variant:select': { name: VariantName; source: 'ring' | 'buy' | 'other' }
  /** The user clicked the pencil — play a button click / lead advance. */
  'pencil:click': Record<string, never>
  /** Real asset load progress 0..1 (GLB / HDR bytes), emitted during experience.init. */
  'load:progress': { p: number }
  /** Preloader curtain starts lifting — first reveals may begin. */
  intro: Record<string, never>
  /** Motion allowed (false = reduced-motion preference or the motion toggle). */
  motion: { ok: boolean }
  /** Active page chapter changed (nav title block). index is 0-based, 9 sheets. */
  chapter: { index: number; id: string; label: string }
  /** LOOK: sweep a fast studio-light streak across the pencil(s). */
  'look:streak': { strength?: number; duration?: number }
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void

const handlers = new Map<keyof BusEvents, Set<Handler<keyof BusEvents>>>()

export const bus = {
  on<K extends keyof BusEvents>(type: K, fn: Handler<K>): () => void {
    let set = handlers.get(type)
    if (!set) handlers.set(type, (set = new Set()))
    set.add(fn as Handler<keyof BusEvents>)
    return () => set!.delete(fn as Handler<keyof BusEvents>)
  },
  emit<K extends keyof BusEvents>(type: K, payload: BusEvents[K]): void {
    handlers.get(type)?.forEach((fn) => (fn as Handler<K>)(payload))
  },
}
