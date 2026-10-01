import { xray } from "../data/content";
import "../overlay/xray.css";

/**
 * X-Ray copy. The card carries an aria-hidden negative twin that the scan
 * reveals (clip-path driven by the ink sheet), so the copy flips to paper
 * exactly where the page turns to ink.
 */
export default function Xray() {
  return (
    <section id="xray" className="tall" aria-labelledby="h-xray">
      <div className="wrap panel">
        <div className="card right rv xr-card">
          <div className="eyebrow">{xray.eyebrow}</div>
          <h2 id="h-xray">{xray.title}</h2>
          <p className="lede">{xray.lede}</p>
          <p className="anno">{xray.anno}</p>
          <div className="xr-neg" aria-hidden="true">
            <div className="eyebrow">{xray.eyebrow}</div>
            <h2>{xray.title}</h2>
            <p className="lede">{xray.lede}</p>
            <p className="anno">{xray.anno}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
