"use client";

import { useHermesAccess } from "@/lib/api/domains/settings";

const TYPE_LABEL: Record<string, string> = {
  api_key: "API-Key",
  oauth: "Abo-Anmeldung",
};

export function HermesAccessArea() {
  const observed = useHermesAccess();

  if (observed.isPending) return <p role="status">Hermes-Zugänge werden gelesen …</p>;
  if (observed.isError)
    return (
      <section aria-label="Hermes-Zugänge">
        <h3>KI-Zugänge</h3>
        <p role="alert">
          {observed.error instanceof Error ? observed.error.message
            : "Die Hermes-Zugänge konnten nicht gelesen werden. Erneut prüfen."}{" "}
          <button type="button" onClick={() => void observed.refetch()}>Erneut lesen</button>
        </p>
      </section>
    );

  const providers = observed.data.data.providers;
  return (
    <section aria-label="Hermes-Zugänge">
      <h3>KI-Zugänge</h3>
      <p>
        Diese Liste kommt aus <code>hermes auth list</code>. Gezeigt werden nur Anbieter, Typ und Herkunft der
        Anmeldung; ein Schlüsselwert verlässt die Bridge nie.
      </p>
      {providers.length === 0
        ? <p role="status">Kein Anbieter ist angemeldet. Hinzufügen folgt über den Hermes-Flow.</p>
        : (
          <ul aria-label="Angemeldete Anbieter">
            {providers.map((provider) => (
              <li key={provider.provider}>
                <strong>{provider.provider}</strong>{" "}
                <span>{provider.count === 1 ? "1 Zugang" : `${provider.count} Zugänge`}</span>
                <ul>
                  {provider.credentials.map((credential) => (
                    <li key={`${provider.provider}-${credential.index}`}>
                      <span>#{credential.index} {credential.label}</span>{" "}
                      <span>{TYPE_LABEL[credential.type] ?? credential.type}</span>{" "}
                      <code>{credential.source}</code>
                      {credential.active ? <span> aktiv</span> : <span> nicht aktiv</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}