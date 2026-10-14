import type { Meta, StoryObj } from '@storybook/react-vite';
import { Cpu, Database, ListChecks } from 'lucide-react';
import { CircularMetric, ConstellationGraph, MetricCard, Waveform, TONES } from '@jarvis/ui';
import { Grid, Row, Section } from './_helpers';

const meta = { title: 'Components/Metrics', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const CircularMetrics: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Normal">
        <Row gap={28}>
          <CircularMetric label="CPU" value={15} />
          <CircularMetric label="RAM" value={54} />
          <CircularMetric label="Disk" value={40} />
          <CircularMetric label="VRAM" value={92} thresholds={[70, 90]} caption="11,0 / 12 GB" size={96} />
          <CircularMetric label="GPU" value={78} thresholds={[70, 90]} />
        </Row>
      </Section>
      <Section title="Wert fehlt (null → „—“ mit Grund, nie eine erfundene 0)">
        <Row gap={28}>
          <CircularMetric label="D:\" value={null} nullReason="Windows-Worker offline – keine Kapazitätsdaten" />
          <CircularMetric label="GPU" value={undefined} />
          <CircularMetric label="Echte 0" value={0} />
        </Row>
      </Section>
      <Section title="Größen">
        <Row gap={28}>
          <CircularMetric label="CPU" value={37} size={64} strokeWidth={5} />
          <CircularMetric label="CPU" value={37} size={120} strokeWidth={8} />
          <CircularMetric label="Violett" value={61} tone="violet" />
          <CircularMetric label="Teal" value={61} tone="teal" />
        </Row>
      </Section>
    </div>
  ),
};

export const MetricCards: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={240}>
        <MetricCard label="Offene Aufgaben" value={12} icon={<ListChecks />} delta="+3 heute" trend="up" trendGood="down" hint="2 überfällig" />
        <MetricCard label="Gedächtnis" value="3.380" icon={<Database />} tone="blue" delta="+14" trend="up" />
        <MetricCard label="Latenz" value={182} unit="ms" icon={<Cpu />} tone="green" delta="−12 ms" trend="down" trendGood="down" spark={[0.3, 0.5, 0.4, 0.7, 0.55, 0.35, 0.5, 0.42]} />
        <MetricCard label="Auslastung" value={null} icon={<Cpu />} nullReason="Adapter ADAPTER_UNAVAILABLE" />
        <MetricCard label="Lädt" value={0} loading />
        <MetricCard label="Lange Bezeichnung für die Überwachungsschwelle" value="1.204.331" unit="Events" tone="violet" />
      </Grid>
    </div>
  ),
};

export const Constellation: Story = {
  name: 'ConstellationGraph',
  render: () => (
    <div style={{ padding: 28, display: 'flex', gap: 24 }}>
      <div style={{ width: 360, height: 180, border: '1px solid var(--jv-line-soft)' }}>
        <ConstellationGraph summary="Demo-Graph mit 15 Einträgen" seed={11} count={15} />
      </div>
      <div style={{ width: 360, height: 180, border: '1px solid var(--jv-line-soft)' }}>
        <ConstellationGraph
          summary="Projekt F.R.I.D.A.Y. mit drei verbundenen Personen"
          nodes={[
            { id: 'p', x: 0.5, y: 0.5, weight: 1, label: 'F.R.I.D.A.Y.' },
            { id: 'a', x: 0.2, y: 0.3, weight: 0.5 },
            { id: 'b', x: 0.8, y: 0.3, weight: 0.5 },
            { id: 'c', x: 0.5, y: 0.85, weight: 0.4, tone: 'amber' },
          ]}
          edges={[['p', 'a'], ['p', 'b'], ['p', 'c']]}
        />
      </div>
    </div>
  ),
};

export const Waveforms: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'grid', gap: 18, maxWidth: 640 }}>
      <Section title="Live (mirror) – animiert bei „Voll“, statisch bei „Reduziert/Aus“">
        <Waveform live height={40} label="Live-Signal" />
      </Section>
      <Section title="Varianten">
        <div style={{ display: 'grid', gap: 12 }}>
          <Waveform live variant="mirror" height={32} fade="edges" />
          <Waveform live variant="bars" height={32} tone="green" />
          <Waveform live variant="line" height={32} tone="violet" />
          <Waveform variant="dots" height={32} energy={0.2} tone="amber" fade="edges" />
          <Waveform levels={[0.2, 0.5, 0.9, 0.4, 0.7, 0.3, 0.6, 0.8, 0.2, 0.5, 0.35, 0.65]} height={32} tone="gold" />
        </div>
      </Section>
      <Section title="Töne">
        <div style={{ display: 'grid', gap: 8 }}>
          {TONES.map((t) => (
            <Waveform key={t} tone={t} height={20} seed={4} />
          ))}
        </div>
      </Section>
    </div>
  ),
};
