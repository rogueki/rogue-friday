import { Button, HudPanel } from "@friday/ui";
import { ideaTargets, type ContentIdea } from "./plan";

const columns: { status: ContentIdea["status"]; title: string }[] = [
  { status: "idee", title: "Idee" }, { status: "in-arbeit", title: "In Arbeit" }, { status: "fertig", title: "Fertig" },
];

export function IdeaKanban({ ideas, disabled, onStatus, onEdit, onPlan, onRemove }: {
  ideas: ContentIdea[];
  disabled: boolean;
  onStatus: (id: string, status: ContentIdea["status"]) => void;
  onEdit: (idea: ContentIdea) => void;
  onPlan: (idea: ContentIdea) => void;
  onRemove: (id: string) => void;
}) {
  return <HudPanel title="Content-Kanban"><div className="cs-stats"><span><strong>{ideas.length}</strong> Gesamt</span>{columns.map(({ status, title }) => <span key={status}><strong>{ideas.filter((idea) => idea.status === status).length}</strong> {title}</span>)}</div>
    {ideas.length === 0 && <p className="cs-empty">Noch keine Content-Ideen. Lege eine Idee an; sie erscheint hier im Kanban.</p>}
    <div className="cs-kanban">{columns.map(({ status, title }) => { const entries = ideas.filter((idea) => idea.status === status); return <section className="cs-kanban-column" key={status} aria-label={`${title}: ${entries.length} Ideen`}><h3>{title} <span>{entries.length}</span></h3>{entries.length === 0 ? <p>Keine Einträge</p> : entries.map((idea) => <article className="cs-card" key={idea.id}><div><strong>{idea.titel}</strong><p>{ideaTargets(idea).join(" + ")} · {idea.format}{idea.zieldatum ? ` · Ziel: ${idea.zieldatum}` : ""}</p>{idea.beschreibung && <p>{idea.beschreibung}</p>}</div><div className="cs-card-actions"><label>Status<select disabled={disabled} value={idea.status} onChange={(event) => onStatus(idea.id, event.target.value as ContentIdea["status"])}><option value="idee">Idee</option><option value="in-arbeit">In Arbeit</option><option value="fertig">Fertig</option></select></label><Button type="button" variant="ghost" onClick={() => onEdit(idea)}>Bearbeiten</Button><Button type="button" variant="ghost" disabled={disabled} onClick={() => onPlan(idea)}>Posting planen</Button><Button type="button" variant="ghost" disabled={disabled} onClick={() => { if (window.confirm(`Idee „${idea.titel}“ entfernen?`)) onRemove(idea.id); }}>Entfernen</Button></div></article>)}</section>; })}</div>
  </HudPanel>;
}
