import type { Meta, StoryObj } from '@storybook/react-vite';
import { Activity, Bell, Cpu, Mail } from 'lucide-react';
import { useState } from 'react';
import {
  ActivityFeed,
  ActivityRow,
  EmptyState,
  FilterBar,
  Timeline,
  type ActivityItem,
  type Severity,
} from '@jarvis/ui';
import { timeline } from '../demo/data';
import { seeded } from '../demo/data';
import { Section, longGerman } from './_helpers';

const meta = { title: 'Components/Lists', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const severities: Severity[] = ['info', 'warn', 'tip', 'critical', 'live', 'ok'];

function makeItems(n: number): ActivityItem[] {
  const rnd = seeded(7);
  return Array.from({ length: n }, (_, i) => {
    const severity = severities[Math.floor(rnd() * severities.length)] as Severity;
    return {
      id: `act_${i}`,
      icon: [<Activity key="a" />, <Mail key="m" />, <Cpu key="c" />, <Bell key="b" />][i % 4],
      severity,
      title: `Ereignis ${i + 1}: ${['Task aktualisiert', 'Mail eingegangen', 'Agent gestartet', 'Alarm quittiert'][i % 4]}`,
      meta: `Quelle ${['Hermes', 'Kimi K3', 'Windows Worker'][i % 3]}`,
      time: `${String(8 + (i % 12)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
    };
  });
}

export const ActivityRows: Story = {
  render: () => (
    <div style={{ padding: 28, maxWidth: 520, display: 'grid', gap: 8 }}>
      {severities.map((s) => (
        <ActivityRow key={s} icon={<Activity />} severity={s} title={`Zeile mit Severity ${s}`} meta="Kurze Beschreibung" time="13:42" onClick={() => undefined} />
      ))}
      <ActivityRow icon={<Activity />} severity="warn" title={longGerman} meta={longGerman} time="13:42" />
      <ActivityRow icon={<Cpu />} tone="violet" title="Ohne Tag" meta="Nur Untertitel" />
    </div>
  ),
};

export const FeedNormal: Story = {
  name: 'ActivityFeed – normal',
  render: () => (
    <div style={{ padding: 28, maxWidth: 520 }}>
      <ActivityFeed items={makeItems(30)} label="Live-Aktivität" height={420} />
    </div>
  ),
};

export const FeedEmpty: Story = {
  name: 'ActivityFeed – leer',
  render: () => (
    <div style={{ padding: 28, maxWidth: 520 }}>
      <ActivityFeed items={[]} label="Live-Aktivität" height={240} empty={<EmptyState compact title="Keine Aktivität" description="Sobald Jarvis arbeitet, erscheinen hier Ereignisse." />} />
    </div>
  ),
};

export const FeedLoading: Story = {
  name: 'ActivityFeed – lädt',
  render: () => (
    <div style={{ padding: 28, maxWidth: 520 }}>
      <ActivityFeed items={[]} label="Live-Aktivität" height={320} loading />
    </div>
  ),
};

export const FeedHuge: Story = {
  name: 'ActivityFeed – 10.000 Einträge (virtualisiert)',
  render: function Render() {
    const [items] = useState(() => makeItems(10_000));
    const [sel, setSel] = useState<string>();
    return (
      <div style={{ padding: 28, maxWidth: 520 }}>
        <p style={{ marginTop: 0, fontFamily: 'var(--jv-font-mono)', fontSize: 12, color: 'var(--jarvis-muted)' }}>10.000 Zeilen, gerendert wird nur das sichtbare Fenster.</p>
        <ActivityFeed items={items} label="Alle Ereignisse" height={460} selectedId={sel} onSelect={setSel} />
      </div>
    );
  },
};

export const TimelineStory: Story = {
  name: 'Timeline',
  render: () => (
    <div style={{ padding: 28, maxWidth: 560, display: 'grid', gap: 28 }}>
      <Section title="Heute">
        <Timeline items={timeline} label="Heutige Termine" onSelect={() => undefined} />
      </Section>
      <Section title="Mit Blocker und langem Titel">
        <Timeline
          label="Plan"
          items={[
            { id: '1', time: '08:00', title: longGerman, status: 'blocked', meta: 'Blockiert', progress: 20 },
            { id: '2', time: '09:30', title: 'Ohne Fortschritt', status: 'upcoming', progress: null, meta: 'in 1 Std.' },
          ]}
        />
      </Section>
    </div>
  ),
};

export const FilterBars: Story = {
  name: 'FilterBar',
  render: function Render() {
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('all');
    return (
      <div style={{ padding: 28 }}>
        <FilterBar
          search={{ value: q, onChange: setQ, placeholder: 'Aufgaben durchsuchen …' }}
          filters={[
            {
              id: 'status',
              label: 'Status',
              value: status,
              onChange: setStatus,
              options: [
                { value: 'all', label: 'Alle Status' },
                { value: 'doing', label: 'In Arbeit' },
                { value: 'blocked', label: 'Blockiert' },
              ],
            },
          ]}
          chips={status !== 'all' ? [{ id: 'status', label: `Status: ${status}`, onRemove: () => setStatus('all') }] : []}
          onReset={() => {
            setQ('');
            setStatus('all');
          }}
          resultCount={status === 'all' ? 128 : 12}
          totalCount={128}
        />
      </div>
    );
  },
};
