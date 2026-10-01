import { useEffect } from "react";
import { startFx } from "../fx";
import BrandMark from "./BrandMark";

export interface ChromeProps {
  motionPaused?: boolean;
  onToggleMotion?: () => void;
}

const links: [string, string][] = [
  ["#detail", "Detail"],
  ["#exploded", "Exploded"],
  ["#mechanism", "Mechanism"],
  ["#lineup", "Lineup"],
];

/**
 * Fixed chrome: skip link, WebGL canvas + paper layers, and the nav as a
 * drawing title block ("SHEET 0X/09 — NAME" + hairline progress rule with
 * chapter ticks). The preloader lives in index.html so it paints before
 * the bundle; src/fx drives it. Boots the DOM effects layer once.
 */
export default function Chrome({ motionPaused = false, onToggleMotion }: ChromeProps) {
  useEffect(() => startFx(), []);

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <canvas id="gl" aria-hidden="true"></canvas>
      <div id="vignette" aria-hidden="true"></div>
      <div id="grain" aria-hidden="true"></div>
      <div id="fallback" role="img" aria-label="Mechanical pencil illustration">
        <svg viewBox="0 0 200 600" fill="none" aria-hidden="true">
          <rect x="85" y="20" width="30" height="560" rx="14" fill="#141412" />
          <rect x="88" y="390" width="24" height="90" rx="8" fill="#3a3a38" />
          <path d="M85 560 L100 595 L115 560Z" fill="#9aa0a8" />
        </svg>
      </div>
      <header id="nav">
        <div className="nav-inner">
          <a className="brand" href="#hero" aria-label="Meridian, back to top">
            <BrandMark />
            Meridian<small>0.5&nbsp;MM</small>
          </a>
          <div className="sheet" aria-hidden="true">
            <span className="sheet-k">Sheet</span>
            <span className="sheet-num" id="sheetNum">
              01
            </span>
            <span className="sheet-of">/09</span>
            <span className="sheet-dash">—</span>
            <span className="sheet-name" id="sheetName">
              <span className="sn">Reveal</span>
            </span>
          </div>
          <nav className="links" aria-label="Sections">
            {links.map(([href, label]) => (
              <a key={href} href={href} data-magnetic="0.35">
                <span className="mag">{label}</span>
              </a>
            ))}
          </nav>
          <a className="nav-cta" href="#buy" data-magnetic="0.3">
            <span className="mag">Buy — $48+</span>
          </a>
          {/* accessible name = visible text (label-in-name); state is in the words */}
          <button
            className="motion-toggle"
            id="motionBtn"
            data-paused={motionPaused ? "true" : "false"}
            type="button"
            onClick={onToggleMotion}
          >
            <i aria-hidden="true"></i>
            {motionPaused ? "Resume motion" : "Pause motion"}
          </button>
        </div>
        <div className="nav-rule" aria-hidden="true">
          <i id="ruleFill"></i>
          <span id="ruleTicks"></span>
        </div>
      </header>
    </>
  );
}
