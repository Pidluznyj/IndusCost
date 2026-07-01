import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, HelpCircle, RefreshCw, X } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { getCommissionsSectionPath } from "@/src/lib/commissionsNavigation";
import {
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import type { CommissionsReleaseDetailPayload } from "@/src/components/commissions/commissionsTypes";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

type Props = {
  open: boolean;
  onClose: () => void;
  detail: CommissionsReleaseDetailPayload | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onReprocess: () => void;
  reprocessing: boolean;
  canReprocess: boolean;
};

export function CommissionsReleaseDetailDrawer({
  open,
  onClose,
  detail,
  loading,
  error,
  onRetry,
  onReprocess,
  reprocessing,
  canReprocess,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe da liberação por recebimento"
      data-testid="commissions-release-detail-drawer"
    >
      <div
        className="flex h-[92vh] w-full max-w-2xl flex-col bg-white shadow-xl sm:h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
              Liberação por recebimento
            </p>
            <h4 className="text-lg font-extrabold text-[#111827]">
              CR #{detail?.nomusReceivableId ?? "—"} · Parcela{" "}
              {detail?.installmentNumber ?? "—"}
            </h4>
            {detail ? (
              <p className="mt-1 text-sm text-[#6B7280]">
                {detail.commissionPersonName} · Pedido {detail.orderCode ?? "—"}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-[#6B7280] hover:bg-[#F3F4F6]"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error ? <CommissionsErrorBanner message={error} onRetry={onRetry} /> : null}
          {loading ? <CommissionsLoading label="Carregando detalhe…" /> : null}

          {!loading && detail ? (
            <>
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950 flex gap-2">
                <HelpCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                <span>{detail.releaseExplanation}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-[#6B7280]">Comissão total (pedido/NF)</p>
                  <p className="font-semibold">
                    {formatFinanceCurrency(detail.recordCommissionTotal)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Rateio desta parcela</p>
                  <p className="font-semibold">
                    {detail.allocationPercent != null
                      ? `${detail.allocationPercent}%`
                      : "—"}{" "}
                    · {formatFinanceCurrency(detail.commissionParcelAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Valor recebido (título)</p>
                  <p className="font-semibold">
                    {formatFinanceCurrency(detail.receivedAmount)}
                    {detail.receivedPercent != null ? ` (${detail.receivedPercent}%)` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Comissão liberada / saldo</p>
                  <p className="font-semibold">
                    {formatFinanceCurrency(detail.commissionReleasedAmount)} / saldo{" "}
                    {formatFinanceCurrency(detail.balanceToRelease)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Vencimento / baixa</p>
                  <p className="font-semibold">
                    {formatDate(detail.dueDate)} · baixa {formatDate(detail.settlementDate)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Regra de liberação</p>
                  <p className="font-semibold">{detail.releaseRule}</p>
                </div>
              </div>

              <section className="space-y-2">
                <h5 className="text-sm font-bold text-[#111827]">
                  Histórico de liberação (parcelas do registro)
                </h5>
                <CommissionsTableScroll>
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Parc.</th>
                      <th className="px-3 py-2 text-left font-medium">Venc.</th>
                      <th className="px-3 py-2 text-right font-medium">Recebido</th>
                      <th className="px-3 py-2 text-right font-medium">Comissão</th>
                      <th className="px-3 py-2 text-right font-medium">Liberada</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {detail.releaseHistory.map((row) => (
                      <tr
                        key={row.scheduleId}
                        className={
                          row.scheduleId === detail.scheduleId ? "bg-blue-50/50 font-medium" : ""
                        }
                      >
                        <td className="px-3 py-2">{row.installmentNumber ?? "—"}</td>
                        <td className="px-3 py-2">{formatDate(row.dueDate)}</td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(row.receivedAmount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(row.commissionExpectedAmount)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(row.commissionReleasedAmount)}
                        </td>
                        <td className="px-3 py-2">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </CommissionsTableScroll>
              </section>

              {detail.auditIssues.length > 0 ? (
                <section className="space-y-2">
                  <h5 className="inline-flex items-center gap-2 text-sm font-bold text-[#111827]">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Auditorias relacionadas
                  </h5>
                  <ul className="space-y-2">
                    {detail.auditIssues.map((issue) => (
                      <li
                        key={issue.id}
                        className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-[#92400E]">{issue.severity}</span>
                        <span className="text-[#6B7280]"> · {issue.type}</span>
                        <p className="mt-1">{issue.message}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </>
          ) : null}
        </div>

        {detail ? (
          <div className="flex flex-wrap gap-2 border-t border-[#E5E7EB] px-5 py-4">
            <Link
              to={getCommissionsSectionPath("audit")}
              className="inline-flex h-9 items-center rounded-lg border border-[#E5E7EB] px-3 text-sm font-medium hover:bg-[#F9FAFB]"
            >
              Auditoria
            </Link>
            {canReprocess ? (
              <button
                type="button"
                disabled={reprocessing}
                onClick={onReprocess}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${reprocessing ? "animate-spin" : ""}`} />
                Reprocessar liberação
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
