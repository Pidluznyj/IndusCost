import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP,
  MATERIAL_USAGE_AUDIT_DRAWER_TITLE,
  MATERIAL_USAGE_AUDIT_FILTERS_NOTE,
  MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
  MATERIAL_USAGE_AUDIT_LOADING,
  MATERIAL_USAGE_AUDIT_TABS,
  MATERIAL_USAGE_AUDIT_TOOLTIPS,
} from "@/src/lib/materialDemandPlannedRealizedAuditCopy";
import { materialDemandUiFiltersToQueryParams, type MaterialDemandUiFilters } from "@/src/lib/materialDemandFilters";
import type {
  MaterialUsageAuditPayload,
  MaterialUsageAuditResponse,
  MaterialUsagePlannedRealizedRow,
} from "@/src/lib/materialDemandPlannedRealizedTypes";
import { formatDatePtBr } from "@/src/components/contextual/materialDemandDashboardUi";
import { cn, formatNumberAdaptive } from "@/src/lib/utils";
import "@/src/styles/material-usage-audit.css";

type AuditTabId = keyof typeof MATERIAL_USAGE_AUDIT_TABS;

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${formatNumberAdaptive(v)}%`;
}

function SummaryCard({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  tooltip: string;
}) {
  return (
    <div
      className="material-usage-audit-kpi rounded-lg border border-border bg-muted/30 px-3 py-2"
      title={tooltip}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
        {label}
        <Info className="h-3 w-3 opacity-60" aria-hidden />
      </p>
      <p className="text-sm font-semibold tabular-nums text-foreground mt-0.5">{value}</p>
    </div>
  );
}

function AuditTable({
  testId,
  columns,
  rows,
  emptyMessage,
}: {
  testId: string;
  columns: Array<{ key: string; label: string; align?: "left" | "right" }>;
  rows: Array<Record<string, React.ReactNode>>;
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border" data-testid={testId}>
      <table className="w-full min-w-[720px] text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left uppercase tracking-wide text-muted-foreground">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn("px-2 py-2 font-semibold", col.align === "right" && "text-right")}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b border-border/60 hover:bg-muted/20">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-2 py-2 text-foreground",
                    col.align === "right" && "text-right tabular-nums"
                  )}
                >
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditDrawerBody({
  audit,
  previewRow,
  activeTab,
}: {
  audit: MaterialUsageAuditPayload;
  previewRow: MaterialUsagePlannedRealizedRow | null;
  activeTab: AuditTabId;
}) {
  const unit = audit.material.unit;
  const summary = audit.summary;
  const rowFallback = previewRow;

  const displaySummary = useMemo(
    () => ({
      plannedQuantity: summary.plannedQuantity ?? rowFallback?.plannedQuantity ?? 0,
      realizedQuantity: summary.realizedQuantity ?? rowFallback?.realizedQuantity ?? 0,
      balanceQuantity: summary.balanceQuantity ?? rowFallback?.remainingQuantity ?? 0,
      accuracyPercent: summary.accuracyPercent ?? rowFallback?.accuracyPercent ?? null,
      unitCost: summary.unitCost ?? rowFallback?.unitCost ?? null,
      plannedCost: summary.plannedCost ?? rowFallback?.plannedCost ?? 0,
      realizedCost: summary.realizedCost ?? rowFallback?.realizedCost ?? 0,
      costDifference: summary.costDifference ?? rowFallback?.costVariance ?? 0,
      plannedOrdersCount: summary.plannedOrdersCount ?? rowFallback?.plannedOrdersCount ?? 0,
      realizedOrdersCount: summary.realizedOrdersCount ?? rowFallback?.realizedOrdersCount ?? 0,
      pendingOrdersCount: summary.pendingOrdersCount,
      costDifferenceExplanation: summary.costDifferenceExplanation,
    }),
    [summary, rowFallback]
  );

  if (activeTab === "summary") {
    return (
      <div className="space-y-4" data-testid="material-usage-audit-tab-summary">
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {MATERIAL_USAGE_AUDIT_TABS.summary}
          </h3>
          <div className="space-y-1 text-sm font-medium tabular-nums" data-testid="material-usage-audit-summary-equation">
            <p>
              Previsto: {qty(displaySummary.plannedQuantity)} {unit}
            </p>
            <p>− Realizado: {qty(displaySummary.realizedQuantity)} {unit}</p>
            <p>= Saldo: {qty(displaySummary.balanceQuantity)} {unit}</p>
          </div>
          <div
            className="space-y-1 text-sm font-medium tabular-nums border-t border-border pt-3"
            data-testid="material-usage-audit-cost-equation"
          >
            <p>Custo previsto: {money(displaySummary.plannedCost)}</p>
            <p>− Custo realizado: {money(displaySummary.realizedCost)}</p>
            <p>= Diferença: {money(displaySummary.costDifference)}</p>
          </div>
          <div className="text-sm text-muted-foreground border-t border-border pt-3 space-y-1">
            <p>Pedidos previstos: {displaySummary.plannedOrdersCount}</p>
            <p>Pedidos faturados: {displaySummary.realizedOrdersCount}</p>
            <p>Pedidos ainda não faturados: {displaySummary.pendingOrdersCount}</p>
          </div>
          <p className="text-sm text-foreground leading-snug">{displaySummary.costDifferenceExplanation}</p>
          <p className="text-xs text-muted-foreground leading-snug">{MATERIAL_USAGE_AUDIT_FISCAL_NOTE}</p>
        </section>
      </div>
    );
  }

  if (activeTab === "products") {
    return (
      <AuditTable
        testId="material-usage-audit-products-table"
        emptyMessage="Nenhum produto relacionado encontrado."
        columns={[
          { key: "code", label: "Código" },
          { key: "desc", label: "Descrição" },
          { key: "unit", label: "Un. vendida" },
          { key: "plannedProd", label: "Qtd prev.", align: "right" },
          { key: "realizedProd", label: "Qtd fat.", align: "right" },
          { key: "factor", label: "Fator MP", align: "right" },
          { key: "plannedMp", label: "Cons. prev.", align: "right" },
          { key: "realizedMp", label: "Cons. real.", align: "right" },
          { key: "balanceMp", label: "Dif. MP", align: "right" },
          { key: "plannedCost", label: "Custo prev.", align: "right" },
          { key: "realizedCost", label: "Custo real.", align: "right" },
          { key: "costDiff", label: "Dif. R$", align: "right" },
          { key: "plannedOrd", label: "Ped. prev.", align: "right" },
          { key: "realizedOrd", label: "Ped. fat.", align: "right" },
        ]}
        rows={audit.products.map((p) => ({
          code: p.productCode ?? "—",
          desc: p.productDescription,
          unit: p.productSoldUnit ?? "—",
          plannedProd: qty(p.plannedProductQuantity),
          realizedProd: qty(p.realizedProductQuantity),
          factor: qty(p.materialFactor),
          plannedMp: qty(p.plannedMaterialQuantity),
          realizedMp: qty(p.realizedMaterialQuantity),
          balanceMp: qty(p.balanceMaterialQuantity),
          plannedCost: money(p.plannedCost),
          realizedCost: money(p.realizedCost),
          costDiff: money(p.costDifference),
          plannedOrd: p.plannedOrdersCount,
          realizedOrd: p.realizedOrdersCount,
        }))}
      />
    );
  }

  if (activeTab === "plannedOrders") {
    return (
      <AuditTable
        testId="material-usage-audit-planned-orders"
        emptyMessage="Nenhum pedido previsto encontrado."
        columns={[
          { key: "order", label: "Pedido" },
          { key: "customer", label: "Cliente" },
          { key: "date", label: "Data" },
          { key: "product", label: "Produto" },
          { key: "qty", label: "Qtd prod.", align: "right" },
          { key: "factor", label: "Fator MP", align: "right" },
          { key: "plannedMp", label: "Qtd prev. MP", align: "right" },
          { key: "cost", label: "Custo prev.", align: "right" },
          { key: "status", label: "Status" },
          { key: "nf", label: "NF" },
        ]}
        rows={audit.plannedOrders.map((o) => ({
          order: o.salesOrderNumber,
          customer: o.customerName,
          date: formatDatePtBr(o.issueDate),
          product: o.productCode ? `[${o.productCode}] ${o.productDescription}` : o.productDescription,
          qty: qty(o.productQuantity),
          factor: qty(o.materialFactor),
          plannedMp: qty(o.plannedMaterialQuantity),
          cost: money(o.plannedCost),
          status: o.status,
          nf: o.invoiceNumber ?? "—",
        }))}
      />
    );
  }

  if (activeTab === "realizedOrders") {
    return (
      <AuditTable
        testId="material-usage-audit-realized-orders"
        emptyMessage="Nenhum pedido faturado encontrado."
        columns={[
          { key: "order", label: "Pedido" },
          { key: "nf", label: "NF" },
          { key: "customer", label: "Cliente" },
          { key: "date", label: "Faturamento" },
          { key: "product", label: "Produto" },
          { key: "qty", label: "Qtd fat.", align: "right" },
          { key: "factor", label: "Fator MP", align: "right" },
          { key: "realizedMp", label: "Qtd real. MP", align: "right" },
          { key: "cost", label: "Custo real.", align: "right" },
        ]}
        rows={audit.realizedOrders.map((o) => ({
          order: o.salesOrderNumber,
          nf: o.invoiceNumber ?? "—",
          customer: o.customerName,
          date: o.invoiceDate ? formatDatePtBr(o.invoiceDate) : "—",
          product: o.productCode ? `[${o.productCode}] ${o.productDescription}` : o.productDescription,
          qty: qty(o.invoicedProductQuantity),
          factor: qty(o.materialFactor),
          realizedMp: qty(o.realizedMaterialQuantity),
          cost: money(o.realizedCost),
        }))}
      />
    );
  }

  if (activeTab === "variance") {
    return (
      <div className="space-y-2" data-testid="material-usage-audit-variance">
        {audit.productVarianceRanking.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma diferença por produto.</p>
        ) : (
          <ul className="space-y-2">
            {audit.productVarianceRanking.map((p) => (
              <li
                key={p.productId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span className="truncate">
                  {p.productCode ? `[${p.productCode}] ` : ""}
                  {p.productDescription}
                </span>
                <span className="shrink-0 tabular-nums font-semibold">
                  {qty(p.balanceMaterialQuantity)} {unit}
                  <span className="text-muted-foreground font-normal ml-2">
                    ({money(p.costDifference)})
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const hasAlerts = audit.dataQuality.warnings.length > 0;
  return (
    <div className="space-y-3" data-testid="material-usage-audit-alerts">
      {!hasAlerts ? (
        <p className="text-sm text-muted-foreground">Nenhum alerta de qualidade de dados.</p>
      ) : (
        <ul className="space-y-2">
          {audit.dataQuality.warnings.map((w) => (
            <li
              key={w}
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
        {audit.dataQuality.missingCosts > 0 ? (
          <div>Matérias-primas sem custo: {audit.dataQuality.missingCosts}</div>
        ) : null}
        {audit.dataQuality.partialInvoiceFallbacks > 0 ? (
          <div>Fallback faturamento parcial: {audit.dataQuality.partialInvoiceFallbacks}</div>
        ) : null}
        {audit.dataQuality.invoiceLinkWarnings > 0 ? (
          <div>NF sem vínculo claro: {audit.dataQuality.invoiceLinkWarnings}</div>
        ) : null}
      </dl>
    </div>
  );
}

export function MaterialUsageAuditDrawer({
  open,
  onClose,
  apiBase,
  materialId,
  previewRow,
  filters,
}: {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  materialId: string | null;
  previewRow: MaterialUsagePlannedRealizedRow | null;
  filters: MaterialDemandUiFilters;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audit, setAudit] = useState<MaterialUsageAuditPayload | null>(null);
  const [activeTab, setActiveTab] = useState<AuditTabId>("summary");

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !materialId) {
      setAudit(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setActiveTab("summary");
    const qs = materialDemandUiFiltersToQueryParams(filters).toString();
    fetchJsonOk<MaterialUsageAuditResponse>(
      `${apiBase}/planned-vs-realized/materials/${encodeURIComponent(materialId)}/details?${qs}`,
      { signal: ac.signal }
    )
      .then((res) => setAudit(res.audit))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError("Não foi possível carregar a auditoria da matéria-prima.");
        setAudit(null);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [open, materialId, apiBase, filters]);

  if (!open || !materialId) return null;

  const subtitle = previewRow
    ? `${previewRow.materialCode ?? materialId} · ${previewRow.materialName}`
    : audit
      ? `${audit.material.code ?? materialId} · ${audit.material.description}`
      : materialId;

  const summarySource = audit?.summary ?? null;
  const kpiSummary = summarySource ?? {
    plannedQuantity: previewRow?.plannedQuantity ?? 0,
    realizedQuantity: previewRow?.realizedQuantity ?? 0,
    balanceQuantity: previewRow?.remainingQuantity ?? 0,
    accuracyPercent: previewRow?.accuracyPercent ?? null,
    unitCost: previewRow?.unitCost ?? null,
    plannedCost: previewRow?.plannedCost ?? 0,
    realizedCost: previewRow?.realizedCost ?? 0,
    costDifference: previewRow?.costVariance ?? 0,
  };

  const unitLabel = audit?.material.unit ?? previewRow?.unitLabel ?? "";

  const tabIds = Object.keys(MATERIAL_USAGE_AUDIT_TABS) as AuditTabId[];

  return createPortal(
    <div
      className="material-usage-audit-overlay fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      data-testid="material-usage-audit-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={MATERIAL_USAGE_AUDIT_DRAWER_TITLE}
      onClick={onClose}
    >
      <div
        className="material-usage-audit-panel flex h-[92vh] sm:h-full w-full sm:max-w-2xl lg:max-w-4xl flex-col bg-background shadow-xl rounded-t-2xl sm:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3 shrink-0 gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">{MATERIAL_USAGE_AUDIT_DRAWER_TITLE}</h2>
            <p className="text-sm text-muted-foreground truncate mt-0.5">{subtitle}</p>
            <p className="text-[11px] text-muted-foreground mt-1">{MATERIAL_USAGE_AUDIT_FILTERS_NOTE}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted text-muted-foreground shrink-0"
            aria-label="Fechar"
            data-testid="material-usage-audit-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 px-4 py-3 border-b border-border shrink-0">
          <SummaryCard
            label="Previsto"
            value={`${qty(kpiSummary.plannedQuantity)} ${unitLabel}`.trim()}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.planned}
          />
          <SummaryCard
            label="Realizado"
            value={`${qty(kpiSummary.realizedQuantity)} ${unitLabel}`.trim()}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.realized}
          />
          <SummaryCard
            label="Saldo"
            value={`${qty(kpiSummary.balanceQuantity)} ${unitLabel}`.trim()}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.balance}
          />
          <SummaryCard
            label="Assertividade"
            value={pct(kpiSummary.accuracyPercent)}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.accuracy}
          />
          <SummaryCard
            label="Diferença R$"
            value={money(kpiSummary.costDifference)}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.costDifference}
          />
          <SummaryCard
            label="Custo unit."
            value={money(kpiSummary.unitCost)}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.unitCost}
          />
        </div>

        <div
          className="flex gap-1 overflow-x-auto px-4 py-2 border-b border-border shrink-0"
          role="tablist"
          aria-label="Seções da auditoria"
        >
          {tabIds.map((tabId) => (
            <button
              key={tabId}
              type="button"
              role="tab"
              aria-selected={activeTab === tabId}
              className={cn(
                "whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === tabId
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              )}
              onClick={() => setActiveTab(tabId)}
            >
              {MATERIAL_USAGE_AUDIT_TABS[tabId]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div
              className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center"
              data-testid="material-usage-audit-loading"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {MATERIAL_USAGE_AUDIT_LOADING}
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive py-4" data-testid="material-usage-audit-error">
              {error}
            </p>
          ) : null}
          {!loading && !error && audit ? (
            <AuditDrawerBody audit={audit} previewRow={previewRow} activeTab={activeTab} />
          ) : null}
          {!loading && !error && !audit ? (
            <p className="text-sm text-muted-foreground py-4">Nenhum dado de auditoria disponível.</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

export { MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP };
