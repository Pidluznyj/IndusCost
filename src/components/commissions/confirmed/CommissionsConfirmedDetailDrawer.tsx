import React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink, X } from "lucide-react";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { getCommissionsSectionPath } from "@/src/lib/commissionsNavigation";
import {
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
} from "@/src/components/commissions/commissionsUi";
import { formatCommissionStatus } from "@/src/components/commissions/dashboard/commissionsDashboardLabels";
import { CommissionOutOfTableFlag } from "@/src/components/commissions/CommissionOutOfTableBadge";
import type { CommissionsConfirmedDetailPayload } from "@/src/components/commissions/commissionsTypes";

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
  detail: CommissionsConfirmedDetailPayload | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

export function CommissionsConfirmedDetailDrawer({
  open,
  onClose,
  detail,
  loading,
  error,
  onRetry,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe da comissão confirmada"
      data-testid="commissions-confirmed-detail-drawer"
    >
      <div
        className="flex h-[92vh] w-full max-w-2xl flex-col bg-white shadow-xl sm:h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
              Comissão confirmada
            </p>
            <h4 className="text-lg font-extrabold text-[#111827]">
              {detail?.orderCode ?? "—"} · NF-e {detail?.nfeNumber ?? "—"}
            </h4>
            {detail ? (
              <p className="mt-1 text-sm text-[#6B7280]">
                {detail.commissionPersonName} · {formatCommissionStatus(detail.status)} ·{" "}
                {formatFinanceCurrency(detail.totalConfirmedCommission)}
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
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                Comissão confirmada por NF-e/documento de saída. Parcelas e liberação seguem as
                Contas a Receber reais vinculadas à operação.
              </div>

              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <p className="text-xs text-[#6B7280]">Cliente</p>
                  <p className="font-medium">{detail.customerName ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Documento de Saída</p>
                  <p className="font-medium">{detail.outputDocumentLabel ?? "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Confirmada em</p>
                  <p className="font-medium">{formatDate(detail.confirmedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Valor recebido (cliente)</p>
                  <p className="font-medium">{formatFinanceCurrency(detail.totalReceivedAmount)}</p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Comissão liberada</p>
                  <p className="font-medium">
                    {formatFinanceCurrency(detail.totalReleasedAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6B7280]">Saldo pendente</p>
                  <p className="font-medium">{formatFinanceCurrency(detail.pendingBalance)}</p>
                </div>
              </div>

              <section className="space-y-2">
                <h5 className="text-sm font-bold text-[#111827]">
                  Pedido → itens e base confirmada
                </h5>
                <CommissionsTableScroll>
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Produto</th>
                      <th className="px-3 py-2 text-left font-medium">Regra</th>
                      <th className="px-3 py-2 text-right font-medium">Base</th>
                      <th className="px-3 py-2 text-right font-medium">%</th>
                      <th className="px-3 py-2 text-right font-medium">Comissão</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-card">
                    {detail.orderItems.map((item) => (
                      <tr key={item.recordId}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.productName ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.productCode ?? "—"}
                          </div>
                          <CommissionOutOfTableFlag show={item.outOfTablePrice} />
                        </td>
                        <td className="px-3 py-2 text-xs">{item.ruleName ?? "—"}</td>
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

              {detail.outputDocumentItems.length > 0 ? (
                <section className="space-y-2">
                  <h5 className="text-sm font-bold text-[#111827]">
                    Documento de Saída — movimentações
                  </h5>
                  <CommissionsTableScroll>
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Documento</th>
                        <th className="px-3 py-2 text-left font-medium">Produto</th>
                        <th className="px-3 py-2 text-right font-medium">Qtd</th>
                        <th className="px-3 py-2 text-left font-medium">Data</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {detail.outputDocumentItems.map((item) => (
                        <tr key={item.movementId}>
                          <td className="px-3 py-2">{item.documentNumber ?? "—"}</td>
                          <td className="px-3 py-2">{item.productLabel ?? "—"}</td>
                          <td className="px-3 py-2 text-right">{item.quantity}</td>
                          <td className="px-3 py-2">{formatDate(item.movementDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </CommissionsTableScroll>
                </section>
              ) : null}

              <section className="space-y-2">
                <h5 className="text-sm font-bold text-[#111827]">
                  Contas a Receber — parcelas e liberação
                </h5>
                {detail.receivables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma conta a receber vinculada registrada para esta comissão.
                  </p>
                ) : (
                  <CommissionsTableScroll>
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Parcela</th>
                        <th className="px-3 py-2 text-left font-medium">Vencimento</th>
                        <th className="px-3 py-2 text-right font-medium">Título</th>
                        <th className="px-3 py-2 text-right font-medium">Recebido</th>
                        <th className="px-3 py-2 text-right font-medium">Comissão</th>
                        <th className="px-3 py-2 text-right font-medium">Liberado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border bg-card">
                      {detail.receivables.map((rec, idx) => (
                        <tr key={`${rec.nomusReceivableId}-${idx}`}>
                          <td className="px-3 py-2">{rec.installmentNumber ?? "—"}</td>
                          <td className="px-3 py-2">{formatDate(rec.dueDate)}</td>
                          <td className="px-3 py-2 text-right">
                            {formatFinanceCurrency(rec.amountReceivable)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatFinanceCurrency(rec.amountReceived)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatFinanceCurrency(rec.commissionExpectedAmount)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {formatFinanceCurrency(rec.commissionReleasedAmount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </CommissionsTableScroll>
                )}
              </section>

              {detail.supersessionHistory.length > 0 ? (
                <section className="space-y-2">
                  <h5 className="text-sm font-bold text-[#111827]">
                    Histórico de substituição da previsão
                  </h5>
                  <ul className="space-y-2 text-sm">
                    {detail.supersessionHistory.map((item) => (
                      <li
                        key={item.recordId}
                        className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2"
                      >
                        <span className="font-medium">
                          {item.productName ?? item.productCode ?? "Item"}
                        </span>
                        <span className="text-[#6B7280]">
                          {" "}
                          · previsão {formatFinanceCurrency(item.commissionAmount)} substituída em{" "}
                          {formatDate(item.supersededAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {detail.auditIssues.length > 0 ? (
                <section className="space-y-2">
                  <h5 className="inline-flex items-center gap-2 text-sm font-bold text-[#111827]">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Auditorias vinculadas
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
            <Link
              to={getCommissionsSectionPath("releases")}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] px-3 text-sm font-medium hover:bg-[#F9FAFB]"
            >
              Liberação por recebimento
            </Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
