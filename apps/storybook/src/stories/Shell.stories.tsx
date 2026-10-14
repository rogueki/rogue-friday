import type { Meta, StoryObj } from '@storybook/react-vite';
import { Zap } from 'lucide-react';
import { useState } from 'react';
import {
  BottomCommandBar,
  BrandMark,
  JarvisShell,
  LeftCommandNav,
  TopStatusBar,
  VoiceStatusPanel,
  defaultTopBarActions,
  type ConnectionState,
  type VoiceState,
} from '@jarvis/ui';
import { contextChips, demoNow, navItems } from '../demo/data';
import { Section } from './_helpers';

const meta = { title: 'Components/Shell', parameters: { layout: 'fullscreen', hudStage: 'bleed' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const TopAndBottomBars: Story = {
  render: () => (
    <div style={{ padding: 16, display: 'grid', gap: 22 }}>
      <Section title="TopStatusBar">
        <div style={{ height: 72 }}>
          <TopStatusBar
            now={demoNow}
            timeZone="Europe/Berlin"
            connection={{ state: 'online' }}
            operator={{ name: 'RogueKI', role: 'Operator' }}
            actions={defaultTopBarActions.map((a) => (a.id === 'notifications' ? { ...a, badge: 3 } : a))}
          />
        </div>
      </Section>
      <Section title="Verbindungszustände">
        <div style={{ display: 'grid', gap: 6 }}>
          {(['degraded', 'offline', 'connecting'] as ConnectionState[]).map((c) => (
            <div key={c} style={{ height: 72 }}>
              <TopStatusBar now={demoNow} connection={{ state: c }} status={c === 'offline' ? { label: 'OFFLINE', tone: 'red' } : { label: 'EINGESCHRÄNKT', tone: 'amber' }} />
            </div>
          ))}
        </div>
      </Section>
      <Section title="BottomCommandBar – listening · speaking (Gold) · paused · compact">
        <div style={{ display: 'grid', gap: 12 }}>
          <BottomCommandBar aria-label="Befehlsleiste: Zuhören" chips={contextChips} state="listening" quickAction={{ label: 'Executive Briefing', icon: <Zap size={14} /> }} />
          <BottomCommandBar aria-label="Befehlsleiste: Sprechen" chips={contextChips} state="speaking" statusText="F.R.I.D.A.Y. spricht …" quickAction={{ label: 'Executive Briefing' }} />
          <BottomCommandBar aria-label="Befehlsleiste: Pausiert" chips={contextChips} state="idle" paused statusText="Pausiert" quickAction={{ label: 'Executive Briefing' }} />
          <BottomCommandBar aria-label="Befehlsleiste: Kompakt" compact state="thinking" />
        </div>
      </Section>
    </div>
  ),
};

export const BrandMarks: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'flex', gap: 24, alignItems: 'center' }}>
      <BrandMark size={32} />
      <BrandMark size={48} />
      <BrandMark size={96} />
    </div>
  ),
};

export const LeftNav: Story = {
  name: 'LeftCommandNav',
  render: function Render() {
    const [active, setActive] = useState('tasks');
    return (
      <div style={{ display: 'flex', gap: 24, padding: 16, height: '100vh' }}>
        <div style={{ width: 264 }}>
          <LeftCommandNav aria-label="Seitenleiste (erweitert)" items={navItems} activeId={active} onNavigate={setActive} navLabel="Hauptnavigation (erweitert)" collapsed={false} footer={<VoiceStatusPanel state="listening" onFocusModeToggle={() => undefined} collapsed={false} />} />
        </div>
        <div style={{ width: 68 }}>
          <LeftCommandNav aria-label="Seitenleiste (kompakt)" items={navItems} activeId={active} onNavigate={setActive} navLabel="Hauptnavigation (kompakt)" collapsed footer={<VoiceStatusPanel state="idle" collapsed onFocusModeToggle={() => undefined} />} />
        </div>
      </div>
    );
  },
};

function ShellDemo({ voice = 'idle' as VoiceState }) {
  const [active, setActive] = useState('overview');
  return (
    <JarvisShell
      nav={<LeftCommandNav items={navItems} activeId={active} onNavigate={setActive} footer={<VoiceStatusPanel state={voice} collapsed={undefined} />} />}
      topBar={<TopStatusBar now={demoNow} timeZone="Europe/Berlin" connection={{ state: 'online' }} operator={{ name: 'RogueKI', role: 'Operator' }} />}
      bottomBar={<BottomCommandBar compact state={voice} />}
    >
      <div style={{ padding: 24, color: 'var(--jarvis-muted)' }}>Inhaltsbereich – schmaler als 1024 px wird die Navigation zum Drawer (Menü-Button oben links).</div>
    </JarvisShell>
  );
}

export const ShellEmpty: Story = {
  name: 'JarvisShell',
  render: () => <ShellDemo />,
};

export const ShellDrawerMode: Story = {
  name: 'JarvisShell – drawer below 1024 px',
  parameters: { viewport: { defaultViewport: 'tablet' } },
  render: () => (
    <div style={{ width: 820, height: 640, margin: '0 auto', border: '1px dashed var(--jv-line-soft)', overflow: 'hidden', position: 'relative' }}>
      <iframe title="Shell 820 px" style={{ width: '100%', height: '100%', border: 0 }} src="iframe.html?id=components-shell--shell-empty&viewMode=story" />
    </div>
  ),
};
