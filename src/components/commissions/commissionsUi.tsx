import React from "react";
import { Loader2 } from "lucide-react";
import { HttpError } from "@/src/lib/http";

export function formatCommissionsApiError(error: unknown, fallback: string): string {
  if (error instanceof HttpError) return error.message || fallback;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

export function CommissionsLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground"
      data-testid="commissions-loading"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function CommissionsEmptyState({
  title = "Nenhum registro encontrado",
  description = "Não há dados para exibir com os filtros atuais.",
  testId = "commissions-empty-state",
}: {
  title?: string;
  description?: string;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-10 text-center"
      data-testid={testId}
    >
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function CommissionsErrorBanner({
  message,
  onRetry,
  onDismiss,
  testId = "commissions-error-banner",
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  testId?: string;
}) {
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between"
      data-testid={testId}
      role="alert"
    >
      <p className="min-w-0">{message}</p>
      <div className="flex shrink-0 gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-red-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800"
          >
            Tentar novamente
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-xs font-medium text-red-700 underline"
          >
            Fechar
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CommissionsSectionIntro({
  title,
  description,
  testId,
}: {
  title: string;
  description: string;
  testId?: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      data-testid={testId}
    >
      <p className="font-semibold text-foreground">{title}</p>
      <p className="mt-1">{description}</p>
    </div>
  );
}

export function CommissionsTableScroll({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-border"
      data-testid={testId}
    >
      <table className="min-w-full divide-y divide-border text-sm">{children}</table>
    </div>
  );
}

export function commissionsTableClassName(): string {
  return "min-w-full divide-y divide-border text-sm";
}

export function CommissionsSummaryGrid({
  items,
}: {
  items: Array<{ label: string; value: string; hint?: string }>;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {item.label}
          </p>
          <p className="mt-1 text-xl font-bold text-foreground">{item.value}</p>
          {item.hint ? <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}
