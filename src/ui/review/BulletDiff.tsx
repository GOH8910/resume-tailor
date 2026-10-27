import { diffWords } from "diff";

/** Word-level diff of the original bank bullet against the current text. */
export function BulletDiff({ original, text }: { original: string; text: string }) {
  const parts = diffWords(original, text);
  return (
    <p className="text-sm leading-relaxed">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <ins key={i} className="rounded bg-ok-soft px-0.5 text-ok no-underline">
              {part.value}
            </ins>
          );
        }
        if (part.removed) {
          return (
            <del key={i} className="rounded bg-accent-soft px-0.5 text-accent-deep line-through">
              {part.value}
            </del>
          );
        }
        return <span key={i}>{part.value}</span>;
      })}
    </p>
  );
}
