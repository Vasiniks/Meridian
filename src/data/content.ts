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
  sub: "Twenty-six parts. One hex axis. A brass clutch that feeds the lead 0.5 mm a click, behind a fixed 4 mm sleeve.",
  ctaSolid: "Buy — $48",
  ctaLine: "See it come apart",
  specs: [
    "Meridian 0.5 / Graphite",
    "Body — Hex 6061 · 18 g",
    "Lead — 0.5 mm · Clutch feed",
    "Feed — 0.5 mm per click",
  ],
  scrollCue: "Scroll",
};

export interface DetailSpec {
  b: string;
  span: string;
}

export const detailTitle = "The grip is the instrument.";

export const detailLede =
  "A 28 mm hexagonal grip, cut in a diamond knurl deep enough to hold and crisp enough to read. The turned cone tapers to a fixed 4 mm sleeve, so the lead meets paper exactly where the eye expects it.";

export const detailSpecs: DetailSpec[] = [
  { b: "Knurl depth", span: "0.26 mm" },
  { b: "Hull section", span: "hex · 6061" },
  { b: "Lead sleeve", span: "4 mm · fixed" },
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
  "No glue. Unscrew the cone and the clutch, spring and lead tube slide out of the front in assembly order. Servicing takes ninety seconds with no tools.";

export const explodedLabels: ExplodedLabel[] = [
  { t: "Cap · eraser · holder", d: "2.5 stroke" },
  { t: "Hex barrel · collar · clip", d: "datum" },
  { t: "Lead tube · 3 spare leads", d: "Ø 2.6" },
  { t: "Knurled grip · ferrules", d: "28 mm" },
  { t: "Return spring · seat", d: "stainless" },
  { t: "Collet · 3 jaws", d: "C360 brass" },
  { t: "Clutch ring · ring stop", d: "0.5 gap" },
  { t: "Cone · lead retainer", d: "rubber" },
  { t: "Lead sleeve · 0.5 lead", d: "4 mm steel" },
];

export interface XrayContent {
  eyebrow: string;
  title: string;
  lede: string;
  anno: string;
}

export const xray: XrayContent = {
  eyebrow: "Sheet 04 — X-ray",
  title: "The shell goes quiet.",
  lede: "A scan passes down the body and the hull turns to glass. What remains is the working core: lead tube, return spring, brass clutch and the lead path to the tip, held on the same axis they run on.",
  anno: "02 / SECTION A–A — read straight through 6061. Nothing is hidden, nothing is faked.",
};

export interface MechStep {
  n: string;
  h: string;
  p: string;
}

export const mechanismTitle = "Five moves. One click.";

export const mechSteps: MechStep[] = [
  { n: "01", h: "Press", p: "Tube, clutch and lead move forward as one." },
  { n: "02", h: "Ring stops", p: "The clutch ring lands on its stop, 0.5 mm in." },
  { n: "03", h: "Jaws open", p: "The jaws leave the ring and spring apart." },
  { n: "04", h: "Release", p: "The spring returns. The retainer holds the lead." },
  { n: "05", h: "Regrip", p: "The jaws close on the lead, 0.5 mm further out." },
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
