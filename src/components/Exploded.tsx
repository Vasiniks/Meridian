import { explodedEyebrow, explodedLabels, explodedLede, explodedTitle } from "../data/content";

export default function Exploded() {
  return (
    <section id="exploded" aria-labelledby="h-exploded">
      <div className="wrap panel">
        <div className="card rv" style={{ maxWidth: "420px" }}>
          <div className="eyebrow">{explodedEyebrow}</div>
          <h2 id="h-exploded">{explodedTitle}</h2>
          <p className="lede">{explodedLede}</p>
          <div className="exp-labels" aria-label="Component list">
            {explodedLabels.map((l) => (
              <div key={l.t}>
                <span>{l.t}</span>
                <span>{l.d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
