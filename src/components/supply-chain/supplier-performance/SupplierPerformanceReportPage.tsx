/**
 * OP-26 — Relatório de Desempenho de Fornecedores.
 *
 * Consome a MESMA engine do drawer do fornecedor (`/api/supplier-performance`):
 * nenhuma nota é recalculada no React. CSV e impressão saem da mesma fonte —
 * o CSV é gerado no backend, não a partir da tela visível.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import { canViewFinanceSuppliers } from "@/src/lib/financeCostCentersPermissions";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { FinanceModuleEmptyState } from "@/src/components/finance/shared/FinanceModuleStates";
import { FinanceSupplierAutocomplete } from "@/src/components/finance/cost-centers/FinanceSupplierAutocomplete";
import type { FinanceSupplierSearchResult } from "@/src/lib/financeSupplierCostCenterRules";
import { formatPrintDateTime } from "@/src/lib/printBranding";
import { usePrintRouteBodyClass, triggerBrowserPrint } from "@/src/lib/usePrintDocument";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { fetchJsonOk } from "@/src/lib/http";
import {
  SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET,
  SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
  buildSupplierPerformancePeriodFromPreset,
  formatSupplierCoverage,
  formatSupplierScore,
  parseSupplierPerformanceCivilDateParam,
  type SupplierPerformancePeriod,
  type SupplierPerformanceReportSort,
} from "@/src/lib/purchasing/supplierPerformance";
import {
  buildSupplierPerformanceDetailCsvUrl,
  buildSupplierPerformanceSummaryCsvUrl,
  fetchSupplierPerformanceReport,
  useSupplierPerformanceFeatureEnabled,
  type SupplierPerformanceReportPayload,
} from "@/src/lib/purchasing/supplierPerformanceClient";
import "./supplier-performance-print.css";

const ROUTE_BODY_CLASS = "supplier-performance-print-route";

const SUPPLIER_STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "ACTIVE", label: "Ativo" },
  { value: "NEEDS_REVIEW", label: "Requer revisão" },
  { value: "INACTIVE", label: "Inativo" },
  { value: "MERGED", label: "Mesclado" },
] as const;

const SORT_OPTIONS: Array<{ value: SupplierPerformanceReportSort; label: string }> = [
  { value: "name", label: "Nome do fornecedor" },
  { value: "score", label: "Nota geral" },
  { value: "coverage", label: "Cobertura" },
];

const INPUT =
  "rounded-lg border border-border bg-background p-2 text-sm outline-none focus:ring-2 focus:ring-primary/20";
const LABEL = "text-[10px] font-bold uppercase tracking-wider text-muted-foreground";

type AppliedFilters = {
  period: SupplierPerformancePeriod;
  supplierId: string | null;
  supplierStatus: string | null;
  sort: SupplierPerformanceReportSort;
  includeOrders: boolean;
};

export function SupplierPerformanceReportPage() {
  usePrintRouteBodyClass(ROUTE_BODY_CLASS);
  const auth = useAuth();
  const permissions = usePermissions();
  const featureEnabled = useSupplierPerformanceFeatureEnabled();

  const canViewSuppliers = canViewFinanceSuppliers({
    ...auth,
    canPerformAction: permissions.canPerformAction,
  });
  const canViewPurchases =
    auth.hasPermission("purchases.view") ||
    permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.purchases,
      OPERATIONS_ACTIONS.view
    );

  const defaultPeriod = buildSupplierPerformancePeriodFromPreset(
    SUPPLIER_PERFORMANCE_DEFAULT_PERIOD_PRESET
  );

  // Rascunho × aplicado: a consulta só roda no botão Aplicar.
  const [draftFrom, setDraftFrom] = useState(defaultPeriod.from ?? "");
  const [draftTo, setDraftTo] = useState(defaultPeriod.to ?? "");
  const [draftSupplier, setDraftSupplier] = useState<FinanceSupplierSearchResult | null>(
    null
  );
  const [draftStatus, setDraftStatus] = useState("");
  const [draftSort, setDraftSort] = useState<SupplierPerformanceReportSort>("name");
  const [draftIncludeOrders, setDraftIncludeOrders] = useState(false);
  const [filterError, setFilterError] = useState<string | null>(null);

  const [applied, setApplied] = useState<AppliedFilters>({
    period: defaultPeriod,
    supplierId: null,
    supplierStatus: null,
    sort: "name",
    includeOrders: false,
  });

  const [payload, setPayload] = useState<SupplierPerformanceReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [reloadToken, setReloadToken] = useState(0);

  const allowed = featureEnabled === true && canViewSuppliers && canViewPurchases;

  useEffect(() => {
    if (!allowed) return;
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then((data) => setBranding({ ...DEFAULT_BRANDING, ...data }))
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchSupplierPerformanceReport(
      {
        period: applied.period,
        supplierId: applied.supplierId,
        supplierStatus: applied.supplierStatus,
        sort: applied.sort,
        includeOrders: applied.includeOrders,
      },
      controller.signal
    )
      .then((data) => {
        if (!controller.signal.aborted) setPayload(data);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "Erro ao carregar o relatório.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [allowed, applied, reloadToken]);

  const applyFilters = useCallback(() => {
    const from = parseSupplierPerformanceCivilDateParam(draftFrom);
    const to = parseSupplierPerformanceCivilDateParam(draftTo);
    if ((draftFrom && !from) || (draftTo && !to)) {
      setFilterError("Informe datas válidas.");
      return;
    }
    if (from && to && from > to) {
      setFilterError("A data inicial não pode ser maior que a final.");
      return;
    }
    setFilterError(null);
    setApplied({
      period: { from, to },
      supplierId: draftSupplier?.id ?? null,
      supplierStatus: draftStatus || null,
      sort: draftSort,
      includeOrders: draftIncludeOrders,
    });
  }, [draftFrom, draftTo, draftSupplier, draftStatus, draftSort, draftIncludeOrders]);

  if (featureEnabled === null) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando…
      </div>
    );
  }

  if (!allowed) {
    return (
      <FinanceModuleEmptyState
        title="Desempenho de fornecedores indisponível"
        description="Recurso desligado ou sem permissão de fornecedores e pedidos de compra."
      />
    );
  }

  const csvFilters = {
    period: applied.period,
    supplierId: applied.supplierId,
    supplierStatus: applied.supplierStatus,
    sort: applied.sort,
  };

  return (
    <div className="supplier-performance-print-root p-4" data-testid="supplier-performance-report">
      <div className="supplier-performance-no-print">
        <FinanceExecutivePageHeader
          eyebrow="Financeiro · Fornecedores"
          title="Desempenho dos fornecedores"
          subtitle="Consolidado das avaliações dos Pedidos de Compra por período — metodologia interna da empresa."
          actions={[
            {
              id: "refresh",
              label: "Atualizar",
              onClick: () => setReloadToken((n) => n + 1),
              icon: <RefreshCw className="h-4 w-4" />,
            },
            {
              id: "print",
              label: "Imprimir / PDF",
              onClick: () => triggerBrowserPrint(150),
              icon: <Printer className="h-4 w-4" />,
            },
          ]}
        />
      </div>

      {/* Filtros — consulta só no Aplicar */}
      <div className="supplier-performance-no-print mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <label className="space-y-1">
          <span className={LABEL}>De</span>
          <input
            type="date"
            className={INPUT}
            value={draftFrom}
            onChange={(e) => setDraftFrom(e.target.value)}
            data-testid="supplier-performance-report-from"
          />
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Até</span>
          <input
            type="date"
            className={INPUT}
            value={draftTo}
            onChange={(e) => setDraftTo(e.target.value)}
            data-testid="supplier-performance-report-to"
          />
        </label>
        <div className="min-w-[260px] space-y-1">
          <span className={LABEL}>Fornecedor</span>
          <FinanceSupplierAutocomplete
            selected={draftSupplier}
            onSelect={setDraftSupplier}
            testIdPrefix="supplier-performance-report-supplier"
            placeholder="Todos os fornecedores"
          />
        </div>
        <label className="space-y-1">
          <span className={LABEL}>Status do fornecedor</span>
          <select
            className={INPUT}
            value={draftStatus}
            onChange={(e) => setDraftStatus(e.target.value)}
            data-testid="supplier-performance-report-status"
          >
            {SUPPLIER_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={LABEL}>Ordenar por</span>
          <select
            className={INPUT}
            value={draftSort}
            onChange={(e) => setDraftSort(e.target.value as SupplierPerformanceReportSort)}
            data-testid="supplier-performance-report-sort"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            checked={draftIncludeOrders}
            onChange={(e) => setDraftIncludeOrders(e.target.checked)}
            data-testid="supplier-performance-report-include-orders"
          />
          Incluir detalhe de pedidos
        </label>
        <button
          type="button"
          onClick={applyFilters}
          data-testid="supplier-performance-report-apply"
          className="rounded-lg bg-primary px-5 py-2 text-sm font-bold text-primary-foreground"
        >
          Aplicar
        </button>
        <a
          href={buildSupplierPerformanceSummaryCsvUrl(csvFilters)}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          data-testid="supplier-performance-report-csv"
        >
          <Download className="h-4 w-4" />
          CSV consolidado
        </a>
        <a
          href={buildSupplierPerformanceDetailCsvUrl(csvFilters)}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent"
          data-testid="supplier-performance-report-csv-detail"
        >
          <Download className="h-4 w-4" />
          CSV detalhado
        </a>
      </div>

      {filterError ? (
        <p className="supplier-performance-no-print mb-3 text-sm text-red-800">{filterError}</p>
      ) : null}

      {/* Cabeçalho da impressão */}
      <div className="supplier-performance-print-block mb-4 border-b border-border pb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {branding.companyName}
        </p>
        <h2 className="text-lg font-bold">Relatório de Desempenho de Fornecedores</h2>
        <p className="text-xs text-muted-foreground">
          Período: {applied.period.from ?? "início"} a {applied.period.to ?? "hoje"} · Gerado em{" "}
          {formatPrintDateTime(payload?.generatedAt ?? new Date().toISOString())} · Metodologia
          versão {payload?.methodology?.version ?? 1}
        </p>
      </div>

      {error ? (
        <p className="mb-3 text-sm text-red-800">{error}</p>
      ) : null}

      {loading && !payload ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando relatório…
        </div>
      ) : !payload ? null : payload.rows.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground" data-testid="supplier-performance-report-empty">
          Sem pedidos elegíveis no período selecionado.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Fornecedor</th>
                <th className="p-2 text-right">Pedidos elegíveis</th>
                <th className="p-2 text-right">Avaliados</th>
                <th className="p-2 text-right">Cobertura</th>
                <th className="p-2 text-right">Qualidade</th>
                <th className="p-2 text-right">Prazo</th>
                <th className="p-2 text-right">Conformidade</th>
                <th className="p-2 text-right">Atendimento</th>
                <th className="p-2 text-right">Nota geral</th>
              </tr>
            </thead>
            <tbody data-testid="supplier-performance-report-rows">
              {payload.rows.map((row) => (
                <tr key={row.supplierId} className="border-t border-border/60">
                  <td className="p-2">
                    {row.supplierName}
                    {row.supplierDocument ? (
                      <span className="ml-1 font-mono text-[11px] text-muted-foreground">
                        {row.supplierDocument}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2 text-right tabular-nums">{row.summary.eligibleOrders}</td>
                  <td className="p-2 text-right tabular-nums">{row.summary.evaluatedOrders}</td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierCoverage(row.summary.coverage)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.summary.qualityScore)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.summary.deliveryScore)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.summary.conformityScore)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.summary.serviceScore)}
                  </td>
                  <td className="p-2 text-right font-semibold tabular-nums">
                    {formatSupplierScore(row.summary.overallScore)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/30 font-semibold">
                <td className="p-2">Total do período</td>
                <td className="p-2 text-right tabular-nums">{payload.totals.eligibleOrders}</td>
                <td className="p-2 text-right tabular-nums">{payload.totals.evaluatedOrders}</td>
                <td className="p-2 text-right tabular-nums">
                  {formatSupplierCoverage(payload.totals.coverage)}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatSupplierScore(payload.totals.qualityScore)}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatSupplierScore(payload.totals.deliveryScore)}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatSupplierScore(payload.totals.conformityScore)}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatSupplierScore(payload.totals.serviceScore)}
                </td>
                <td className="p-2 text-right tabular-nums">
                  {formatSupplierScore(payload.totals.overallScore)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Detalhe de pedidos — só quando solicitado na tela */}
      {payload?.orders && payload.orders.length > 0 ? (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
          <h3 className="border-b border-border p-2 text-xs font-bold uppercase text-muted-foreground">
            Detalhe dos pedidos elegíveis
          </h3>
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Fornecedor</th>
                <th className="p-2">Pedido</th>
                <th className="p-2">Data</th>
                <th className="p-2">Status</th>
                <th className="p-2 text-right">Qualidade</th>
                <th className="p-2 text-right">Prazo</th>
                <th className="p-2 text-right">Conformidade</th>
                <th className="p-2 text-right">Atendimento</th>
                <th className="p-2 text-right">Nota</th>
              </tr>
            </thead>
            <tbody data-testid="supplier-performance-report-order-rows">
              {payload.orders.map((row) => (
                <tr key={row.purchaseOrderId} className="border-t border-border/60">
                  <td className="p-2">{row.supplierName}</td>
                  <td className="p-2 font-mono text-xs">{row.purchaseOrderCode}</td>
                  <td className="p-2 tabular-nums">
                    {new Date(row.purchaseOrderDate).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="p-2">{row.purchaseOrderStatus}</td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.qualityScore, 1)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.deliveryScore, 1)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.conformityScore, 1)}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    {formatSupplierScore(row.serviceScore, 1)}
                  </td>
                  <td className="p-2 text-right font-semibold tabular-nums">
                    {formatSupplierScore(row.overallScore)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Metodologia — declarada na tela e na impressão */}
      <section
        className="supplier-performance-print-block mt-6 rounded-2xl border border-border bg-accent/10 p-4"
        data-testid="supplier-performance-methodology"
      >
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Metodologia de avaliação
        </h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {(payload?.methodology?.text ?? SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
