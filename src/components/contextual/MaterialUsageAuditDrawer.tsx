import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP,
  MATERIAL_USAGE_AUDIT_DIFFERENCE_BRIDGE_TITLE,
  MATERIAL_USAGE_AUDIT_DRAWER_TITLE,
  MATERIAL_USAGE_AUDIT_FILTERS_NOTE,
  MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
  MATERIAL_USAGE_AUDIT_LOADING,
  MATERIAL_USAGE_AUDIT_PARTIAL_EMPTY,
  MATERIAL_USAGE_AUDIT_TABS,
  MATERIAL_USAGE_AUDIT_TOOLTIPS,
  MATERIAL_USAGE_PRODUCT_STATUS_LABELS,
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
  subValue,
  tooltip,
}: {
  label: string;
  value: React.ReactNode;
  subValue?: React.ReactNode;
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
      {subValue ? (
        <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">{subValue}</p>
      ) : null}
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
    return (
      <p className="text-sm text-muted-foreground py-4" data-testid={`${testId}-empty`}>
        {emptyMessage}
      </p>
    );
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

function productStatusBadge(status: MaterialUsageAuditPayload["products"][number]["status"]) {
  const label = MATERIAL_USAGE_PRODUCT_STATUS_LABELS[status];
  const cls =
    status === "ok"
      ? "bg-emerald-100 text-emerald-800"
      : status === "partial"
        ? "bg-amber-100 text-amber-900"
        : status === "warning"
          ? "bg-orange-100 text-orange-900"
          : "bg-muted text-muted-foreground";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", cls)}>
      {label}
    </span>
  );
}

function DifferenceBridgeSection({
  audit,
}: {
  audit: MaterialUsageAuditPayload;
}) {
  const unit = audit.material.unit;
  const bridge = audit.differenceBridge;
  const items = [
    {
      key: "notInvoiced",
      label: "Pedidos ainda não faturados",
      value: bridge.notInvoicedOrdersQuantity,
      show: bridge.notInvoicedOrdersQuantity > 0,
    },
    {
      key: "partial",
      label: "Pedidos parcialmente faturados",
      value: bridge.partiallyInvoicedOrdersQuantity,
      show: bridge.partiallyInvoicedOrdersQuantity > 0,
    },
    {
      key: "invoiceLink",
      label: "Divergências de vínculo NF/pedido",
      value: bridge.invoiceLinkWarningQuantity,
      show: bridge.invoiceLinkWarningQuantity > 0,
    },
    {
      key: "missingBom",
      label: "Produto sem BOM",
      value: bridge.missingBomQuantity,
      show: bridge.missingBomQuantity > 0,
    },
    {
      key: "missingCost",
      label: "Matéria-prima sem custo",
      value: bridge.missingCostQuantity,
      show: bridge.missingCostQuantity > 0,
    },
  ].filter((i) => i.show);

  return (
    <section
      className="rounded-xl border border-border bg-card p-4 space-y-3"
      data-testid="material-usage-audit-difference-bridge"
    >
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {MATERIAL_USAGE_AUDIT_DIFFERENCE_BRIDGE_TITLE}
      </h3>
      <p className="text-sm font-semibold tabular-nums">
        Saldo total: {qty(bridge.totalBalanceQuantity)} {unit}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma categoria de diferença identificada.</p>
      ) : (
        <ul className="space-y-1 text-sm tabular-nums">
          {items.map((item) => (
            <li key={item.key}>
              • {item.label}: {qty(item.value)} {unit}
            </li>
          ))}
        </ul>
      )}
      {!bridge.reconciles ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Diferença não explicada automaticamente: {qty(bridge.unexplainedQuantity)} {unit}
        </p>
      ) : null}
    </section>
  );
}

function AuditDrawerBody({
  audit,
  activeTab,
}: {
  audit: MaterialUsageAuditPayload;
  activeTab: AuditTabId;
}) {
  const unit = audit.material.unit;
  const summary = audit.summary;

  if (activeTab === "summary") {
    return (
      <div className="space-y-4" data-testid="material-usage-audit-tab-summary">
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div
            className="space-y-1 text-sm font-medium tabular-nums"
            data-testid="material-usage-audit-summary-equation"
          >
            <p>
              Previsto: {qty(summary.plannedQuantity)} {unit}
            </p>
            <p>− Faturado/Realizado: {qty(summary.realizedQuantity)} {unit}</p>
            <p>= A faturar / Diferença: {qty(summary.pendingQuantity)} {unit}</p>
          </div>
          <div
            className="space-y-1 text-sm font-medium tabular-nums border-t border-border pt-3"
            data-testid="material-usage-audit-cost-equation"
          >
            <p>Custo previsto: {money(summary.plannedCost)}</p>
            <p>− Custo faturado: {money(summary.realizedCost)}</p>
            <p>= Diferença: {money(summary.costDifference)}</p>
          </div>
          <div className="text-sm text-muted-foreground border-t border-border pt-3 space-y-1">
            <p>Pedidos previstos: {summary.plannedOrdersCount}</p>
            <p>Pedidos faturados: {summary.realizedOrdersCount}</p>
            <p>Pedidos não faturados: {summary.notInvoicedOrdersCount}</p>
            {summary.partiallyInvoicedOrdersCount > 0 ? (
              <p>Pedidos parcialmente faturados: {summary.partiallyInvoicedOrdersCount}</p>
            ) : null}
          </div>
          <p className="text-sm text-foreground leading-snug">{summary.costDifferenceExplanation}</p>
          <p className="text-xs text-muted-foreground leading-snug">{MATERIAL_USAGE_AUDIT_FISCAL_NOTE}</p>
        </section>
        <DifferenceBridgeSection audit={audit} />
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
          { key: "desc", label: "Produto" },
          { key: "plannedProd", label: "Qtd prev.", align: "right" },
          { key: "realizedProd", label: "Qtd fat.", align: "right" },
          { key: "pendingProd", label: "Qtd a fat.", align: "right" },
          { key: "plannedMp", label: "MP prev.", align: "right" },
          { key: "realizedMp", label: "MP fat.", align: "right" },
          { key: "pendingMp", label: "MP a fat.", align: "right" },
          { key: "plannedCost", label: "Custo prev.", align: "right" },
          { key: "realizedCost", label: "Custo fat.", align: "right" },
          { key: "costDiff", label: "Dif. R$", align: "right" },
          { key: "plannedOrd", label: "Ped. prev.", align: "right" },
          { key: "realizedOrd", label: "Ped. fat.", align: "right" },
          { key: "notInvOrd", label: "Ped. não fat.", align: "right" },
          { key: "status", label: "Status" },
        ]}
        rows={audit.products.map((p) => ({
          code: p.productCode ?? "—",
          desc: p.productDescription,
          plannedProd: qty(p.plannedProductQuantity),
          realizedProd: qty(p.realizedProductQuantity),
          pendingProd: qty(p.pendingProductQuantity),
          plannedMp: qty(p.plannedMaterialQuantity),
          realizedMp: qty(p.realizedMaterialQuantity),
          pendingMp: qty(p.pendingMaterialQuantity),
          plannedCost: money(p.plannedCost),
          realizedCost: money(p.realizedCost),
          costDiff: money(p.costDifference),
          plannedOrd: p.plannedOrdersCount,
          realizedOrd: p.realizedOrdersCount,
          notInvOrd: p.notInvoicedOrdersCount,
          status: productStatusBadge(p.status),
        }))}
      />
    );
  }

  if (activeTab === "notInvoicedOrders") {
    const pendingQty = audit.differenceBridge.notInvoicedOrdersQuantity;
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" data-testid="material-usage-audit-not-invoiced-summary">
          {summary.notInvoicedOrdersCount} pedido(s) ainda não faturado(s) representam{" "}
          {qty(pendingQty)} {unit} da diferença.
        </p>
        <AuditTable
          testId="material-usage-audit-not-invoiced-orders"
          emptyMessage="Nenhum pedido não faturado encontrado."
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
            { key: "days", label: "Dias", align: "right" },
            { key: "delivery", label: "Entrega" },
          ]}
          rows={audit.notInvoicedOrders.map((o) => ({
            order: o.salesOrderNumber,
            customer: o.customerName,
            date: formatDatePtBr(o.issueDate),
            product: o.productCode ? `[${o.productCode}] ${o.productDescription}` : o.productDescription,
            qty: qty(o.orderedQuantity),
            factor: qty(o.materialFactor),
            plannedMp: qty(o.plannedMaterialQuantity),
            cost: money(o.plannedCost),
            status: o.orderStatus,
            days: o.daysOpen ?? "—",
            delivery: o.expectedDeliveryDate ? formatDatePtBr(o.expectedDeliveryDate) : "—",
          }))}
        />
      </div>
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

  if (activeTab === "partiallyInvoicedOrders") {
    return (
      <AuditTable
        testId="material-usage-audit-partial-orders"
        emptyMessage={MATERIAL_USAGE_AUDIT_PARTIAL_EMPTY}
        columns={[
          { key: "order", label: "Pedido" },
          { key: "customer", label: "Cliente" },
          { key: "product", label: "Produto" },
          { key: "ordered", label: "Qtd pedida", align: "right" },
          { key: "invoiced", label: "Qtd fat.", align: "right" },
          { key: "pending", label: "Qtd pend.", align: "right" },
          { key: "plannedMp", label: "MP prev.", align: "right" },
          { key: "realizedMp", label: "MP real.", align: "right" },
          { key: "pendingMp", label: "MP pend.", align: "right" },
          { key: "nf", label: "NF" },
        ]}
        rows={audit.partiallyInvoicedOrders.map((o) => ({
          order: o.salesOrderNumber,
          customer: o.customerName,
          product: o.productCode ? `[${o.productCode}] ${o.productDescription}` : o.productDescription,
          ordered: qty(o.orderedQuantity),
          invoiced: qty(o.invoicedQuantity),
          pending: qty(o.pendingQuantity),
          plannedMp: qty(o.plannedMaterialQuantity),
          realizedMp: qty(o.realizedMaterialQuantity),
          pendingMp: qty(o.pendingMaterialQuantity),
          nf: o.invoices.length > 0 ? o.invoices.join(", ") : "—",
        }))}
      />
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

  const kpiSummary = useMemo(() => {
    const s = audit?.summary;
    return {
      plannedQuantity: s?.plannedQuantity ?? previewRow?.plannedQuantity ?? 0,
      realizedQuantity: s?.realizedQuantity ?? previewRow?.realizedQuantity ?? 0,
      pendingQuantity: s?.pendingQuantity ?? previewRow?.remainingQuantity ?? 0,
      partialQuantity: s?.partialQuantity ?? 0,
      accuracyPercent: s?.accuracyPercent ?? previewRow?.accuracyPercent ?? null,
      plannedCost: s?.plannedCost ?? previewRow?.plannedCost ?? 0,
      realizedCost: s?.realizedCost ?? previewRow?.realizedCost ?? 0,
      pendingCost: s?.pendingCost ?? (previewRow ? previewRow.plannedCost - previewRow.realizedCost : 0),
      costDifference: s?.costDifference ?? previewRow?.costVariance ?? 0,
    };
  }, [audit, previewRow]);

  if (!open || !materialId) return null;

  const subtitle = previewRow
    ? `${previewRow.materialCode ?? materialId} · ${previewRow.materialName}`
    : audit
      ? `${audit.material.code ?? materialId} · ${audit.material.description}`
      : materialId;

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
            subValue={money(kpiSummary.plannedCost)}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.planned}
          />
          <SummaryCard
            label="Faturado"
            value={`${qty(kpiSummary.realizedQuantity)} ${unitLabel}`.trim()}
            subValue={money(kpiSummary.realizedCost)}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.invoiced}
          />
          <SummaryCard
            label="A faturar"
            value={`${qty(kpiSummary.pendingQuantity)} ${unitLabel}`.trim()}
            subValue={money(kpiSummary.pendingCost)}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.pending}
          />
          <SummaryCard
            label="Parcial"
            value={`${qty(kpiSummary.partialQuantity)} ${unitLabel}`.trim()}
            tooltip={MATERIAL_USAGE_AUDIT_TOOLTIPS.partial}
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
            <AuditDrawerBody audit={audit} activeTab={activeTab} />
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
