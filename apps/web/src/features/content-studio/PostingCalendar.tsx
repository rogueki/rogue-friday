import { Button, HudPanel } from "@friday/ui";
import { useState } from "react";
import { postingTargets, type Posting } from "./plan";

const isoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shortDate = (date: Date) => date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
// There is no publisher adapter, so "gepostet" only ever means "by hand marked" - the label must not claim more.
const statusNames: Record<Posting["status"], string> = { geplant: "Geplant", gepostet: "Manuell markiert", verpasst: "Verpasst" };

export function PostingCalendar({ postings, disabled, onStatus }: { postings: Posting[]; disabled: boolean; onStatus: (id: string, status: Posting["status"]) => void }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = new Date();
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + weekOffset * 7);
  const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(monday); day.setDate(monday.getDate() + index); return day; });
  const ordered = [...postings].sort((left, right) => `${left.datum}${left.uhrzeit}`.localeCompare(`${right.datum}${right.uhrzeit}`));
  const overdue = (post: Posting) => post.status === "geplant" && `${post.datum}T${post.uhrzeit}` < `${isoDate(today)}T${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;

  return <HudPanel title="Wochen-Postingkalender"><div className="cs-calendar-controls"><Button type="button" variant="ghost" onClick={() => setWeekOffset((value) => value - 1)}>Vorherige Woche</Button><Button type="button" variant="ghost" onClick={() => setWeekOffset(0)}>Aktuelle Woche</Button><Button type="button" variant="ghost" onClick={() => setWeekOffset((value) => value + 1)}>Nächste Woche</Button><strong aria-live="polite">{shortDate(days[0]!)} – {days[6]!.toLocaleDateString("de-DE")}</strong></div>
    <div className="cs-week" aria-label="Postings dieser Woche">{days.map((day) => { const date = isoDate(day); const entries = ordered.filter((post) => post.datum === date); return <section key={date} className={`cs-day${date === isoDate(today) ? " cs-day-today" : ""}`} aria-label={day.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })}><h3>{day.toLocaleDateString("de-DE", { weekday: "short" })} {shortDate(day)}</h3>{entries.length === 0 ? <p>Keine Posts</p> : entries.map((post) => <button key={post.id} type="button" disabled={disabled} className={`cs-post-chip cs-post-${post.status}${overdue(post) ? " cs-post-overdue" : ""}`} title="Als manuell veröffentlicht markieren oder zurücknehmen – kein Publisher angebunden, die Veröffentlichung wird nicht extern bestätigt" aria-label={`${post.uhrzeit} ${post.titel}, ${postingTargets(post).join(" und ")}, ${statusNames[post.status]}. Status wechseln`} onClick={() => onStatus(post.id, post.status === "gepostet" ? "geplant" : "gepostet")}><strong>{post.uhrzeit}</strong> {post.titel}<small>{postingTargets(post).join(" + ")}{overdue(post) ? " · überfällig" : ""} · {statusNames[post.status]}</small></button>)}</section>; })}</div>
  </HudPanel>;
}
