import { xray } from "../data/content";

export default function Xray() {
  return (
    <section id="xray" className="tall" aria-labelledby="h-xray">
      <div className="wrap panel">
        <div className="card right rv">
          <h2 id="h-xray">{xray.title}</h2>
          <p className="lede">{xray.lede}</p>
          <p className="anno">{xray.anno}</p>
        </div>
      </div>
    </section>
  );
}
