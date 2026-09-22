import { mechanismTitle, mechSteps } from "../data/content";

export default function Mechanism() {
  return (
    <section id="mechanism" className="tall" aria-labelledby="h-mech">
      <div className="wrap panel">
        <div className="card rv">
          <h2 id="h-mech">{mechanismTitle}</h2>
          <div className="steps" id="steps">
            {mechSteps.map((s, i) => (
              <div className="step" data-i={String(i)} key={s.n}>
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
