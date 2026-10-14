import { Mic, MicOff, Square, Volume2, LoaderCircle } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';
import { useMotionMode } from '../hooks';
import { Waveform } from './Waveform';

export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking' | 'muted' | 'error' | 'disabled';

const stateIcon: Record<VoiceState, ReactNode> = {
  idle: <Mic strokeWidth={1.5} />,
  listening: <Mic strokeWidth={1.5} />,
  transcribing: <LoaderCircle strokeWidth={1.5} className="jv-spin" />,
  thinking: <LoaderCircle strokeWidth={1.5} className="jv-spin" />,
  speaking: <Volume2 strokeWidth={1.5} />,
  muted: <MicOff strokeWidth={1.5} />,
  error: <Square strokeWidth={1.5} />,
  disabled: <MicOff strokeWidth={1.5} />,
};

export const defaultVoiceLabels: Record<VoiceState, string> = {
  idle: 'Bereit',
  listening: 'Ich höre zu …',
  transcribing: 'Transkribiere …',
  thinking: 'Jarvis denkt …',
  speaking: 'Jarvis spricht …',
  muted: 'Mikrofon stumm',
  error: 'Sprachfehler',
  disabled: 'Sprache nicht verfügbar',
};

export interface VoiceControlProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  state?: VoiceState;
  /** Diameter of the mic button in px. */
  size?: number;
  /** Status text under the button (default from state). */
  statusText?: string;
  /** Small hint text, e.g. "Zum Sprechen tippen". */
  hint?: string;
  /** Fixed levels (0..1) for the waveform; otherwise generated while listening/speaking. */
  levels?: readonly number[];
  /** Show the waveform above the button. */
  showWaveform?: boolean;
  /** Accessible name of the button. */
  label?: string;
}

/**
 * Big circular mic button with concentric animated rings, waveform and status text.
 * Purely presentational: the app drives `state` and handles `onClick`.
 */
export const VoiceControl = forwardRef<HTMLButtonElement, VoiceControlProps>(function VoiceControl(
  { state = 'idle', size = 92, statusText, hint, levels, showWaveform = true, label = 'Sprachsteuerung', className, disabled, ...rest },
  ref,
) {
  const { animate } = useMotionMode();
  const active = state === 'listening' || state === 'speaking';
  const text = statusText ?? defaultVoiceLabels[state];
  const tone = state === 'speaking' ? 'gold' : state === 'error' ? 'red' : state === 'muted' || state === 'disabled' ? 'muted' : 'cyan';
  return (
    <div className={cx('jv-voice', `jv-voice--${state}`, className)} data-state={state}>
      {showWaveform ? (
        <div className="jv-voice__wave" aria-hidden="true">
          <Waveform levels={levels} live={active} energy={active ? 0.8 : 0.12} tone={tone} height={26} fade="edges" />
        </div>
      ) : null}
      <div className="jv-voice__stage" style={{ width: size * 1.45, height: size * 1.45 }}>
        <span className={cx('jv-voice__ring jv-voice__ring--3', active && animate && 'jv-voice__ring--live')} aria-hidden="true" />
        <span className={cx('jv-voice__ring jv-voice__ring--2', active && animate && 'jv-voice__ring--live')} aria-hidden="true" />
        <span className={cx('jv-voice__ring jv-voice__ring--1', active && animate && 'jv-voice__ring--live')} aria-hidden="true" />
        <button
          ref={ref}
          type="button"
          className="jv-voice__button"
          style={{ width: size, height: size }}
          aria-label={label}
          aria-pressed={state === 'listening'}
          aria-describedby={undefined}
          disabled={disabled || state === 'disabled'}
          {...rest}
        >
          <span className="jv-voice__icon" style={{ width: size * 0.38, height: size * 0.38 }}>
            {stateIcon[state]}
          </span>
        </button>
      </div>
      <p className="jv-voice__status" role="status" aria-live="polite">
        {text}
      </p>
      {hint ? <p className="jv-voice__hint">{hint}</p> : null}
    </div>
  );
});
