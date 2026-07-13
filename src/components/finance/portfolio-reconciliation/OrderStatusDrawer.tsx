import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
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
import {
  ORDER_STATUS_ALERT_SEVERITY_CLASS,
  ORDER_STATUS_ALERT_SEVERITY_LABEL,
  ORDER_STATUS_BADGE_CLASS,
  ORDER_STATUS_TEMP_BADGE_CLASS,
  orderStatusAlertSeverity,
  orderStatusDash,
} from "./orderStatusUi";

type Props = {
  open: boolean;
  order: PortfolioOrderStatusRow | null;
  onClose: () => void;
};

type DrawerTab = "resumo" | "financeiro" | "alertas";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatFinanceDate(iso.slice(0, 10)) || "—";
}

function MiniValue({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div className="rounded-[12px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 tabular-nums text-[#101828]",
          emphasize ? "text-lg font-bold" : "text-sm font-semibold"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
        {label}
      </p>
      <div className="text-sm text-[#101828]">{children}</div>
    </div>
  );
}

function FulfillmentMap({ order }: { order: PortfolioOrderStatusRow }) {
  const pct = Math.max(0, Math.min(100, order.fulfillmentPercent || 0));
  const allocated = Math.max(0, order.allocatedItemCount);
  const pending = Math.max(0, order.pendingItemCount);
  const totalItems = Math.max(allocated + pending, 1);

  return (
    <div
      className="rounded-[12px] border border-[#E5E7EB] bg-white px-3 py-3"
      data-testid="order-status-drawer-fulfillment-map"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
          Mapa de atendimento
        </p>
        <p className="text-sm font-bold tabular-nums text-[#101828]">
          {formatFinancePercent(order.fulfillmentPercent)}
        </p>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-[#F2F4F7]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Percentual atendido do pedido"
      >
        <div
          className="h-full rounded-full bg-sky-500/80 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#667085]">
        <span>
          <span className="font-semibold text-[#101828]">
            {formatFinanceInteger(allocated)}
          </span>{" "}
          item(ns) atendido(s)
        </span>
        <span>
          <span className="font-semibold text-[#101828]">
            {formatFinanceInteger(pending)}
          </span>{" "}
          pendente(s)
        </span>
        <span className="text-[#98A2B3]">
          base {formatFinanceInteger(totalItems)} item(ns) ·{" "}
          {formatFinanceInteger(order.factCount)} evidência(s)
        </span>
      </div>
    </div>
  );
}

/**
 * Drawer de resumo do pedido (grão Pedido de Venda).
 * Detalhe item a item permanece na Auditoria Pedido → Caixa.
 */
export function OrderStatusDrawer({ open, order, onClose }: Props) {
  const portalContainer = usePortalContainer();
  const [tab, setTab] = useState<DrawerTab>("resumo");

  useEffect(() => {
    if (open) setTab("resumo");
  }, [open, order?.orderKey]);

  if (!open || !portalContainer || !order) return null;

  const statusLabel =
    ORDER_STATUS_STATUS_LABEL[order.consolidatedOrderStatus] ??
    order.consolidatedOrderStatus;
  const temp = formatOrderStatusTemperatureLabel(order.temperature);

  const tabs: Array<{ id: DrawerTab; label: string }> = [
    { id: "resumo", label: "Resumo" },
    { id: "financeiro", label: "Valores" },
    { id: "alertas", label: "Alertas" },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      aria-label={`Resumo do pedido ${orderStatusDash(order.orderCode)}`}
      data-testid="order-status-drawer"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-xl flex-col border-l border-[#E5E7EB] bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
                Status Pedidos
              </p>
              <h2 className="mt-0.5 truncate text-lg font-semibold text-[#101828]">
                {orderStatusDash(order.orderCode)}
              </h2>
              <p className="mt-0.5 truncate text-sm text-[#667085]">
                {orderStatusDash(order.customerName)}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1.5 text-[#667085] hover:bg-[#F2F4F7] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
              onClick={onClose}
              aria-label="Fechar resumo do pedido"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <span
              className={cn(
                "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                ORDER_STATUS_BADGE_CLASS[order.consolidatedOrderStatus]
              )}
            >
              {statusLabel}
            </span>
            {temp !== "—" ? (
              <span
                className={cn(
                  "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                  ORDER_STATUS_TEMP_BADGE_CLASS[temp] ??
                    "border-[#E5E7EB] bg-[#F9FAFB] text-[#667085]"
                )}
              >
                {temp}
              </span>
            ) : null}
            <span className="inline-flex rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-0.5 text-[11px] font-medium text-[#475467]">
              {formatOrderStatusOperationalLabel(order.operationalStatus)} ·{" "}
              {formatOrderStatusFinancialLabel(order.financialStatus)}
            </span>
          </div>
        </header>

        <div className="border-b border-[#E5E7EB] px-5">
          <div className="flex gap-1" role="tablist" aria-label="Seções do resumo">
            {tabs.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    "-mb-px border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70",
                    active
                      ? "border-sky-500 text-sky-800"
                      : "border-transparent text-[#667085] hover:text-[#101828]"
                  )}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                  {t.id === "alertas" && order.alerts.length > 0
                    ? ` (${order.alerts.length})`
                    : ""}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="rounded-[12px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-relaxed text-sky-950">
            Resumo por pedido. O detalhe item a item fica na aba Auditoria Pedido
            → Caixa.
          </div>

          {tab === "resumo" ? (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <MiniValue
                  label="Valor do pedido"
                  value={formatFinanceCurrency(order.totalOrderValue)}
                  emphasize
                />
                <MiniValue
                  label="% atendido"
                  value={formatFinancePercent(order.fulfillmentPercent)}
                  emphasize
                />
                <MiniValue
                  label="Atendido"
                  value={formatFinanceCurrency(order.allocatedOrderValue)}
                />
                <MiniValue
                  label="Saldo pendente"
                  value={formatFinanceCurrency(order.pendingOrderValue)}
                />
              </div>

              <FulfillmentMap order={order} />

              <div className="grid grid-cols-2 gap-3">
                <Field label="Data do pedido">
                  {formatDate(order.orderIssueDate)}
                </Field>
                <Field label="Entrega estimada">
                  {formatDate(order.orderExpectedDeliveryDate)}
                </Field>
                <Field label="Responsável comercial">
                  {orderStatusDash(order.commercialResponsibleName)}
                </Field>
                <Field label="Vendedor do pedido">
                  {orderStatusDash(order.orderSellerName)}
                </Field>
              </div>

              <Field label="Ação recomendada">
                {orderStatusDash(order.recommendedAction)}
              </Field>
            </>
          ) : null}

          {tab === "financeiro" ? (
            <div className="grid grid-cols-2 gap-2.5">
              <MiniValue
                label="Valor do pedido"
                value={formatFinanceCurrency(order.totalOrderValue)}
                emphasize
              />
              <MiniValue
                label="Valor atendido"
                value={formatFinanceCurrency(order.allocatedOrderValue)}
                emphasize
              />
              <MiniValue
                label="Saldo pendente"
                value={formatFinanceCurrency(order.pendingOrderValue)}
              />
              <MiniValue
                label="Cobrado (itens)"
                value={formatFinanceCurrency(order.lineBilledValue)}
              />
              <MiniValue
                label="CR aberto"
                value={formatFinanceCurrency(order.receivableOpenValue)}
              />
              <MiniValue
                label="Recebido"
                value={formatFinanceCurrency(order.receivableReceivedValue)}
              />
              <MiniValue
                label="CR total"
                value={formatFinanceCurrency(order.receivableTotalValue)}
              />
              <MiniValue
                label="% atendido"
                value={formatFinancePercent(order.fulfillmentPercent)}
              />
            </div>
          ) : null}

          {tab === "alertas" ? (
            <div className="space-y-3">
              {order.alerts.length ? (
                order.alerts.map((a) => {
                  const severity = orderStatusAlertSeverity(a);
                  return (
                    <div
                      key={a}
                      className={cn(
                        "rounded-[12px] border px-3 py-2.5",
                        ORDER_STATUS_ALERT_SEVERITY_CLASS[severity]
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold">
                          {formatOrderStatusAlertLabel(a)}
                        </p>
                        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                          {ORDER_STATUS_ALERT_SEVERITY_LABEL[severity]}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-[12px] border border-dashed border-[#D0D5DD] bg-[#F9FAFB] px-3 py-6 text-center text-sm text-[#667085]">
                  Nenhum alerta neste pedido.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </aside>
    </div>,
    portalContainer
  );
}
