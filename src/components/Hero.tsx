import type { CSSProperties } from "react";
import { hero } from "../data/content";

/** "Body — Hex 6061 · 18 g" → ["Body", "Hex 6061 · 18 g"] */
function splitSpec(s: string): [string, string] {
  const i = s.indexOf(" — ");
  return i < 0 ? ["", s] : [s.slice(0, i), s.slice(i + 3)];
}

export default function Hero() {
  const [head, ...rows] = hero.specs;
  return (
    <section id="hero" aria-labelledby="h-hero">
      <div className="wrap hero-grid panel">
        <div className="hero-copy">
          <div className="eyebrow" data-reveal="type" data-reveal-delay="40">
            {hero.eyebrow}
          </div>
          <h1 id="h-hero" data-reveal="lines" data-reveal-delay="120">
            {hero.titleA}
            <br />
            <em>{hero.titleEm}</em>
          </h1>
          <p className="hero-sub" data-reveal="fade" data-reveal-delay="560">
            {hero.sub}
          </p>
          <div className="hero-actions" data-reveal="fade" data-reveal-delay="680">
            <a className="btn-solid" href="#order" data-magnetic="0.28">
              <span className="mag">
                <span className="mag-label">{hero.ctaSolid}</span>
              </span>
            </a>
            <a className="btn-line" href="#exploded" data-magnetic="0.22">
              <span className="mag">
                <span className="mag-label">{hero.ctaLine}</span>
              </span>
            </a>
          </div>
          <div className="scroll-cue" aria-hidden="true" data-reveal="fade" data-reveal-delay="900">
            <span className="cue-line">
              <i></i>
            </span>
            <span className="mono">{hero.scrollCue}</span>
          </div>
        </div>
        <div className="hero-spec" data-reveal="fade" data-reveal-delay="780">
          <div className="hs-head mono">{head}</div>
          <dl>
            {rows.map((r, i) => {
              const [k, v] = splitSpec(r);
              return (
                <div key={r} style={{ "--k": i } as CSSProperties}>
                  <dt className="mono">{k}</dt>
                  <dd className="mono" data-odometer>
                    {v}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </section>
  );
}
