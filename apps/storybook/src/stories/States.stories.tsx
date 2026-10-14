import type { Meta, StoryObj } from '@storybook/react-vite';
import { Inbox } from 'lucide-react';
import { useState } from 'react';
import { Button, DegradedState, EmptyState, ErrorState, HudPanel, OfflineState, Skeleton, StaleBanner } from '@jarvis/ui';
import { Grid, Section } from './_helpers';

const meta = { title: 'Components/States', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const now = new Date('2026-06-15T11:18:21+02:00');

export const Empty: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={380}>
        <EmptyState title="Keine Aufgaben" description="Lege eine Aufgabe an oder passe den Filter an." action={<Button size="sm" icon={<Inbox />}>Aufgabe anlegen</Button>} />
        <EmptyState compact title="Keine Freigaben offen" />
      </Grid>
    </div>
  ),
};

export const ErrorStates: Story = {
  name: 'Error',
  render: function Render() {
    const [retrying, setRetrying] = useState(false);
    return (
      <div style={{ padding: 28 }}>
        <Grid min={420}>
          <ErrorState
            title="Aufgaben konnten nicht geladen werden"
            description="Der Adapter hat nicht rechtzeitig geantwortet."
            code="ADAPTER_TIMEOUT"
            correlationId="corr_01HZX3K8M2Q9N4"
            retrying={retrying}
            onRetry={() => {
              setRetrying(true);
              window.setTimeout(() => setRetrying(false), 1500);
            }}
          />
          <ErrorState compact title="Verlauf nicht verfügbar" code="CAPABILITY_MISSING" onRetry={() => undefined} />
        </Grid>
      </div>
    );
  },
};

export const Offline: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={420}>
        <OfflineState lastSync="2026-06-15T10:58:00+02:00" now={now} onRetry={() => undefined} />
        <OfflineState compact title="Offline" description="Zwischengespeicherte Daten" lastSync="2026-06-15T10:58:00+02:00" now={now} />
      </Grid>
    </div>
  ),
};

export const Degraded: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={420}>
        <DegradedState description="Einige Funktionen arbeiten mit Verzögerung oder ohne Live-Daten." affected={['Voice STT', 'Windows Worker', 'Kalender-Sync']} />
        <DegradedState compact title="Eingeschränkt" description="Voice STT langsam" />
      </Grid>
    </div>
  ),
};

export const Stale: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'grid', gap: 12, maxWidth: 780 }}>
      <StaleBanner asOf="2026-06-15T10:40:00+02:00" now={now} onRefresh={() => undefined} />
      <StaleBanner message="Kalenderdaten sind älter als 1 Stunde." asOf="2026-06-15T09:30:00+02:00" now={now} />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={320}>
        <HudPanel title="Lädt …">
          <Skeleton lines={4} />
        </HudPanel>
        <HudPanel title="Liste lädt …">
          <div style={{ display: 'grid', gap: 8 }}>
            <Skeleton variant="row" />
            <Skeleton variant="row" />
            <Skeleton variant="row" />
          </div>
        </HudPanel>
      </Grid>
    </div>
  ),
};

export const MissingAndReadOnlyCapability: Story = {
  name: 'Missing / read-only capability',
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Fehlende Capability">
        <EmptyState title="Funktion nicht verfügbar" description="Für diese Ansicht fehlt die Capability „automations.read“. Prüfe die Adapter-Konfiguration." />
      </Section>
      <Section title="Nur Lesezugriff">
        <DegradedState title="Nur Lesezugriff" description="Änderungen sind deaktiviert. Du kannst Daten ansehen, aber nichts schreiben." compact />
      </Section>
    </div>
  ),
};
