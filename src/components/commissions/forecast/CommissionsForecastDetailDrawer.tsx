import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Calculator, ExternalLink, Loader2, X } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { getCommissionsSectionPath } from "@/src/lib/commissionsNavigation";
import {
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { formatCommissionStatus } from "@/src/components/commissions/dashboard/commissionsDashboardLabels";
import type { CommissionsForecastDetailPayload } from "@/src/components/commissions/commissionsTypes";

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
  detail: CommissionsForecastDetailPayload | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onRecalculate: () => void;
  recalculating: boolean;
  canRecalculate: boolean;
};

export function CommissionsForecastDetailDrawer({
  open,
  onClose,
  detail,
  loading,
  error,
  onRetry,
  onRecalculate,
  recalculating,
  canRecalculate,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe da comissão prevista"
      data-testid="commissions-forecast-detail-drawer"
    >
      <div
        className="flex h-[92vh] w-full max-w-2xl flex-col bg-white shadow-xl sm:h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
              Detalhe da previsão
            </p>
            <h4 className="text-lg font-extrabold text-[#111827]">
              Pedido {detail?.orderCode ?? "—"}
            </h4>
            {detail ? (
              <p className="mt-1 text-sm text-[#6B7280]">
                {formatCommissionStatus(detail.status)} ·{" "}
                {formatFinanceCurrency(detail.totalForecastCommission)}
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
          {error ? (
            <CommissionsErrorBanner message={error} onRetry={onRetry} />
          ) : null}

          {loading ? <CommissionsLoading label="Carregando detalhe…" /> : null}

          {!loading && detail ? (
            <>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                {detail.forecastReason}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-[#6B7280]">Cliente</p>
                  <p className="font-medium">{detail.customerName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Data do pedido</p>
                  <p className="font-medium">{formatDate(detail.orderDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Vendedor</p>
                  <p className="font-medium">{detail.sellerLabel ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Representante</p>
                  <p className="font-medium">{detail.representativeLabel ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Condição de pagamento</p>
                  <p className="font-medium">{detail.paymentTerms ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Valor líquido do pedido</p>
                  <p className="font-medium">
                    {detail.orderNetValue != null
                      ? formatFinanceCurrency(detail.orderNetValue)
                      : "—"}
                  </p>
                </div>
              </div>

              <section className="space-y-2">
                <h5 className="text-sm font-bold text-[#111827]">Itens e base de cálculo</h5>
                <CommissionsTableScroll>
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Produto</th>
                      <th className="px-3 py-2 text-left font-medium">Pessoa</th>
                      <th className="px-3 py-2 text-left font-medium">Regra</th>
                      <th className="px-3 py-2 text-right font-medium">Base</th>
                      <th className="px-3 py-2 text-right font-medium">%</th>
                      <th className="px-3 py-2 text-right font-medium">Comissão</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {detail.items.map((item) => (
                      <tr key={item.recordId}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.productName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.productCode ?? "—"}
                          </div>
                        </td>
                        <td className="px-3 py-2">{item.commissionPersonName}</td>
                        <td className="px-3 py-2 text-xs">
                          {item.ruleName ?? "Sem regra"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(item.baseAmount)}
                        </td>
                        <td className="px-3 py-2 text-right">{item.ratePercent}%</td>
                        <td className="px-3 py-2 text-right">
                          {formatFinanceCurrency(item.commissionAmount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </CommissionsTableScroll>
              </section>

              <section className="space-y-2">
                <h5 className="text-sm font-bold text-[#111827]">Parcelas previstas do pedido</h5>
                {detail.installments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma parcela prevista registrada.</p>
                ) : (
                  <CommissionsTableScroll>
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Parcela</th>
                        <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                        <th className="px-3 py-2 text-right font-medium">Valor previsto</th>
                        <th className="px-3 py-2 text-right font-medium">Comissão prevista</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {detail.installments.map((inst, idx) => (
                        <tr key={`${inst.installmentNumber}-${idx}`}>
                          <td className="px-3 py-2">{inst.installmentNumber ?? "—"}</td>
                          <td className="px-3 py-2">{formatDate(inst.dueDate)}</td>
                          <td className="px-3 py-2 text-right">
                            {inst.expectedAmount != null
                              ? formatFinanceCurrency(inst.expectedAmount)
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatFinanceCurrency(inst.commissionExpectedAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </CommissionsTableScroll>
                )}
              </section>

              {detail.auditIssues.length > 0 ? (
                <section className="space-y-2">
                  <h5 className="inline-flex items-center gap-2 text-sm font-bold text-[#111827]">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Avisos de auditoria
                  </h5>
                  <ul className="space-y-2">
                    {detail.auditIssues.map((issue) => (
                      <li
                        key={issue.id}
                        className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-[#92400E]">{issue.severity}</span>
                        <span className="text-[#6B7280]"> · {issue.type}</span>
                        <p className="mt-1 text-[#374151]">{issue.message}</p>
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
            {detail.localOrderId ? (
              <Link
                to={`/sales-orders/${detail.localOrderId}`}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 text-sm font-medium hover:bg-[#F9FAFB]"
              >
                <ExternalLink className="h-4 w-4" />
                Ver pedido
              </Link>
            ) : null}
            <Link
              to={getCommissionsSectionPath("audit")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 text-sm font-medium hover:bg-[#F9FAFB]"
            >
              Ir para auditoria
            </Link>
            {canRecalculate ? (
              <button
                type="button"
                disabled={recalculating}
                onClick={onRecalculate}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
              >
                {recalculating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Calculator className="h-4 w-4" />
                )}
                Recalcular pedido
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
