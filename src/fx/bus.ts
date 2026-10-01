import type { VariantName } from '../three/finishes'

/**
 * Tiny typed event bus shared by the DOM effects layer (src/fx) and the 3D
 * experience (src/three). Keeps the two sides decoupled: e.g. the 3D ring
 * announces the variant in front, the DOM overlay and buy form listen.
 */
export type CursorMode = 'default' | 'hover' | 'drag' | 'view' | 'text' | 'hidden'

export interface BusEvents {
  /** Request a cursor state (label shown inside the cursor ring). */
  cursor: { mode: CursorMode; label?: string }
  /** The variant currently presented (e.g. in front of the lineup ring). */
  'variant:active': { name: VariantName }
  /** The user chose a variant (ring click, buy radio). */
  'variant:select': { name: VariantName; source: 'ring' | 'buy' | 'other' }
  /** The user clicked the pencil — play a button click / lead advance. */
  'pencil:click': Record<string, never>
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
