import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import {
  DataTable,
  EmptyState,
  ErrorState,
  FreshnessBadge,
  StaleBanner,
  TagPill,
  type DataTableColumn,
  type Tone,
} from '@friday/ui';
import { seeded } from '../demo/data';
import { longGerman } from './_helpers';

interface TaskRow {
  id: string;
  title: string;
  status: 'Offen' | 'In Arbeit' | 'Blockiert' | 'Erledigt';
  priority: number;
  owner: string;
  due: string;
}

const statusTone: Record<TaskRow['status'], Tone> = { Offen: 'muted', 'In Arbeit': 'cyan', Blockiert: 'red', Erledigt: 'green' };

const columns: DataTableColumn<TaskRow>[] = [
  { id: 'id', header: 'ID', width: '120px', sortValue: (r) => r.id, sortable: true, mono: true },
  { id: 'title', header: 'Titel', width: 'minmax(0, 3fr)', sortValue: (r) => r.title, sortable: true },
  { id: 'status', header: 'Status', width: '130px', sortValue: (r) => r.status, sortable: true, cell: (r) => <TagPill tone={statusTone[r.status]}>{r.status}</TagPill> },
  { id: 'priority', header: 'Prio', width: '70px', align: 'right', sortValue: (r) => r.priority, sortable: true, mono: true, cell: (r) => `P${r.priority}` },
  { id: 'owner', header: 'Zuständig', width: 'minmax(0, 1fr)', sortValue: (r) => r.owner, sortable: true },
  { id: 'due', header: 'Fällig', width: '110px', sortValue: (r) => r.due, mono: true, hideInCards: false },
];

const titles = ['HUD-Panel-Abstände finalisieren', 'Voice-Pipeline testen', 'Windows-Worker anbinden', 'Größenänderung Überwachungsschwelle', 'Gedächtnis-Index erneuern', 'Mail-Triage prüfen'];
const statuses: TaskRow['status'][] = ['Offen', 'In Arbeit', 'Blockiert', 'Erledigt'];
const owners = ['Coding-Agent', 'Recherche-Agent', 'Operator', 'System-Agent'];

function makeRows(n: number): TaskRow[] {
  const rnd = seeded(42);
  return Array.from({ length: n }, (_, i) => ({
    id: `task_${String(i + 1).padStart(6, '0')}`,
    title: `${titles[i % titles.length]} #${i + 1}`,
    status: statuses[Math.floor(rnd() * 4)] as TaskRow['status'],
    priority: Math.floor(rnd() * 4),
    owner: owners[Math.floor(rnd() * owners.length)] as string,
    due: `2026-06-${String(1 + (i % 28)).padStart(2, '0')}`,
  }));
}

const meta = { title: 'Components/DataTable', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const page = { padding: 28 } as const;

export const Normal: Story = {
  render: function Render() {
    const rows = useMemo(() => makeRows(40), []);
    const [sel, setSel] = useState<string>();
    return (
      <div style={page}>
        <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Aufgaben" height={460} selectedId={sel} onRowActivate={(r) => setSel(r.id)} defaultSort={{ columnId: 'priority', direction: 'asc' }} />
      </div>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <div style={page}>
      <DataTable columns={columns} rows={[]} getRowId={(r) => r.id} label="Aufgaben" empty={<EmptyState title="Keine Aufgaben" description="Lege eine Aufgabe an oder ändere den Filter." />} />
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div style={page}>
      <DataTable columns={columns} rows={[]} getRowId={(r) => r.id} label="Aufgaben" loading />
    </div>
  ),
};

export const ErrorStory: Story = {
  name: 'Error',
  render: () => (
    <div style={page}>
      <DataTable columns={columns} rows={[]} getRowId={(r) => r.id} label="Aufgaben" error={<ErrorState title="Aufgaben konnten nicht geladen werden" code="ADAPTER_TIMEOUT" correlationId="corr_01HZX3K8M2Q9" onRetry={() => undefined} />} />
    </div>
  ),
};

export const Stale: Story = {
  render: () => (
    <div style={{ ...page, display: 'grid', gap: 12 }}>
      <StaleBanner asOf="2026-06-15T10:40:00+02:00" now={new Date('2026-06-15T11:18:21+02:00')} onRefresh={() => undefined} />
      <FreshnessBadge state="stale" />
      <DataTable columns={columns} rows={makeRows(8)} getRowId={(r) => r.id} label="Aufgaben (veraltet)" height={320} />
    </div>
  ),
};

export const LongGermanText: Story = {
  render: () => (
    <div style={page}>
      <DataTable
        columns={columns}
        rows={[{ id: 'task_000001', title: longGerman, status: 'In Arbeit', priority: 1, owner: 'Größenänderungs-Überwachungs-Agent', due: '2026-06-30' }, ...makeRows(5)]}
        getRowId={(r) => r.id}
        label="Aufgaben mit langen Texten"
        height={320}
      />
    </div>
  ),
};

export const Huge10000: Story = {
  name: 'Large data set (10.000 rows, virtualized)',
  render: function Render() {
    const rows = useMemo(() => makeRows(10_000), []);
    return (
      <div style={page}>
        <p style={{ marginTop: 0, fontFamily: 'var(--jv-font-mono)', fontSize: 12, color: 'var(--friday-muted)' }}>Tastatur: Pfeile, Bild auf/ab, Pos1/Ende, Enter. Sortierung nach Spaltenkopf.</p>
        <DataTable columns={columns} rows={rows} getRowId={(r) => r.id} label="Alle Aufgaben" height={520} totalCount={10_000} />
      </div>
    );
  },
};

export const CardMode: Story = {
  name: 'Mobile card mode',
  render: () => (
    <div style={{ ...page, maxWidth: 420 }}>
      <DataTable columns={columns} rows={makeRows(20)} getRowId={(r) => r.id} label="Aufgaben (Karten)" height={520} mode="cards" />
    </div>
  ),
};

export const ReadOnly: Story = {
  name: 'Read-only (no row action)',
  render: () => (
    <div style={page}>
      <p style={{ marginTop: 0, fontSize: 12, color: 'var(--friday-muted)' }}>Lesender Zugriff: keine Zeilenaktion, nur Sortierung und Navigation.</p>
      <DataTable columns={columns} rows={makeRows(12)} getRowId={(r) => r.id} label="Aufgaben (nur lesen)" height={380} />
    </div>
  ),
};
