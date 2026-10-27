"use client";

import {
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useContext,
  useId,
} from "react";

const BASE =
  "w-full rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10";

// Lets a control inside <Field> point aria-describedby at the hint without the caller wiring ids.
const FieldContext = createContext<{ describedBy?: string } | null>(null);

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const hintId = useId();
  return (
    <FieldContext.Provider value={{ describedBy: hint ? hintId : undefined }}>
      <div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
          {children}
        </label>
        {hint && (
          <p id={hintId} className="mt-1 text-xs text-ink-faint">
            {hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const ctx = useContext(FieldContext);
  return <input aria-describedby={ctx?.describedBy} {...props} className={`${BASE} ${className}`} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ctx = useContext(FieldContext);
  return <textarea aria-describedby={ctx?.describedBy} {...props} className={`${BASE} leading-relaxed ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const ctx = useContext(FieldContext);
  return <select aria-describedby={ctx?.describedBy} {...props} className={`${BASE} ${className}`} />;
}
