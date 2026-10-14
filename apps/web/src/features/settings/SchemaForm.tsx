"use client";

import { Button, Select, StatusChip, Switch, TextField } from "@jarvis/ui";
import type { SecretStatus } from "@jarvis/sdk";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/i18n";
import { NumberField, StringListEditor, TextAreaField } from "./controls";
import { asFieldSchema, defaultValueFor, errorFor, fieldKind, type FieldError, type FieldSchema } from "./schemaLogic";

/**
 * Configuration form generated from an adapter's JSON Schema (PLAN §42.2).
 * Secrets never enter `value`: the server only reports `{ configured }`, so a secret field shows "gesetzt / nicht gesetzt"
 * plus a write-only input whose text is kept apart (`secretInput`) and is only ever sent, never read back.
 */
export interface SchemaFormProps {
  schema: FieldSchema;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  secretStatus: Record<string, SecretStatus>;
  secretInput: Record<string, string>;
  onSecretChange: (name: string, value: string) => void;
  errors: readonly FieldError[];
  disabled?: boolean;
  idPrefix?: string;
}

const humanize = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

interface NodeProps {
  name: string;
  path: string;
  schema: FieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  errors: readonly FieldError[];
  disabled?: boolean;
  secretNames: ReadonlySet<string>;
  /** Only top-level secrets are supported (the API addresses them by field name). */
  secretStatus: Record<string, SecretStatus>;
  secretInput: Record<string, string>;
  onSecretChange: (name: string, value: string) => void;
  topLevel: boolean;
}

function JsonField({ label, value, onChange, disabled, error }: { label: string; value: unknown; onChange: (value: unknown) => void; disabled?: boolean; error?: string }) {
  const { t } = useT();
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [problem, setProblem] = useState<string | undefined>();
  useEffect(() => {
    // Accept outside changes (reset) but never overwrite what is being typed while it is valid JSON of the same value.
    try {
      if (JSON.stringify(JSON.parse(text)) === JSON.stringify(value ?? null)) return;
    } catch {
      return;
    }
    setText(JSON.stringify(value ?? null, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `text` is deliberately not a dependency
  }, [value]);
  return (
    <TextAreaField
      label={label}
      value={text}
      rows={5}
      disabled={disabled}
      hint={t("settings.schema.jsonHint")}
      error={problem ?? error}
      onValueChange={(next) => {
        setText(next);
        try {
          onChange(JSON.parse(next));
          setProblem(undefined);
        } catch {
          setProblem(t("settings.schema.invalidJson"));
        }
      }}
    />
  );
}

function SecretField({ name, label, description, status, input, onChange, disabled }: { name: string; label: string; description?: string; status: SecretStatus | undefined; input: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useT();
  const configured = status?.configured === true;
  return (
    <div className="st-secret" data-secret-field={name}>
      <div className="st-secret__head">
        <span className="jv-field__label">{label}</span>
        <StatusChip tone={configured ? "green" : "amber"}>{configured ? t("settings.schema.secret.set") : t("settings.schema.secret.unset")}</StatusChip>
      </div>
      <TextField
        label={t("settings.schema.secret.newValue", { name: label })}
        hideLabel
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        placeholder={configured ? t("settings.schema.secret.placeholderSet") : t("settings.schema.secret.placeholderUnset")}
        value={input}
        disabled={disabled}
        hint={description ?? t("settings.schema.secret.hint")}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function FieldNode(props: NodeProps) {
  const { t } = useT();
  const { name, path, schema, value, onChange, required, errors, disabled, secretNames } = props;
  const kind = fieldKind(name, schema, props.topLevel ? secretNames : new Set());
  const label = schema.title ?? humanize(name);
  const error = errorFor(errors, path);
  const readOnly = disabled || schema.readOnly === true;

  switch (kind) {
    case "secret":
      return (
        <SecretField
          name={name}
          label={label}
          description={schema.description}
          status={props.secretStatus[name]}
          input={props.secretInput[name] ?? ""}
          onChange={(next) => props.onSecretChange(name, next)}
          disabled={disabled}
        />
      );
    case "boolean":
      return <Switch label={label} description={schema.description} checked={value === true} disabled={readOnly} onCheckedChange={onChange} stateLabels={[t("settings.state.on"), t("settings.state.off")]} />;
    case "enum":
      return (
        <Select
          label={label}
          hint={schema.description}
          error={error}
          disabled={readOnly}
          value={String(value ?? "")}
          options={(schema.enum ?? []).map((option) => ({ value: String(option), label: String(option) }))}
          onChange={(event) => {
            const picked = (schema.enum ?? []).find((option) => String(option) === event.target.value);
            onChange(picked);
          }}
        />
      );
    case "number":
    case "integer":
      return (
        <NumberField
          label={label}
          hint={schema.description}
          value={typeof value === "number" ? value : null}
          onValueChange={(next) => onChange(next ?? undefined)}
          integer={kind === "integer"}
          min={schema.minimum}
          max={schema.maximum}
          nullable={!required}
          required={required}
          disabled={readOnly}
          error={error}
        />
      );
    case "string": {
      if ((schema.maxLength ?? 0) > 200) {
        return <TextAreaField label={label} hint={schema.description} value={typeof value === "string" ? value : ""} onValueChange={onChange} error={error} disabled={readOnly} mono={false} />;
      }
      const type = schema.format === "uri" || schema.format === "url" ? "url" : schema.format === "email" ? "email" : "text";
      return (
        <TextField
          label={label}
          hint={schema.description}
          type={type}
          placeholder={typeof schema.default === "string" ? schema.default : undefined}
          required={required}
          value={typeof value === "string" ? value : ""}
          error={error}
          disabled={readOnly}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    case "object": {
      const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
      return (
        <fieldset className="st-fieldset" disabled={readOnly}>
          <legend className="st-fieldset__legend">{label}</legend>
          {schema.description ? <p className="st-muted">{schema.description}</p> : null}
          <div className="st-fieldset__body">
            {Object.entries(schema.properties ?? {}).map(([childName, child]) => (
              <FieldNode
                key={childName}
                {...props}
                topLevel={false}
                name={childName}
                path={`${path}.${childName}`}
                schema={asFieldSchema(child)}
                value={record[childName]}
                required={(schema.required ?? []).includes(childName)}
                onChange={(next) => onChange({ ...record, [childName]: next })}
              />
            ))}
          </div>
        </fieldset>
      );
    }
    case "array": {
      const list = Array.isArray(value) ? value : [];
      const items = asFieldSchema(schema.items);
      const itemKind = fieldKind("", items);
      if (itemKind === "string") {
        return (
          <div>
            <StringListEditor label={label} values={list.map(String)} onChange={onChange} disabled={readOnly} />
            {schema.description ? <p className="st-muted">{schema.description}</p> : null}
            {error ? <p className="jv-field__error" role="alert">{error}</p> : null}
          </div>
        );
      }
      return (
        <fieldset className="st-fieldset" disabled={readOnly}>
          <legend className="st-fieldset__legend">{label}</legend>
          {schema.description ? <p className="st-muted">{schema.description}</p> : null}
          {list.length === 0 ? <p className="st-muted">{t("settings.list.empty")}</p> : null}
          {list.map((item, index) => (
            <div key={index} className="st-array-item">
              <div className="st-array-item__body">
                <FieldNode
                  {...props}
                  topLevel={false}
                  name={`${name} ${index + 1}`}
                  path={`${path}[${index}]`}
                  schema={{ ...items, title: items.title ?? `${label} ${index + 1}` }}
                  value={item}
                  required
                  onChange={(next) => onChange(list.map((entry, i) => (i === index ? next : entry)))}
                />
              </div>
              <button type="button" className="st-iconbtn" aria-label={t("settings.list.remove", { name: `${label} ${index + 1}` })} onClick={() => onChange(list.filter((_, i) => i !== index))}>
                <Trash2 size={14} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => onChange([...list, defaultValueFor(items)])}>
            {t("settings.list.add")}
          </Button>
          {error ? <p className="jv-field__error" role="alert">{error}</p> : null}
        </fieldset>
      );
    }
    default:
      return <JsonField label={label} value={value} onChange={onChange} disabled={readOnly} error={error} />;
  }
}

export function SchemaForm({ schema, value, onChange, secretStatus, secretInput, onSecretChange, errors, disabled, idPrefix = "cfg" }: SchemaFormProps) {
  const { t } = useT();
  const properties = Object.entries(schema.properties ?? {});
  const secretNames = new Set(Object.keys(secretStatus));
  // Secrets the server knows but the schema does not describe still need an input.
  const extraSecrets = Object.keys(secretStatus).filter((name) => !(name in (schema.properties ?? {})));

  if (properties.length === 0 && extraSecrets.length === 0) return <p className="st-muted">{t("settings.schema.noFields")}</p>;
  return (
    <div className="st-schema" data-schema-form={idPrefix}>
      {properties.map(([name, child]) => (
        <FieldNode
          key={name}
          name={name}
          path={name}
          schema={asFieldSchema(child)}
          value={value[name]}
          required={(schema.required ?? []).includes(name)}
          errors={errors}
          disabled={disabled}
          secretNames={secretNames}
          secretStatus={secretStatus}
          secretInput={secretInput}
          onSecretChange={onSecretChange}
          topLevel
          onChange={(next) => {
            const copy = { ...value };
            if (next === undefined) delete copy[name];
            else copy[name] = next;
            onChange(copy);
          }}
        />
      ))}
      {extraSecrets.map((name) => (
        <SecretField key={name} name={name} label={humanize(name)} status={secretStatus[name]} input={secretInput[name] ?? ""} onChange={(next) => onSecretChange(name, next)} disabled={disabled} />
      ))}
    </div>
  );
}
