import type { Rng } from "../core/prng";
import type { WorldState } from "../world/state";

const COMPOUNDS = [
  "Donaudampfschifffahrtsgesellschaftskapitänsmützenreinigungsauftrag",
  "Bundesausbildungsförderungsgesetzänderungsvorschlagsprüfung",
  "Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz",
  "Straßenverkehrsgenehmigungsgebührenanpassungsverordnung",
  "Haftpflichtversicherungsschadensfreiheitsrabattberechnung",
  "Elektrizitätswirtschaftsrechtsänderungsentwurfsbegutachtung",
  "Kraftfahrzeughaftpflichtversicherungsbeitragsrückerstattung",
  "Wohnungsbaugenossenschaftsmitgliederversammlungseinladungsentwurf",
  "Arbeitsunfähigkeitsbescheinigungsdatenübermittlungsschnittstelle",
  "Datenschutzgrundverordnungsumsetzungsüberwachungsbericht",
  "Photovoltaikanlagenfördermittelantragsbearbeitungsstatusabfrage",
  "Betriebskostenabrechnungsnachzahlungsüberprüfungsmitteilung",
];

const TAILS = [
  "mit allen Änderungen, Rückfragen und Ergänzungen aus den Gesprächen der vergangenen Wochen einschließlich Übersicht der Zuständigkeiten",
  "samt vollständiger Dokumentation für die Prüfung durch Steuerberatung, Finanzamt Hannover-Nord und die zuständige Sachbearbeiterin",
  "inklusive aller Anhänge, Nachweise, Rechnungen und Rückmeldungen der beteiligten Firmen aus dem gesamten Zeitraum",
];

/** Lengthens a text with compound words and clauses (max 290 chars so contract limits such as Task.title ≤ 300 hold). */
export function lengthen(text: string, rng: Rng, targetLength = 200): string {
  if (text.length >= targetLength) return text.slice(0, 290);
  const compound = rng.pick(COMPOUNDS);
  const tail = rng.pick(TAILS);
  let result = `${compound}: ${text} ${tail}`;
  if (result.length > 290) result = result.slice(0, 287).trimEnd() + "…";
  return result;
}

/** Rewrites visible text fields of a default world with very long German strings (PLAN §45.12). */
export function applyLongGerman(state: WorldState, rng: Rng): void {
  for (const task of state.tasks) {
    task.title = lengthen(task.title, rng, 160);
    if (task.description) task.description = lengthen(task.description, rng, 400).repeat(1);
    for (const step of task.steps) step.title = lengthen(step.title, rng, 90);
  }
  for (const thread of state.threads) thread.subject = lengthen(thread.subject, rng, 170);
  for (const memory of state.memory) {
    if (memory.title) memory.title = lengthen(memory.title, rng, 120);
  }
  for (const approval of state.approvals) approval.action = lengthen(approval.action, rng, 140);
  for (const event of state.calendarEvents) event.title = lengthen(event.title, rng, 120);
  for (const notification of state.notifications) notification.title = lengthen(notification.title, rng, 130);
  for (const automation of state.automations) automation.name = lengthen(automation.name, rng, 100);
  for (const project of state.researchProjects) project.topic = lengthen(project.topic, rng, 160);
  for (const file of state.files) {
    const dot = file.name.lastIndexOf(".");
    const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
    const ext = dot > 0 ? file.name.slice(dot) : "";
    file.name = `${lengthen(stem, rng, 100)}${ext}`.slice(0, 250);
  }
  for (const agent of state.agents) agent.role = lengthen(agent.role, rng, 90);
}
