import React, { useState } from "react";
import {
  AlertCircle,
  Banknote,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  Loader2,
  Lock,
  RefreshCw,
  Unlock,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { COMMISSIONS_RECALCULATE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CommissionsReleaseItem } from "@/src/components/commissions/commissionsTypes";
import { CommissionsReleaseDetailDrawer } from "@/src/components/commissions/releases/CommissionsReleaseDetailDrawer";
import { CommissionsReleasesFiltersPanel } from "@/src/components/commissions/releases/CommissionsReleasesFiltersPanel";
import {
  EMPTY_COMMISSIONS_RELEASES_FILTERS,
  releaseRowClassName,
  resolveCommissionsReleasesRecalculatePeriod,
  type CommissionsReleasesFilters,
} from "@/src/components/commissions/releases/commissionsReleasesFilters";
import {
  useCommissionsReleaseDetail,
  useCommissionsReleasesData,
} from "@/src/components/commissions/releases/useCommissionsReleasesData";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function ReleaseTooltip() {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-[#6B7280]"
      title="A liberação é proporcional ao valor recebido da Conta a Receber."
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden />
      Liberação proporcional ao recebido
    </span>
  );
}

function ReleaseRowActions({
  row,
  onOpenDetail,
  onReprocess,
  reprocessingId,
  canReprocess,
}: {
  row: CommissionsReleaseItem;
  onOpenDetail: () => void;
  onReprocess: () => void;
  reprocessingId: string | null;
  canReprocess: boolean;
}) {
  const busy = reprocessingId === row.scheduleId;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button
        type="button"
        onClick={onOpenDetail}
        className="rounded px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
      >
        Detalhe
      </button>
      {canReprocess ? (
        <button
          type="button"
          disabled={busy}
          onClick={onReprocess}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          Reprocessar
        </button>
      ) : null}
    </div>
  );
}

export function CommissionsReleasesPage() {
  const auth = useAuth();
  const canReprocess = auth.hasAnyPermission([...COMMISSIONS_RECALCULATE_PERMISSIONS]);

  const [draftFilters, setDraftFilters] = useState<CommissionsReleasesFilters>(
    EMPTY_COMMISSIONS_RELEASES_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsReleasesFilters>(
    EMPTY_COMMISSIONS_RELEASES_FILTERS
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [reprocessError, setReprocessError] = useState<string | null>(null);
  const [periodReprocessing, setPeriodReprocessing] = useState(false);

  const { data, loading, error, reload } = useCommissionsReleasesData(appliedFilters);
  const detailState = useCommissionsReleaseDetail(selectedScheduleId, appliedFilters);

  async function runReprocess(period: { from: string; to: string }) {
    setReprocessError(null);
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
    if (selectedScheduleId) await detailState.reload();
  }

  async function handleReprocessPeriod() {
    if (!canReprocess) return;
    const period = resolveCommissionsReleasesRecalculatePeriod(appliedFilters);
    const ok = window.confirm(
      `Reprocessar liberação de comissões de ${period.from} até ${period.to}?\n\nO cálculo será refeito com base nas Contas a Receber atuais.`
    );
    if (!ok) return;

    setPeriodReprocessing(true);
    try {
      await runReprocess(period);
    } catch (e: unknown) {
      setReprocessError(
        formatCommissionsApiError(e, "Não foi possível reprocessar a liberação.")
      );
    } finally {
      setPeriodReprocessing(false);
    }
  }

  async function handleReprocessRow(row: CommissionsReleaseItem) {
    if (!canReprocess) return;
    const period = resolveCommissionsReleasesRecalculatePeriod(appliedFilters);
    const ok = window.confirm(
      `Reprocessar liberação da parcela CR #${row.nomusReceivableId ?? "—"} (período ${period.from} a ${period.to})?`
    );
    if (!ok) return;

    setReprocessingId(row.scheduleId);
    try {
      await runReprocess(period);
    } catch (e: unknown) {
      setReprocessError(
        formatCommissionsApiError(e, "Não foi possível reprocessar a liberação.")
      );
    } finally {
      setReprocessingId(null);
    }
  }

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  const cards = data?.cards;
  const rows = data?.rows ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-releases-page">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Liberação por recebimento
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Parcelas e Contas a Receber
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Comissão confirmada não é comissão liberada. A liberação segue a regra da comissão,
            proporcional ao recebimento de cada título.
          </p>
          <div className="mt-2">
            <ReleaseTooltip />
          </div>
        </div>
        {canReprocess ? (
          <button
            type="button"
            disabled={periodReprocessing}
            onClick={() => void handleReprocessPeriod()}
            className={financeBiButtonOutlineClass}
          >
            {periodReprocessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Reprocessar período
          </button>
        ) : null}
      </div>

      <CommissionsReleasesFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {reprocessError ? (
        <CommissionsErrorBanner
          message={reprocessError}
          onDismiss={() => setReprocessError(null)}
        />
      ) : null}

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {loading && !data ? <CommissionsLoading /> : null}

      {cards ? (
        <CommissionsKpiSection
          title="Resumo de liberações"
          eyebrow="Indicadores do filtro aplicado"
          testId="commissions-releases-kpi"
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Comissão a liberar"
            amount={cards.commissionToRelease}
            amountFormat="currency"
            tone="money"
            icon={Unlock}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Comissão já liberada"
            amount={cards.commissionAlreadyReleased}
            amountFormat="currency"
            tone="success"
            icon={Banknote}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Bloqueada (sem recebimento)"
            amount={cards.commissionBlockedByNoReceipt}
            amountFormat="currency"
            tone="warning"
            icon={Lock}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Contas recebidas"
            amount={cards.accountsReceivedCount}
            amountFormat="number"
            icon={Banknote}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Contas em aberto"
            amount={cards.accountsOpenCount}
            amountFormat="number"
            icon={Clock}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Contas vencidas"
            amount={cards.accountsOverdueCount}
            amountFormat="number"
            icon={AlertCircle}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Próximas liberações (30d)"
            amount={cards.upcomingReleasesCount}
            amountFormat="number"
            icon={CalendarClock}
          />
        </CommissionsKpiSection>
      ) : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma parcela de liberação"
            description="Não há cronogramas vinculados a contas a receber com os filtros atuais."
            testId="commissions-releases-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll testId="commissions-releases-table">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                  <th className="px-3 py-2 text-left font-medium">Pedido</th>
                  <th className="px-3 py-2 text-left font-medium">NF-e</th>
                  <th className="px-3 py-2 text-left font-medium">CR</th>
                  <th className="px-3 py-2 text-left font-medium">Cliente</th>
                  <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                  <th className="px-3 py-2 text-right font-medium">Parcela</th>
                  <th className="px-3 py-2 text-right font-medium">Recebido</th>
                  <th className="px-3 py-2 text-right font-medium">% rec.</th>
                  <th className="px-3 py-2 text-right font-medium" title="A liberação é proporcional ao valor recebido da Conta a Receber.">
                    Comissão
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Liberada</th>
                  <th className="px-3 py-2 text-right font-medium">Saldo</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Baixa</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => (
                  <tr
                    key={row.scheduleId}
                    className={`cursor-pointer hover:bg-muted/20 ${releaseRowClassName(row.highlight)}`}
                    onClick={() => setSelectedScheduleId(row.scheduleId)}
                    data-testid="commissions-release-row"
                  >
                    <td className="px-3 py-2">{row.commissionPersonName}</td>
                    <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {row.nomusReceivableId ?? "—"}
                      {row.installmentNumber != null ? ` / ${row.installmentNumber}` : ""}
                    </td>
                    <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-3 py-2">{formatDate(row.dueDate)}</td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.parcelAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.receivedAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {row.receivedPercent != null ? `${row.receivedPercent}%` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.commissionParcelAmount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.commissionReleasedAmount)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">
                      {formatFinanceCurrency(row.balanceToRelease)}
                    </td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{formatDate(row.settlementDate)}</td>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <ReleaseRowActions
                        row={row}
                        onOpenDetail={() => setSelectedScheduleId(row.scheduleId)}
                        onReprocess={() => void handleReprocessRow(row)}
                        reprocessingId={reprocessingId}
                        canReprocess={canReprocess}
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
                  parcelas
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

      <CommissionsReleaseDetailDrawer
        open={selectedScheduleId != null}
        onClose={() => setSelectedScheduleId(null)}
        detail={detailState.data}
        loading={detailState.loading}
        error={detailState.error}
        onRetry={() => void detailState.reload()}
        onReprocess={() => {
          if (selectedScheduleId && detailState.data) {
            void handleReprocessRow({
              scheduleId: selectedScheduleId,
              nomusReceivableId: detailState.data.nomusReceivableId,
            } as CommissionsReleaseItem);
          }
        }}
        reprocessing={reprocessingId === selectedScheduleId}
        canReprocess={canReprocess}
      />
    </div>
  );
}
