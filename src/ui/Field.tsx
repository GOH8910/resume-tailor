import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from "react";

const BASE =
  "w-full rounded-md border border-rule bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const hintId = useId();
  return (
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
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${BASE} ${className}`} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${BASE} leading-relaxed ${className}`} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${BASE} ${className}`} />;
}
