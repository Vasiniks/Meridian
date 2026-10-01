import { FINISHES } from './finishes'

export type Quality = 'high' | 'low'

export interface QualityConfig {
  quality: Quality
  isSmall: boolean
  mob: number
  dprCap: number
  assetUrl: string
  msaaSamples: number
}

export function detectConfig(): QualityConfig {
  const isSmall = window.matchMedia('(max-width: 900px)').matches
  const isTouch = navigator.maxTouchPoints > 0
  const isLow = (navigator.hardwareConcurrency || 8) <= 4
  const quality: Quality = (isTouch && isSmall) || isLow ? 'low' : 'high'
  return {
    quality,
    isSmall,
    mob: isSmall ? 1.45 : 1,
    dprCap: quality === 'high' ? 2 : 1.5,
    assetUrl:
      quality === 'high'
        ? '/models/desktop/mechanical-pencil.glb'
        : '/models/mobile/mechanical-pencil-mobile.glb',
    // AA investigation: native MSAA on the composer target (desktop only).
    // Post-process AA passes were rejected — double cost, softer facets.
    msaaSamples: quality === 'high' ? 4 : 0,
  }
}

/** Barrel tint per variant (derived from FINISHES — edit colors there). */
export const ANODIZED: Record<string, number> = Object.fromEntries(
  Object.entries(FINISHES).map(([k, f]) => [k, f.color]),
)
