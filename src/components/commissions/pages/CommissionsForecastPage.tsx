import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileWarning,
  Loader2,
  ShoppingCart,
  TrendingUp,
  UserX,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { COMMISSIONS_RECALCULATE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import { getCommissionsSectionPath } from "@/src/lib/commissionsNavigation";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import { formatCommissionStatus } from "@/src/components/commissions/dashboard/commissionsDashboardLabels";
import { commissionStatusClassName } from "@/src/components/commissions/commissionsStatusLabels";
import { CommissionOutOfTableFlag } from "@/src/components/commissions/CommissionOutOfTableBadge";
import type { CommissionsForecastRow } from "@/src/components/commissions/commissionsTypes";
import { CommissionsForecastDetailDrawer } from "@/src/components/commissions/forecast/CommissionsForecastDetailDrawer";
import { CommissionsForecastFiltersPanel } from "@/src/components/commissions/forecast/CommissionsForecastFiltersPanel";
import {
  EMPTY_COMMISSIONS_FORECAST_FILTERS,
  resolveCommissionsForecastRecalculatePeriod,
  type CommissionsForecastFilters,
} from "@/src/components/commissions/forecast/commissionsForecastFilters";
import {
  useCommissionsForecastData,
  useCommissionsForecastDetail,
} from "@/src/components/commissions/forecast/useCommissionsForecastData";
import { formatCommissionSellerLabel } from "@/src/components/commissions/commissionSellerUi";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function ForecastRowActions({
  row,
  canRecalculate,
  onOpenDetail,
  onRecalculate,
  recalculatingKey,
}: {
  row: CommissionsForecastRow;
  canRecalculate: boolean;
  onOpenDetail: () => void;
  onRecalculate: () => void;
  recalculatingKey: string | null;
}) {
  const busy = recalculatingKey === row.orderKey;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button
        type="button"
        onClick={onOpenDetail}
        className="rounded px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
      >
        Detalhe
      </button>
      {row.localOrderId ? (
        <Link
          to={`/sales-orders/${row.localOrderId}`}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6]"
        >
          <ExternalLink className="h-3 w-3" />
          Pedido
        </Link>
      ) : null}
      <Link
        to={getCommissionsSectionPath("audit")}
        className="rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6]"
      >
        Auditoria
      </Link>
      {canRecalculate ? (
        <button
          type="button"
          disabled={busy}
          onClick={onRecalculate}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Recalcular
        </button>
      ) : null}
    </div>
  );
}

export function CommissionsForecastPage() {
  const auth = useAuth();
  const canRecalculate = auth.hasAnyPermission([...COMMISSIONS_RECALCULATE_PERMISSIONS]);

  const [draftFilters, setDraftFilters] = useState<CommissionsForecastFilters>(
    EMPTY_COMMISSIONS_FORECAST_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsForecastFilters>(
    EMPTY_COMMISSIONS_FORECAST_FILTERS
  );
  const [selectedOrderKey, setSelectedOrderKey] = useState<string | null>(null);
  const [recalculatingKey, setRecalculatingKey] = useState<string | null>(null);
  const [recalculateError, setRecalculateError] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsForecastData(appliedFilters);
  const detailState = useCommissionsForecastDetail(selectedOrderKey, appliedFilters);

  async function handleRecalculateRow(row: CommissionsForecastRow) {
    if (!canRecalculate) return;
    const period = resolveCommissionsForecastRecalculatePeriod(appliedFilters, row.orderDate);
    const ok = window.confirm(
      `Recalcular comissões do pedido ${row.orderCode ?? row.orderKey} (${period.from} a ${period.to})?`
    );
    if (!ok) return;

    setRecalculatingKey(row.orderKey);
    setRecalculateError(null);
    try {
      await fetchJsonOk("/api/commissions/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: period.from,
          to: period.to,
          mode: "FULL_RECALC",
        }),
      });
      await reload();
      if (selectedOrderKey === row.orderKey) {
        await detailState.reload();
      }
    } catch (e: unknown) {
      setRecalculateError(
        formatCommissionsApiError(e, "Não foi possível recalcular o pedido.")
      );
    } finally {
      setRecalculatingKey(null);
    }
  }

  async function handleRecalculateFromDetail() {
    if (!detailState.data) return;
    const row: CommissionsForecastRow = {
      orderKey: detailState.data.orderKey,
      orderCode: detailState.data.orderCode,
      nomusOrderId: detailState.data.nomusOrderId,
      localOrderId: detailState.data.localOrderId,
      orderDate: detailState.data.orderDate,
      customerName: detailState.data.customerName,
      sellerLabel: detailState.data.sellerLabel,
      representativeLabel: detailState.data.representativeLabel,
      orderAmount: detailState.data.orderNetValue ?? detailState.data.totalBaseAmount,
      baseAmount: detailState.data.totalBaseAmount,
      ratePercent: 0,
      forecastCommissionAmount: detailState.data.totalForecastCommission,
      paymentTermsHint: detailState.data.paymentTerms,
      nextDueDate: null,
      status: detailState.data.status,
      hasRule: detailState.data.items.some((i) => i.ruleId),
      hasOutOfTablePrice: detailState.data.items.some((i) => i.outOfTablePrice),
      recordIds: detailState.data.items.map((i) => i.recordId),
    };
    await handleRecalculateRow(row);
  }

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  const cards = data?.cards;
  const rows = data?.rows ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-forecast-page">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
          Comissões previstas
        </p>
        <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
          Previsão a partir do Pedido de Venda
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
          Comissões calculadas enquanto ainda não há NF-e ou documento de saída confirmado.
        </p>
      </div>

      <div
        className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"
        data-testid="commissions-forecast-provisional-notice"
        role="note"
      >
        Comissões previstas usam as condições do Pedido de Venda enquanto ainda não houver
        NF-e/Documento de Saída. Após a emissão, a previsão será substituída pelos dados reais.
      </div>

      <CommissionsForecastFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {recalculateError ? (
        <CommissionsErrorBanner
          message={recalculateError}
          onDismiss={() => setRecalculateError(null)}
        />
      ) : null}

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading && !data ? <CommissionsLoading /> : null}

      {cards ? (
        <CommissionsKpiSection
          title="Resumo de comissões previstas"
          eyebrow="Indicadores do filtro aplicado"
          testId="commissions-forecast-kpi"
        >
          <FinanceKpiCard
            label="Comissão prevista total"
            value=""
            amount={cards.totalForecastAmount}
            amountFormat="currency"
            icon={TrendingUp}
          />
          <FinanceKpiCard
            label="Pedidos aguardando NF-e"
            value={String(cards.ordersWaitingNfe)}
            icon={FileWarning}
          />
          <FinanceKpiCard
            label="Pedidos sem regra"
            value={String(cards.ordersWithoutRule)}
            icon={AlertCircle}
          />
          <FinanceKpiCard
            label="Sem vendedor/representante"
            value={String(cards.ordersWithoutSellerOrRep)}
            icon={UserX}
          />
          <FinanceKpiCard
            label="Valor previsto a faturar"
            value=""
            amount={cards.forecastBaseToInvoice}
            amountFormat="currency"
            icon={ShoppingCart}
          />
          <FinanceKpiCard
            label="Quantidade de pedidos"
            value={String(cards.orderCount)}
            icon={ClipboardList}
          />
        </CommissionsKpiSection>
      ) : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma comissão prevista"
            description="Não há previsões calculadas a partir de pedidos de venda com os filtros atuais."
            testId="commissions-forecast-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll testId="commissions-forecast-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">Data do pedido</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Vendedor</th>
                  <th className="px-3 py-2 text-left font-medium">Representante</th>
                  <th className="px-3 py-2 text-right font-medium">Valor do pedido</th>
                  <th className="px-3 py-2 text-right font-medium">Base de comissão</th>
                  <th className="px-3 py-2 text-right font-medium">% comissão</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão prevista</th>
                  <th className="px-3 py-2 text-left font-medium">Cond. pagamento</th>
                  <th className="px-3 py-2 text-left font-medium">Próx. vencimento</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => (
                  <tr
                    key={row.orderKey}
                    className="cursor-pointer hover:bg-muted/30"
                    onClick={() => setSelectedOrderKey(row.orderKey)}
                    data-testid="commissions-forecast-row"
                  >
                    <td className="px-3 py-2 font-medium">{row.orderCode ?? row.orderKey}</td>
                    <td className="px-3 py-2">{formatDate(row.orderDate)}</td>
                    <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-3 py-2">
                      {formatCommissionSellerLabel(row.seller, row.sellerLabel)}
                    </td>
                    <td className="px-3 py-2">{row.representativeLabel ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.orderAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.baseAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">{row.ratePercent}%</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatFinanceCurrency(row.forecastCommissionAmount)}
                    </td>
                    <td className="px-3 py-2 text-sm">{row.paymentTermsHint ?? "—"}</td>
                    <td className="px-3 py-2">{formatDate(row.nextDueDate)}</td>
                    <td className={cn("px-3 py-2 font-medium", commissionStatusClassName(row.status))}>
                      {formatCommissionStatus(row.status)}
                      <CommissionOutOfTableFlag show={row.hasOutOfTablePrice} />
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <ForecastRowActions
                        row={row}
                        canRecalculate={canRecalculate}
                        onOpenDetail={() => setSelectedOrderKey(row.orderKey)}
                        onRecalculate={() => void handleRecalculateRow(row)}
                        recalculatingKey={recalculatingKey}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>

            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Página {pagination.page} de {pagination.totalPages} · {pagination.total} pedidos
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => changePage(pagination.page + 1)}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 disabled:opacity-50"
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}

      <CommissionsForecastDetailDrawer
        open={selectedOrderKey != null}
        onClose={() => setSelectedOrderKey(null)}
        detail={detailState.data}
        loading={detailState.loading}
        error={detailState.error}
        onRetry={() => void detailState.reload()}
        onRecalculate={() => void handleRecalculateFromDetail()}
        recalculating={recalculatingKey === selectedOrderKey}
        canRecalculate={canRecalculate}
      />
    </div>
  );
}
