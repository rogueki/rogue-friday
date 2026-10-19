# P8-2 Security, Sessions und Approval-Policy

Stand: 2026-10-19, Quellbasis `b9514ee`.

## Laufzeitbindung

`security.sessionTimeoutMinutes` begrenzt neue und vorhandene Sitzungen. Die bestehende absolute Frist wird bei einer Verlaengerung nicht automatisch erweitert. Remember-Me hebt nur die Idle-Frist auf; die absolute Frist und das Cookie-Max-Age folgen weiter dem eingestellten Timeout. `security.reauthWindowMinutes` steuert Sitzungsanzeige und die serverseitige Tier-3-Entscheidung. Logout/Logout-All widerrufen Sessions weiterhin im Store.

`security.trustedOrigins` wird pro Request vom Guard gelesen; die Settings-Transaktion validiert kanonische, eindeutige HTTP(S)-Origins, bevor sie gespeichert werden. Ein gescheiterter Patch belaesst die vorherige Origin-Policy. `allowRemoteAccess` bildet die tatsaechliche Serverbindung ab und ist zur Laufzeit nicht umschaltbar. `auditHashChain` bleibt immer aktiv. Beide Schalter sind deshalb im UI gesperrt; API-Patches, die davon abweichen, liefern einen Validierungsfehler.

## Nativer Approval-Erzeugungsvertrag

`runtime.nativeApprovals.propose(input)` ist ein persistierter Control-API-Port fuer einen vertrauenswuerdigen Action-Executor. Aufruf **vor** einer externen Aktion mit geprueftem Preview, Risikostufe und stabilem `requestKey`. Der Port validiert den Approval-Vertrag, speichert den konkreten Default-Snapshot und liefert `{draftOnly, notifyOnRequest, requiresApproval, approval}`. Eine wiederholte Anfrage mit gleichem Key und Payload liefert denselben Snapshot; andere Payload mit gleichem Key wird abgewiesen. `get(requestKey)` liest den persistierten Snapshot. Neue Tier-2-Antraege haengen von `confirmTier2` ab, Tier 3 erfordert immer Reauth. Alte pending Approval-Datensaetze behalten `expiresAt` und `requiredAuth` nach einer Settings-Aenderung.

Der Port fuehrt selbst keine Aktion aus, bewilligt keinen Antrag und versendet keine Nachricht. Der Action-Executor muss `draftOnly` vor Ausfuehrung, `notifyOnRequest` beim neu erstellten Antrag und die Approval-ID beim spaeteren Entscheid verbrauchen. Er muss den Store/Port um einen sicheren Decide-und-Execute-Schritt mit erneuter Zustands-, Frist- und Versionpruefung ergaenzen. Externe Adapter-Approvals bleiben bei ihrem Provider, da der derzeitige `ApprovalPort` nur List/Get/Approve/Reject/Context kennt und keinen Erzeugungsaufruf annimmt. P9 muss seine konkreten Command-, Agent- und Tool-Aktionspfade an diesen Erzeugungsvertrag anbinden; P6-Messaging hat einen separaten Send-Flow. Bis dahin sind die Approval-Settings fuer Live-Aktionen **nicht vollstaendig angewandt**. Die gespeicherten Defaults duerfen nicht als bereits wirksamer Schutz fuer externe Provider dargestellt werden.

## Nachweisgrenzen

Synthetisch geprueft: Session-Ablauf und Remember-Me-Cookie, Reauth-Fenster, Trusted-Origin-Apply und -Fehlapply, Tier-3-Reauth, Approval-Policy-Snapshot, Idempotenz, bestehende Antraege und Persistenz ueber API-Neustart. Kein Live-Login, keine echte externe Aktion, keine physische Audio-/Headsetpruefung.
