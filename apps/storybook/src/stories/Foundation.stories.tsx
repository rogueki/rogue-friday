import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  DEFAULT_THEME_SETTINGS,
  TONES,
  applyThemeSettings,
  fontFamilies,
  jarvisTokens,
  spacing,
  type JarvisTokenKey,
  type ThemeSettings,
} from '@jarvis/design-tokens';
import { Activity, Bell, Bot, Cpu, Database, Mic, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { HudPanel, IconTile, Slider, TagPill } from '@jarvis/ui';
import { Grid, Row, Section } from './_helpers';

const meta = {
  title: 'Design System/Foundation',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const groups: { title: string; keys: JarvisTokenKey[] }[] = [
  { title: 'Hintergrund', keys: ['bg0', 'bg1', 'bg2'] },
  { title: 'Panel-Flächen', keys: ['panel0', 'panel1', 'panelActive'] },
  { title: 'Linien', keys: ['borderDim', 'border', 'borderActive', 'grid'] },
  { title: 'Cyan-Familie', keys: ['cyan', 'cyanBright', 'teal', 'blue', 'focus'] },
  { title: 'Orb (nur AI-Core-Kontext)', keys: ['orbGold', 'orbOrange', 'orbHot', 'orbDeep'] },
  { title: 'Semantik', keys: ['success', 'warning', 'error', 'violet'] },
  { title: 'Text', keys: ['text', 'textStrong', 'muted', 'disabled'] },
];

function Swatch({ k }: { k: JarvisTokenKey }) {
  const t = jarvisTokens[k];
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span
        style={{
          width: 44,
          height: 44,
          flex: 'none',
          borderRadius: 4,
          border: '1px solid var(--jv-line-soft)',
          background: `var(${t.name})`,
        }}
      />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.35, minWidth: 0 }}>
        <code style={{ fontFamily: 'var(--jv-font-mono)', fontSize: 12, color: 'var(--jarvis-text-strong)' }}>{t.name}</code>
        <code style={{ fontFamily: 'var(--jv-font-mono)', fontSize: 11, color: 'var(--jarvis-muted)' }}>{t.value}</code>
      </span>
    </div>
  );
}

export const Colors: Story = {
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Farbdisziplin: 80–85 % Navy · 10–15 % Cyan · 2–5 % Semantik · Gold nur im Orb-Kontext">
        <div style={{ display: 'flex', height: 18, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--jv-line-soft)' }}>
          <span style={{ flex: 83, background: 'var(--jarvis-bg-1)' }} />
          <span style={{ flex: 12, background: 'var(--jarvis-cyan)' }} />
          <span style={{ flex: 3, background: 'var(--jarvis-success)' }} />
          <span style={{ flex: 2, background: 'var(--jarvis-orb-gold)' }} />
        </div>
      </Section>
      {groups.map((g) => (
        <Section key={g.title} title={g.title}>
          <Grid min={260}>
            {g.keys.map((k) => (
              <Swatch key={k} k={k} />
            ))}
          </Grid>
        </Section>
      ))}
    </div>
  ),
};

export const ToneTiles: Story = {
  name: 'Icon tiles per tone',
  render: () => {
    const icons: Record<string, ReactNode> = {
      cyan: <Cpu />,
      green: <ShieldCheck />,
      violet: <Database />,
      amber: <Bell />,
      red: <Zap />,
      teal: <Activity />,
      blue: <Bot />,
      gold: <Sparkles />,
      muted: <Mic />,
    };
    return (
      <div style={{ padding: 28 }}>
        <Section title="Semantische Tönungen (Fläche, Rand, Glow)">
          <Row gap={24}>
            {TONES.map((tone) => (
              <div key={tone} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <IconTile tone={tone} size="lg" icon={icons[tone]} />
                <IconTile tone={tone} size="lg" active icon={icons[tone]} />
                <TagPill tone={tone}>{tone}</TagPill>
              </div>
            ))}
          </Row>
        </Section>
      </div>
    );
  },
};

export const Typography: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'grid', gap: 24, maxWidth: 900 }}>
      <Section title={`Oxanium – Überschriften, Labels, Uhr (${fontFamilies.display.split(',')[0]})`}>
        <div style={{ fontFamily: 'var(--jv-font-display)', fontSize: 40, letterSpacing: '0.42em', color: 'var(--jarvis-text-strong)' }}>JARVIS</div>
        <div style={{ fontFamily: 'var(--jv-font-display)', fontSize: 30, color: 'var(--jarvis-cyan)', marginTop: 8 }}>11:18:21</div>
        <div style={{ fontFamily: 'var(--jv-font-display)', fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', marginTop: 8 }}>
          Panel-Titel · Aktive Agenten
        </div>
      </Section>
      <Section title="Inter – Inhalte (13–14 px)">
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
          Größenänderung der Überwachungsschwelle für Übertragungsfehler – lange deutsche Wörter mit Umlauten bleiben lesbar.
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--jarvis-muted)' }}>Sekundärtext, 12 px, Kontrast AA auf Navy.</p>
      </Section>
      <Section title="JetBrains Mono – Zahlen, IDs, Tags">
        <code style={{ fontFamily: 'var(--jv-font-mono)', fontSize: 14 }}>task_01HZX3K8M2 · 3.380 · 15 % · +14</code>
      </Section>
    </div>
  ),
};

export const SpacingAndHierarchy: Story = {
  name: 'Spacing and panel hierarchy',
  render: () => (
    <div style={{ padding: 28 }}>
      <Section title="Spacing-Skala (px)">
        <Row gap={14} style={{ alignItems: 'flex-end' }}>
          {spacing
            .filter((n) => n > 0)
            .map((n) => (
              <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <span style={{ width: n, height: n, background: 'var(--jarvis-cyan)', opacity: 0.8 }} />
                <code style={{ fontFamily: 'var(--jv-font-mono)', fontSize: 10, color: 'var(--jarvis-muted)' }}>{n}</code>
              </div>
            ))}
        </Row>
      </Section>
      <Section title="Panel-Hierarchie §24.5 (Level 0 = Seitenhintergrund)">
        <Grid min={240}>
          <HudPanel level={1} title="Level 1 · Modul">
            <p style={{ margin: 0, fontSize: 13 }}>Normale Module, kein Glow.</p>
          </HudPanel>
          <HudPanel level={2} title="Level 2 · Aktiv">
            <p style={{ margin: 0, fontSize: 13 }}>Aktiv/ausgewählt, Cyan-Glow.</p>
          </HudPanel>
          <HudPanel level={3} tone="amber" title="Level 3 · Attention">
            <p style={{ margin: 0, fontSize: 13 }}>Approval / Attention.</p>
          </HudPanel>
          <HudPanel level={3} tone="red" title="Level 3 · Critical">
            <p style={{ margin: 0, fontSize: 13 }}>Kritischer Zustand.</p>
          </HudPanel>
        </Grid>
      </Section>
    </div>
  ),
};

export const BackgroundUtilities: Story = {
  render: () => (
    <div style={{ padding: 28, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
      {[
        ['jv-bg-grid', 'Punktraster 24 px'],
        ['jv-bg-radial', 'Radiale Aufhellung'],
        ['jv-bg-stage', 'Stage = beides'],
      ].map(([cls, label]) => (
        <div
          key={cls}
          className={cls}
          style={{ height: 180, border: '1px solid var(--jv-line-soft)', display: 'grid', placeItems: 'center', fontFamily: 'var(--jv-font-mono)', fontSize: 12, color: 'var(--jarvis-muted)' }}
        >
          .{cls} – {label}
        </div>
      ))}
    </div>
  ),
};

export const RuntimeThemeSettings: Story = {
  name: 'Runtime theme settings',
  render: function Render() {
    const [s, setS] = useState<ThemeSettings>({ ...DEFAULT_THEME_SETTINGS });
    const set = (patch: Partial<ThemeSettings>): void => setS(applyThemeSettings(patch));
    const pct = (v: number): string => `${Math.round(v * 100)} %`;
    return (
      <div style={{ padding: 28, display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) 1fr', gap: 24 }}>
        <HudPanel title="Einstellungen" level={2}>
          <div style={{ display: 'grid', gap: 14 }}>
            <Slider label="Cyan-Intensität" min={0.3} max={1.5} step={0.05} value={s.cyanIntensity} onValueChange={(v) => set({ cyanIntensity: v })} formatValue={pct} />
            <Slider label="Paneltransparenz" min={0} max={1} step={0.05} value={s.panelTransparency} onValueChange={(v) => set({ panelTransparency: v })} formatValue={pct} />
            <Slider label="Gold-Intensität (Orb)" min={0} max={1.5} step={0.05} value={s.orbGoldIntensity} onValueChange={(v) => set({ orbGoldIntensity: v })} formatValue={pct} />
            <Slider label="Hintergrundraster" min={0} max={1} step={0.05} value={s.gridVisibility} onValueChange={(v) => set({ gridVisibility: v })} formatValue={pct} />
            <Slider label="Schriftgröße" min={0.85} max={1.3} step={0.05} value={s.fontScale} onValueChange={(v) => set({ fontScale: v })} formatValue={pct} />
          </div>
        </HudPanel>
        <Grid min={220}>
          <HudPanel title="Normal">
            <p style={{ margin: 0 }}>Das Panel reagiert live auf die Regler.</p>
          </HudPanel>
          <HudPanel title="AI Core" tone="gold" glow>
            <p style={{ margin: 0 }}>Gold nur im Orb-Kontext.</p>
          </HudPanel>
          <HudPanel title="Aktiv" level={2}>
            <p style={{ margin: 0 }}>Level 2 mit Glow.</p>
          </HudPanel>
        </Grid>
      </div>
    );
  },
};
