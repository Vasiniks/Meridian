import { reassembly } from "../data/content";

export default function Reassembly() {
  return (
    <section id="reassembly" className="tall" aria-labelledby="h-re">
      <div className="wrap panel">
        <div className="card rv" style={{ textAlign: "center", margin: "0 auto" }}>
          <h2 id="h-re">{reassembly.title}</h2>
          <p className="lede" style={{ margin: "14px auto 0" }}>
            {reassembly.lede}
          </p>
        </div>
      </div>
    </section>
  );
}
