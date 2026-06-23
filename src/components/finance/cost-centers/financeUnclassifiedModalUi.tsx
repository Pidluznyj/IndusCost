import React, { type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function CostCenterDialog({
  testId,
  title,
  subtitle,
  children,
  footer,
  onClose,
  closeDisabled = false,
  maxWidthClass = "max-w-3xl",
}: {
  testId: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  maxWidthClass?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4">
      <div
        className={cn(
          financeBiCardClass,
          "relative flex max-h-[min(92vh,900px)] w-full flex-col overflow-hidden shadow-xl",
          maxWidthClass
        )}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
      >
        <header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 id={`${testId}-title`} className="text-lg font-semibold text-foreground">
                {title}
              </h3>
              {subtitle ? (
                <p className="text-sm text-muted-foreground leading-relaxed">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
              onClick={onClose}
              disabled={closeDisabled}
              aria-label="Fechar"
            >
              <X className="h-3.5 w-3.5" />
              Fechar
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        <footer className="shrink-0 border-t border-border bg-muted/20 px-5 py-3">{footer}</footer>
      </div>
    </div>
  );
}

export function ModalLoadingOverlay({
  testId,
  title,
  message,
  stats,
}: {
  testId: string;
  title: string;
  message: string;
  stats?: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/85 backdrop-blur-[2px] p-4"
      data-testid={testId}
      aria-live="polite"
      aria-busy="true"
    >
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-6 shadow-lg text-center">
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
        <div className="space-y-1">
          <p className="text-base font-semibold text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
        </div>
        {stats && stats.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 text-left sm:grid-cols-3">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-lg border border-border bg-muted/30 px-3 py-2"
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {stat.label}
                </p>
                <p className="text-sm font-semibold tabular-nums">{stat.value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ModalErrorBlock({
  title,
  message,
  details,
  hint,
}: {
  title: string;
  message: string;
  details?: string | null;
  hint?: string;
}) {
  return (
    <div
      className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
      data-testid="finance-unclassified-modal-error"
      role="alert"
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1">{message}</p>
      {hint ? <p className="mt-2 text-xs text-rose-800">{hint}</p> : null}
      {details ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-semibold">Detalhes técnicos</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-rose-100/80 p-2 font-mono text-[11px]">
            {details}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export function ModalSuccessBlock({
  title,
  message,
  stats,
}: {
  title: string;
  message: string;
  stats?: Array<{ label: string; value: string | number }>;
}) {
  return (
    <div
      className="space-y-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-4 text-emerald-900"
      data-testid="finance-unclassified-modal-success"
    >
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold">{title}</p>
          <p className="text-sm leading-relaxed">{message}</p>
        </div>
      </div>
      {stats && stats.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-emerald-200 bg-white/70 px-3 py-2"
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800/80">
                {stat.label}
              </p>
              <p className="text-sm font-semibold tabular-nums">{stat.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PreviewStatGrid({
  stats,
}: {
  stats: Array<{ label: string; value: number; tone?: "ok" | "error" | "warn" }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {stats.map((stat) => (
        <PreviewStat key={stat.label} {...stat} />
      ))}
    </div>
  );
}

function PreviewStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "error" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "error"
        ? "text-rose-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-muted/15 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", toneClass)}>{value}</p>
    </div>
  );
}

export function SensitiveConfirmAlert({
  count,
  checked,
  onChange,
}: {
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
      <input
        type="checkbox"
        data-testid="finance-unclassified-import-confirm-sensitive"
        className="mt-1 h-4 w-4 rounded border-amber-400"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="space-y-1">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-4 w-4" />
          {count} linha(s) sensível(is) exigem confirmação
        </span>
        <span className="block text-xs leading-relaxed text-amber-900/90">
          Inclui conta administrativa, Receita Federal, sócios, financiamentos ou grupo interno.
          Marque para autorizar a classificação dessas linhas.
        </span>
      </span>
    </label>
  );
}
