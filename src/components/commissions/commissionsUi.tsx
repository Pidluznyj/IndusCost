import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { HttpError } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
  type SystemTotalizerTone,
} from "@/src/components/ui/SystemTotalizerCard";

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
  tableClassName,
}: {
  children: React.ReactNode;
  testId?: string;
  /** Classes extras na `<table>` (ex.: `table-fixed` em grids densos). */
  tableClassName?: string;
}) {
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [innerWidth, setInnerWidth] = useState(0);
  const syncing = useRef(false);

  /* Observa mudanças na largura real do conteúdo para dimensionar a barra superior. */
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const update = () => setInnerWidth(el.scrollWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    /* Quando filhos mudam (ex.: re-render de tabela) o scrollWidth pode mudar sem
       resize do container — MutationObserver cobre esse caso. */
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [children]);

  const syncScroll = useCallback((source: "top" | "bottom") => {
    if (syncing.current) return;
    syncing.current = true;
    const from = source === "top" ? topRef.current : bottomRef.current;
    const to = source === "top" ? bottomRef.current : topRef.current;
    if (from && to) to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => { syncing.current = false; });
  }, []);

  /* A barra de topo só aparece quando há overflow real. */
  const showTopBar = bottomRef.current
    ? innerWidth > bottomRef.current.clientWidth
    : innerWidth > 0;

  return (
    <div data-testid={testId}>
      {/* Barra de rolagem superior — espelho discreto */}
      {showTopBar ? (
        <div
          ref={topRef}
          onScroll={() => syncScroll("top")}
          className="overflow-x-auto"
          style={{
            height: 10,
            scrollbarWidth: "thin",
            scrollbarColor: "#b0b8c4 transparent",
          }}
          aria-hidden
        >
          <div style={{ width: innerWidth, height: 1 }} />
        </div>
      ) : null}
      {/* Container real de rolagem */}
      <div
        ref={bottomRef}
        onScroll={() => syncScroll("bottom")}
        className="overflow-x-auto rounded-xl border border-border"
      >
        <table
          className={cn(
            "min-w-full divide-y divide-border text-sm",
            tableClassName
          )}
        >
          {children}
        </table>
      </div>
    </div>
  );
}

export function commissionsTableClassName(): string {
  return "min-w-full divide-y divide-border text-sm";
}

/** Bloco executivo de KPI — padrão Cards Totalizadores Executivos. */
export function CommissionsKpiSection({
  title,
  eyebrow,
  children,
  testId,
  className,
  minColumnWidth = 200,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  testId?: string;
  className?: string;
  minColumnWidth?: number;
}) {
  return (
    <ExecutiveSummarySection
      title={title}
      eyebrow={eyebrow}
      testId={testId ?? "commissions-kpi-summary"}
      className={className}
    >
      <SummaryKpiGrid
        minColumnWidth={minColumnWidth}
        testId={testId ? `${testId}-grid` : undefined}
        className={SYSTEM_TOTALIZER_GRID_CLASS}
      >
        {children}
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}

export function CommissionsSummaryGrid({
  title,
  eyebrow,
  items,
  testId,
}: {
  title?: string;
  eyebrow?: string;
  items: Array<{
    label: string;
    value: string;
    hint?: string;
    valueTitle?: string;
    tone?: SystemTotalizerTone;
  }>;
  testId?: string;
}) {
  const cards = items.map((item) => (
    <SystemTotalizerCard
      key={item.label}
      className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
      label={item.label}
      value={item.value}
      valueTitle={item.valueTitle}
      helperText={item.hint}
      tone={item.tone}
    />
  ));

  if (title) {
    return (
      <CommissionsKpiSection title={title} eyebrow={eyebrow} testId={testId}>
        {cards}
      </CommissionsKpiSection>
    );
  }

  return (
    <SummaryKpiGrid className={SYSTEM_TOTALIZER_GRID_CLASS} testId={testId}>
      {cards}
    </SummaryKpiGrid>
  );
}
