import { HudPanel } from "@friday/ui";

const providers = [
  {
    name: "Instagram und Facebook",
    setup: "Meta-Developer-App mit den benötigten Instagram- und Facebook-Berechtigungen einrichten, Redirect-URI hinterlegen und gegebenenfalls die App-Prüfung abschließen.",
    account: "Ein professionelles Instagram-Konto oder eine Facebook-Seite auswählen und beim Meta-Login freigeben. Beide Veröffentlichungsziele werden getrennt geprüft.",
    guide: "https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api",
    guideLabel: "Meta-API-Anleitung",
  },
  {
    name: "TikTok",
    setup: "TikTok-Developer-App registrieren, die Content Posting API und video.publish beantragen, Redirect-URI hinterlegen und die Anbieterprüfung abschließen.",
    account: "TikTok-Konto verbinden. Vor jedem Posting müssen die erlaubte Sichtbarkeit und die Creator-Einstellungen geprüft werden.",
    guide: "https://developers.tiktok.com/docs/en/content-posting-api-get-started",
    guideLabel: "TikTok-Posting-Anleitung",
  },
  {
    name: "YouTube",
    setup: "Google-Cloud-Projekt, YouTube Data API, OAuth-Zustimmungsbildschirm und OAuth-Client mit Redirect-URI einrichten.",
    account: "Google-Konto und YouTube-Kanal mit Upload-Berechtigung verbinden und den Kanal prüfen.",
    guide: "https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps",
    guideLabel: "YouTube-OAuth-Anleitung",
  },
] as const;

export function SocialPublishingOnboarding() {
  return (
    <HudPanel title="Social-Konten einrichten">
      <p>Für direkte Veröffentlichungen braucht F.R.I.D.A.Y. eine Developer-App oder einen OAuth-Client des jeweiligen Anbieters. Die Plattformen können hier geplant werden; direkte Veröffentlichungen sind in dieser Version noch nicht verfügbar.</p>
      <p>Die Person, die F.R.I.D.A.Y. betreibt, richtet die App einmalig ein. Anschließend verbindet jeder Nutzer sein Konto über die Anmeldeseite des jeweiligen Anbieters. API-Schlüssel für kie.ai oder ElevenLabs ersetzen diese Verbindung nicht.</p>
      <div className="cs-list">
        {providers.map((provider) => (
          <details key={provider.name} className="cs-onboarding-card">
            <summary>{provider.name} · Einrichtung erforderlich</summary>
            <p><strong>App einrichten:</strong> {provider.setup}</p>
            <p><strong>Konto verbinden:</strong> {provider.account}</p>
            <p><a href={provider.guide} target="_blank" rel="noopener noreferrer">{provider.guideLabel}</a></p>
          </details>
        ))}
      </div>
      <p>Nach der Einrichtung müssen Konten und Rechte lesend geprüft werden. Erst danach kann der Veröffentlichungsablauf freigeschaltet werden.</p>
    </HudPanel>
  );
}
