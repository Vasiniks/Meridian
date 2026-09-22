import { useState, type FormEvent } from "react";
import { PRICES, buyEyebrow, buyFine, buyLede, buyOptions, buySpecs, buyTitle } from "../data/content";

export interface BuyProps {
  onVariantChange?: (variantName: string) => void;
}

export default function Buy({ onVariantChange }: BuyProps) {
  const [variant, setVariant] = useState("Core");
  const [toast, setToast] = useState("");
  const [added, setAdded] = useState(false);

  const handleChange = (value: string) => {
    setVariant(value);
    setAdded(false);
    onVariantChange?.(value);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setToast(`${variant} added to cart — ships in a steel tube with 3 leads…`);
    setAdded(true);
    window.setTimeout(() => {
      setAdded(false);
    }, 2200);
  };

  return (
    <section id="buy" aria-labelledby="h-buy">
      <div className="wrap buy-grid panel">
        <div className="rv buy-copy">
          <div className="eyebrow">{buyEyebrow}</div>
          <h2 id="h-buy">{buyTitle}</h2>
          <p className="lede">{buyLede}</p>
          <ul className="spec-list">
            {buySpecs.map((s) => (
              <li key={s.b}>
                <b>{s.b}</b>
                <span>{s.span}</span>
              </li>
            ))}
          </ul>
        </div>
        <form className="buy-box rv" id="buyForm" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Variant</legend>
            {buyOptions.map((o) => (
              <label className="opt" key={o.value}>
                <input
                  type="radio"
                  name="variant"
                  value={o.value}
                  checked={variant === o.value}
                  onChange={() => handleChange(o.value)}
                  {...(o.value === "Studio" ? { "data-color": "0x1e2f4f" } : {})}
                />
                <span>
                  <span className="t">{o.title}</span>
                  <br />
                  <span className="d">{o.desc}</span>
                </span>
                <span className="p">${o.price}</span>
              </label>
            ))}
          </fieldset>
          <button className="buy-cta" type="submit" id="buyBtn">
            {added ? "Added ✓" : `Add to Cart — $${PRICES[variant] ?? 48}`}
          </button>
          <p className="fine">{buyFine}</p>
          <p id="toast" aria-live="polite">
            {toast}
          </p>
        </form>
      </div>
    </section>
  );
}
