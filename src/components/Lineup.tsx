import { lineupHint, lineupTitle, variants } from "../data/content";

function colorToHex(colorHex: number): string {
  return "0x" + colorHex.toString(16).padStart(6, "0");
}

export default function Lineup() {
  return (
    <section id="lineup" aria-labelledby="h-line">
      <div className="pin" id="lineupPin">
        <div className="track" id="lineupTrack">
          {variants.map((v, i) => (
            <div
              className="variant"
              key={v.name}
              data-color={colorToHex(v.colorHex)}
              data-name={v.name}
            >
              {i === 0 ? (
                <div className="wrap" style={{ padding: "0 0 26px" }}>
                  <h2 id="h-line">{lineupTitle}</h2>
                </div>
              ) : null}
              <div className="shot">
                <span className="dot">{v.dot}</span>
                <img
                  src={`/variants/${v.name.toLowerCase()}.png`}
                  alt={`${v.name} variant render`}
                />
              </div>
              <h3>{v.name}</h3>
              <div className="mat">{v.mat}</div>
              <p>{v.desc}</p>
              <div className="row">
                <span className="swatch" style={{ background: v.swatch }}></span>
                <span className="price">${v.price}</span>
              </div>
            </div>
          ))}
          <div className="variant" aria-hidden="true" style={{ flexBasis: "20vw" }}></div>
        </div>
        <div className="lineup-hint mono panel">{lineupHint}</div>
      </div>
    </section>
  );
}
