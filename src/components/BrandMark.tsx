/**
 * Logo B, "Hex & lead": the barrel in cross-section with the 0.5 mm lead
 * in oxide red. Inherits text colour; the dot takes the accent token.
 */
export default function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <polygon
        points="16,2 28.12,9 28.12,23 16,30 3.88,23 3.88,9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.2" fill="var(--accent)" />
    </svg>
  )
}
