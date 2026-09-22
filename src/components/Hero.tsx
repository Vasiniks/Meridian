import { hero } from "../data/content";

export default function Hero() {
  return (
    <section id="hero" aria-labelledby="h-hero">
      <div className="wrap hero-grid panel">
        <div className="rv">
          <div className="eyebrow">{hero.eyebrow}</div>
          <h1 id="h-hero">
            {hero.titleA}
            <br />
            <em>{hero.titleEm}</em>
          </h1>
          <p className="hero-sub">{hero.sub}</p>
          <div className="hero-actions">
            <a className="btn-solid" href="#buy">
              {hero.ctaSolid}
            </a>
            <a className="btn-line" href="#exploded">
              {hero.ctaLine}
            </a>
          </div>
          <div className="scroll-cue" aria-hidden="true">
            <span className="tick"></span>
            <span className="mono">{hero.scrollCue}</span>
          </div>
        </div>
        <div className="hero-spec rv">
          {hero.specs.map((s) => (
            <div className="mono" key={s}>
              {s}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
