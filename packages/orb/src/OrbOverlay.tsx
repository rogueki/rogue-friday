import type { CSSProperties } from "react";
import type { OrbLayers, OrbMode, OrbStatus } from "./contract-types";
import type { OrbLabels } from "./labels";

/** Shared CSS for the HTML layer. Inline so the package has no stylesheet dependency. */
export const ORB_CSS = `
.friday-orb{box-sizing:border-box;position:relative;width:100%;height:100%;min-height:var(--orb-min-height,160px);display:grid;place-items:center;overflow:hidden;padding:clamp(24px,4vh,52px);background:transparent;isolation:isolate;--orb-gold:#f6c453;--orb-amber:#ffb000;--orb-danger:#ff6a3d;--orb-muted:#b79b6a}
.friday-orb__canvas{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.friday-orb *{box-sizing:border-box}
.friday-orb__label::before{content:"";position:absolute;left:0;right:0;bottom:-16px;height:150%;z-index:-1;background:linear-gradient(to top,rgba(1,6,12,.82),rgba(1,6,12,.55) 55%,transparent);pointer-events:none}
.friday-orb__label{position:absolute;left:0;right:0;bottom:clamp(6px,2.4%,16px);display:flex;flex-direction:column;align-items:center;gap:3px;pointer-events:none;text-align:center;padding:0 12px}
.friday-orb__state{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-heading,"Oxanium","Segoe UI",system-ui,sans-serif);font-weight:600;font-size:clamp(10px,2.1vmin,14px);letter-spacing:.24em;text-transform:uppercase;color:var(--orb-label-color,var(--orb-gold));text-shadow:0 0 12px rgba(246,196,83,.45),0 0 2px rgba(0,0,0,.8);transition:color .4s ease}
.friday-orb__activity{font-family:var(--font-body,"Inter","Segoe UI",system-ui,sans-serif);font-size:clamp(9px,1.7vmin,12px);letter-spacing:.06em;color:var(--orb-muted);max-width:88%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.friday-orb__glyph{display:inline-block;width:1.15em;height:1.15em;flex:none}
.friday-orb__target{position:absolute;inset:0;margin:auto;width:var(--orb-diameter,66%);height:var(--orb-diameter,66%);border-radius:50%;border:0;background:transparent;padding:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.friday-orb__target:focus-visible{outline:2px solid var(--orb-gold);outline-offset:4px;box-shadow:0 0 24px rgba(246,196,83,.35)}
.friday-orb__tip{position:absolute;inset:0;margin:auto;width:fit-content;height:fit-content;min-width:176px;max-width:260px;padding:9px 12px;border:1px solid rgba(246,196,83,.35);border-radius:3px;background:rgba(3,17,29,.88);backdrop-filter:blur(4px);color:#e8dcc2;font:11px/1.45 var(--font-body,"Inter","Segoe UI",system-ui,sans-serif);pointer-events:none;z-index:3;box-shadow:0 0 18px rgba(246,196,83,.15)}
.friday-orb__tip dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0}
.friday-orb__tip dt{color:var(--orb-muted);text-transform:uppercase;letter-spacing:.1em;font-size:9px;padding-top:1px}
.friday-orb__tip dd{margin:0;font-family:var(--font-mono,"JetBrains Mono",ui-monospace,monospace);font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.friday-orb__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.friday-orb canvas{display:block}
@media (prefers-reduced-motion:reduce){.friday-orb__state{transition:none}}
`;

const MODE_COLOR: Partial<Record<OrbMode, string>> = {
  waiting_approval: "#ffb000",
  error: "#ff6a3d",
  warning: "#ff9a3c",
  offline: "#9c7e57",
  paused: "#b89458",
  success: "#fff0b8",
};

export function modeLabelColor(mode: OrbMode): string {
  return MODE_COLOR[mode] ?? "#f6c453";
}

function MicGlyph() {
  return (
    <svg className="friday-orb__glyph" viewBox="0 0 24 24" fill="none" stroke="#5fe3ff" strokeWidth="1.6" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg className="friday-orb__glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function ApprovalGlyph() {
  return (
    <svg className="friday-orb__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 3l8 4v5c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V7z" strokeLinejoin="round" />
      <path d="M12 8.5v4.2M12 15.4v.1" strokeLinecap="round" />
    </svg>
  );
}

function WarnGlyph() {
  return (
    <svg className="friday-orb__glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 4l9 16H3z" strokeLinejoin="round" />
      <path d="M12 10v4.5M12 17.2v.1" strokeLinecap="round" />
    </svg>
  );
}

export interface OrbOverlayProps {
  status: OrbStatus;
  layers: OrbLayers;
  labels: OrbLabels;
}

/** StateLabel + ActivityText + mic / pause / approval glyphs. Lives outside the sphere (bottom of the panel). */
export function OrbOverlay({ status, layers, labels }: OrbOverlayProps) {
  const mode = status.mode;
  const agents = Math.max(layers.activeAgentIds.length, status.activeAgentCount ?? 0);
  let activity = status.activityText?.trim();
  if (!activity && agents > 0 && (mode === "working" || mode === "speaking")) activity = labels.agentsActive(agents);
  const style = { "--orb-label-color": modeLabelColor(mode) } as CSSProperties;
  const micOpen = layers.voice === "listening";
  return (
    <div className="friday-orb__label" style={style} data-testid="orb-label">
      <span className="friday-orb__state" data-testid="orb-state-label">
        {micOpen ? <MicGlyph /> : null}
        {mode === "paused" ? <PauseGlyph /> : null}
        {mode === "waiting_approval" ? <ApprovalGlyph /> : null}
        {mode === "warning" || mode === "error" ? <WarnGlyph /> : null}
        {labels.states[mode]}
      </span>
      {activity ? (
        <span className="friday-orb__activity" data-testid="orb-activity">
          {activity}
          {mode === "working" && agents > 0 && status.activityText ? `  ·  ${labels.agentsShort(agents)}` : ""}
        </span>
      ) : null}
    </div>
  );
}
