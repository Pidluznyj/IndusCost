import React from "react";
import { cn } from "@/src/lib/utils";

const CONFIDENCE_CLASS: Record<string, string> = {
  HIGH: "bg-emerald-100 text-emerald-900 border-emerald-200",
  MEDIUM: "bg-amber-100 text-amber-900 border-amber-200",
  LOW: "bg-orange-100 text-orange-900 border-orange-200",
  BLOCKED: "bg-red-100 text-red-900 border-red-200",
};

const STATUS_CLASS: Record<string, string> = {
  FULLY_ALLOCATED: "bg-emerald-100 text-emerald-900 border-emerald-200",
  ITEM_ALLOCATED: "bg-emerald-50 text-emerald-900 border-emerald-200",
  RECEIVED: "bg-emerald-100 text-emerald-900 border-emerald-200",
  RECEIVABLE_CONFIRMED: "bg-green-100 text-green-900 border-green-200",
  PARTIALLY_ALLOCATED: "bg-amber-100 text-amber-900 border-amber-200",
  STOCK_DOCUMENT_ITEMIZED: "bg-sky-100 text-sky-900 border-sky-200",
  ORDER_ONLY: "bg-orange-100 text-orange-900 border-orange-200",
  HEADER_ONLY_LINK: "bg-orange-100 text-orange-900 border-orange-200",
  PRICE_MISMATCH: "bg-red-100 text-red-900 border-red-200",
  QUANTITY_SURPLUS_IN_NFE: "bg-red-100 text-red-900 border-red-200",
  OVER_LINKED_BY_HEADER: "bg-red-100 text-red-900 border-red-200",
  DATA_QUALITY_ISSUE: "bg-red-100 text-red-900 border-red-200",
  AMBIGUOUS_ALLOCATION: "bg-red-100 text-red-900 border-red-200",
};

const STATUS_LABELS: Record<string, string> = {
  ORDER_ONLY: "Só pedido",
  HEADER_ONLY_LINK: "NF só cabeçalho",
  STOCK_DOCUMENT_ITEMIZED: "Doc. estoque",
  ITEM_ALLOCATED: "Item alocado",
  PARTIALLY_ALLOCATED: "Parcial",
  FULLY_ALLOCATED: "Totalmente alocado",
  OVER_LINKED_BY_HEADER: "Sobrevinculado",
  PRICE_MISMATCH: "Divergência de preço",
  QUANTITY_SURPLUS_IN_NFE: "Excedente NF",
  RECEIVABLE_CONFIRMED: "CR confirmado",
  RECEIVED: "Recebido",
  DATA_QUALITY_ISSUE: "Qualidade de dados",
  AMBIGUOUS_ALLOCATION: "Alocação ambígua",
};

const FORECAST_LABELS: Record<string, string> = {
  RECEIVABLE: "Contas a receber",
  NFE: "NF",
  ORDER: "Pedido",
  UNRESOLVED: "Não resolvida",
};

function softBadgeClass(extra?: string): string {
  return cn(
    "inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-tight",
    extra
  );
}

export function portfolioConfidenceBadgeClass(level: string): string {
  return CONFIDENCE_CLASS[level.toUpperCase()] ?? "bg-slate-100 text-slate-700 border-slate-200";
}

export function portfolioStatusBadgeClass(status: string): string {
  return STATUS_CLASS[status] ?? "bg-slate-100 text-slate-700 border-slate-200";
}

export function formatPortfolioStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatPortfolioForecastSourceLabel(source: string): string {
  return FORECAST_LABELS[source.toUpperCase()] ?? source;
}

export function PortfolioConfidenceBadge({ level }: { level: string }) {
  const normalized = level.toUpperCase();
  return (
    <span
      className={softBadgeClass(portfolioConfidenceBadgeClass(normalized))}
      title={`Confiança: ${normalized}`}
      data-testid="portfolio-confidence-badge"
    >
      {normalized}
    </span>
  );
}

export function PortfolioStatusBadge({ status }: { status: string }) {
  const label = formatPortfolioStatusLabel(status);
  return (
    <span
      className={softBadgeClass(portfolioStatusBadgeClass(status))}
      title={label}
      data-testid="portfolio-status-badge"
    >
      <span className="truncate">{label}</span>
    </span>
  );
}

export function PortfolioAlertsInline({ alerts }: { alerts: string[] }) {
  if (!alerts.length) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const visible = alerts.slice(0, 2);
  const rest = alerts.length - visible.length;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="portfolio-alerts-inline">
      {visible.map((alert) => (
        <span
          key={alert}
          className={softBadgeClass("bg-amber-50 text-amber-950 border-amber-200")}
        >
          <span className="truncate">{alert}</span>
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-[11px] font-medium text-muted-foreground">
          +{rest} alerta{rest > 1 ? "s" : ""}
        </span>
      ) : null}
    </div>
  );
}
