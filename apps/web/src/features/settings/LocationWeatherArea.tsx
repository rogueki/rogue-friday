"use client";

import { Button, ConfirmDialog, TextField } from "@friday/ui";
import { useState } from "react";
import { Section } from "./controls";
import { useAreaDraft } from "./SettingsDrafts";
import { useT } from "@/i18n";

interface Candidate { label: string; region?: string; country: string; countryCode: string; latitude: number; longitude: number }
type Choice = { label: string; latitude: number; longitude: number; countryCode?: string };
const coarse = (value: number): number => Math.round(value * 100) / 100;

export function LocationWeatherArea() {
  const { t, locale } = useT();
  const { value, update, readOnly } = useAreaDraft("dashboard");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!value) return null;

  const search = async () => {
    setBusy(true); setError(null); setResults([]); setSearched(false);
    try {
      const response = await fetch(`/api/v1/location/search?q=${encodeURIComponent(query.trim())}&language=${locale}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(t("settings.location.searchFailed"));
      const body = await response.json() as { data?: { items?: Candidate[] } };
      setResults(Array.isArray(body.data?.items) ? body.data.items : []);
      setSearched(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("settings.location.searchFailed")); }
    finally { setBusy(false); }
  };

  const locate = () => {
    setPermission(false);
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(t("settings.location.insecure"));
      return;
    }
    setBusy(true); setError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const latitude = coarse(coords.latitude), longitude = coarse(coords.longitude);
        setChoice({ label: t("settings.location.detected", { latitude, longitude }), latitude, longitude });
        setBusy(false);
      },
      (failure) => {
        setError(t(failure.code === 1 ? "settings.location.denied" : "settings.location.failed"));
        setBusy(false);
      },
      { timeout: 10_000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  };

  return <Section title={t("settings.location.title")} description={t("settings.location.description")}>
    <p className="st-muted" role="status">{value.location ? t("settings.location.saved", { location: value.location.label }) : t("settings.location.none")}</p>
    <div className="st-inline-actions">
      <Button type="button" disabled={readOnly || busy} onClick={() => setPermission(true)}>{t("settings.location.activate")}</Button>
      {value.location ? <Button type="button" variant="ghost" disabled={readOnly} onClick={() => { update({ location: null }); setChoice(null); }}>{t("settings.location.remove")}</Button> : null}
    </div>
    <p className="st-muted">{t("settings.location.permissionHint")}</p>
    <ConfirmDialog open={permission} onOpenChange={setPermission} title={t("settings.location.confirmTitle")}
      description={t("settings.location.confirmDescription")}
      confirmLabel={t("settings.location.confirmYes")} cancelLabel={t("settings.location.confirmNo")} onConfirm={locate} />
    <div className="st-inline-actions">
      <TextField label={t("settings.location.searchLabel")} value={query} disabled={readOnly || busy} onChange={(event) => setQuery(event.target.value)} />
      <Button type="button" disabled={readOnly || busy || query.trim().length < 2} onClick={() => void search()}>{t("settings.location.search")}</Button>
    </div>
    {results.length > 0 ? <ul aria-label={t("settings.location.results")}>{results.map((item, index) => <li key={`${item.countryCode}-${item.latitude}-${item.longitude}-${index}`}>
      <Button type="button" variant="ghost" disabled={readOnly} onClick={() => setChoice({ label: [item.label, item.region, item.country].filter(Boolean).join(", "),
        latitude: item.latitude, longitude: item.longitude, countryCode: item.countryCode })}>
        {[item.label, item.region, item.country].filter(Boolean).join(", ")}
      </Button>
    </li>)}</ul> : null}
    {searched && results.length === 0 ? <p className="st-muted" role="status">{t("settings.location.noResults")}</p> : null}
    {choice ? <div role="status"><p>{t("settings.location.chosen", { location: choice.label })}</p>
      <Button type="button" disabled={readOnly} onClick={() => { update({ location: choice }); setChoice(null); }}>{t("settings.location.accept")}</Button>
      <p className="st-muted">{t("settings.location.saveHint")}</p>
    </div> : null}
    {error ? <p className="st-error" role="alert">{error}</p> : null}
  </Section>;
}
