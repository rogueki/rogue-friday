import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bot, Code2, Cpu, Globe, Server, Sparkles } from 'lucide-react';
import {
  AgentCard,
  AlertCard,
  ApprovalCard,
  KanbanColumn,
  ProviderCard,
  TaskCard,
  type AgentStatus,
  type Capability,
  type ProviderStatus,
  type Severity,
} from '@friday/ui';
import { Grid, Row, Section, longGerman } from './_helpers';

const meta = { title: 'Components/Cards', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const AgentCards: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Status: aktiv · beschäftigt · bereit · blockiert · Fehler · offline">
        <Grid min={260}>
          {(
            [
              ['Coding-Agent', 'active', 'green', <Code2 key="i" />],
              ['Recherche-Agent', 'busy', 'cyan', <Globe key="i" />],
              ['Browser-Agent', 'standby', 'amber', <Globe key="i" />],
              ['Aufgaben-Agent', 'blocked', 'blue', <Bot key="i" />],
              ['System-Agent', 'error', 'red', <Cpu key="i" />],
              ['Gedächtnis-Agent', 'offline', 'violet', <Bot key="i" />],
            ] as const
          ).map(([name, status, tone, icon], i) => (
            <AgentCard key={name} name={name} status={status as AgentStatus} tone={tone} icon={icon} seed={i + 1} task={status === 'active' ? 'Panel-Rahmen für Storybook' : undefined} onClick={() => undefined} />
          ))}
        </Grid>
      </Section>
      <Section title="Lange Texte (Umlaute) und ausgewählt">
        <Grid min={320}>
          <AgentCard name={longGerman} status="active" icon={<Code2 />} tone="green" task={longGerman} />
          <AgentCard name="Ausgewählter Agent" status="active" icon={<Bot />} tone="cyan" selected task="Aktueller Task" />
        </Grid>
      </Section>
    </div>
  ),
};

export const ProviderCards: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={220}>
        {(
          [
            ['Kimi K3', 'connected', '182 ms'],
            ['Qwen Local', 'connected', 'lokal · 8 GB'],
            ['Hermes', 'degraded', 'hohe Latenz'],
            ['Voice STT', 'not-linked', undefined],
            ['Voice TTS', 'no-models', undefined],
            ['Windows Worker', 'error', 'Zeitüberschreitung'],
          ] as [string, ProviderStatus, string | undefined][]
        ).map(([name, status, detail]) => (
          <ProviderCard key={name} name={name} status={status} detail={detail} icon={name === 'Windows Worker' ? <Server /> : <Sparkles />} onClick={() => undefined} />
        ))}
        <ProviderCard name={longGerman} status="connected" icon={<Sparkles />} detail={longGerman} />
      </Grid>
    </div>
  ),
};

export const TaskCards: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={320}>
        <TaskCard title="HUD-Panel-Abstände finalisieren" status="doing" priority="P1" project="Design-System" due="heute 12:00" progress={64} assignee="Coding-Agent" tags={['UI', 'Storybook']} onClick={() => undefined} />
        <TaskCard title="Voice-Pipeline testen" status="todo" priority="P2" due="morgen" progress={null} />
        <TaskCard title="Windows-Worker anbinden" status="blocked" priority="P0" blockedReason="Warten auf Freigabe für Remote-Zugriff" due="gestern" overdue />
        <TaskCard title="Review Command Center V1" status="review" priority="P3" />
        <TaskCard title="Standup" status="done" progress={100} />
        <TaskCard title={longGerman} status="doing" priority="P1" project={longGerman} />
        <TaskCard title="Nur Lesezugriff" status="todo" capability="read-only" />
        <TaskCard title="Capability fehlt" status="todo" capability="missing" />
      </Grid>
    </div>
  ),
};

export const AlertCards: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={380}>
        {(['info', 'tip', 'warn', 'critical', 'live', 'ok'] as Severity[]).map((s) => (
          <AlertCard key={s} severity={s} title={`Meldung (${s})`} description="Kurzbeschreibung des Ereignisses mit Hinweis auf die betroffene Komponente." source="Hermes" time="vor 4 Min." onAcknowledge={() => undefined} onClick={() => undefined} />
        ))}
        <AlertCard severity="warn" title="Bereits quittiert" description="Dieser Alarm wurde bestätigt." acknowledged />
        <AlertCard severity="critical" title={longGerman} description={longGerman} onAcknowledge={() => undefined} capability="read-only" />
      </Grid>
    </div>
  ),
};

export const ApprovalCards: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={400}>
        {(['available', 'read-only', 'missing'] as Capability[]).map((cap) => (
          <ApprovalCard
            key={cap}
            title="E-Mail senden"
            description="Du bist dabei: eine E-Mail an Max Mustermann (Angebot Rechenzentrum) zu senden."
            requester="Mail-Agent"
            risk={cap === 'available' ? 'high' : 'medium'}
            expires="läuft in 12 Min. ab"
            capability={cap}
            onApprove={() => undefined}
            onReject={() => undefined}
            onDetails={() => undefined}
          />
        ))}
        <ApprovalCard title="Datei löschen" description="Du bist dabei: D:\Projekte\alt\*.log (1.204 Dateien) endgültig zu löschen." risk="critical" onApprove={() => undefined} onReject={() => undefined} />
        <ApprovalCard title="Lädt" description="Freigabe wird verarbeitet …" risk="low" busy onApprove={() => undefined} onReject={() => undefined} />
      </Grid>
    </div>
  ),
};

export const KanbanColumns: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row gap={14} style={{ alignItems: 'stretch' }}>
        <KanbanColumn title="Offen" count={2} tone="muted" style={{ width: 300 }}>
          <TaskCard title="Voice-Pipeline testen" status="todo" priority="P2" />
          <TaskCard title="Lange Aufgabe" status="todo" project={longGerman} />
        </KanbanColumn>
        <KanbanColumn title="In Arbeit" count={4} limit={3} tone="cyan" style={{ width: 300 }}>
          <TaskCard title="HUD-Panel-Abstände" status="doing" priority="P1" progress={40} />
        </KanbanColumn>
        <KanbanColumn title="Erledigt" count={0} tone="green" style={{ width: 300 }} />
      </Row>
    </div>
  ),
};
