export interface HeroContent {
  eyebrow: string;
  titleA: string;
  titleEm: string;
  sub: string;
  ctaSolid: string;
  ctaLine: string;
  specs: string[];
  scrollCue: string;
}

export const hero: HeroContent = {
  eyebrow: "Precision mechanical pencil — Nº 01",
  titleA: "Precision you feel.",
  titleEm: "A mechanism you keep.",
  sub: "Forty-two parts. One hex axis. Zero wobble. Machined to ±0.02 mm and balanced at the grip.",
  ctaSolid: "Buy — $48",
  ctaLine: "See it come apart",
  specs: [
    "Meridian 0.5 / Graphite",
    "Body — Hex 6061 · 18 g",
    "Lead — 0.5 mm · Clutch feed",
    "Tolerance — ±0.02 mm",
  ],
  scrollCue: "Scroll — the camera moves",
};

export interface DetailSpec {
  b: string;
  span: string;
}

export const detailTitle = "The grip is the instrument.";

export const detailLede =
  "A 63 mm hexagonal grip, cut in an inverse-crisscross lattice deep enough to hold and crisp enough to read. The faceted nose tapers so the lead meets paper exactly where the eye expects it.";

export const detailSpecs: DetailSpec[] = [
  { b: "Lattice depth", span: "0.22 mm" },
  { b: "Hull section", span: "hex · 6061" },
  { b: "Sleeve runout", span: "< 0.03 mm" },
];

export const detailAnno =
  "01 / TOLERANCE — every seam is a 0.03 mm shadow gap, not a stack-up error.";

export interface ExplodedLabel {
  t: string;
  d: string;
}

export const explodedEyebrow = "Exploded view — every part on one axis";
export const explodedTitle = "Comes apart on one axis.";
export const explodedLede =
  "No hidden clips. No glue. Each component slides off the central reservoir in assembly order. Servicing takes ninety seconds with no tools.";

export const explodedLabels: ExplodedLabel[] = [
  { t: "Hex button + stem · eraser", d: "+3.3 / +2.8" },
  { t: "Actuator · collar · springs", d: "+2.6 / +2.4" },
  { t: "Clutch · 3 jaws · retainer", d: "+2.2 / +1.9" },
  { t: "Return spring · seats · rods", d: "+1.6 / +1.1" },
  { t: "Hex reservoir + plug", d: "+0.9" },
  { t: "Hex hull · 6061 · clip", d: "datum" },
  { t: "Grip · crisscross lattice", d: "−0.8" },
  { t: "Faceted nose · insert", d: "−1.6 / −2.2" },
  { t: "Lead sleeve · 0.5 lead", d: "−2.7 / −3.1" },
];

export interface XrayContent {
  title: string;
  lede: string;
  anno: string;
}

export const xray: XrayContent = {
  title: "The shell goes quiet.",
  lede: "The outer body turns to glass. What remains is the working core: reservoir, spring, clutch and lead path, held on the same axis they run on.",
  anno: "02 / SECTION — shell opacity 15%. Nothing is hidden, nothing is faked.",
};

export interface MechStep {
  n: string;
  h: string;
  p: string;
}

export const mechanismTitle = "Five moves. One click.";

export const mechSteps: MechStep[] = [
  { n: "01", h: "Press", p: "One click engages the clutch." },
  { n: "02", h: "Compress", p: "Spring stores controlled energy." },
  { n: "03", h: "Release", p: "Jaws open with exact clearance." },
  { n: "04", h: "Advance", p: "Lead feeds one precise increment." },
  { n: "05", h: "Reset", p: "Clutch reseats. Zero wobble remains." },
];

export interface ReassemblyContent {
  title: string;
  lede: string;
}

export const reassembly: ReassemblyContent = {
  title: "Snaps back. Exactly.",
  lede: "Every part returns to datum with a single damped motion. No bounce. No rattle. A pencil that sounds like a caliper closing.",
};

export interface PhilosophyRow {
  idx: string;
  p: string;
  val: string;
}

export const philosophyTitleA = "Fewer parts.";
export const philosophyTitleB = "Tighter tolerances.";

export const philosophy: PhilosophyRow[] = [
  { idx: "01", p: "Weight serves balance, not decoration.", val: "18 g @ grip" },
  { idx: "02", p: "Built to be serviced, not replaced.", val: "90 s teardown" },
  { idx: "03", p: "Precision engineering disguised as everyday beauty.", val: "±0.02 mm" },
];

export interface Variant {
  name: string;
  mat: string;
  desc: string;
  price: number;
  colorHex: number;
  swatch: string;
  blurb: string;
  dot: string;
}

export const lineupTitle = "One form. Four tempers.";
export const lineupHint = "Vertical scroll drives horizontal travel";

export const variants: Variant[] = [
  {
    name: "Core",
    mat: "STAINLESS · CLUTCH FEED",
    desc: "The everyday workhorse. Brushed steel barrel, clutch mechanism, tuned for long sessions.",
    price: 48,
    colorHex: 0x2b2f36,
    swatch: "#23272e",
    blurb: "The everyday workhorse. Brushed steel barrel, clutch mechanism, tuned for long sessions.",
    dot: "01 / CORE",
  },
  {
    name: "Pro",
    mat: "BRASS · CLUTCH FEED",
    desc: "Weighted forward for control. Solid brass that patinas with use. Drafts like a ruling pen.",
    price: 86,
    colorHex: 0x6b5a3e,
    swatch: "#8a6b3a",
    blurb: "Weighted forward for control. Solid brass that patinas with use. Drafts like a ruling pen.",
    dot: "02 / PRO",
  },
  {
    name: "Studio",
    mat: "ALUMINUM · AUTO-ADVANCE",
    desc: "Anodized 6061 in deep ink blue. Auto-advance feed for uninterrupted drafting flow.",
    price: 64,
    colorHex: 0x1e2f4f,
    swatch: "#1e2f4f",
    blurb: "Anodized 6061 in deep ink blue. Auto-advance feed for uninterrupted drafting flow.",
    dot: "03 / STUDIO",
  },
  {
    name: "Limited",
    mat: "TITANIUM · AUTO-ADVANCE",
    desc: "Numbered run of five hundred. Blasted titanium, auto-advance, presented in a steel tube.",
    price: 148,
    colorHex: 0x4a4e55,
    swatch: "#4a4e55",
    blurb: "Numbered run of five hundred. Blasted titanium, auto-advance, presented in a steel tube.",
    dot: "04 / LIMITED · 500",
  },
];

export interface BuyOption {
  value: string;
  title: string;
  desc: string;
  price: number;
}

export const buyEyebrow = "Own it";
export const buyTitle = "Choose your instrument.";
export const buyLede =
  "Ships worldwide in a steel tube with three spare leads and a teardown card. 30-day returns, lifetime service.";

export const buySpecs: DetailSpec[] = [
  { b: "In the tube", span: "pencil + 3 leads" },
  { b: "Service", span: "lifetime · 90 s" },
  { b: "Returns", span: "30 days" },
];

export const buyOptions: BuyOption[] = [
  { value: "Core", title: "Core — Stainless", desc: "Clutch feed · everyday", price: 48 },
  { value: "Studio", title: "Studio — Aluminum", desc: "Auto-advance · drafting", price: 64 },
  { value: "Pro", title: "Pro — Brass", desc: "Clutch feed · weighted", price: 86 },
  { value: "Limited", title: "Limited — Titanium", desc: "Numbered · 500 pcs", price: 148 },
];

export const buyFine = "Free shipping over $75 · Carbon-neutral delivery";

export const PRICES: Record<string, number> = {
  Core: 48,
  Studio: 64,
  Pro: 86,
  Limited: 148,
};

export interface FooterContent {
  brand: string;
  tagline: string;
  copyright: string;
}

export const footer: FooterContent = {
  brand: "Meridian",
  tagline: "Designed on one axis · Built for decades",
  copyright: "© 2026 Meridian Instrument Co.",
};
