import React from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";

export type ProjectModalShellSize = "default" | "wide" | "xl";

function resolveModalSize(wide?: boolean, size?: ProjectModalShellSize): ProjectModalShellSize {
  if (size) return size;
  return wide ? "wide" : "default";
}

export function ProjectModalShell({
  title,
  subtitle,
  children,
  onClose,
  footer,
  wide,
  size: sizeProp,
  testId,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
  size?: ProjectModalShellSize;
  testId?: string;
}) {
  const size = resolveModalSize(wide, sizeProp);
  const isXl = size === "xl";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        data-testid={testId}
        className={cn(
          "w-full rounded-xl border border-border bg-card shadow-xl",
          isXl
            ? "flex max-h-[min(90vh,calc(100vh-32px))] w-[min(90vw,calc(100vw-32px))] max-w-[1280px] min-w-0 flex-col"
            : "max-h-[90vh] overflow-y-auto p-6",
          !isXl && size === "default" && "max-w-lg",
          !isXl && size === "wide" && "max-w-2xl"
        )}
      >
        <div
          className={cn(
            "flex shrink-0 items-start justify-between gap-3",
            isXl ? "border-b border-border px-6 py-4" : "mb-4"
          )}
        >
          <div className="min-w-0">
            <h3 className="text-lg font-semibold">{title}</h3>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {isXl ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        ) : (
          children
        )}

        {footer ? (
          <div
            data-testid={isXl ? "project-modal-footer" : undefined}
            className={cn(
              "flex shrink-0 justify-end gap-2",
              isXl ? "border-t border-border bg-card px-6 py-4" : "mt-6"
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ProjectModalSubmitButton({
  label,
  saving,
  disabled,
}: {
  label: string;
  saving?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={disabled || saving}
      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {label}
    </button>
  );
}
