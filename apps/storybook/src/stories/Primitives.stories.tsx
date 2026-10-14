import type { Meta, StoryObj } from '@storybook/react-vite';
import { Bell, Bot, Download, Plus, Settings, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  FreshnessBadge,
  HealthBadge,
  IconButton,
  IconTile,
  Skeleton,
  SourceBadge,
  StatusChip,
  TagPill,
  TONES,
  Tooltip,
  VisuallyHidden,
  type FreshnessState,
  type HealthState,
} from '@jarvis/ui';
import { Row, Section } from './_helpers';

const meta = { title: 'Components/Primitives', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const now = new Date('2026-06-15T11:18:21+02:00');

export const IconTiles: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="IconTile – Größen xs · sm · md · lg">
        <Row>{(['xs', 'sm', 'md', 'lg'] as const).map((s) => <IconTile key={s} size={s} icon={<Bot />} />)}</Row>
      </Section>
      <Section title="Töne, normal und aktiv">
        <Row>{TONES.map((t) => <IconTile key={t} tone={t} icon={<Bot />} />)}</Row>
        <Row style={{ marginTop: 12 }}>{TONES.map((t) => <IconTile key={t} tone={t} active icon={<Bot />} />)}</Row>
      </Section>
    </div>
  ),
};

export const TagPills: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row>
        <TagPill tone="cyan">Info</TagPill>
        <TagPill tone="amber">Warn</TagPill>
        <TagPill tone="green">Tipp</TagPill>
        <TagPill tone="green">Live</TagPill>
        <TagPill tone="red">Krit</TagPill>
        <TagPill tone="violet">P1</TagPill>
        <TagPill tone="muted">Mock</TagPill>
        <TagPill tone="cyan" solid>Solid</TagPill>
      </Row>
    </div>
  ),
};

export const Badges: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row>
        <Badge count={3} label="3 offene Aufgaben" />
        <Badge count={12} />
        <Badge count={250} />
        <Badge count={2} tone="amber" />
        <Badge count={1} tone="red" />
        <Badge count={0} showZero />
      </Row>
    </div>
  ),
};

export const StatusChips: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row>
        {TONES.map((t) => (
          <StatusChip key={t} tone={t}>{t}</StatusChip>
        ))}
        <StatusChip tone="green" pulse>Live</StatusChip>
      </Row>
    </div>
  ),
};

export const HealthBadges: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row gap={24}>
        {(['ok', 'degraded', 'down', 'unknown', 'maintenance'] as HealthState[]).map((s) => (
          <HealthBadge key={s} state={s} />
        ))}
      </Row>
      <Row gap={24} style={{ marginTop: 16 }}>
        {(['ok', 'degraded', 'down'] as HealthState[]).map((s) => (
          <HealthBadge key={s} state={s} compact />
        ))}
      </Row>
    </div>
  ),
};

export const FreshnessBadges: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Icon + Text je Zustand (nie nur Farbe)">
        <Row gap={24}>
          {(['fresh', 'stale', 'unknown', 'offline-cache'] as FreshnessState[]).map((s) => (
            <FreshnessBadge key={s} state={s} asOf="2026-06-15T11:14:21+02:00" now={now} />
          ))}
        </Row>
        <Row gap={24} style={{ marginTop: 12 }}>
          {(['fresh', 'stale', 'unknown', 'offline-cache'] as FreshnessState[]).map((s) => (
            <FreshnessBadge key={s} state={s} />
          ))}
        </Row>
      </Section>
    </div>
  ),
};

export const SourceBadges: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row>
        <SourceBadge source="Hermes" mode="live" />
        <SourceBadge source="Kimi K3" mode="mock" />
        <SourceBadge source="Windows Worker" mode="cache" />
        <SourceBadge source="Qwen Local" />
      </Row>
    </div>
  ),
};

export const Buttons: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'grid', gap: 18 }}>
      <Row>
        <Button icon={<Plus />}>Primär</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="subtle">Subtle</Button>
        <Button variant="danger" icon={<Trash2 />}>Gefahr</Button>
        <Button variant="jarvis">F.R.I.D.A.Y. (Gold)</Button>
      </Row>
      <Row>
        <Button size="sm">Klein</Button>
        <Button size="md">Mittel</Button>
        <Button size="lg">Groß</Button>
        <Button loading>Lädt</Button>
        <Button disabled>Deaktiviert</Button>
        <Button iconRight={<Download size={14} />}>Mit Icon rechts</Button>
      </Row>
      <Row>
        <IconButton label="Benachrichtigungen" icon={<Bell size={17} />} badge={<Badge count={3} tone="red" />} />
        <IconButton label="Einstellungen" icon={<Settings size={17} />} />
        <IconButton label="Aktiv" icon={<Settings size={17} />} pressed />
        <IconButton label="Klein" icon={<Settings size={15} />} size="sm" />
        <IconButton label="Gefahr" icon={<Trash2 size={16} />} variant="danger" />
        <IconButton label="Deaktiviert" icon={<Settings size={17} />} disabled />
      </Row>
    </div>
  ),
};

export const Skeletons: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'grid', gap: 16, maxWidth: 520 }}>
      <Skeleton height={40} />
      <Skeleton lines={3} />
      <Row>
        <Skeleton variant="circle" width={40} height={40} />
        <Skeleton variant="row" width={300} />
      </Row>
    </div>
  ),
};

export const Tooltips: Story = {
  render: () => (
    <div style={{ padding: 80 }}>
      <Row gap={32}>
        <Tooltip content="Tooltip oben"><Button variant="ghost">Oben</Button></Tooltip>
        <Tooltip content="Tooltip rechts" placement="right"><Button variant="ghost">Rechts</Button></Tooltip>
        <Tooltip content="Tooltip unten" placement="bottom"><Button variant="ghost">Unten</Button></Tooltip>
        <Tooltip content="Tooltip links" placement="left"><Button variant="ghost">Links</Button></Tooltip>
      </Row>
    </div>
  ),
};

export const VisuallyHiddenText: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Button icon={<Bell />}>
        <VisuallyHidden>Nur für Screenreader: </VisuallyHidden>
        Sichtbarer Text
      </Button>
    </div>
  ),
};
