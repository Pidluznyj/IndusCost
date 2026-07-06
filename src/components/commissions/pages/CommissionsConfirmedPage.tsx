import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  FileCheck,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { getCommissionsSectionPath } from "@/src/lib/commissionsNavigation";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { formatCommissionStatus } from "@/src/components/commissions/dashboard/commissionsDashboardLabels";
import { commissionStatusClassName } from "@/src/components/commissions/commissionsStatusLabels";
import { CommissionOutOfTableFlag } from "@/src/components/commissions/CommissionOutOfTableBadge";
import type { CommissionsConfirmedRow } from "@/src/components/commissions/commissionsTypes";
import { CommissionsConfirmedDetailDrawer } from "@/src/components/commissions/confirmed/CommissionsConfirmedDetailDrawer";
import { CommissionsConfirmedFiltersPanel } from "@/src/components/commissions/confirmed/CommissionsConfirmedFiltersPanel";
import {
  confirmedRowClassName,
  EMPTY_COMMISSIONS_CONFIRMED_FILTERS,
  type CommissionsConfirmedFilters,
} from "@/src/components/commissions/confirmed/commissionsConfirmedFilters";
import {
  useCommissionsConfirmedData,
  useCommissionsConfirmedDetail,
} from "@/src/components/commissions/confirmed/useCommissionsConfirmedData";

function ConfirmedRowActions({
  row,
  onOpenDetail,
}: {
  row: CommissionsConfirmedRow;
  onOpenDetail: () => void;
}) {
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
    </div>
  );
}

export function CommissionsConfirmedPage({
  variant = "confirmed",
}: {
  variant?: "confirmed" | "generated";
} = {}) {
  const isGenerated = variant === "generated";
  const apiOptions = isGenerated
    ? {
        listPath: "/api/commissions/generated",
        detailPath: "/api/commissions/generated/detail",
      }
    : undefined;

  const [draftFilters, setDraftFilters] = useState<CommissionsConfirmedFilters>(
    EMPTY_COMMISSIONS_CONFIRMED_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsConfirmedFilters>(
    EMPTY_COMMISSIONS_CONFIRMED_FILTERS
  );
  const [selectedConfirmKey, setSelectedConfirmKey] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsConfirmedData(appliedFilters, apiOptions);
  const detailState = useCommissionsConfirmedDetail(
    selectedConfirmKey,
    appliedFilters,
    apiOptions
  );

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  const cards = data?.cards;
  const rows = data?.rows ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid={isGenerated ? "commissions-generated-page" : "commissions-confirmed-page"}>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
          {isGenerated ? "Comissão gerada" : "Comissões confirmadas"}
        </p>
        <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
          {isGenerated
            ? "Comissão Gerada por NF / Pedido Faturado"
            : "Confirmadas por NF-e e Documento de Saída"}
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
          {isGenerated
            ? "Comissão calculada por item, consolidada por NF/pedido na competência do documento faturado."
            : "Comissões reais vinculadas a NF-e autorizada, documento de saída e contas a receber."}
        </p>
      </div>

      <div className="flex flex-wrap gap-3 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800 ring-1 ring-emerald-200">
          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmada / liberada
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-amber-900 ring-1 ring-amber-200">
          <Clock className="h-3.5 w-3.5" /> Aguardando recebimento
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-red-800 ring-1 ring-red-200">
          <AlertTriangle className="h-3.5 w-3.5" /> Divergência
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground ring-1 ring-border">
          Cancelada / estornada
        </span>
      </div>

      <CommissionsConfirmedFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading && !data ? <CommissionsLoading /> : null}

      {cards ? (
        <div className="indus-kpi-grid commercial-kpi-grid">
          <FinanceKpiCard
            label="Comissão confirmada"
            value=""
            amount={cards.totalConfirmedCommission}
            amountFormat="currency"
            icon={FileCheck}
          />
          <FinanceKpiCard
            label="Valor faturado"
            value=""
            amount={cards.invoicedAmount}
            amountFormat="currency"
            icon={Receipt}
          />
          <FinanceKpiCard
            label="Valor recebido"
            value=""
            amount={cards.receivedAmount}
            amountFormat="currency"
            icon={Banknote}
          />
          <FinanceKpiCard
            label="Aguardando recebimento"
            value=""
            amount={cards.waitingReceivableCommission}
            amountFormat="currency"
            icon={Clock}
          />
          <FinanceKpiCard
            label="Liberada parcial"
            value=""
            amount={cards.partiallyReleasedCommission}
            amountFormat="currency"
            icon={TrendingUp}
          />
          <FinanceKpiCard
            label="Liberada total"
            value=""
            amount={cards.fullyReleasedCommission}
            amountFormat="currency"
            icon={CheckCircle2}
          />
          <FinanceKpiCard
            label="Saldo a liberar"
            value=""
            amount={cards.balanceToRelease}
            amountFormat="currency"
            icon={Wallet}
          />
          <FinanceKpiCard
            label="Docs. inconsistentes"
            value={String(cards.inconsistentDocumentsCount)}
            icon={AlertTriangle}
          />
        </div>
      ) : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma comissão confirmada"
            description="Não há comissões confirmadas com os filtros atuais."
            testId="commissions-confirmed-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll testId="commissions-confirmed-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">NF-e</th>
                  <th className="px-3 py-2 text-left font-medium">Doc. Saída</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                  <th className="px-3 py-2 text-right font-medium">Base confirmada</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão</th>
                  <th className="px-3 py-2 text-right font-medium">Recebido</th>
                  <th className="px-3 py-2 text-right font-medium">Liberada</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => (
                  <tr
                    key={row.confirmKey}
                    className={`cursor-pointer hover:bg-muted/20 ${confirmedRowClassName(row.highlight)}`}
                    onClick={() => setSelectedConfirmKey(row.confirmKey)}
                    data-testid="commissions-confirmed-row"
                  >
                    <td className="px-3 py-2 font-medium">{row.orderCode ?? "—"}</td>
                    <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-sm">{row.outputDocumentLabel ?? "—"}</td>
                    <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-3 py-2">{row.commissionPersonName}</td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.confirmedBaseAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">{row.ratePercent}%</td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatFinanceCurrency(row.confirmedCommissionAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.receivedAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.releasedCommissionAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.pendingBalance)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn("inline-flex flex-wrap items-center gap-1 font-medium", commissionStatusClassName(row.status))}>
                        {row.hasDivergence ? (
                          <AlertTriangle className="h-3.5 w-3.5 text-red-500" aria-hidden />
                        ) : null}
                        {formatCommissionStatus(row.status)}
                        <CommissionOutOfTableFlag show={row.hasOutOfTablePrice} />
                      </span>
                    </td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <ConfirmedRowActions
                        row={row}
                        onOpenDetail={() => setSelectedConfirmKey(row.confirmKey)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>

            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                  Página {pagination.page} de {pagination.totalPages} · {pagination.total}{" "}
                  registros
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

      <CommissionsConfirmedDetailDrawer
        open={selectedConfirmKey != null}
        onClose={() => setSelectedConfirmKey(null)}
        detail={detailState.data}
        loading={detailState.loading}
        error={detailState.error}
        onRetry={() => void detailState.reload()}
      />
    </div>
  );
}
