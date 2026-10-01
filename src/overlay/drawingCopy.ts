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

/** Nine groups = the nine rows of the Exploded component list. */
export const PART_GROUPS: PartGroup[] = [
  { n: 1, name: 'Hex button', sub: 'POM · stem · eraser', anchor: 'buttonHex', mobile: true,
    nodes: ['buttonHex', 'buttonStem', 'eraser', 'eraserSleeve'] },
  { n: 2, name: 'Actuator', sub: 'collar · 2 springs', anchor: 'actuatorCone', mobile: false,
    nodes: ['topCollar', 'actuatorCone', 'actuatorSleeve', 'washerTop', 'buttonSpring'] },
  { n: 3, name: 'Clutch jaw', sub: 'C360 brass · ×3', anchor: 'clutchHousing', mobile: true,
    nodes: ['clutchHousing', 'jawA', 'jawB', 'jawC', 'retainerHex'] },
  { n: 4, name: 'Return spring', sub: '17-7 PH · feed rod', anchor: 'returnSpring', mobile: false,
    nodes: ['returnSpring', 'seatUp', 'seatLow', 'stopCollar', 'feedRod', 'shaftMid'] },
  { n: 5, name: 'Reservoir', sub: 'hex · 12 leads', anchor: 'reservoirHex', mobile: false,
    nodes: ['reservoirHex', 'resPlug', 'stabilizerSpring', 'spacerTube', 'threadRing'] },
  { n: 6, name: 'Hull', sub: '6061-T6 · clip', anchor: 'barrelHex', mobile: true,
    nodes: ['barrelHex', 'barrelGrooves', 'clipBlade', 'clipFoot', 'clipScrew'] },
  { n: 7, name: 'Grip', sub: 'crisscross lattice', anchor: 'gripSleeve', mobile: true,
    nodes: ['gripSleeve', 'gripUnderlay', 'gripLattice', 'gripRingTop', 'gripRingBot', 'guideTube'] },
  { n: 8, name: 'Nose', sub: 'faceted · insert', anchor: 'noseHex', mobile: false,
    nodes: ['noseHex', 'noseTip', 'noseInsert', 'noseWasher'] },
  { n: 9, name: 'Lead sleeve', sub: 'Ø 0.50 · steel', anchor: 'leadSleeve', mobile: true,
    nodes: ['leadSleeve', 'lead'] },
]

export const pad2 = (n: number): string => String(n).padStart(2, '0')
export const cursorLabel = (g: PartGroup): string =>
  `PART ${pad2(g.n)} · ${g.name.toUpperCase()}`

/** Nominal dimensions (drawing values; geometry comes from the model). */
export const DIM = {
  acrossFlats: 'A/F 8.00',
  lead: 'Ø 0.50 ±0.02',
  length: 'L 142.0',
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
  { node: 'clutchHousing', text: 'Clutch', sub: '3 jaws · C360', mobile: true },
  { node: 'returnSpring', text: 'Return spring', sub: '17-7 PH', mobile: false },
  { node: 'reservoirHex', text: 'Reservoir', sub: '12 × 0.5', mobile: true },
  { node: 'guideTube', text: 'Guide tube', sub: 'brass', mobile: false },
  { node: 'leadSleeve', text: 'Lead path', sub: 'Ø 0.50', mobile: true },
]

/** Mechanism step names (the five moves of Mechanism.tsx). */
export const MECH_STEPS = [
  { h: 'Press', d: 'Button −2.2' },
  { h: 'Compress', d: 'Spring −28%' },
  { h: 'Release', d: 'Jaws +1.6' },
  { h: 'Advance', d: 'Lead +0.5' },
  { h: 'Reset', d: 'Clutch seated' },
]
