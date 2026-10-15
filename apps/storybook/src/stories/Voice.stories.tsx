import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { VoiceControl, VoiceStatusPanel, type VoiceState } from '@friday/ui';
import { Row, Section } from './_helpers';

const meta = { title: 'Components/Voice', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const states: VoiceState[] = ['idle', 'listening', 'transcribing', 'thinking', 'speaking', 'muted', 'error', 'disabled'];

export const VoiceControlStates: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Zustände (props-getrieben)">
        <Row gap={36} style={{ alignItems: 'flex-start' }}>
          {states.map((s) => (
            <div key={s} style={{ width: 150, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <code style={{ fontFamily: 'var(--jv-font-mono)', fontSize: 11, color: 'var(--friday-muted)' }}>{s}</code>
              <VoiceControl state={s} size={84} hint={s === 'idle' ? 'Zum Sprechen tippen' : undefined} />
            </div>
          ))}
        </Row>
      </Section>
    </div>
  ),
};

export const Interactive: Story = {
  render: function Render() {
    const [s, setS] = useState<VoiceState>('idle');
    return (
      <div style={{ padding: 28, display: 'grid', placeItems: 'center' }}>
        <VoiceControl state={s} size={110} hint="Klicken zum Umschalten" onClick={() => setS((v) => (v === 'listening' ? 'thinking' : v === 'thinking' ? 'speaking' : v === 'speaking' ? 'idle' : 'listening'))} />
      </div>
    );
  },
};

export const StatusPanel: Story = {
  name: 'VoiceStatusPanel',
  render: function Render() {
    const [focus, setFocus] = useState(false);
    return (
      <div style={{ padding: 28, display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ width: 240 }}>
          <VoiceStatusPanel state="listening" focusMode={focus} onFocusModeToggle={() => setFocus((f) => !f)} onToggle={() => undefined} />
        </div>
        <div style={{ width: 240 }}>
          <VoiceStatusPanel state="speaking" onToggle={() => undefined} />
        </div>
        <div style={{ width: 240 }}>
          <VoiceStatusPanel state="disabled" statusText="Mikrofon nicht verfügbar" />
        </div>
      </div>
    );
  },
};
