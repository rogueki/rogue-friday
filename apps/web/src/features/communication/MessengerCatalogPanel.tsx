"use client";

import type { MessengerCatalogResponse } from "@friday/sdk";
import { useQuery } from "@tanstack/react-query";
import { call } from "@/lib/api/call";
import { getApiClient } from "@/lib/api/client";
import { useSession } from "@/lib/session";

export function MessengerCatalogPanel() {
  const { role } = useSession();
  const catalog = useQuery({ queryKey: ["messenger", "catalog"], enabled: role === "owner", retry: false,
    queryFn: (): Promise<MessengerCatalogResponse> => call(getApiClient().GET("/api/v1/messenger/catalog")) });
  if (role !== "owner") return null;
  return <section className="mk-panel" aria-label="Hermes-Messenger-Kanäle">
    <h2>Hermes-Messenger-Kanäle</h2>
    <p>Das Inventar stammt aus der gepinnten lokalen Hermes-Version. „Konfiguriert“ bedeutet nur, dass Hermes die Voraussetzungen erkennt. Ein erfolgreicher Empfang oder Versand ist damit nicht belegt.</p>
    {catalog.isPending ? <p role="status">Kanalvoraussetzungen werden gelesen.</p> : null}
    {catalog.isError ? <p role="alert">Kanalinventar nicht erreichbar. <button type="button" onClick={() => void catalog.refetch()}>Erneut prüfen</button></p> : null}
    {catalog.data ? <details><summary>{catalog.data.data.items.length} native Nachrichtenkanäle anzeigen</summary><ul>
      {catalog.data.data.items.map((item) => <li key={item.platform}>
        <strong>{item.platform}</strong>: {item.configured ? "konfiguriert" : "Voraussetzungen fehlen"};
        {" "}Gateway: {item.gatewayRunning ? "läuft" : "nicht bestätigt"}; Verbindung: {item.connectionState};
        {" "}Friday-Versand: {item.exactSendSupported ? "exakte Ziele möglich" : "noch nicht freigegeben"};
        {" "}native Friday-Einrichtung: {item.nativeSetupAvailable ? "vorhanden" : "ausstehend"}.
        {item.fields.length ? <details><summary>Voraussetzungen</summary><ul>
          {item.fields.map((field) => <li key={field.name}>{field.name}: {field.present ? "vorhanden" : "fehlt"}
            {field.required ? " (erforderlich)" : " (optional)"}{field.secret ? ", geheimer Wert wird nicht angezeigt" : ""}</li>)}
        </ul></details> : null}
      </li>)}
    </ul></details> : null}
  </section>;
}
