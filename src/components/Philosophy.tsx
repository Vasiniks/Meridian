import { philosophy, philosophyTitleA, philosophyTitleB } from "../data/content";

export default function Philosophy() {
  return (
    <section id="philosophy" aria-labelledby="h-phil">
      <div className="wrap panel">
        <div className="rv">
          <h2 id="h-phil">
            {philosophyTitleA}
            <br />
            {philosophyTitleB}
          </h2>
          <div className="phil-rows">
            {philosophy.map((r) => (
              <div key={r.idx}>
                <span className="idx">{r.idx}</span>
                <p>{r.p}</p>
                <span className="val">{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
