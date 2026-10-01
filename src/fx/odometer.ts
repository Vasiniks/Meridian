/**
 * Odometer digits: every 0-9 becomes a clipped column that rolls to its
 * value (900 ms expo.out, 40 ms stagger right-to-left, tabular figures).
 * Updates roll from the previous value, never count up from zero.
 *
 * Markup: any element with plain text, e.g. <span data-odometer>18 g</span>.
 * Screen readers get an sr-only copy; the columns are aria-hidden.
 */
type OdHost = HTMLElement & { __od?: { cols: HTMLElement[]; text: string; vis: HTMLElement; sr: HTMLElement } }

const STACK = '0123456789'

function build(host: OdHost, text: string): void {
  const sr = document.createElement('span')
  sr.className = 'sr-only'
  sr.textContent = text
  const vis = document.createElement('span')
  vis.className = 'od'
  vis.setAttribute('aria-hidden', 'true')
  const cols: HTMLElement[] = []
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') {
      const col = document.createElement('span')
      col.className = 'odc'
      const ph = document.createElement('span')
      ph.className = 'odp'
      ph.textContent = ch
      const stack = document.createElement('span')
      stack.className = 'ods'
      for (const d of STACK) {
        const s = document.createElement('span')
        s.textContent = d
        stack.append(s)
      }
      col.append(ph, stack)
      col.style.setProperty('--d', '0')
      col.dataset.v = ch
      cols.push(col)
      vis.append(col)
    } else {
      vis.append(ch)
    }
  }
  host.replaceChildren(sr, vis)
  host.__od = { cols, text, vis, sr }
}

/** Convert the element's digits into (unrolled, showing 0) columns. */
export function prepareOdometer(host: OdHost): void {
  if (host.__od) return
  build(host, (host.textContent ?? '').trim())
}

/** Roll every column to its digit. */
export function rollOdometer(host: OdHost, delayMs = 0): void {
  if (!host.__od) prepareOdometer(host)
  const { cols } = host.__od!
  const n = cols.length
  cols.forEach((c, i) => {
    c.style.setProperty('--od-delay', `${delayMs + (n - 1 - i) * 40}ms`)
    c.style.setProperty('--d', c.dataset.v ?? '0')
  })
}

/**
 * Show new text, rolling digits from their previous values. If the shape
 * changes (digit positions differ) the columns are rebuilt, then rolled.
 */
export function setOdometer(host: OdHost, text: string): void {
  const od = host.__od
  if (od && od.text === text) return
  const shape = (t: string): string => t.replace(/[0-9]/g, '#')
  if (!od || shape(od.text) !== shape(text)) {
    const prev = od?.text
    build(host, text)
    const cols = host.__od!.cols
    // start from the previous digits where possible, then roll next frame
    if (prev) {
      const pd = prev.replace(/[^0-9]/g, '')
      cols.forEach((c, i) => c.style.setProperty('--d', pd[i] ?? '0'))
    }
    cols.forEach((c, i) => (c.dataset.v = text.replace(/[^0-9]/g, '')[i] ?? '0'))
    requestAnimationFrame(() => rollOdometer(host))
    return
  }
  od.text = text
  od.sr.textContent = text
  let di = 0
  const digits = text.replace(/[^0-9]/g, '')
  for (const c of od.cols) c.dataset.v = digits[di++] ?? '0'
  // non-digit characters may change too (same shape): one text node per char
  const nodes = od.vis.childNodes
  for (let i = 0; i < text.length && i < nodes.length; i++) {
    const node = nodes[i]
    if (node.nodeType === Node.TEXT_NODE) (node as Text).data = text[i]
  }
  rollOdometer(host)
}
