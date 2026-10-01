/**
 * Renders a headline with its last `n` words as the editorial emphasis
 * (Instrument Serif italic via `h1 em, h2 em`). Keeps content.ts plain text.
 */
export default function Em({ text, n = 1 }: { text: string; n?: number }) {
  const words = text.trim().split(/\s+/)
  const head = words.slice(0, Math.max(0, words.length - n)).join(' ')
  const tail = words.slice(-n).join(' ')
  return (
    <>
      {head}
      {head ? ' ' : ''}
      <em>{tail}</em>
    </>
  )
}
