import type { CSSProperties } from "react";
import { philosophy, philosophyTitleA, philosophyTitleB } from "../data/content";

const SPECS = ["0.5 mm lead", "Hex A/F 8.0", "18 g", "6061 Al", "C360 brass", "Grade 5 Ti"];

export default function Philosophy() {
  return (
    <section id="philosophy" aria-labelledby="h-phil">
      <div className="wrap panel">
        <div className="eyebrow" data-reveal="type">
          Sheet 07 — Principles
        </div>
        {/* letter-spacing tightens with scroll (--sp, driven by src/fx/chrome) */}
        <h2 id="h-phil" className="phil-h" data-reveal="lines">
          {philosophyTitleA}
          <br />
          {philosophyTitleB}
        </h2>
        <div className="phil-rows draw-rows" data-reveal="fade" data-reveal-delay="200">
          {philosophy.map((r, i) => (
            <div key={r.idx} style={{ "--k": i } as CSSProperties}>
              <span className="idx">{r.idx}</span>
              <p>{r.p}</p>
              <span className="val" data-odometer>
                {r.val}
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* velocity-coupled spec ticker (decorative; static list for AT) */}
      <ul className="sr-only">
        {SPECS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <div className="marquee" data-marquee aria-hidden="true">
        <div className="mq-track">
          {[0, 1, 2, 3].map((c) => (
            <span className="mq-copy" key={c}>
              {SPECS.map((s) => (
                <span key={s}>
                  {s}
                  <i>·</i>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
