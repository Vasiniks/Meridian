import { useEffect, useRef, useState, type CSSProperties } from "react";
import { lineupTitle, variants } from "../data/content";
import { bus } from "../fx/bus";
import { isVariantName } from "../three/finishes";
import { atPageEnd, gotoDetent, inFreeSpin, spinScroll, spinSwipe, spinTo, variantIndex } from "./lineupNav";
import { asset } from "../assetUrl";

/**
 * Lineup — typographic overlay for the 3D variant ring (three/ring.ts).
 *
 * The ring announces the variant in front via `variant:active`; this
 * component renders text for it (masked character roll on the giant name,
 * odometer counter + price, dial) and the Order button. The lineup is the
 * last section: in its first pass the dial scrolls the page to a detent;
 * at the end of the page (free spin) wheel / swipe / arrow-down past the
 * bottom and the dial spin the ring round indefinitely. Scrolling up is
 * never intercepted, so leaving is immediate.
 *
 * `--ring` (0..3, continuous) is written on #lineup every frame by the ring
 * (or by FrameFallback in static mode); the dial needle and the static CSS
 * prism read it without React re-renders.
 */

interface Swap {
  idx: number;
  prev: number;
  dir: 1 | -1;
  n: number;
}

/** Masked per-character roll between two words (direction-aware). */
function RollWord({ swap, words, className }: { swap: Swap; words: string[]; className: string }) {
  const cur = words[swap.idx];
  const prev = swap.prev >= 0 ? words[swap.prev] : null;
  const chars = (w: string) =>
    [...w].map((ch, i) => (
      <span className="rc" style={{ "--i": i } as CSSProperties} key={i}>
        {ch === " " ? " " : ch}
      </span>
    ));
  return (
    <span className={`roll ${className}`} data-dir={swap.dir > 0 ? "up" : "down"} aria-hidden="true">
      {prev !== null && prev !== cur ? (
        <span className="roll-l roll-out" key={`o${swap.n}`}>
          {chars(prev)}
        </span>
      ) : null}
      <span className={`roll-l ${swap.n > 0 ? "roll-in" : ""}`} key={`i${swap.n}`}>
        {chars(cur)}
      </span>
    </span>
  );
}

/** Rolling digits: each slot is a 0–9 column translated by its digit. */
function Odometer({ value, width, pad = " " }: { value: number; width: number; pad?: string }) {
  const s = String(value).padStart(width, pad);
  return (
    <span className="odo" aria-hidden="true">
      {[...s].map((d, i) => {
        const blank = d === " ";
        const n = blank ? 0 : Number(d);
        return (
          <span
            className={`odo-slot${blank ? " is-blank" : ""}`}
            key={i}
            style={{ "--d": n, "--k": width - 1 - i } as CSSProperties}
          >
            <span className="odo-col">
              {"0123456789".split("").map((c) => (
                <span key={c}>{c}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Wheel delta → pixels, whatever the device reports in. */
const wheelPx = (e: WheelEvent): number =>
  e.deltaMode === 1 ? e.deltaY * 32 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;

export default function Lineup() {
  const [swap, setSwap] = useState<Swap>({ idx: 0, prev: -1, dir: 1, n: 0 });
  const [ordered, setOrdered] = useState<string | null>(null);
  const idxRef = useRef(0);

  // free spin: input past the bottom of the page turns the ring
  useEffect(() => {
    const free = (): boolean => atPageEnd() && inFreeSpin();
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY <= 0 || !free()) return;
      spinScroll(Math.min(wheelPx(e), 240));
    };
    // swipe: total upward travel since touchstart (event-rate independent)
    let ty0 = -1;
    let steps = 0;
    const onTouchStart = (e: TouchEvent) => {
      ty0 = e.touches.length === 1 ? e.touches[0].clientY : -1;
      steps = 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (ty0 < 0 || e.touches.length !== 1 || !free()) return;
      steps = spinSwipe(ty0 - e.touches[0].clientY, steps); // finger up = scroll down
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.key === "ArrowDown" || e.key === "PageDown") && free()) spinScroll(90);
    };
    const sec = document.getElementById("lineup");
    let lastFree: boolean | null = null;
    const onScroll = () => {
      const f = inFreeSpin();
      if (f !== lastFree && sec) {
        lastFree = f;
        sec.toggleAttribute("data-free", f);
      }
    };
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(
    () =>
      bus.on("variant:active", ({ name }) => {
        if (!isVariantName(name)) return;
        const i = variantIndex(name);
        if (i === idxRef.current) return;
        const prev = idxRef.current;
        idxRef.current = i;
        setSwap((s) => ({ idx: i, prev, dir: i > prev ? 1 : -1, n: s.n + 1 }));
      }),
    [],
  );

  const v = variants[swap.idx];
  const names = variants.map((x) => x.name);
  const mats = variants.map((x) => x.mat);

  // the confirmation belongs to the variant it was given for
  const isOrdered = ordered === v.name;
  useEffect(() => {
    if (!ordered) return;
    const t = window.setTimeout(() => setOrdered(null), 2600);
    return () => window.clearTimeout(t);
  }, [ordered]);

  const order = () => {
    if (isVariantName(v.name)) bus.emit("variant:select", { name: v.name, source: "ring" });
    setOrdered(v.name);
  };
  const pickStop = (i: number) => (inFreeSpin() ? spinTo(i) : gotoDetent(i));

  return (
    <section id="lineup" aria-labelledby="h-line">
      {/* start of the free-spin stretch: the "Order" sheet + #order anchor
          (top set in px by lineupNav.sizeLineup) */}
      <div id="order" className="lu-order-mark" aria-hidden="true" />
      <div className="pin" id="lineupPin">
        <div className="lu-grid">
          <header className="lu-head">
            <div className="lu-eyebrow mono">
              <span>Lineup</span>
              <span className="lu-count">
                <Odometer value={swap.idx + 1} width={2} pad="0" />
                <span className="lu-of"> / 04</span>
              </span>
            </div>
            <h2 id="h-line">{lineupTitle}</h2>
          </header>

          <div className="lu-stage" id="ringStage" aria-hidden="true">
            {/* static (zero-GPU) mode: CSS 3D prism of the four renders */}
            <div className="lu-prism">
              {variants.map((x, i) => (
                <figure className="lu-card" key={x.name} style={{ "--i": i } as CSSProperties}>
                  <img src={asset(`variants/${x.name.toLowerCase()}.png`)} alt="" loading="lazy" decoding="async" />
                  <figcaption className="mono">{x.dot}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          <div className="lu-info">
            <h3 className="lu-name" aria-label={v.name}>
              <RollWord swap={swap} words={names} className="lu-name-roll" />
            </h3>
            <div className="lu-mat mono">
              <RollWord swap={swap} words={mats} className="lu-mat-roll" />
            </div>
            <p className="lu-desc" key={swap.n}>
              {v.desc}
            </p>
            <div className="lu-buyrow">
              <span className="lu-price" aria-label={`$${v.price}`}>
                <span className="lu-cur">$</span>
                <Odometer value={v.price} width={3} />
              </span>
              <button
                type="button"
                className="lu-cta"
                onClick={order}
                data-done={isOrdered ? "true" : "false"}
                aria-live="polite"
              >
                <span className="lu-cta-t">{isOrdered ? `${v.name} added to your order` : `Order ${v.name}`}</span>
                <span className="lu-cta-a" aria-hidden="true">{isOrdered ? "✓" : "→"}</span>
              </button>
            </div>
            <p className="lu-ship mono">Steel tube · 3 spare leads · 30‑day returns</p>
          </div>

          <div className="lu-dial">
            <div className="lu-scale" aria-hidden="true">
              <i className="lu-needle" />
            </div>
            <div className="lu-stops" role="radiogroup" aria-label="Finish in front">
              {variants.map((x, i) => (
                <label className="lu-stop" key={x.name} data-on={i === swap.idx ? "true" : "false"}>
                  <input
                    type="radio"
                    name="lu-finish"
                    value={x.name}
                    checked={i === swap.idx}
                    onChange={() => pickStop(i)}
                  />
                  <span className="lu-stop-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="lu-stop-t">{x.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* technical-drawing leader: material line → front pencil's barrel
              (endpoints written per frame by three/ring.ts; landscape only) */}
          <svg className="lu-leader" aria-hidden="true" key={`lead${swap.n}`}>
            <line id="luLeadLine" pathLength={1} />
            <circle id="luLeadDot" r={2.75} />
          </svg>

          <p className="lu-hint mono" aria-hidden="true">
            Scroll or drag to spin · scroll up to go back
          </p>

          <p className="sr-only" aria-live="polite">
            {`${v.name}, ${v.mat.toLowerCase()}, $${v.price}`}
          </p>
        </div>
      </div>
    </section>
  );
}
