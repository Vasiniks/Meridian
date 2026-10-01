/**
 * State shared by the LOOK modules within one frame. Written by the rig
 * (first look module in the frame), read by light / shadow / post.
 */
export interface LookShared {
  /** scroll velocity, viewport-heights per second (signed, + = down) */
  vhps: number
  /** normalized velocity −1..1, critically-damped (inertia + CA source) */
  vs: number
  /** seconds since the last pointer move or scroll tick */
  idle: number
  /** idle-breathing weight 0..1 */
  breath: number
  /** pointer rig is allowed (fine pointer, motion on, not frozen) */
  pointerLive: boolean
  /** damped pointer, −1..1 (0 when the rig is off) */
  px: number
  py: number
  /** max scroll in px (refreshed on resize) */
  maxScroll: number
  /** dev/test only: multiplies dt for the look dampers (screenshots) */
  timeScale: number
}

export const createShared = (): LookShared => ({
  vhps: 0,
  vs: 0,
  idle: 0,
  breath: 0,
  pointerLive: false,
  px: 0,
  py: 0,
  maxScroll: 1,
  timeScale: 1,
})

/** True on touch-first devices (no hover, coarse pointer). */
export const isCoarseDevice = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: none), (pointer: coarse)').matches
