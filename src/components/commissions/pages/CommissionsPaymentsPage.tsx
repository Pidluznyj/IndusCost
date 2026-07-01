import React, { useState } from "react";
import {
  Banknote,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Plus,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CommissionsPaymentBatchListItem } from "@/src/components/commissions/commissionsTypes";
import { CommissionsPaymentCreateModal } from "@/src/components/commissions/payments/CommissionsPaymentCreateModal";
import { CommissionsPaymentDetailDrawer } from "@/src/components/commissions/payments/CommissionsPaymentDetailDrawer";
import { CommissionsPaymentsFiltersPanel } from "@/src/components/commissions/payments/CommissionsPaymentsFiltersPanel";
import {
  EMPTY_COMMISSIONS_PAYMENTS_FILTERS,
  type CommissionsPaymentsFilters,
} from "@/src/components/commissions/payments/commissionsPaymentsFilters";
import {
  formatPaymentBatchStatus,
  paymentBatchStatusClassName,
} from "@/src/components/commissions/payments/commissionsPaymentsLabels";
import {
  createPaymentBatchApi,
  useCommissionsPaymentsData,
} from "@/src/components/commissions/payments/useCommissionsPaymentsData";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export function CommissionsPaymentsPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS]);

  const [draftFilters, setDraftFilters] = useState<CommissionsPaymentsFilters>(
    EMPTY_COMMISSIONS_PAYMENTS_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsPaymentsFilters>(
    EMPTY_COMMISSIONS_PAYMENTS_FILTERS
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsPaymentsData(appliedFilters);

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  async function handleCreateBatch(body: {
    periodStart: string;
    periodEnd: string;
    commissionPersonId: string;
    recordIds: string[];
    notes?: string | null;
  }) {
    setSaving(true);
    setCreateError(null);
    try {
      const batch = await createPaymentBatchApi(body as unknown as Record<string, unknown>);
      setCreateOpen(false);
      await reload();
      setSelectedBatchId(batch.id);
    } catch (e: unknown) {
      setCreateError(formatCommissionsApiError(e, "Não foi possível criar o lote de pagamento."));
    } finally {
      setSaving(false);
    }
  }

  const cards = data?.cards;
  const rows = data?.rows ?? data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-payments-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Pagamentos
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Lotes de pagamento de comissões liberadas
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Somente comissões liberadas podem entrar em lote. Comissão liberada não é comissão
            paga — o pagamento é controle interno do IndusCost ao comissionado.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreateOpen(true);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            Novo lote
          </button>
        ) : null}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Comissão prevista ou confirmada sem liberação não pode ser paga. Apenas valores liberados
        entram no lote, e o pagamento nunca excede o valor liberado de cada item.
      </div>

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {cards ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <FinanceKpiCard
            label="Liberadas não pagas"
            value={formatFinanceCurrency(cards.unpaidReleasedAmount)}
            icon={Wallet}
            tone="info"
          />
          <FinanceKpiCard
            label="Em rascunho"
            value={formatFinanceCurrency(cards.draftBatchTotal)}
            icon={ClipboardList}
            tone="neutral"
          />
          <FinanceKpiCard
            label="Aprovados"
            value={formatFinanceCurrency(cards.approvedBatchTotal)}
            icon={Banknote}
            tone="warning"
          />
          <FinanceKpiCard
            label="Pago no período"
            value={formatFinanceCurrency(cards.paidInPeriodTotal)}
            icon={Banknote}
            tone="success"
          />
          <FinanceKpiCard
            label="Saldo a pagar"
            value={formatFinanceCurrency(cards.balanceToPay)}
            icon={Wallet}
            tone="info"
          />
        </div>
      ) : null}

      <CommissionsPaymentsFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {loading ? <CommissionsLoading label="Carregando lotes de pagamento…" /> : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhum lote encontrado"
            description="Crie um lote a partir de comissões liberadas ou ajuste os filtros."
            testId="commissions-payments-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll>
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                  <th className="px-3 py-2 text-left font-medium">Período</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Selecionado</th>
                  <th className="px-3 py-2 text-right font-medium">Pago</th>
                  <th className="px-3 py-2 text-left font-medium">Pagamento</th>
                  <th className="px-3 py-2 text-right font-medium">Itens</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row: CommissionsPaymentBatchListItem) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2 font-medium">{row.commissionPersonName}</td>
                    <td className="px-3 py-2 text-xs">
                      {formatDate(row.periodStart)} — {formatDate(row.periodEnd)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={paymentBatchStatusClassName(row.status)}>
                        {formatPaymentBatchStatus(row.status)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.totalSelected)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatFinanceCurrency(row.totalPaid)}
                    </td>
                    <td className="px-3 py-2 text-xs">{formatDate(row.paymentDate)}</td>
                    <td className="px-3 py-2 text-right">{row.itemsCount}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedBatchId(row.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
                      >
                        Detalhe
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>

            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between text-sm text-[#6B7280]">
                <span>
                  Página {pagination.page} de {pagination.totalPages} ({pagination.total}{" "}
                  registros)
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                    className="inline-flex h-8 items-center gap-1 rounded border border-[#E5E7EB] px-2 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => changePage(pagination.page + 1)}
                    className="inline-flex h-8 items-center gap-1 rounded border border-[#E5E7EB] px-2 disabled:opacity-40"
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

      <CommissionsPaymentCreateModal
        open={createOpen}
        saving={saving}
        error={createError}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreateBatch}
      />

      <CommissionsPaymentDetailDrawer
        batchId={selectedBatchId}
        canManage={canManage}
        onClose={() => setSelectedBatchId(null)}
        onChanged={() => void reload()}
      />
    </div>
  );
}
