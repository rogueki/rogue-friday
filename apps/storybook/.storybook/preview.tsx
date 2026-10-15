import type { Decorator, Preview } from '@storybook/react-vite';
import { applyThemeById, setMotionMode, themes, type MotionMode } from '@friday/design-tokens';
import '@friday/ui/styles.css';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { initialHandlers } from './handlers';
import '../../web/src/app/web.css';
import '../../web/src/app/responsive.css';
import './preview.css';

interface HudStageProps {
  motion: MotionMode;
  theme: string;
  bleed: boolean;
  children: ReactNode;
}

/** Dark HUD stage (#01060c + dot grid) behind every story; applies toolbar motion/theme globals. */
function HudStage({ motion, theme, bleed, children }: HudStageProps) {
  useEffect(() => {
    applyThemeById(theme);
  }, [theme]);
  useEffect(() => {
    setMotionMode(motion);
  }, [motion]);

  const style: CSSProperties = bleed ? { minHeight: '100vh' } : { minHeight: '100vh', padding: 24 };
  return (
    <div className="jv-root jv-bg-stage sb-stage" style={style}>
      {children}
    </div>
  );
}

const withHudStage: Decorator = (Story, context) => (
  <HudStage
    motion={(context.globals.motion as MotionMode | undefined) ?? 'full'}
    theme={(context.globals.theme as string | undefined) ?? 'friday-command-gold-core'}
    bleed={context.parameters.hudStage === 'bleed'}
  >
    <Story />
  </HudStage>
);

const preview: Preview = {
  decorators: [withHudStage],
  loaders: [mswLoader()],
  globalTypes: {
    motion: {
      description: 'Animationen',
      toolbar: {
        title: 'Animationen',
        icon: 'play',
        dynamicTitle: true,
        items: [
          { value: 'full', title: 'Animationen: Voll' },
          { value: 'reduced', title: 'Animationen: Reduziert' },
          { value: 'off', title: 'Animationen: Aus' },
        ],
      },
    },
    theme: {
      description: 'Theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        dynamicTitle: true,
        items: themes.map((t) => ({ value: t.id, title: t.name })),
      },
    },
  },
  initialGlobals: { motion: 'full', theme: 'friday-command-gold-core' },
  parameters: {
    layout: 'fullscreen',
    msw: initialHandlers,
    backgrounds: { disabled: true },
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    a11y: { test: 'todo' },
    options: { storySort: { order: ['Design System', ['Foundation'], 'Overview', 'Components', '*'] } },
  },
};

export default preview;
