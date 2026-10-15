import type { Meta, StoryObj } from '@storybook/react-vite';
import { Activity, Bot, Settings } from 'lucide-react';
import { useState } from 'react';
import { SearchField, Select, Slider, Switch, Tabs, TextArea, TextField } from '@friday/ui';
import { Section } from './_helpers';

const meta = { title: 'Components/Forms', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const wrap = { padding: 28, maxWidth: 520, display: 'grid', gap: 18 } as const;

export const SearchFields: Story = {
  name: 'SearchField',
  render: function Render() {
    const [q, setQ] = useState('');
    return (
      <div style={wrap}>
        <SearchField value={q} onValueChange={setQ} placeholder="Suchen …" />
        <SearchField value="Größenänderung" onValueChange={() => undefined} />
        <SearchField value="" onValueChange={() => undefined} shortcutHint={null} placeholder="Ohne Shortcut-Hinweis" />
      </div>
    );
  },
};

export const TextFields: Story = {
  name: 'TextField',
  render: () => (
    <div style={wrap}>
      <TextField label="Name" placeholder="Operator-Name" />
      <TextField label="Mit Hinweis" hint="Wird nur lokal gespeichert." defaultValue="RogueKI" />
      <TextField label="Fehler" error="Der Wert darf nicht leer sein." defaultValue="" required />
      <TextField label="Deaktiviert" disabled defaultValue="Schreibgeschützt (read-only capability)" />
      <TextField label="Mit Icon" icon={<Bot size={15} />} suffix="ms" defaultValue="182" />
    </div>
  ),
};

export const TextAreas: Story = {
  name: 'TextArea',
  render: () => (
    <div style={wrap}>
      <TextArea label="Notiz" placeholder="Was soll F.R.I.D.A.Y. beachten?" />
      <TextArea label="Mit Hinweis und Zähler" hint="Wird an die Aufgabe angehängt." showCount maxLength={240} defaultValue="Bitte vor dem Versand die Anhänge prüfen." rows={3} />
      <TextArea label="Begründung" required error="Eine Begründung ist erforderlich." />
      <TextArea label="Deaktiviert" disabled defaultValue="Schreibgeschützt (read-only capability)" rows={2} />
    </div>
  ),
};

export const Selects: Story = {
  name: 'Select',
  render: () => (
    <div style={wrap}>
      <Select
        label="Zeitzone"
        defaultValue="Europe/Berlin"
        options={[
          { value: 'Europe/Berlin', label: 'Europe/Berlin (MESZ)' },
          { value: 'UTC', label: 'UTC' },
          { value: 'America/New_York', label: 'America/New_York' },
        ]}
      />
      <Select label="Fehler" error="Bitte wählen." options={[{ value: '', label: 'Bitte wählen …' }]} />
      <Select label="Deaktiviert" disabled options={[{ value: 'a', label: 'Nicht verfügbar' }]} />
    </div>
  ),
};

export const Switches: Story = {
  name: 'Switch',
  render: function Render() {
    const [on, setOn] = useState(true);
    return (
      <div style={wrap}>
        <Switch label="Animationen" description="Reduziert Bewegung im gesamten Dashboard" checked={on} onCheckedChange={setOn} />
        <Switch label="Mikrofon-Wake-Word" defaultChecked={false} />
        <Switch label="Deaktiviert (fehlende Berechtigung)" disabled defaultChecked />
      </div>
    );
  },
};

export const Sliders: Story = {
  name: 'Slider',
  render: () => (
    <div style={wrap}>
      <Slider label="Orb-Intensität" defaultValue={72} formatValue={(v) => `${v} %`} />
      <Slider label="Partikeldichte" defaultValue={30} min={0} max={100} />
      <Slider label="Deaktiviert" disabled defaultValue={50} />
    </div>
  ),
};

export const TabsStory: Story = {
  name: 'Tabs',
  render: () => (
    <div style={{ padding: 28, maxWidth: 720, display: 'grid', gap: 28 }}>
      <Section title="line">
        <Tabs
          label="Agent-Details"
          items={[
            { id: 'overview', label: 'Übersicht', icon: <Activity />, content: <p>Inhalt Übersicht</p> },
            { id: 'tasks', label: 'Aufgaben', count: 4, content: <p>Inhalt Aufgaben</p> },
            { id: 'settings', label: 'Einstellungen', icon: <Settings />, content: <p>Inhalt Einstellungen</p> },
            { id: 'audit', label: 'Audit', disabled: true },
          ]}
        />
      </Section>
      <Section title="boxed">
        <Tabs
          label="Ansicht"
          variant="boxed"
          items={[
            { id: 'a', label: 'Liste', content: <p>Listenansicht</p> },
            { id: 'b', label: 'Board', content: <p>Boardansicht</p> },
          ]}
        />
      </Section>
    </div>
  ),
};
