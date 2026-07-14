import React from "react";
import { cn } from "@/src/lib/utils";

/**
 * Classes canônicas dos controles de formulário dentro de overlays. Exportadas
 * para reutilizar em controles custom (autocompletes, date-pickers, etc.).
 */
export const OVERLAY_CONTROL_CLASS = cn(
  "w-full min-w-0 rounded-lg border bg-white text-sm text-foreground",
  "border-[color:var(--color-overlay-border)]",
  "px-3 py-2",
  "outline-none transition-colors",
  "placeholder:text-muted-foreground/60",
  "focus:border-primary focus:ring-2 focus:ring-primary/20",
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-muted-foreground",
  "aria-[invalid=true]:border-rose-400 aria-[invalid=true]:focus:ring-rose-200"
);

export type OverlayInputProps = React.InputHTMLAttributes<HTMLInputElement>;
export type OverlayTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;
export type OverlaySelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

export const OverlayInput = React.forwardRef<HTMLInputElement, OverlayInputProps>(
  function OverlayInput({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cn(OVERLAY_CONTROL_CLASS, className)}
        {...rest}
      />
    );
  }
);

export const OverlayTextarea = React.forwardRef<
  HTMLTextAreaElement,
  OverlayTextareaProps
>(function OverlayTextarea({ className, rows = 3, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(OVERLAY_CONTROL_CLASS, "min-h-[72px] resize-y", className)}
      {...rest}
    />
  );
});

export const OverlaySelect = React.forwardRef<
  HTMLSelectElement,
  OverlaySelectProps
>(function OverlaySelect({ className, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      className={cn(OVERLAY_CONTROL_CLASS, "appearance-none pr-8", className)}
      {...rest}
    >
      {children}
    </select>
  );
});
