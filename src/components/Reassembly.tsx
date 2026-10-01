import { reassembly } from "../data/content";
import Em from "./Em";

export default function Reassembly() {
  return (
    <section id="reassembly" className="tall" aria-labelledby="h-re">
      <div className="wrap panel">
        <div className="card re-card">
          <h2 id="h-re" data-reveal="lines">
            <Em text={reassembly.title} />
          </h2>
          <p className="lede" data-reveal="fade" data-reveal-delay="240">
            {reassembly.lede}
          </p>
        </div>
      </div>
    </section>
  );
}
