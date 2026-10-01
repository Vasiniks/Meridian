import { detailAnno, detailLede, detailSpecs, detailTitle } from "../data/content";
import Em from "./Em";

export default function Detail() {
  return (
    <section id="detail" className="tall" aria-labelledby="h-detail">
      <div className="wrap panel">
        <div className="card">
          <div className="eyebrow" data-reveal="type">
            Sheet 02 — Grip detail
          </div>
          <h2 id="h-detail" data-reveal="lines">
            <Em text={detailTitle} />
          </h2>
          <p className="lede" data-reveal="fade" data-reveal-delay="240">
            {detailLede}
          </p>
          <ul className="spec-list draw-rows" data-reveal="fade" data-reveal-delay="360">
            {detailSpecs.map((s) => (
              <li key={s.b}>
                <b>{s.b}</b>
                <span data-odometer>{s.span}</span>
              </li>
            ))}
          </ul>
          <p className="anno" data-reveal="fade" data-reveal-delay="480">
            {detailAnno}
          </p>
        </div>
      </div>
    </section>
  );
}
