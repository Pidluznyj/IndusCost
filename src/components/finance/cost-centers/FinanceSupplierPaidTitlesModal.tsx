import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import { buildFinanceCostCentersDashboardQuery } from "@/src/lib/financeCostCentersPageTypes";
import type {
  CostCenterSupplierPaymentTitleRow,
  CostCenterSupplierPaymentTitlesPayload,
} from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import { COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import type { SupplierGridRow } from "@/src/lib/financeCostCenterGridKit";
import { FinanceApTitleReclassifyModal } from "@/src/components/finance/cost-centers/FinanceApTitleReclassifyModal";
import { ExecutiveAlertBadge } from "@/src/components/ui/ExecutiveAlert";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";

type Props = {
  open: boolean;
  supplier: SupplierGridRow | null;
  filters: FinanceCostCentersUiFilters;
  canReclassify: boolean;
  onClose: () => void;
};

function buildPaidTitlesQuery(
  filters: FinanceCostCentersUiFilters,
  supplier: SupplierGridRow,
  extra: Record<string, string | number | undefined> = {}
): string {
  const base = buildFinanceCostCentersDashboardQuery(filters);
  const q = new URLSearchParams(base);
  q.set("supplierKey", supplier.supplierKey);
  q.set("supplierDisplayName", supplier.name);
  if (filters.year != null) q.set("year", String(filters.year));
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") continue;
    q.set(key, String(value));
  }
  return q.toString();
}

export function FinanceSupplierPaidTitlesModal({
  open,
  supplier,
  filters,
  canReclassify,
  onClose,
}: Props) {
  const portalContainer = usePortalContainer();
  const [payload, setPayload] = useState<CostCenterSupplierPaymentTitlesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [reclassifyTitle, setReclassifyTitle] =
    useState<CostCenterSupplierPaymentTitleRow | null>(null);

  const year = filters.year ?? new Date().getFullYear();

  const loadTitles = useCallback(
    async (nextPage: number, nextSearch: string) => {
      if (!supplier) return;
      setLoading(true);
      setError(null);
      try {
        const qs = buildPaidTitlesQuery(filters, supplier, {
          year,
          page: nextPage,
          pageSize: 50,
          search: nextSearch || undefined,
        });
        const data = await fetchJsonOk<CostCenterSupplierPaymentTitlesPayload>(
          `/api/finance/cost-centers/supplier-payment-titles?${qs}`,
          { credentials: "include" }
        );
        setPayload(data);
      } catch (e) {
        setError(buildFinanceTabLoadError("Não foi possível carregar títulos pagos.", e));
        setPayload(null);
      } finally {
        setLoading(false);
      }
    },
    [filters, supplier, year]
  );

  useEffect(() => {
    if (!open || !supplier) {
      setPayload(null);
      setError(null);
      setPage(1);
      setSearch("");
      setSearchDraft("");
      return;
    }
    void loadTitles(1, "");
  }, [open, supplier, loadTitles]);

  const periodSummary = useMemo(() => {
    if (!payload) return null;
    return `${payload.periodLabel} · ${payload.paidTitlesCount} título(s) · ${formatFinanceCurrency(payload.totalPaidAmount)}`;
  }, [payload]);

  const showPanel = Boolean(open && supplier && portalContainer);

  return (
    <>
      {showPanel && supplier && portalContainer
        ? createPortal(
    <div className="fixed inset-0 z-[75] flex">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label="Fechar modal"
        onClick={onClose}
      />
      <div
        className={cn(
          financeBiCardClass,
          "relative ml-auto flex h-full w-full max-w-6xl flex-col overflow-hidden shadow-2xl"
        )}
        data-testid="finance-supplier-paid-titles-modal"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold truncate">
              Títulos pagos — {supplier.name}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Lista de títulos pagos vinculados a este fornecedor no período/filtro selecionado.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {payload?.periodScopeNote ??
                "Somente leitura — não altera classificação nem dados do Contas a Pagar."}
            </p>
          </div>
          <button type="button" className="rounded-lg border p-2" onClick={onClose} aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border/80 bg-muted/20 px-5 py-3 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-muted-foreground">Fornecedor:</span>{" "}
              <span className="font-semibold">{supplier.name}</span>
            </span>
            <span>
              <span className="text-muted-foreground">Documento:</span>{" "}
              {supplier.document ?? payload?.supplierDocument ?? "—"}
            </span>
            <span>
              <span className="text-muted-foreground">Centro padrão:</span> {supplier.costCenterName}
            </span>
            <span>
              <span className="text-muted-foreground">Regra:</span> {supplier.ruleStatus}
            </span>
          </div>
          {periodSummary ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Período: <span className="font-semibold text-foreground">{periodSummary}</span>
            </p>
          ) : null}
          <p className="mt-1 text-[11px] text-muted-foreground" title={COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE}>
            {COST_CENTER_SUPPLIER_PAYMENT_DATE_RULE_NOTE}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error ? (
            <FinanceModuleErrorBanner
              message={error}
              onRetry={() => void loadTitles(page, search)}
              onDismiss={() => setError(null)}
            />
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <FinanceCostCenterGridSearchBar
              value={searchDraft}
              onChange={setSearchDraft}
              placeholder="Buscar documento, descrição, NF…"
              testId="finance-supplier-paid-titles-search"
            />
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm font-semibold"
              onClick={() => {
                setSearch(searchDraft);
                setPage(1);
                void loadTitles(1, searchDraft);
              }}
            >
              Buscar
            </button>
          </div>

          {loading ? <FinanceModuleLoadingBlock label="Carregando títulos pagos…" /> : null}

          {!loading && payload && payload.items.length === 0 ? (
            <FinanceModuleEmptyState
              title="Nenhum título pago encontrado"
              description="Nenhum título pago encontrado para este fornecedor no filtro atual."
            />
          ) : null}

          {!loading && payload && payload.items.length > 0 ? (
            <FinanceCostCenterGridTableShell
              tableClassName="min-w-[1100px]"
              head={
                <tr className="border-b border-border text-left text-[10px] uppercase text-muted-foreground">
                  <th className="px-3 py-2">Documento</th>
                  <th className="px-3 py-2">Emissão</th>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2">Pagamento</th>
                  <th className="px-3 py-2">Baixa oper.</th>
                  <th className="px-3 py-2 text-right">Valor pago</th>
                  <th className="px-3 py-2">Centro de custo</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 min-w-[14rem]">Descrição / comentário</th>
                  {canReclassify ? <th className="px-3 py-2">Ações</th> : null}
                </tr>
              }
              footer={
                <FinanceCostCenterGridPagination
                  page={payload.page}
                  totalPages={payload.totalPages}
                  pageSize={payload.pageSize}
                  onPageChange={(nextPage) => {
                    setPage(nextPage);
                    void loadTitles(nextPage, search);
                  }}
                  onPageSizeChange={() => undefined}
                />
              }
            >
              {payload.items.map((row) => (
                <tr key={row.accountsPayableId} className="border-b border-border/60 text-xs align-top">
                  <td className="px-3 py-2">
                    {row.documentNumber ?? row.accountsPayableId}
                    {row.sourceInvoiceNumber || row.sourceInvoiceId ? (
                      <p className="text-[10px] text-muted-foreground">
                        NF {row.sourceInvoiceNumber ?? row.sourceInvoiceId}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">{formatFinanceDate(row.issueDate)}</td>
                  <td className="px-3 py-2">{formatFinanceDate(row.dueDate)}</td>
                  <td className="px-3 py-2">{formatFinanceDate(row.paymentDate)}</td>
                  <td className="px-3 py-2">{formatFinanceDate(row.operationalPaymentDate)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {formatFinanceCurrency(row.paidAmount)}
                  </td>
                  <td className="px-3 py-2" title={row.costCenterCode ?? undefined}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{row.costCenterName}</span>
                      {row.isManualClassification ? (
                        <ExecutiveAlertBadge variant="attention" className="text-[9px]">
                          Manual
                        </ExecutiveAlertBadge>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">{row.statusLabel}</td>
                  <td className="px-3 py-2 max-w-[20rem]">
                    <p className="line-clamp-3 whitespace-pre-wrap" title={row.descriptiveText}>
                      {row.descriptiveText}
                    </p>
                  </td>
                  {canReclassify ? (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        data-testid="finance-supplier-paid-title-reclassify-button"
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => setReclassifyTitle(row)}
                      >
                        Reclassificar
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </FinanceCostCenterGridTableShell>
          ) : null}
        </div>
      </div>
    </div>,
    portalContainer
          )
        : null}
      <FinanceApTitleReclassifyModal
        open={Boolean(open && supplier && reclassifyTitle)}
        titleRow={reclassifyTitle}
        supplierName={supplier?.name ?? ""}
        onClose={() => setReclassifyTitle(null)}
        onSaved={() => {
          if (supplier) void loadTitles(page, search);
        }}
      />
    </>
  );
}
