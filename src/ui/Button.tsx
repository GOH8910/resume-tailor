import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-accent focus-visible:ring-accent",
  secondary: "bg-card text-ink border border-rule hover:border-ink focus-visible:ring-ink",
  ghost: "text-ink-soft hover:text-ink hover:bg-paper-deep focus-visible:ring-ink",
  danger: "text-danger hover:bg-accent-soft focus-visible:ring-danger",
};

const SIZES: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

/** Focus ring for links and other non-Button controls; Buttons get theirs from buttonClass. */
export const FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

/** A text link: underlined in the surrounding text's colour, crimson on hover. */
export const LINK_CLASS = `rounded-sm underline underline-offset-2 transition-colors hover:text-accent ${FOCUS_RING}`;

/** Button styling as a class string, so links can look like buttons. */
export function buttonClass({
  variant = "secondary",
  size = "md",
  className = "",
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
}): string {
  return `inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${className}`;
}

type Props = ComponentProps<"button"> & { variant?: Variant; size?: Size };

export function Button({ variant = "secondary", size = "md", className, type = "button", ...props }: Props) {
  return <button type={type} {...props} className={buttonClass({ variant, size, className })} />;
}
