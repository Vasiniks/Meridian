/**
 * Variant finishes — the single source of truth for how each lineup
 * variant's barrel material looks. Consumed by the hero tint chase, the
 * lineup ring and the buy pose. Keys match `variants[].name` in
 * src/data/content.ts.
 *
 * `color` is the sRGB hex of the barrel albedo (three converts to linear);
 * roughness/metalness/envIntensity override the GLB's anodized material so
 * a brass Pro and a blasted-titanium Limited differ in more than hue.
 */
export type VariantName = 'Core' | 'Pro' | 'Studio' | 'Limited'

export interface Finish {
  color: number
  roughness: number
  metalness: number
  envIntensity: number
}

export const FINISHES: Record<VariantName, Finish> = {
  Core: { color: 0x2b2f36, roughness: 0.52, metalness: 1.0, envIntensity: 1.0 },
  Pro: { color: 0x6b5a3e, roughness: 0.42, metalness: 1.0, envIntensity: 1.05 },
  Studio: { color: 0x1e2f4f, roughness: 0.5, metalness: 1.0, envIntensity: 1.0 },
  Limited: { color: 0x4a4e55, roughness: 0.58, metalness: 1.0, envIntensity: 1.0 },
}

export const VARIANT_ORDER: VariantName[] = ['Core', 'Pro', 'Studio', 'Limited']

export const isVariantName = (s: string): s is VariantName => s in FINISHES
