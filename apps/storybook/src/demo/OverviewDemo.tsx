import { ChevronDown, Zap } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import {
  ActivityFeed,
  ActivityRow,
  AgentCard,
  BottomCommandBar,
  CircularMetric,
  ConstellationGraph,
  defaultTopBarActions,
  HudPanel,
  JarvisShell,
  LeftCommandNav,
  PanelLink,
  ProviderCard,
  StatusChip,
  Timeline,
  TopStatusBar,
  VoiceStatusPanel,
  type VoiceState,
} from '@jarvis/ui';
import layout from '../../../../config/layouts/jarvis-command-overview.json';
import {
  agents,
  attentionItems,
  contextChips,
  coreOverview,
  demoNow,
  navItems,
  providers,
  quickCommands,
  systemServices,
  timeline,
} from './data';
import './overview.css';

type WidgetId = (typeof layout.widgets)[number]['id'];

/** Placement of a widget from config/layouts/jarvis-command-overview.json (12-column grid). */
function place(id: WidgetId): CSSProperties {
  const w = layout.widgets.find((x) => x.id === id);
  if (!w || !w.visible) return { display: 'none' };
  return { gridColumn: `${w.x + 1} / span ${w.w}`, gridRow: `${w.y + 1} / span ${w.h}` };
}

export interface OverviewDemoProps {
  voice?: VoiceState;
  navCollapsed?: boolean;
  fixedNow?: boolean;
}

export function OverviewDemo({ voice = 'listening', navCollapsed, fixedNow = true }: OverviewDemoProps) {
  const [active, setActive] = useState('overview');
  const [voiceState, setVoiceState] = useState<VoiceState>(voice);
  const [focus, setFocus] = useState(false);

  return (
    <JarvisShell
      defaultNavCollapsed={navCollapsed}
      nav={
        <LeftCommandNav
          items={navItems}
          activeId={active}
          onNavigate={setActive}
          footer={
            <VoiceStatusPanel
              state={voiceState}
              onToggle={() => setVoiceState((s) => (s === 'listening' ? 'idle' : 'listening'))}
              focusMode={focus}
              onFocusModeToggle={() => setFocus((f) => !f)}
              hint=""
              title="VOICE STATUS"
            />
          }
        />
      }
      topBar={
        <TopStatusBar
          now={fixedNow ? demoNow : undefined}
          timeZone="Europe/Berlin"
          status={{ label: 'OPTIMAL', tone: 'green' }}
          connection={{ state: 'online' }}
          actions={defaultTopBarActions.map((a) => (a.id === 'notifications' ? { ...a, badge: 3 } : a))}
          operator={{ name: 'RogueKI', role: 'Operator' }}
          searchLabel="Suchen …"
        />
      }
      bottomBar={
        <BottomCommandBar
          chips={contextChips}
          state={voiceState}
          onTalk={() => setVoiceState((s) => (s === 'listening' ? 'idle' : 'listening'))}
          quickAction={{ label: 'Executive Briefing', icon: <Zap size={14} /> }}
        />
      }
    >
      <div className="ov-grid">
        <HudPanel className="ov-cell" style={place('core-overview')} title="AI Core Übersicht" scroll>
          <div className="ov-stack ov-stack--fill">
            {coreOverview.map((row) => (
              <ActivityRow key={row.id} icon={row.icon} tone={row.tone} title={row.title} meta={row.meta} onClick={() => undefined} />
            ))}
          </div>
        </HudPanel>

        <HudPanel
          className="ov-cell ov-core"
          style={place('ai-core-orb')}
          tone="gold"
          glow
          cut="all"
          cutSize="lg"
          brackets={['tl', 'tr', 'bl', 'br']}
          padding="none"
          aria-label="AI Core"
        >
          <div className="ov-orb">
            <div className="ov-orb__slot" role="img" aria-label="Platzhalter für den goldenen Orb">
              <span>ORB SLOT</span>
            </div>
            <div className="ov-orb__brand">
              <span className="ov-orb__name">F.R.I.D.A.Y.</span>
              <span className="ov-orb__sub">AI CORE</span>
              <span className="ov-orb__ver">v1.0 · Mock-Modus</span>
            </div>
            <div className="ov-orb__status" role="status">
              <StatusChip tone="gold" pulse>
                F.R.I.D.A.Y. hört zu
              </StatusChip>
              <span>Aktiver Agent: Coding-Agent · „Panel-Rahmen für Storybook“</span>
            </div>
          </div>
        </HudPanel>

        <HudPanel
          className="ov-cell"
          style={place('attention-feed')}
          title="Live-Intelligenz"
          live
          padding="sm"
          footer={<PanelLink>Alle Meldungen anzeigen</PanelLink>}
        >
          <ActivityFeed items={attentionItems} label="Aufmerksamkeit und Live-Aktivität" rowHeight={48} gap={5} />
        </HudPanel>

        <HudPanel
          className="ov-cell"
          style={place('active-agents')}
          title="Aktive Agenten"
          actions={<PanelLink>Alle</PanelLink>}
        >
          <div className="ov-agents">
            {agents.map((a, idx) => (
              <AgentCard key={a.id} name={a.name} icon={a.icon} tone={a.tone} status={a.status} task={a.task} seed={idx + 2} onClick={() => undefined} />
            ))}
          </div>
        </HudPanel>

        <HudPanel
          className="ov-cell"
          style={place('mission-timeline')}
          title="Mission-Timeline"
          actions={
            <button type="button" className="ov-today">
              Heute <ChevronDown size={12} aria-hidden="true" />
            </button>
          }
          footer={<PanelLink>Gesamten Zeitplan anzeigen</PanelLink>}
        >
          <Timeline items={timeline} label="Heutige Termine und Aufgaben" />
        </HudPanel>

        <HudPanel className="ov-cell" style={place('quick-commands')} title="Schnellbefehle">
          <div className="ov-stack ov-stack--tight ov-stack--fill">
            {quickCommands.map((c) => (
              <ActivityRow key={c.id} icon={c.icon} tone={c.tone} title={c.label} onClick={() => undefined} className="ov-quick" />
            ))}
          </div>
        </HudPanel>

        <HudPanel className="ov-cell" style={place('system-monitor')} title="Systemmonitor">
          <div className="ov-monitor">
            <div className="ov-gauges">
              <CircularMetric label="CPU" value={15} size={86} />
              <CircularMetric label="RAM" value={54} size={86} />
              <CircularMetric label="GPU" value={38} size={86} />
              <CircularMetric label="D:\" value={null} size={86} nullReason="Laufwerk D:\ meldet keine Kapazität (Windows-Worker offline)" />
            </div>
            <ul className="ov-services" aria-label="Dienste">
              {systemServices.map((s) => (
                <li key={s.id}>
                  <StatusChip tone={s.tone}>
                    {s.label}
                    <span className="ov-services__state"> · {s.state}</span>
                  </StatusChip>
                </li>
              ))}
            </ul>
          </div>
        </HudPanel>

        <HudPanel
          className="ov-cell"
          style={place('memory-insights')}
          title="Gedächtnis-Einblicke"
          footer={<PanelLink>Gedächtniskarte öffnen</PanelLink>}
        >
          <div className="ov-memory">
            <ConstellationGraph className="ov-memory__graph" summary="Netzwerkvorschau: 15 Gedächtniseinträge mit Verbindungen" seed={11} count={15} />
            <dl className="ov-memory__stats">
              <div>
                <dt>Einträge</dt>
                <dd>3.380</dd>
              </div>
              <div>
                <dt>Neu heute</dt>
                <dd>+14</dd>
              </div>
              <div>
                <dt>Projekte</dt>
                <dd>22</dd>
              </div>
              <div>
                <dt>Aktualisiert</dt>
                <dd>11:17</dd>
              </div>
            </dl>
          </div>
        </HudPanel>

        <HudPanel
          className="ov-cell"
          style={place('models-services')}
          title="Modelle & Dienste"
          actions={<span className="ov-count">4 verbunden</span>}
          footer={<PanelLink>Anbieter verwalten</PanelLink>}
        >
          <div className="ov-providers">
            {providers.map((p) => (
              <ProviderCard key={p.id} name={p.name} icon={p.icon} status={p.status} detail={p.detail} tone={p.tone} onClick={() => undefined} />
            ))}
          </div>
        </HudPanel>
      </div>
    </JarvisShell>
  );
}

