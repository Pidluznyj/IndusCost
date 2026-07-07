import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { CommissionsReleaseDetailDrawer } from "@/src/components/commissions/releases/CommissionsReleaseDetailDrawer";
import { CommissionsReleasesFiltersPanel } from "@/src/components/commissions/releases/CommissionsReleasesFiltersPanel";
import {
  EMPTY_COMMISSIONS_RELEASES_FILTERS,
  type CommissionsReleasesFilters,
} from "@/src/components/commissions/releases/commissionsReleasesFilters";
import { useCommissionsReleaseDetail } from "@/src/components/commissions/releases/useCommissionsReleasesData";
import {
  useCommissionsArViewData,
  type CommissionsArViewMode,
} from "@/src/components/commissions/arViews/useCommissionsArViewData";

type PageConfig = {
  mode: CommissionsArViewMode;
  title: string;
  subtitle: string;
  testId: string;
  showSettlement: boolean;
  showDaysUntilDue: boolean;
  showDaysOverdue: boolean;
};

const CONFIG: Record<CommissionsArViewMode, PageConfig> = {
  payable: {
    mode: "payable",
    title: "Comissão a Pagar",
    subtitle:
      "Títulos baixados no Contas a Receber — comissão liberada pela data real de recebimento (settlementDate).",
    testId: "commissions-payable-page",
    showSettlement: true,
    showDaysUntilDue: false,
    showDaysOverdue: false,
  },
  future: {
    mode: "future",
    title: "Comissões Futuras",
    subtitle:
      "Comissão prevista em títulos a vencer, aguardando pagamento do cliente para liberação.",
    testId: "commissions-future-page",
    showSettlement: false,
    showDaysUntilDue: true,
    showDaysOverdue: false,
  },
  overdue: {
    mode: "overdue",
    title: "Comissões Atrasadas",
    subtitle:
      "Títulos vencidos sem baixa — comissão bloqueada por inadimplência do cliente.",
    testId: "commissions-overdue-page",
    showSettlement: false,
    showDaysUntilDue: false,
    showDaysOverdue: true,
  },
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export function CommissionsArViewPage({ mode }: { mode: CommissionsArViewMode }) {
  const cfg = CONFIG[mode];
  const [draftFilters, setDraftFilters] = useState<CommissionsReleasesFilters>(
    EMPTY_COMMISSIONS_RELEASES_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsReleasesFilters>(
    EMPTY_COMMISSIONS_RELEASES_FILTERS
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsArViewData(mode, appliedFilters);
  const detail = useCommissionsReleaseDetail(selectedScheduleId, appliedFilters);

  const rows = data?.rows ?? [];
  const cards = data?.cards;
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid={cfg.testId}>
      <CommissionsSectionIntro title={cfg.title} description={cfg.subtitle} />

      <CommissionsReleasesFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
      />

      <div className="flex justify-end">
        <button
          type="button"
          className={financeBiButtonOutlineClass}
          onClick={() => void reload()}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Atualizar
        </button>
      </div>

      {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {cards ? (
        <CommissionsKpiSection
          title={`Resumo — ${cfg.title}`}
          eyebrow="Indicadores do filtro aplicado"
          testId={`${cfg.testId}-kpi`}
        >
          <FinanceKpiCard label="Comissão prevista" value={formatFinanceCurrency(cards.totalCommission)} />
          <FinanceKpiCard label="Comissão liberada" value={formatFinanceCurrency(cards.totalReleased)} />
          <FinanceKpiCard label="Comissão bloqueada" value={formatFinanceCurrency(cards.totalBlocked)} />
          <FinanceKpiCard label="Linhas" value={String(cards.rowCount)} />
        </CommissionsKpiSection>
      ) : null}

      {loading && !data ? <CommissionsLoading label="Carregando…" /> : null}

      {!loading && rows.length === 0 ? (
        <CommissionsEmptyState
          title="Nenhum registro encontrado"
          description="Ajuste os filtros de ano, mês ou vendedor."
        />
      ) : null}

      {rows.length > 0 ? (
        <>
          <CommissionsTableScroll>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2">Vendedor</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Pedido</th>
                  <th className="px-3 py-2">NF</th>
                  <th className="px-3 py-2">Parcela</th>
                  <th className="px-3 py-2">Vencimento</th>
                  {cfg.showSettlement ? <th className="px-3 py-2">Baixa</th> : null}
                  {cfg.showDaysUntilDue ? <th className="px-3 py-2">Dias p/ vencer</th> : null}
                  {cfg.showDaysOverdue ? <th className="px-3 py-2">Dias atraso</th> : null}
                  <th className="px-3 py-2 text-right">Título</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.scheduleId} className="border-b hover:bg-muted/30">
                    <td className="px-3 py-2">{row.commissionPersonName}</td>
                    <td className="px-3 py-2">{row.customerName ?? "—"}</td>
                    <td className="px-3 py-2">{row.orderCode ?? "—"}</td>
                    <td className="px-3 py-2">{row.nfeNumber ?? "—"}</td>
                    <td className="px-3 py-2">{row.installmentNumber ?? "—"}</td>
                    <td className="px-3 py-2">{formatDate(row.dueDate)}</td>
                    {cfg.showSettlement ? (
                      <td className="px-3 py-2">{formatDate(row.settlementDate)}</td>
                    ) : null}
                    {cfg.showDaysUntilDue ? (
                      <td className="px-3 py-2">{row.daysUntilDue ?? "—"}</td>
                    ) : null}
                    {cfg.showDaysOverdue ? (
                      <td className="px-3 py-2">{row.daysOverdue ?? "—"}</td>
                    ) : null}
                    <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.parcelAmount)}</td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.commissionParcelAmount)}
                    </td>
                    <td className="px-3 py-2">{row.paymentStatus}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="text-primary text-xs font-semibold hover:underline"
                        onClick={() => setSelectedScheduleId(row.scheduleId)}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CommissionsTableScroll>

          {pagination ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {pagination.page} de {pagination.totalPages} ({pagination.total} linhas)
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={pagination.page <= 1 || loading}
                  onClick={() =>
                    setAppliedFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))
                  }
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={financeBiButtonOutlineClass}
                  disabled={pagination.page >= pagination.totalPages || loading}
                  onClick={() => setAppliedFilters((f) => ({ ...f, page: f.page + 1 }))}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <CommissionsReleaseDetailDrawer
        open={selectedScheduleId != null}
        onClose={() => setSelectedScheduleId(null)}
        detail={detail.data}
        loading={detail.loading}
        error={detail.error}
        onRetry={() => void detail.reload()}
        onReprocess={() => undefined}
        reprocessing={false}
      />
    </div>
  );
}
