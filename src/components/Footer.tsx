import { footer } from "../data/content";

export default function Footer() {
  return (
    <footer>
      <div className="wrap foot">
        <span className="brand">{footer.brand}</span>
        <span className="mono">{footer.tagline}</span>
        <span className="mono">{footer.copyright}</span>
      </div>
    </footer>
  );
}
