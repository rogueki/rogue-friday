"use client";

import { Button, TextField, type TextFieldProps } from "@friday/ui";
import { Plus, X } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useT } from "@/i18n";

/** Titled group inside an area (HUD sub panel). */
export function Section({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  const id = useId();
  return (
    <section className="st-section" aria-labelledby={id}>
      <header className="st-section__head">
        <div>
          <h3 id={id} className="st-section__title">
            {title}
          </h3>
          {description ? <p className="st-section__desc">{description}</p> : null}
        </div>
        {actions ? <div className="st-section__actions">{actions}</div> : null}
      </header>
      <div className="st-section__body">{children}</div>
    </section>
  );
}

export function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 | 3 }) {
  return <div className={`st-grid st-grid--${columns}`}>{children}</div>;
}

interface NumberFieldProps extends Omit<TextFieldProps, "value" | "onChange" | "type" | "defaultValue"> {
  value: number | null;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  /** An empty field means `null` (e.g. "no budget"). */
  nullable?: boolean;
}

/** Number input that keeps what the user types while it is not a valid number yet and reports only valid values. */
export function NumberField({ value, onValueChange, min, max, step, integer, nullable, label, error, ...rest }: NumberFieldProps) {
  const { t } = useT();
  const [text, setText] = useState(value === null ? "" : String(value));
  useEffect(() => {
    setText((current) => {
      const parsed = current.trim() === "" ? null : Number(current.replace(",", "."));
      return parsed === value ? current : value === null ? "" : String(value);
    });
  }, [value]);

  const parsed = text.trim() === "" ? null : Number(text.replace(",", "."));
  let problem = error;
  if (!problem) {
    if (parsed === null && !nullable) problem = t("settings.field.required");
    else if (parsed !== null && !Number.isFinite(parsed)) problem = t("settings.field.number");
    else if (parsed !== null && integer && !Number.isInteger(parsed)) problem = t("settings.field.integer");
    else if (parsed !== null && min !== undefined && parsed < min) problem = t("settings.field.min", { min });
    else if (parsed !== null && max !== undefined && parsed > max) problem = t("settings.field.max", { max });
  }

  return (
    <TextField
      {...rest}
      label={label}
      type="number"
      inputMode={integer ? "numeric" : "decimal"}
      min={min}
      max={max}
      step={step ?? (integer ? 1 : "any")}
      value={text}
      error={problem}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === "") {
          if (nullable) onValueChange(null);
          return;
        }
        const number = Number(next.replace(",", "."));
        if (Number.isFinite(number)) onValueChange(number);
      }}
    />
  );
}

/** Multi-line text input in the look of the HUD text field (the UI library has no textarea). */
export function TextAreaField({
  label,
  value,
  onValueChange,
  rows = 6,
  hint,
  error,
  disabled,
  placeholder,
  mono = true,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  rows?: number;
  hint?: string;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <div className={`jv-field${error ? " jv-field--invalid" : ""}${disabled ? " jv-field--disabled" : ""}`}>
      <label htmlFor={id} className="jv-field__label">
        {label}
      </label>
      <div className="jv-field__control">
        <textarea
          id={id}
          className={`jv-field__input st-textarea${mono ? " st-textarea--mono" : ""}`}
          rows={rows}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
          onChange={(event) => onValueChange(event.target.value)}
        />
      </div>
      {error ? (
        <p id={`${id}-e`} className="jv-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-h`} className="jv-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Editable list of strings (trusted origins, array fields of adapter schemas). */
export function StringListEditor({
  label,
  values,
  onChange,
  disabled,
  placeholder,
  addLabel,
  emptyLabel,
}: {
  label: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  addLabel?: string;
  emptyLabel?: string;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState("");
  const add = (): void => {
    const next = draft.trim();
    if (!next || values.includes(next)) return;
    onChange([...values, next]);
    setDraft("");
  };
  return (
    <div className="st-list" role="group" aria-label={label}>
      <span className="jv-field__label">{label}</span>
      {values.length === 0 ? <p className="st-muted">{emptyLabel ?? t("settings.list.empty")}</p> : null}
      <ul className="st-list__items">
        {values.map((entry, index) => (
          <li key={`${entry}-${index}`} className="st-list__item">
            <code className="st-mono">{entry}</code>
            {disabled ? null : (
              <button type="button" className="st-iconbtn" aria-label={t("settings.list.remove", { name: entry })} onClick={() => onChange(values.filter((_, i) => i !== index))}>
                <X size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {disabled ? null : (
        <div className="st-list__add">
          <TextField
            label={addLabel ?? t("settings.list.add")}
            hideLabel
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" size="sm" variant="ghost" icon={<Plus size={14} />} onClick={add} disabled={!draft.trim()}>
            {addLabel ?? t("settings.list.add")}
          </Button>
        </div>
      )}
    </div>
  );
}
