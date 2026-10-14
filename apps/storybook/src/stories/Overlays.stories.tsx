import type { Meta, StoryObj } from '@storybook/react-vite';
import { FileText, Mail, Mic, Plus, Search, Settings, Trash2, Workflow } from 'lucide-react';
import { useState } from 'react';
import {
  Button,
  CommandPalette,
  ConfirmDialog,
  Dialog,
  Drawer,
  TaskCard,
  ToastProvider,
  Toaster,
  useToast,
  type CommandItem,
  type ToastData,
} from '@jarvis/ui';
import { Row } from './_helpers';

const meta = { title: 'Components/Overlays', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DialogStory: Story = {
  name: 'Dialog',
  render: function Render() {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ padding: 28 }}>
        <Button onClick={() => setOpen(true)}>Dialog öffnen</Button>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title="Neue Aufgabe"
          description="Beschreibe, was F.R.I.D.A.Y. erledigen soll. Fokus bleibt im Dialog, Esc schließt."
          icon={<Plus size={16} />}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button onClick={() => setOpen(false)}>Anlegen</Button>
            </>
          }
        >
          <TaskCard title="Vorschau: Voice-Pipeline testen" status="todo" priority="P2" />
        </Dialog>
      </div>
    );
  },
};

export const ConfirmDialogStory: Story = {
  name: 'ConfirmDialog',
  render: function Render() {
    const [open, setOpen] = useState(true);
    const [danger, setDanger] = useState(false);
    return (
      <div style={{ padding: 28 }}>
        <Row>
          <Button onClick={() => { setDanger(false); setOpen(true); }}>Bestätigen</Button>
          <Button variant="danger" icon={<Trash2 />} onClick={() => { setDanger(true); setOpen(true); }}>Löschen …</Button>
        </Row>
        <ConfirmDialog
          open={open}
          onOpenChange={setOpen}
          tone={danger ? 'danger' : 'default'}
          title={danger ? 'Dateien endgültig löschen?' : 'E-Mail senden?'}
          description={danger ? 'Du bist dabei: 1.204 Logdateien unter D:\\Projekte\\alt zu löschen. Das kann nicht rückgängig gemacht werden.' : 'Du bist dabei: eine E-Mail an Max Mustermann zu senden.'}
          details={danger ? ['Betroffen: *.log', 'Kein Papierkorb'] : ['Betreff: Angebot Rechenzentrum']}
          confirmLabel={danger ? 'Endgültig löschen' : 'Senden'}
          onConfirm={() => setOpen(false)}
        />
      </div>
    );
  },
};

export const DrawerStory: Story = {
  name: 'Drawer',
  render: function Render() {
    const [open, setOpen] = useState(true);
    return (
      <div style={{ padding: 28 }}>
        <Button onClick={() => setOpen(true)}>Detail-Drawer öffnen</Button>
        <Drawer
          open={open}
          onOpenChange={setOpen}
          title="Task-Details"
          subtitle="task_000042"
          icon={<FileText size={16} />}
          footer={<Button onClick={() => setOpen(false)}>Schließen</Button>}
        >
          <TaskCard title="HUD-Panel-Abstände finalisieren" status="doing" priority="P1" progress={64} />
          <p style={{ lineHeight: 1.6 }}>Detailansicht als Drawer (Level 4). Navigation per Query-Parameter, kein eigener Routen-Segment.</p>
        </Drawer>
      </div>
    );
  },
};

const paletteItems: CommandItem[] = [
  { id: 'ask', group: 'F.R.I.D.A.Y.', label: 'F.R.I.D.A.Y. fragen', description: 'Freitext-Anfrage an F.R.I.D.A.Y.', icon: <Mic size={15} />, shortcut: '/' },
  { id: 'task', group: 'Erstellen', label: 'Aufgabe anlegen', description: 'Neue Aufgabe mit Priorität', icon: <Plus size={15} />, keywords: ['todo', 'task'] },
  { id: 'mail', group: 'Erstellen', label: 'E-Mail an Max senden', icon: <Mail size={15} />, critical: true, preview: { title: 'E-Mail an Max Mustermann senden', lines: ['Betreff: Angebot Rechenzentrum', 'Anhang: angebot.pdf (1,2 MB)'], warning: 'Die Mail verlässt das lokale System.' } },
  { id: 'search', group: 'Navigation', label: 'Gedächtnis durchsuchen', icon: <Search size={15} />, keywords: ['memory'] },
  { id: 'auto', group: 'Automationen', label: 'Automation „Nachtlauf“ starten', icon: <Workflow size={15} />, critical: true, preview: { title: 'Automation „Nachtlauf“ jetzt starten', warning: 'Läuft ca. 25 Minuten.' } },
  { id: 'settings', group: 'Navigation', label: 'Einstellungen öffnen', icon: <Settings size={15} />, shortcut: 'G S' },
  { id: 'readonly', group: 'Automationen', label: 'Automationen pausieren', icon: <Workflow size={15} />, disabled: true, disabledReason: 'Nur Lesezugriff – Capability fehlt' },
];

export const CommandPaletteStory: Story = {
  name: 'CommandPalette',
  render: function Render() {
    const [open, setOpen] = useState(true);
    const [last, setLast] = useState('');
    return (
      <div style={{ padding: 28 }}>
        <Button onClick={() => setOpen(true)}>Palette öffnen (Ctrl+K)</Button>
        <p style={{ color: 'var(--jarvis-muted)' }}>Zuletzt ausgeführt: {last || '–'}</p>
        <CommandPalette open={open} onOpenChange={setOpen} items={paletteItems} onSelect={(i) => setLast(i.label)} groupOrder={['F.R.I.D.A.Y.', 'Erstellen', 'Navigation', 'Automationen']} />
      </div>
    );
  },
};

export const CommandPaletteEmptyResult: Story = {
  name: 'CommandPalette – keine Treffer',
  render: () => <CommandPalette open onOpenChange={() => undefined} items={paletteItems} onSelect={() => undefined} query="zzzxq" />,
};

function ToastButtons() {
  const { toast } = useToast();
  return (
    <Row>
      <Button onClick={() => toast({ title: 'Aufgabe angelegt', description: 'task_000043', tone: 'green' })}>Erfolg</Button>
      <Button variant="ghost" onClick={() => toast({ title: 'Verbindung eingeschränkt', description: 'Voice STT antwortet langsam', tone: 'amber', duration: 0 })}>Warnung (bleibt)</Button>
      <Button variant="danger" onClick={() => toast({ title: 'Worker nicht erreichbar', tone: 'red', action: { label: 'Erneut', onClick: () => undefined } })}>Fehler</Button>
    </Row>
  );
}

export const Toasts: Story = {
  name: 'Toast / Toaster',
  render: () => (
    <ToastProvider>
      <div style={{ padding: 28 }}>
        <ToastButtons />
      </div>
    </ToastProvider>
  ),
};

export const ToasterStatic: Story = {
  render: () => {
    const toasts: ToastData[] = [
      { id: '1', title: 'Aufgabe angelegt', description: 'task_000043', tone: 'green', duration: 0 },
      { id: '2', title: 'Verbindung eingeschränkt', description: 'Voice STT antwortet langsam', tone: 'amber', duration: 0 },
      { id: '3', title: 'Worker nicht erreichbar', tone: 'red', duration: 0, action: { label: 'Erneut', onClick: () => undefined } },
    ];
    return <Toaster toasts={toasts} onDismiss={() => undefined} />;
  },
};
