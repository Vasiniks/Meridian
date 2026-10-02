/**
 * Copy + nominal values for the technical-drawing layer (DRAWING agent).
 * Kept separate from data/content.ts so the DOM sections and the drawing
 * overlay can evolve independently.
 */

export interface PartGroup {
  /** balloon number, 1-based, top → bottom along the axis */
  n: number
  /** short callout name (balloon label, cursor label) */
  name: string
  /** material / detail line under the name */
  sub: string
  /** GLB node names that belong to this group (unknown names are ignored) */
  nodes: string[]
  /** node the balloon leader lands on (falls back to the first found node) */
  anchor: string
  /** shown on small screens (≤900px): fewer callouts there */
  mobile: boolean
}

/** Nine groups = the nine rows of the Exploded component list (top → tip). */
export const PART_GROUPS: PartGroup[] = [
  { n: 1, name: 'Cap', sub: 'steel · eraser · holder', anchor: 'cap', mobile: true,
    nodes: ['cap', 'eraser', 'eraserHolder'] },
  { n: 2, name: 'Barrel', sub: '6061 hex · collar · clip', anchor: 'barrelHex', mobile: true,
    nodes: ['topCollar', 'barrelHex', 'clipBlade', 'clipFoot', 'clipScrew'] },
  { n: 3, name: 'Lead tube', sub: 'Ø 2.6 · 3 spare leads', anchor: 'leadTube', mobile: false,
    nodes: ['leadTube', 'spareLeads'] },
  { n: 4, name: 'Grip', sub: 'knurled · 2 ferrules', anchor: 'grip', mobile: true,
    nodes: ['grip', 'gripRingTop', 'gripRingBot', 'threadRing'] },
  { n: 5, name: 'Return spring', sub: 'stainless · seat', anchor: 'mainSpring', mobile: false,
    nodes: ['mainSpring', 'springSeat'] },
  { n: 6, name: 'Clutch', sub: 'C360 brass · 3 jaws', anchor: 'clutch', mobile: true,
    nodes: ['clutch'] },
  { n: 7, name: 'Clutch ring', sub: 'brass · ring stop', anchor: 'clutchRing', mobile: false,
    nodes: ['clutchRing', 'ringStop'] },
  { n: 8, name: 'Cone', sub: 'turned hex · retainer', anchor: 'noseHex', mobile: false,
    nodes: ['noseHex', 'noseTip', 'noseWasher', 'noseInsert', 'leadRetainer'] },
  { n: 9, name: 'Lead sleeve', sub: '4 mm steel · Ø 0.5', anchor: 'leadSleeve', mobile: true,
    nodes: ['leadSleeve', 'lead'] },
]

export const pad2 = (n: number): string => String(n).padStart(2, '0')
export const cursorLabel = (g: PartGroup): string =>
  `PART ${pad2(g.n)} · ${g.name.toUpperCase()}`

/** Nominal dimensions (drawing values; geometry comes from the model). */
export const DIM = {
  acrossFlats: 'A/F 7.80',
  lead: 'Ø 0.50',
  length: 'L 136.5',
  sectionGrip: 'SECTION B–B',
  sectionScale: 'SCALE 4:1',
}

/** X-ray: internals labelled as the scan develops them (≤5). */
export interface XrayLabel {
  node: string
  text: string
  sub: string
  mobile: boolean
}
export const XRAY_LABELS: XrayLabel[] = [
  { node: 'leadTube', text: 'Lead tube', sub: '3 spare leads', mobile: true },
  { node: 'mainSpring', text: 'Return spring', sub: 'stainless', mobile: false },
  { node: 'clutch', text: 'Clutch', sub: '3 jaws · brass', mobile: true },
  { node: 'leadRetainer', text: 'Lead retainer', sub: 'rubber', mobile: false },
  { node: 'leadSleeve', text: 'Lead sleeve', sub: 'Ø 0.50 · 4 mm', mobile: true },
]

/** Mechanism step names (the five moves of Mechanism.tsx). */
export const MECH_STEPS = [
  { h: 'Press', d: 'All forward 0.5 mm' },
  { h: 'Ring stops', d: 'Ring travel 0.5 mm' },
  { h: 'Jaws open', d: 'Stroke 2.5 mm' },
  { h: 'Release', d: 'Retainer holds lead' },
  { h: 'Regrip', d: 'Lead +0.5 per click' },
]
