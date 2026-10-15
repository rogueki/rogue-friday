import type { Meta, StoryObj } from '@storybook/react-vite';
import { Activity, Cpu, Settings } from 'lucide-react';
import { Button, CornerBrackets, HudPanel, HudPanelHeader, PanelLink, type PanelCut } from '@friday/ui';
import { Grid, Row, Section, longGerman } from './_helpers';

const meta = {
  title: 'Components/Panels',
  component: HudPanel,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof HudPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

const body = (
  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
    Panelkörper mit sauberem Innenabstand. Die 1-px-Linie folgt der abgeschrägten Ecke, die innere Haarlinie sitzt 4 px versetzt.
  </p>
);

export const Levels: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Level 1 · 2 · 3 (§24.5)">
        <Grid min={300}>
          <HudPanel level={1} title="Level 1 · Normal" icon={<Cpu />} actions={<PanelLink>Alle anzeigen</PanelLink>}>
            {body}
          </HudPanel>
          <HudPanel level={2} title="Level 2 · Aktiv" icon={<Activity />} live>
            {body}
          </HudPanel>
          <HudPanel level={3} tone="amber" title="Level 3 · Attention">
            {body}
          </HudPanel>
          <HudPanel level={3} tone="red" title="Level 3 · Critical" glow>
            {body}
          </HudPanel>
        </Grid>
      </Section>
    </div>
  ),
};

export const Tones: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Tone: cyan · gold (nur AI Core) · amber · red">
        <Grid min={260}>
          {(['cyan', 'gold', 'amber', 'red'] as const).map((tone) => (
            <HudPanel key={tone} tone={tone} title={`Tone ${tone}`} glow={tone === 'gold'}>
              {body}
            </HudPanel>
          ))}
        </Grid>
      </Section>
    </div>
  ),
};

export const CutVariants: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="cut: tl-br · tr-bl · all · tl · br · none, Größen sm / md / lg">
        <Grid min={240}>
          {(['tl-br', 'tr-bl', 'all', 'tl', 'br', 'none'] as PanelCut[]).map((cut) => (
            <HudPanel key={cut} cut={cut} title={`cut="${cut}"`}>
              {body}
            </HudPanel>
          ))}
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <HudPanel key={size} cut="all" cutSize={size} title={`cutSize="${size}"`}>
              {body}
            </HudPanel>
          ))}
        </Grid>
      </Section>
    </div>
  ),
};

export const HeaderVariants: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Grid min={320}>
        <HudPanel title="Nur Titel">{body}</HudPanel>
        <HudPanel title="Mit Icon und Aktion" icon={<Settings />} actions={<PanelLink>Alle anzeigen</PanelLink>}>
          {body}
        </HudPanel>
        <HudPanel title="Live-Feed" live>
          {body}
        </HudPanel>
        <HudPanel title="Titel und Untertitel" subtitle="aktualisiert 11:17">
          {body}
        </HudPanel>
        <HudPanel title={longGerman}>{body}</HudPanel>
        <HudPanel header={<HudPanelHeader title="Eigener Header" actions={<Button size="sm">Aktion</Button>} />}>{body}</HudPanel>
        <HudPanel padding="none" title="Ohne Innenabstand">
          <div style={{ padding: 12, background: 'rgba(39,220,255,.06)' }}>Bündiger Inhalt</div>
        </HudPanel>
        <HudPanel aria-label="Panel ohne Header">{body}</HudPanel>
      </Grid>
    </div>
  ),
};

export const InteractiveAndScrolling: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Row gap={16} style={{ alignItems: 'stretch' }}>
        <HudPanel interactive title="Interaktiv (Tab, Enter)" style={{ width: 300 }} onClick={() => undefined}>
          {body}
        </HudPanel>
        <HudPanel scroll title="Scrollender Körper" style={{ width: 300, height: 180 }}>
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i} style={{ margin: '0 0 8px' }}>
              Zeile {i + 1}
            </p>
          ))}
        </HudPanel>
      </Row>
    </div>
  ),
};

export const Brackets: Story = {
  name: 'CornerBrackets',
  render: () => (
    <div style={{ padding: 28 }}>
      <Row gap={24}>
        {(['cyan', 'gold', 'amber', 'red'] as const).map((tone) => (
          <div key={tone} style={{ position: 'relative', width: 160, height: 90, border: '1px solid var(--jv-line-soft)' }}>
            <CornerBrackets corners={['tl', 'tr', 'br', 'bl']} tone={tone} size={12} />
          </div>
        ))}
      </Row>
    </div>
  ),
};
