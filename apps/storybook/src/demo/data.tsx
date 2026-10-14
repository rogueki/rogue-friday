import {
  Activity,
  AudioLines,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  Cloud,
  Code2,
  Cpu,
  Database,
  FileText,
  FlaskConical,
  FolderOpen,
  Globe,
  History,
  LayoutDashboard,
  ListChecks,
  Mail,
  MapPin,
  Mic,
  Plus,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wifi,
  Workflow,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  ActivityItem,
  AgentStatus,
  ContextChip,
  NavItem,
  ProviderStatus,
  Tone,
  TimelineItem,
} from '@jarvis/ui';

export const navItems: NavItem[] = [
  { id: 'overview', label: 'Übersicht', icon: <LayoutDashboard /> },
  { id: 'tasks', label: 'Aufgaben', icon: <ListChecks />, badge: 3, badgeLabel: '3 offene Aufgaben' },
  { id: 'activity', label: 'Live-Aktivität', icon: <Activity /> },
  { id: 'memory', label: 'Gedächtnis', icon: <Database /> },
  { id: 'agents', label: 'Agenten', icon: <Bot /> },
  { id: 'approvals', label: 'Freigaben', icon: <ShieldCheck />, badge: 2, badgeLabel: '2 offene Freigaben', badgeTone: 'amber' },
  { id: 'mail', label: 'Kommunikation', icon: <Mail />, badge: 12, badgeLabel: '12 ungelesene Nachrichten' },
  { id: 'calendar', label: 'Kalender', icon: <CalendarDays /> },
  { id: 'automations', label: 'Automationen', icon: <Workflow /> },
  { id: 'research', label: 'Recherche', icon: <FlaskConical /> },
  { id: 'files', label: 'Dateien & Dokumente', icon: <FolderOpen /> },
  { id: 'voice', label: 'Sprache', icon: <Mic /> },
  { id: 'alerts', label: 'Meldungen & Alarme', icon: <Bell />, badge: 1, badgeLabel: '1 kritischer Alarm', badgeTone: 'red' },
  { id: 'system', label: 'System', icon: <Cpu /> },
  { id: 'audit', label: 'Audit & Verlauf', icon: <History /> },
  { id: 'settings', label: 'Einstellungen', icon: <Settings /> },
];

export const coreOverview: { id: string; icon: ReactNode; tone: Tone; title: string; meta: string }[] = [
  { id: 'core', icon: <Brain />, tone: 'cyan', title: 'AI Core', meta: 'Online' },
  { id: 'memory', icon: <Database />, tone: 'blue', title: 'Gedächtnis', meta: '3.380 gespeichert' },
  { id: 'voice', icon: <Mic />, tone: 'green', title: 'Sprache', meta: 'Bereit' },
  { id: 'agents', icon: <Bot />, tone: 'violet', title: 'Agenten', meta: '2 aktiv' },
  { id: 'models', icon: <Sparkles />, tone: 'amber', title: 'Modelle', meta: '4 verbunden' },
  { id: 'system', icon: <ShieldCheck />, tone: 'green', title: 'System', meta: 'Optimal' },
];

export const attentionItems: ActivityItem[] = [
  { id: 'a1', icon: <CalendarDays />, tone: 'cyan', severity: 'info', title: 'Design-Review mit dem Produktteam', meta: 'Kalender · in 20 Min.', time: '14:00' },
  { id: 'a2', icon: <ListChecks />, tone: 'amber', severity: 'warn', title: '2 Aufgaben überfällig – „HUD-Panels polieren“', meta: 'Aufgaben', time: '13:42' },
  { id: 'a3', icon: <ShieldCheck />, tone: 'green', severity: 'tip', title: '3 Freigaben warten auf deine Entscheidung', meta: 'Freigaben', time: '13:31' },
  { id: 'a4', icon: <Mail />, tone: 'cyan', severity: 'info', title: 'Wichtige Mail: Angebot Größenänderung Rechenzentrum', meta: 'Mail · Priorität hoch', time: '13:12' },
  { id: 'a5', icon: <Cpu />, tone: 'green', severity: 'live', title: 'CPU-Auslastung 15 % – Systemlast normal', meta: 'System', time: 'jetzt' },
  { id: 'a6', icon: <Terminal />, tone: 'red', severity: 'critical', title: 'Windows-Worker antwortet nicht mehr', meta: 'ADAPTER_TIMEOUT · wird erneut versucht', time: '12:58' },
];

export const agents: { id: string; name: string; icon: ReactNode; tone: Tone; status: AgentStatus; task?: string }[] = [
  { id: 'coding', name: 'Coding-Agent', icon: <Code2 />, tone: 'green', status: 'active', task: 'Panel-Rahmen für Storybook' },
  { id: 'research', name: 'Recherche-Agent', icon: <FlaskConical />, tone: 'cyan', status: 'active', task: 'Wettbewerbsanalyse Q4' },
  { id: 'memory', name: 'Gedächtnis-Agent', icon: <Database />, tone: 'violet', status: 'busy', task: 'Sitzung wird indexiert' },
  { id: 'browser', name: 'Browser-Agent', icon: <Globe />, tone: 'amber', status: 'standby' },
  { id: 'task', name: 'Aufgaben-Agent', icon: <ListChecks />, tone: 'blue', status: 'standby' },
  { id: 'system', name: 'System-Agent', icon: <ShieldCheck />, tone: 'green', status: 'standby' },
];

export const timeline: TimelineItem[] = [
  { id: 't1', time: '09:30', title: 'Tägliches Standup', status: 'done', progress: 100, meta: 'Erledigt' },
  { id: 't2', time: '12:00', title: 'HUD-Panel-Abstände finalisieren', status: 'now', progress: 64, meta: 'in 42 Min.' },
  { id: 't3', time: '14:00', title: 'Deep-Work-Block: Voice-Pipeline', status: 'upcoming', progress: 0, meta: 'in 2 Std. 42 Min.' },
  { id: 't4', time: '16:30', title: 'Design-Review – Command Center V1', status: 'upcoming', progress: 0, meta: 'in 5 Std. 12 Min.' },
];

export const quickCommands: { id: string; icon: ReactNode; label: string; tone: Tone }[] = [
  { id: 'task', icon: <Plus />, label: 'Neue Aufgabe', tone: 'cyan' },
  { id: 'cal', icon: <CalendarDays />, label: 'Kalender öffnen', tone: 'cyan' },
  { id: 'voice', icon: <Mic />, label: 'Voice starten', tone: 'cyan' },
  { id: 'brief', icon: <FileText />, label: 'Executive Briefing', tone: 'cyan' },
];

export const providers: { id: string; name: string; icon: ReactNode; status: ProviderStatus; detail?: string; tone?: Tone }[] = [
  { id: 'kimi', name: 'Kimi K3', icon: <Sparkles />, status: 'connected', detail: '182 ms', tone: 'cyan' },
  { id: 'qwen', name: 'Qwen Local', icon: <Cpu />, status: 'connected', detail: 'lokal · 8 GB', tone: 'teal' },
  { id: 'hermes', name: 'Hermes', icon: <Bot />, status: 'connected', detail: 'Agent-Hub', tone: 'violet' },
  { id: 'stt', name: 'Voice STT', icon: <AudioLines />, status: 'degraded', detail: 'hohe Latenz', tone: 'amber' },
  { id: 'tts', name: 'Voice TTS', icon: <Mic />, status: 'connected', tone: 'green' },
  { id: 'worker', name: 'Windows Worker', icon: <Server />, status: 'error', detail: 'Zeitüberschreitung', tone: 'red' },
];

export const contextChips: ContextChip[] = [
  { id: 'loc', icon: <MapPin />, label: 'Standort', value: 'Köln, Deutschland' },
  { id: 'weather', icon: <Cloud />, label: 'Wetter', value: '14 °C · bewölkt' },
  { id: 'net', icon: <Wifi />, label: 'Netzwerk', value: 'Ausgezeichnet' },
];

export const systemServices: { id: string; label: string; tone: Tone; state: string }[] = [
  { id: 'wsl', label: 'WSL', tone: 'green', state: 'läuft' },
  { id: 'hermes', label: 'Hermes', tone: 'green', state: 'läuft' },
  { id: 'kimi', label: 'Kimi', tone: 'green', state: 'läuft' },
  { id: 'llm', label: 'Local LLM', tone: 'amber', state: 'langsam' },
  { id: 'voice', label: 'Voice', tone: 'green', state: 'läuft' },
];

export const demoNow = new Date('2026-06-15T11:18:21+02:00');

/** Deterministic pseudo-random for demo data (no Math.random so stories/screenshots are stable). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

