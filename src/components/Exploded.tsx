import type { CSSProperties } from "react";
import { explodedEyebrow, explodedLabels, explodedLede, explodedTitle } from "../data/content";
import Em from "./Em";

export default function Exploded() {
  return (
    <section id="exploded" aria-labelledby="h-exploded">
      <div className="wrap panel">
        <div className="card exp-card">
          <div className="eyebrow" data-reveal="type">
            {explodedEyebrow}
          </div>
          <h2 id="h-exploded" data-reveal="lines">
            <Em text={explodedTitle} n={2} />
          </h2>
          <p className="lede" data-reveal="fade" data-reveal-delay="240">
            {explodedLede}
          </p>
          <div
            className="exp-labels draw-rows"
            aria-label="Component list"
            data-reveal="fade"
            data-reveal-delay="360"
          >
            {explodedLabels.map((l, i) => (
              <div key={l.t} style={{ "--k": i } as CSSProperties}>
                <span>
                  <i className="exp-n">{String(i + 1).padStart(2, "0")}</i>
                  {l.t}
                </span>
                <span>{l.d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
