import type { CSSProperties } from "react";
import { mechanismTitle, mechSteps } from "../data/content";
import Em from "./Em";

export default function Mechanism() {
  return (
    <section id="mechanism" className="tall" aria-labelledby="h-mech">
      <div className="wrap panel">
        <div className="card">
          <div className="eyebrow mech-eyebrow" aria-hidden="true">
            <span>Sequence</span>
            <span className="mech-count">
              <span id="mechCount">01</span>
              <span className="mech-of">&nbsp;/&nbsp;05</span>
            </span>
          </div>
          <h2 id="h-mech" data-reveal="lines">
            <Em text={mechanismTitle} n={2} />
          </h2>
          <div className="steps draw-rows" id="steps" data-reveal="fade" data-reveal-delay="260">
            {mechSteps.map((s, i) => (
              <div className="step" data-i={String(i)} key={s.n} style={{ "--k": i } as CSSProperties}>
                <span className="n">{s.n}</span>
                <div>
                  <h3>{s.h}</h3>
                  <p>{s.p}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
