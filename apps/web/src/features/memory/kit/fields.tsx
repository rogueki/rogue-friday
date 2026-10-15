"use client";

import { cx, useStableIdLike } from "./fieldsInternal";
import type { TextareaHTMLAttributes } from "react";

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows"> {
  label: string;
  hint?: string;
  error?: string;
  rows?: number;
}

/** Multi-line field in the look of `@friday/ui`'s `TextField` (the library has no textarea yet). */
export function TextArea({ label, hint, error, rows = 5, className, id, required, disabled, ...rest }: TextAreaProps) {
  const autoId = useStableIdLike("mk-textarea");
  const fieldId = id ?? autoId;
  return (
    <div className={cx("jv-field", "mk-textarea", error && "jv-field--invalid", disabled && "jv-field--disabled", className)}>
      <label htmlFor={fieldId} className="jv-field__label">
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
        className="jv-field__input mk-textarea__input"
        {...rest}
      />
      {error ? (
        <p id={`${fieldId}-error`} className="jv-field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="jv-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
