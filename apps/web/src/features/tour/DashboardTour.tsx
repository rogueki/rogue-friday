"use client";

import { isFridayApiError } from "@friday/sdk";
import { Button, Switch } from "@friday/ui";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pageRoute, useNavItems, type NavPageId } from "@/features/shell/navModel";
import { useSpeakVoiceTourStep } from "@/lib/api/domains/voice";
import { useSession } from "@/lib/session";
import { subscribeNavigationRequests } from "./navigationRequests";
import tourSteps from "./tourSteps.generated.json";
import "./tour.css";

interface TourStepText {
  id: string;
  title: string;
  text: string;
}

const STEPS = tourSteps.steps;
const TOUR_RETRY_MS = 4_000;

/** Knowledge-base entry of every dashboard page; the card shows the help text of the step. */
const KNOWLEDGE_ID: Record<NavPageId, string> = {
  overview: "seiten#uebersicht",
  tasks: "seiten#aufgaben",
  activity: "seiten#live-aktivitaet",
  memory: "seiten#gedaechtnis",
  agents: "seiten#agenten",
  skills: "seiten#skills",
  approvals: "seiten#freigaben",
  communication: "seiten#mail-kommunikation",
  calendar: "seiten#kalender",
  automations: "seiten#automationen",
  research: "seiten#recherche",
  "content-studio": "seiten#content-studio",
  files: "seiten#dateien-dokumente",
  voice: "seiten#sprache",
  alerts: "seiten#meldungen-alarme",
  system: "seiten#system",
  audit: "seiten#audit-verlauf",
  settings: "seiten#einstellungen",
};

interface TourStep {
  area: NavPageId;
  step: TourStepText;
}

interface TourContextValue {
  start: (area?: NavPageId) => void;
  stop: () => void;
  active: boolean;
}

const TourContext = createContext<TourContextValue>({ start: () => undefined, stop: () => undefined, active: false });

/** Tour controls; without a TourProvider the card never opens and starting is a no-op. */
export function useTour(): TourContextValue {
  return useContext(TourContext);
}

/** Guided tour through the visible pages in sidebar order: open the page, show its help text, optionally speak it. */
export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { items } = useNavItems();
  const session = useSession();
  const { mutate: speakTourStep } = useSpeakVoiceTourStep();
  const owner = session.role === "owner";

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [speak, setSpeak] = useState(true);
  const [speakError, setSpeakError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const stepById = useMemo(() => {
    const map = new Map<string, TourStepText>();
    for (const step of STEPS) map.set(step.id, step);
    return map;
  }, []);

  const steps = useMemo<TourStep[]>(() => {
    const entries: TourStep[] = [];
    for (const item of items) {
      const area = item.id as NavPageId;
      const step = stepById.get(KNOWLEDGE_ID[area]);
      if (step) entries.push({ area, step });
    }
    return entries;
  }, [items, stepById]);

  const start = useCallback(
    (area?: NavPageId) => {
      if (!owner || steps.length === 0) return;
      const target = area === undefined ? 0 : steps.findIndex((entry) => entry.area === area);
      setIndex(target >= 0 ? target : 0);
      setSpeakError(null);
      setActive(true);
    },
    [owner, steps],
  );
  const stop = useCallback(() => setActive(false), []);

  // Refs keep the step effect and the realtime listener on the current values without re-running on every render.
  const routerRef = useRef(router);
  routerRef.current = router;
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const speakTourStepRef = useRef(speakTourStep);
  speakTourStepRef.current = speakTourStep;
  const startRef = useRef(start);
  startRef.current = start;
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const currentArea = steps[index]?.area;

  useEffect(() => {
    if (!active || currentArea === undefined) return;
    routerRef.current.push(pageRoute(currentArea));
    if (!speakRef.current) return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const request = (again: boolean): void => speakTourStepRef.current(
      { area: currentArea },
      {
        onError: (error) => {
          // A voice start of the tour still speaks its confirmation; one later attempt keeps the first explanation.
          if (again && isFridayApiError(error) && error.code === "CONFLICT") retry = setTimeout(() => request(false), TOUR_RETRY_MS);
          else setSpeakError(error.message);
        },
        onSuccess: () => setSpeakError(null),
      },
    );
    request(true);
    return () => clearTimeout(retry);
  }, [active, currentArea]);

  useEffect(() => {
    if (active) headingRef.current?.focus();
  }, [active, currentArea]);

  useEffect(
    () =>
      subscribeNavigationRequests((request) => {
        if (session.role !== "owner") return;
        if (!stepsRef.current.some((entry) => entry.area === request.area)) return;
        if (request.tour) startRef.current(request.area);
        else routerRef.current.push(pageRoute(request.area));
      }),
    [session.role],
  );

  const value = useMemo<TourContextValue>(() => ({ start, stop, active }), [start, stop, active]);
  const entry = steps[index];
  const last = index === steps.length - 1;

  return (
    <TourContext.Provider value={value}>
      {children}
      {active && entry ? (
        <aside
          className="tour-card"
          role="dialog"
          aria-modal="false"
          aria-labelledby="tour-title"
          onKeyDown={(event) => {
            if (event.key === "Escape") stop();
          }}
        >
          <p className="tour-card__step">Schritt {index + 1} von {steps.length}</p>
          <h2 id="tour-title" ref={headingRef} tabIndex={-1}>{entry.step.title}</h2>
          {entry.step.text.split(/\n\s*\n/).map((paragraph, paragraphIndex) => (
            <p key={paragraphIndex}>{paragraph}</p>
          ))}
          <Switch label="Vorlesen" checked={speak} onCheckedChange={setSpeak} />
          {speakError ? <p role="status">{speakError}</p> : null}
          <p className="tour-card__hint">Fragen kannst du jederzeit stellen, auch per Stimme.</p>
          <div className="tour-card__actions">
            <Button type="button" variant="ghost" disabled={index === 0} onClick={() => setIndex((previous) => Math.max(0, previous - 1))}>Zurück</Button>
            <Button
              type="button"
              onClick={last ? stop : () => setIndex((previous) => Math.min(steps.length - 1, previous + 1))}
            >
              {last ? "Tour beenden" : "Weiter"}
            </Button>
            <Button type="button" variant="ghost" onClick={stop}>Schließen</Button>
          </div>
        </aside>
      ) : null}
    </TourContext.Provider>
  );
}
