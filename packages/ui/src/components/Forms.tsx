import { ChevronDown, Search, X } from 'lucide-react';
import {
  forwardRef,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from '../cx';
import { useControllable, useStableId } from '../hooks';
import { Badge } from './Primitives';

/* ── SearchField ────────────────────────────────────────────────────────── */

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name (the field has no visible label). */
  label?: string;
  /** Shortcut hint chip, e.g. "Ctrl K". null hides it. */
  shortcutHint?: string | null;
  clearLabel?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onValueChange, label = 'Suche', shortcutHint = 'Ctrl K', clearLabel = 'Suche leeren', placeholder = 'Suchen …', className, ...rest },
  ref,
) {
  return (
    <div className={cx('jv-search', className)}>
      <Search size={15} strokeWidth={1.5} aria-hidden="true" className="jv-search__icon" />
      <input
        ref={ref}
        type="search"
        aria-label={label}
        className="jv-search__input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        {...rest}
      />
      {value ? (
        <button type="button" className="jv-search__clear" aria-label={clearLabel} onClick={() => onValueChange('')}>
          <X size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      ) : shortcutHint ? (
        <kbd className="jv-kbd jv-search__hint">{shortcutHint}</kbd>
      ) : null}
    </div>
  );
});

/* ── TextField ──────────────────────────────────────────────────────────── */

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  /** Error message; sets aria-invalid. */
  error?: string;
  icon?: ReactNode;
  suffix?: ReactNode;
  multiline?: false;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hideLabel, hint, error, icon, suffix, className, id, required, disabled, ...rest },
  ref,
) {
  const autoId = useStableId('jv-field');
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  return (
    <div className={cx('jv-field', error && 'jv-field--invalid', disabled && 'jv-field--disabled', className)}>
      <label htmlFor={fieldId} className={cx('jv-field__label', hideLabel && 'jv-sr-only')}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="jv-field__control">
        {icon ? <span className="jv-field__icon">{icon}</span> : null}
        <input
          ref={ref}
          id={fieldId}
          className="jv-field__input"
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={cx(error && errorId, hint && hintId) || undefined}
          {...rest}
        />
        {suffix ? <span className="jv-field__suffix">{suffix}</span> : null}
      </div>
      {error ? (
        <p id={errorId} className="jv-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="jv-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* ── TextArea ───────────────────────────────────────────────────────────── */

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  /** Error message; sets aria-invalid and is announced (role="alert"). */
  error?: string;
  /** Shows "n / maxLength" below the field (needs `maxLength`); updates are not announced per keystroke. */
  showCount?: boolean;
}

/** Multi-line text input with the same label / hint / error contract as {@link TextField}. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hideLabel, hint, error, showCount, className, id, required, disabled, rows = 4, maxLength, value, defaultValue, onChange, ...rest },
  ref,
) {
  const autoId = useStableId('jv-textarea');
  const fieldId = id ?? autoId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const countId = `${fieldId}-count`;
  const [length, setLength] = useState(() => String(value ?? defaultValue ?? '').length);
  const counted = showCount && maxLength !== undefined;
  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    setLength(event.target.value.length);
    onChange?.(event);
  };
  const currentLength = value !== undefined ? String(value).length : length;
  return (
    <div className={cx('jv-field', error && 'jv-field--invalid', disabled && 'jv-field--disabled', className)}>
      <label htmlFor={fieldId} className={cx('jv-field__label', hideLabel && 'jv-sr-only')}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <textarea
        ref={ref}
        id={fieldId}
        className="jv-field__input jv-field__textarea"
        rows={rows}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        aria-invalid={error ? true : undefined}
        aria-describedby={cx(error && errorId, hint && hintId, counted && countId) || undefined}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="jv-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="jv-field__hint">
          {hint}
        </p>
      ) : null}
      {counted ? (
        <p id={countId} className="jv-field__count">
          {currentLength} / {maxLength}
        </p>
      ) : null}
    </div>
  );
});

/* ── Select (native, styled) ────────────────────────────────────────────── */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption[];
  hint?: string;
  error?: string;
}

/** Native <select>: best a11y and mobile behaviour; styled for the HUD and `color-scheme: dark`. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hideLabel, options, hint, error, className, id, disabled, ...rest },
  ref,
) {
  const autoId = useStableId('jv-select');
  const selectId = id ?? autoId;
  return (
    <div className={cx('jv-field jv-select', error && 'jv-field--invalid', disabled && 'jv-field--disabled', className)}>
      <label htmlFor={selectId} className={cx('jv-field__label', hideLabel && 'jv-sr-only')}>
        {label}
      </label>
      <div className="jv-field__control">
        <select
          ref={ref}
          id={selectId}
          className="jv-select__native"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
          {...rest}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} strokeWidth={1.75} className="jv-select__chevron" aria-hidden="true" />
      </div>
      {error ? (
        <p id={`${selectId}-error`} className="jv-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${selectId}-hint`} className="jv-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

/* ── Switch ─────────────────────────────────────────────────────────────── */

export interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'aria-checked' | 'children'> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label: string;
  description?: string;
  /** On/off words shown next to the switch so state is never colour-only. */
  stateLabels?: readonly [on: string, off: string];
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, defaultChecked = false, onCheckedChange, label, description, stateLabels = ['An', 'Aus'], className, disabled, id, ...rest },
  ref,
) {
  const [on, setOn] = useControllable(checked, defaultChecked, onCheckedChange);
  const autoId = useStableId('jv-switch');
  const switchId = id ?? autoId;
  return (
    <div className={cx('jv-switch', disabled && 'jv-switch--disabled', className)}>
      <button
        ref={ref}
        id={switchId}
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={description ? `${switchId}-desc` : undefined}
        aria-labelledby={`${switchId}-label`}
        disabled={disabled}
        className="jv-switch__track"
        onClick={() => setOn(!on)}
        {...rest}
      >
        <span className="jv-switch__thumb" />
      </button>
      <div className="jv-switch__text">
        <label id={`${switchId}-label`} htmlFor={switchId} className="jv-switch__label">
          {label}
        </label>
        {description ? (
          <span id={`${switchId}-desc`} className="jv-switch__desc">
            {description}
          </span>
        ) : null}
      </div>
      <span className="jv-switch__state" aria-hidden="true">
        {on ? stateLabels[0] : stateLabels[1]}
      </span>
    </div>
  );
});

/* ── Slider ─────────────────────────────────────────────────────────────── */

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue' | 'onChange'> {
  label: string;
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  formatValue?: (value: number) => string;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { label, value, defaultValue = 0, onValueChange, min = 0, max = 100, step = 1, formatValue, className, id, disabled, ...rest },
  ref,
) {
  const [current, setCurrent] = useControllable(value, defaultValue, onValueChange);
  const autoId = useStableId('jv-slider');
  const sliderId = id ?? autoId;
  const pct = max === min ? 0 : ((current - min) / (max - min)) * 100;
  const text = formatValue ? formatValue(current) : String(current);
  return (
    <div className={cx('jv-slider', disabled && 'jv-field--disabled', className)}>
      <div className="jv-slider__head">
        <label htmlFor={sliderId} className="jv-field__label">
          {label}
        </label>
        <output htmlFor={sliderId} className="jv-slider__value">
          {text}
        </output>
      </div>
      <input
        ref={ref}
        id={sliderId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        disabled={disabled}
        aria-valuetext={text}
        className="jv-slider__input"
        style={{ ['--jv-fill' as string]: `${pct}%` }}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrent(Number(e.target.value))}
        {...rest}
      />
    </div>
  );
});

/* ── Tabs ───────────────────────────────────────────────────────────────── */

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
  content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  variant?: 'line' | 'boxed';
  className?: string;
  panelClassName?: string;
}

export function Tabs({ items, value, defaultValue, onValueChange, label, variant = 'line', className, panelClassName }: TabsProps) {
  const first = items.find((i) => !i.disabled)?.id ?? items[0]?.id ?? '';
  const [active, setActive] = useControllable<string>(value, defaultValue ?? first, onValueChange);
  const baseId = useStableId('jv-tabs');
  const listRef = useRef<HTMLDivElement>(null);
  const enabled = items.filter((i) => !i.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = enabled.findIndex((i) => i.id === active);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    setActive(target.id);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus();
  };

  const current = items.find((i) => i.id === active);

  return (
    <div className={cx('jv-tabs', `jv-tabs--${variant}`, className)}>
      <div ref={listRef} role="tablist" aria-label={label} className="jv-tabs__list" onKeyDown={onKeyDown}>
        {items.map((item) => {
          const selected = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              data-tab={item.id}
              aria-selected={selected}
              aria-controls={selected && current?.content !== undefined ? `${baseId}-panel-${item.id}` : undefined}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={cx('jv-tabs__tab', selected && 'jv-tabs__tab--active')}
              onClick={() => setActive(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              {item.count !== undefined ? <Badge count={item.count} showZero label={`${item.count}`} /> : null}
            </button>
          );
        })}
      </div>
      {current?.content !== undefined ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${current.id}`}
          aria-labelledby={`${baseId}-tab-${current.id}`}
          tabIndex={0}
          className={cx('jv-tabs__panel', panelClassName)}
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
