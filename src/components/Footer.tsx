import { footer } from "../data/content";

/** Closing title block: the last sheet of the drawing set. */
export default function Footer() {
  return (
    <footer>
      <div className="wrap">
        <div className="foot-tb">
          <span className="brand">{footer.brand}</span>
          <span className="mono">{footer.tagline}</span>
          <span className="mono">Drawn · Checked · Scale 1:1</span>
          <span className="mono">Sheet 09/09 · Rev C</span>
          <span className="mono">{footer.copyright}</span>
        </div>
      </div>
    </footer>
  );
}
