export interface ChromeProps {
  motionPaused?: boolean;
  onToggleMotion?: () => void;
}

export default function Chrome({ motionPaused = false, onToggleMotion }: ChromeProps) {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <div id="loader" role="status" aria-label="Loading product viewer">
        <div className="mono">Meridian 0.5</div>
        <div className="bar">
          <i id="loadFill"></i>
        </div>
      </div>
      <div id="progress" aria-hidden="true">
        <i id="progressFill"></i>
      </div>
      <div id="sceneLabel" aria-hidden="true">
        01 — Reveal
      </div>
      <canvas id="gl" aria-hidden="true"></canvas>
      <div className="scrim" aria-hidden="true"></div>
      <div id="fallback" role="img" aria-label="Mechanical pencil illustration">
        <svg viewBox="0 0 200 600" fill="none" aria-hidden="true">
          <rect x="85" y="20" width="30" height="560" rx="14" fill="#141412" />
          <rect x="88" y="390" width="24" height="90" rx="8" fill="#3a3a38" />
          <path d="M85 560 L100 595 L115 560Z" fill="#9aa0a8" />
        </svg>
      </div>
      <header id="nav">
        <div className="nav-inner">
          <a className="brand" href="#hero">
            Meridian<small>0.5&nbsp;MM</small>
          </a>
          <nav className="links" aria-label="Sections">
            <a href="#detail">Detail</a>
            <a href="#exploded">Exploded</a>
            <a href="#mechanism">Mechanism</a>
            <a href="#lineup">Lineup</a>
          </nav>
          <a className="nav-cta" href="#buy">
            Buy — $48+
          </a>
          <button
            className="motion-toggle"
            id="motionBtn"
            aria-pressed={motionPaused ? "true" : "false"}
            aria-label="Pause motion"
            type="button"
            onClick={onToggleMotion}
          >
            {motionPaused ? "Resume motion" : "Pause motion"}
          </button>
        </div>
      </header>
    </>
  );
}
