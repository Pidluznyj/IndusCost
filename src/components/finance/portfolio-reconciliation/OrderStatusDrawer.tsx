import React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import {
  ORDER_STATUS_STATUS_LABEL,
  formatOrderStatusAlertLabel,
  formatOrderStatusFinancialLabel,
  formatOrderStatusOperationalLabel,
  formatOrderStatusTemperatureLabel,
} from "@/src/lib/finance/portfolioOrderStatusClient";
import type { PortfolioOrderStatusRow } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  order: PortfolioOrderStatusRow | null;
  onClose: () => void;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <div className="text-sm text-[#111827]">{children}</div>
    </div>
  );
}

function dash(value: string | null | undefined): string {
  const s = value?.trim();
  return s ? s : "—";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatFinanceDate(iso.slice(0, 10)) || "—";
}

/**
 * Drawer de resumo do pedido (grão Pedido de Venda).
 * Detalhe item a item permanece na Auditoria Pedido → Caixa.
 */
export function OrderStatusDrawer({ open, order, onClose }: Props) {
  const portalContainer = usePortalContainer();
  if (!open || !portalContainer || !order) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      data-testid="order-status-drawer"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-lg flex-col border-l border-[#E5E7EB] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Status Pedidos
            </p>
            <h2 className="text-base font-semibold text-[#111827]">
              {dash(order.orderCode)}
            </h2>
            <p className="mt-0.5 text-xs text-[#6B7280]">
              {dash(order.customerName)}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-[#6B7280] hover:bg-[#F3F4F6]"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="rounded-[12px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
            Resumo por Pedido de Venda. Evidências item a item estão na aba
            Auditoria Pedido → Caixa.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data pedido">{formatDate(order.orderIssueDate)}</Field>
            <Field label="Entrega estimada">
              {formatDate(order.orderExpectedDeliveryDate)}
            </Field>
            <Field label="Responsável comercial">
              {dash(order.commercialResponsibleName)}
            </Field>
            <Field label="Vendedor pedido">{dash(order.orderSellerName)}</Field>
            <Field label="Valor pedido">
              {formatFinanceCurrency(order.totalOrderValue)}
            </Field>
            <Field label="Valor atendido">
              {formatFinanceCurrency(order.allocatedOrderValue)}
            </Field>
            <Field label="% atendido">
              {formatFinancePercent(order.fulfillmentPercent)}
            </Field>
            <Field label="Saldo pendente">
              {formatFinanceCurrency(order.pendingOrderValue)}
            </Field>
            <Field label="CR aberto">
              {formatFinanceCurrency(order.receivableOpenValue)}
            </Field>
            <Field label="Recebido">
              {formatFinanceCurrency(order.receivableReceivedValue)}
            </Field>
            <Field label="Status operacional">
              {formatOrderStatusOperationalLabel(order.operationalStatus)}
            </Field>
            <Field label="Status financeiro">
              {formatOrderStatusFinancialLabel(order.financialStatus)}
            </Field>
            <Field label="Status consolidado">
              {ORDER_STATUS_STATUS_LABEL[order.consolidatedOrderStatus] ??
                order.consolidatedOrderStatus}
            </Field>
            <Field label="Temperatura">
              {formatOrderStatusTemperatureLabel(order.temperature)}
            </Field>
          </div>

          <Field label="Alertas">
            {order.alerts.length ? (
              <div className="flex flex-wrap gap-1">
                {order.alerts.map((a) => (
                  <span
                    key={a}
                    className={cn(
                      "inline-flex rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-900"
                    )}
                  >
                    {formatOrderStatusAlertLabel(a)}
                  </span>
                ))}
              </div>
            ) : (
              "—"
            )}
          </Field>

          <Field label="Ação recomendada">
            {dash(order.recommendedAction)}
          </Field>
        </div>
      </aside>
    </div>,
    portalContainer
  );
}
