import { detailAnno, detailLede, detailSpecs, detailTitle } from "../data/content";

export default function Detail() {
  return (
    <section id="detail" className="tall" aria-labelledby="h-detail">
      <div className="wrap panel">
        <div className="card rv">
          <h2 id="h-detail">{detailTitle}</h2>
          <p className="lede">{detailLede}</p>
          <ul className="spec-list">
            {detailSpecs.map((s) => (
              <li key={s.b}>
                <b>{s.b}</b>
                <span>{s.span}</span>
              </li>
            ))}
          </ul>
          <p className="anno">{detailAnno}</p>
        </div>
      </div>
    </section>
  );
}
