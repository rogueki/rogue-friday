"use client";

import { Button, ConfirmDialog, TextField } from "@friday/ui";
import { isFridayApiError } from "@friday/sdk";
import { useState } from "react";
import { Section } from "./controls";
import { useAreaDraft, useSettingsDrafts } from "./SettingsDrafts";
import { nameCurrentBrowserLocation } from "./reverseLocation";
import { useT } from "@/i18n";
import { weatherApi } from "@/lib/api/domains/weather";

interface Candidate { label: string; region?: string; country: string; countryCode: string; latitude: number; longitude: number }
type Choice = { label: string; latitude: number; longitude: number; countryCode?: string };
type Busy = "search" | "detect" | "resolve" | "save" | null;

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("location timeout")); }
    }, 15_000);
    navigator.geolocation.getCurrentPosition(
      (position) => { if (!settled) { settled = true; window.clearTimeout(timeout); resolve(position); } },
      (failure) => { if (!settled) { settled = true; window.clearTimeout(timeout); reject(failure); } },
      { timeout: 10_000, maximumAge: 0, enableHighAccuracy: false },
    );
  });
}

export function LocationWeatherArea() {
  const { t, locale } = useT();
  const { value, readOnly } = useAreaDraft("dashboard");
  const { settings, saveLocation, conflicts } = useSettingsDrafts();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [permission, setPermission] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  if (!value) return null;

  const search = async () => {
    setBusy("search"); setError(null); setResults([]); setSearched(false); setSavedNotice(false);
    try {
      const body = await weatherApi.searchLocations(query.trim(), locale);
      setResults(Array.isArray(body.data?.items) ? body.data.items : []);
      setSearched(true);
    } catch { setError(t("settings.location.searchFailed")); }
    finally { setBusy(null); }
  };

  const locate = async () => {
    setPermission(false); setError(null); setChoice(null); setSavedNotice(false);
    if (!window.isSecureContext || !navigator.geolocation) {
      setError(t("settings.location.insecure"));
      return;
    }
    setBusy("detect");
    let position: GeolocationPosition;
    try {
      position = await currentPosition();
    } catch (failure) {
      const denied = typeof failure === "object" && failure !== null && "code" in failure && failure.code === 1;
      setError(t(denied ? "settings.location.denied" : "settings.location.failed"));
      setBusy(null);
      return;
    }
    setBusy("resolve");
    try {
      setChoice(await nameCurrentBrowserLocation(position.coords.latitude, position.coords.longitude, locale));
    } catch {
      setError(t("settings.location.nameFailed"));
    } finally { setBusy(null); }
  };

  const persist = async (location: Choice | null) => {
    setBusy("save"); setError(null); setSavedNotice(false);
    try {
      await saveLocation(location);
      setChoice(null); setSavedNotice(true);
    } catch (failure) {
      setError(isFridayApiError(failure) && failure.code === "CONFLICT" ? t("settings.save.conflict") : t("settings.location.saveFailed"));
    } finally { setBusy(null); }
  };

  return <Section title={t("settings.location.title")} description={t("settings.location.description")}>
    <p className="st-muted" role="status">{settings?.dashboard.location ? t("settings.location.saved", { location: settings.dashboard.location.label }) : t("settings.location.none")}</p>
    <div className="st-inline-actions">
      <Button type="button" disabled={readOnly || busy !== null} onClick={() => setPermission(true)}>{t("settings.location.activate")}</Button>
      {settings?.dashboard.location ? <Button type="button" variant="ghost" disabled={readOnly || busy !== null} onClick={() => void persist(null)}>{t("settings.location.remove")}</Button> : null}
    </div>
    <p className="st-muted">{t("settings.location.permissionHint")}</p>
    <ConfirmDialog open={permission} onOpenChange={setPermission} title={t("settings.location.confirmTitle")}
      description={t("settings.location.confirmDescription")}
      confirmLabel={t("settings.location.confirmYes")} cancelLabel={t("settings.location.confirmNo")} onConfirm={() => void locate()} />
    <div className="st-inline-actions">
      <TextField label={t("settings.location.searchLabel")} value={query} disabled={readOnly || busy !== null} onChange={(event) => setQuery(event.target.value)} />
      <Button type="button" disabled={readOnly || busy !== null || query.trim().length < 2} onClick={() => void search()}>{t("settings.location.search")}</Button>
    </div>
    {results.length > 0 ? <ul aria-label={t("settings.location.results")}>{results.map((item, index) => <li key={`${item.countryCode}-${item.latitude}-${item.longitude}-${index}`}>
      <Button type="button" variant="ghost" disabled={readOnly || busy !== null} onClick={() => { setChoice({ label: [item.label, item.region, item.country].filter(Boolean).join(", "),
        latitude: item.latitude, longitude: item.longitude, countryCode: item.countryCode }); setSavedNotice(false); }}>
        {[item.label, item.region, item.country].filter(Boolean).join(", ")}
      </Button>
    </li>)}</ul> : null}
    {searched && results.length === 0 ? <p className="st-muted" role="status">{t("settings.location.noResults")}</p> : null}
    {choice ? <div><p>{t("settings.location.chosen", { location: choice.label })}</p>
      <Button type="button" loading={busy === "save"} disabled={readOnly || busy !== null || conflicts.includes("dashboard")} onClick={() => void persist(choice)}>{t("settings.location.accept")}</Button>
      {conflicts.includes("dashboard") ? <p className="st-error" role="alert">{t("settings.save.conflict")}</p> : null}
    </div> : null}
    {busy === "detect" ? <p role="status">{t("settings.location.detecting")}</p> : null}
    {busy === "resolve" ? <p role="status">{t("settings.location.resolving")}</p> : null}
    {busy === "save" ? <p role="status">{t("settings.location.saving")}</p> : null}
    {savedNotice ? <p role="status">{t("settings.location.savedNow")}</p> : null}
    {error ? <p className="st-error" role="alert">{error}</p> : null}
  </Section>;
}
