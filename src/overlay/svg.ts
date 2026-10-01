/**
 * Retained-mode SVG primitives for the technical-drawing overlay.
 * Every write is cached: geometry only touches the DOM when a coordinate
 * moved by more than EPS px, text only when the string changed.
 */
export const NS = 'http://www.w3.org/2000/svg'
const EPS = 0.25

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  parent?: Element,
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag)
  for (const k in attrs) e.setAttribute(k, String(attrs[k]))
  parent?.appendChild(e)
  return e
}

const r2 = (v: number): string => (Math.round(v * 2) / 2).toString()

/** A polyline/polygon path with cached points (draw-on via pathLength=1). */
export class PolyPath {
  readonly el: SVGPathElement
  private prev = new Float32Array(32)
  private n = -1
  private closed = false
  constructor(parent: Element, cls: string, drawOn = true) {
    this.el = svg('path', drawOn ? { class: cls, pathLength: 1 } : { class: cls }, parent)
  }

  /** pts = flat [x0,y0,x1,y1,...], count = number of floats */
  set(pts: ArrayLike<number>, count: number, closed = false): void {
    let changed = count !== this.n || closed !== this.closed
    if (!changed) {
      for (let i = 0; i < count; i++) {
        if (Math.abs(pts[i] - this.prev[i]) > EPS) {
          changed = true
          break
        }
      }
    }
    if (!changed) return
    if (count > this.prev.length) this.prev = new Float32Array(count * 2)
    let d = ''
    for (let i = 0; i < count; i += 2) {
      d += (i === 0 ? 'M' : 'L') + r2(pts[i]) + ' ' + r2(pts[i + 1])
      this.prev[i] = pts[i]
      this.prev[i + 1] = pts[i + 1]
    }
    if (closed) d += 'Z'
    this.n = count
    this.closed = closed
    this.el.setAttribute('d', d)
  }

  /** raw path data (for arcs etc.), cached by string */
  raw(d: string): void {
    if (this.el.getAttribute('d') !== d) this.el.setAttribute('d', d)
    this.n = -1
  }
}

/** A <g> positioned with translate(x y) (+ optional rotation). */
export class Anchor {
  readonly el: SVGGElement
  private x = -1e9
  private y = -1e9
  private a = -1e9
  constructor(parent: Element, cls = '') {
    this.el = svg('g', cls ? { class: cls } : {}, parent)
  }
  at(x: number, y: number, rotDeg = 0): void {
    if (Math.abs(x - this.x) <= EPS && Math.abs(y - this.y) <= EPS && Math.abs(rotDeg - this.a) <= 0.05) return
    this.x = x
    this.y = y
    this.a = rotDeg
    this.el.setAttribute(
      'transform',
      rotDeg ? `translate(${r2(x)} ${r2(y)}) rotate(${rotDeg.toFixed(2)})` : `translate(${r2(x)} ${r2(y)})`,
    )
  }
}

/** Text with cached content + position. */
export class Label {
  readonly el: SVGTextElement
  private s = ''
  private x = -1e9
  private y = -1e9
  private anchor = ''
  constructor(parent: Element, cls: string, text = '') {
    this.el = svg('text', { class: cls }, parent)
    this.text(text)
  }
  text(s: string): void {
    if (s === this.s) return
    this.s = s
    this.el.textContent = s
  }
  at(x: number, y: number, anchor: 'start' | 'middle' | 'end' = 'start'): void {
    if (anchor !== this.anchor) {
      this.anchor = anchor
      this.el.setAttribute('text-anchor', anchor)
    }
    if (Math.abs(x - this.x) > EPS) {
      this.x = x
      this.el.setAttribute('x', r2(x))
    }
    if (Math.abs(y - this.y) > EPS) {
      this.y = y
      this.el.setAttribute('y', r2(y))
    }
  }
}

/** Toggle a class only when the state changes. */
export function flag(el: Element, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on)
}

/** Filled ISO arrowhead at (x,y) pointing along unit (ux,uy). */
export function arrowPts(out: Float32Array, x: number, y: number, ux: number, uy: number, len = 8, half = 2.6): number {
  const bx = x - ux * len
  const by = y - uy * len
  out[0] = x
  out[1] = y
  out[2] = bx - uy * half
  out[3] = by + ux * half
  out[4] = bx + uy * half
  out[5] = by - ux * half
  return 6
}
