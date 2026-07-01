import React, { useState } from "react";
import { Loader2, X } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  CommissionsErrorBanner,
  CommissionsLoading,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import {
  canApproveBatch,
  canCancelBatch,
  canMarkBatchPaid,
  formatPaymentBatchStatus,
  isBatchLocked,
  paymentBatchStatusClassName,
} from "@/src/components/commissions/payments/commissionsPaymentsLabels";
import {
  approvePaymentBatchApi,
  cancelPaymentBatchApi,
  markPaymentBatchPaidApi,
  useCommissionPaymentBatchDetail,
} from "@/src/components/commissions/payments/useCommissionsPaymentsData";

type Props = {
  batchId: string | null;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

export function CommissionsPaymentDetailDrawer({
  batchId,
  canManage,
  onClose,
  onChanged,
}: Props) {
  const { data, loading, error, reload } = useCommissionPaymentBatchDetail(batchId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));

  if (!batchId) return null;

  async function runAction(
    key: string,
    confirmMessage: string,
    action: () => Promise<void>
  ) {
    if (!window.confirm(confirmMessage)) return;
    setBusy(key);
    setActionError(null);
    try {
      await action();
      await reload();
      onChanged();
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível concluir a ação."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
          <div>
            <h3 className="text-base font-bold text-[#111827]">Detalhe do lote</h3>
            <p className="text-xs text-[#6B7280]">
              Controle interno de pagamento ao comissionado no IndusCost.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? <CommissionsLoading label="Carregando lote…" /> : null}
          {error ? <CommissionsErrorBanner message={error} onRetry={() => void reload()} /> : null}
          {actionError ? (
            <CommissionsErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
          ) : null}

          {!loading && !error && data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="text-xs text-[#6B7280]">Pessoa</p>
                  <p className="font-semibold text-[#111827]">{data.commissionPersonName}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Status</p>
                  <span className={paymentBatchStatusClassName(data.status)}>
                    {formatPaymentBatchStatus(data.status)}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Período</p>
                  <p className="text-sm">
                    {formatDate(data.periodStart)} — {formatDate(data.periodEnd)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Data de pagamento</p>
                  <p className="text-sm">{formatDate(data.paymentDate)}</p>
                </div>
              </div>

              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div className="rounded-lg bg-[#F9FAFB] p-3">
                  <dt className="text-xs text-[#6B7280]">Selecionado</dt>
                  <dd className="font-bold">{formatFinanceCurrency(data.totalSelected)}</dd>
                </div>
                <div className="rounded-lg bg-[#F9FAFB] p-3">
                  <dt className="text-xs text-[#6B7280]">Liberado</dt>
                  <dd className="font-bold">{formatFinanceCurrency(data.totalReleased)}</dd>
                </div>
                <div className="rounded-lg bg-[#F9FAFB] p-3">
                  <dt className="text-xs text-[#6B7280]">Pago</dt>
                  <dd className="font-bold">{formatFinanceCurrency(data.totalPaid)}</dd>
                </div>
              </dl>

              {data.notes ? (
                <div className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm text-[#374151]">
                  <span className="text-xs font-medium text-[#6B7280]">Observações: </span>
                  {data.notes}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
                <table className="min-w-full text-sm">
                  <thead className="bg-[#F9FAFB] text-left text-xs text-[#6B7280]">
                    <tr>
                      <th className="px-3 py-2">Pedido</th>
                      <th className="px-3 py-2">NF-e</th>
                      <th className="px-3 py-2">CR</th>
                      <th className="px-3 py-2 text-right">Liberado</th>
                      <th className="px-3 py-2 text-right">A pagar</th>
                      <th className="px-3 py-2 text-right">Pago</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB]">
                    {data.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">{item.orderCode ?? "—"}</td>
                        <td className="px-3 py-2">{item.nfeNumber ?? "—"}</td>
                        <td className="px-3 py-2">{item.nomusReceivableId ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(item.releasedAmount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(item.amountToPay)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(item.amountPaid)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {canManage && !isBatchLocked(data.status) ? (
                <div className="space-y-3 rounded-lg border border-[#E5E7EB] p-4">
                  <p className="text-sm font-semibold text-[#111827]">Ações do lote</p>
                  {canApproveBatch(data.status) ? (
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() =>
                        void runAction(
                          "approve",
                          "Aprovar este lote de pagamento?\n\nApós aprovado, poderá ser marcado como pago.",
                          async () => {
                            await approvePaymentBatchApi(data.id);
                          }
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Aprovar lote
                    </button>
                  ) : null}

                  {canMarkBatchPaid(data.status) ? (
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="space-y-1">
                        <span className="text-xs text-[#6B7280]">Data de pagamento *</span>
                        <input
                          type="date"
                          required
                          className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
                          value={paymentDate}
                          onChange={(e) => setPaymentDate(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy != null || !paymentDate}
                        onClick={() =>
                          void runAction(
                            "pay",
                            `Marcar lote como pago em ${paymentDate}?\n\nOs registros de comissão serão atualizados. Esta ação não altera comissões fora do lote.`,
                            async () => {
                              await markPaymentBatchPaidApi(
                                data.id,
                                new Date(`${paymentDate}T12:00:00`).toISOString()
                              );
                            }
                          )
                        }
                        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {busy === "pay" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Marcar como pago
                      </button>
                    </div>
                  ) : null}

                  {canCancelBatch(data.status) ? (
                    <button
                      type="button"
                      disabled={busy != null}
                      onClick={() =>
                        void runAction(
                          "cancel",
                          "Cancelar este lote?\n\nNenhum pagamento será registrado.",
                          async () => {
                            await cancelPaymentBatchApi(data.id);
                          }
                        )
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Cancelar lote
                    </button>
                  ) : null}
                </div>
              ) : null}

              {isBatchLocked(data.status) ? (
                <p className="text-xs text-[#6B7280]">
                  Lotes pagos ou cancelados não podem ser alterados.
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
