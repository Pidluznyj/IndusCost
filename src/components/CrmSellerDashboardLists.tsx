import React from "react";
import { cn } from "@/src/lib/utils";
import { ManagementListPanel } from "@/src/components/CrmManagementDashboardSection";
import type { SellerDashboardResponse } from "@/src/components/crmSellerDashboardTypes";
import { truncateMiddle } from "@/src/components/crmSellerDashboardUi";

export type CrmSellerDashboardListsProps = {
  data: SellerDashboardResponse;
  onSelectCustomer: (customerId: string, meta?: { displayName?: string }) => void;
  formatDateShortPt: (iso: string | null | undefined) => string;
  formatDateTimePt: (iso: string | null | undefined) => string;
  formatIntelCurrency: (value: unknown) => string;
  formatCommercialStatusLabel: (raw: string | null | undefined) => string;
  displayLine: (v: unknown) => string;
};

const listButtonClass =
  "w-full text-left rounded-lg border border-border/70 bg-background/80 px-3 py-2.5 hover:border-primary/40 hover:bg-accent/30 transition-colors";

export const CrmSellerDashboardLists: React.FC<CrmSellerDashboardListsProps> = ({
  data,
  onSelectCustomer,
  formatDateShortPt,
  formatIntelCurrency,
  displayLine,
}) => (
  <div className="grid gap-4 lg:grid-cols-2">
    <ManagementListPanel
      title="Carteira aberta"
      description="Pedidos válidos sem NF processada."
      emptyMessage="Nenhum pedido em carteira no escopo."
      isEmpty={data.openPortfolioOrders.length === 0}
    >
      <ul className="space-y-1.5">
        {data.openPortfolioOrders.map((row) => {
          const overdue = typeof row.daysOverdue === "number" && row.daysOverdue > 0;
          return (
            <li key={row.salesOrderId}>
              <button
                type="button"
                onClick={() =>
                  onSelectCustomer(row.customerId, { displayName: row.customerName })
                }
                className={listButtonClass}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground">{row.orderCode}</p>
                  <span
                    className={cn(
                      "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase",
                      overdue
                        ? "border-red-200 bg-red-50 text-red-900"
                        : "border-violet-200 bg-violet-50 text-violet-900"
                    )}
                  >
                    {overdue ? "Atrasado" : "Em carteira"}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                  {row.customerName}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Emissão: {formatDateShortPt(row.issueDate)} · Entrega:{" "}
                  {formatDateShortPt(row.expectedDeliveryDate ?? null)} ·{" "}
                  {formatIntelCurrency(row.totalNetValue)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {overdue && typeof row.daysOverdue === "number"
                    ? `${row.daysOverdue} dia(s) em atraso`
                    : typeof row.daysUntilExpectedDelivery === "number"
                      ? row.daysUntilExpectedDelivery >= 0
                        ? `${row.daysUntilExpectedDelivery} dia(s) até a entrega`
                        : `${Math.abs(row.daysUntilExpectedDelivery)} dia(s) além do prazo`
                      : "—"}
                  {row.responsible ? ` · ${row.responsible}` : ""}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </ManagementListPanel>

    <ManagementListPanel
      title="Pedidos faturados"
      description="Com NFe processada (dataProcessamento)."
      emptyMessage="Nenhum pedido faturado no escopo."
      isEmpty={data.invoicedOrders.length === 0}
    >
      <ul className="space-y-1.5">
        {data.invoicedOrders.map((row) => (
          <li key={row.salesOrderId}>
            <button
              type="button"
              onClick={() => onSelectCustomer(row.customerId, { displayName: row.customerName })}
              className={listButtonClass}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{row.orderCode}</p>
                <span className="shrink-0 rounded-full border border-green-200 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-900">
                  Faturado
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                {row.customerName}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {formatIntelCurrency(row.totalNetValue)}
                {row.invoiceProcessedAtText
                  ? ` · NFe ${displayLine(row.invoiceProcessedAtText)}`
                  : ""}
                {row.invoiceNumber ? ` · Nº ${row.invoiceNumber}` : ""}
                {row.invoiceSeries ? ` · Série ${row.invoiceSeries}` : ""}
              </p>
              {row.invoiceKey ? (
                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                  Chave: {truncateMiddle(row.invoiceKey, 22)}
                </p>
              ) : null}
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {displayLine(row.responsible)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </ManagementListPanel>

    <ManagementListPanel
      title="Pedidos sem proposta vinculada"
      description="Qualidade de rastreabilidade — sem proposalId no pedido."
      emptyMessage="Todos os pedidos possuem proposta vinculada."
      isEmpty={data.ordersWithoutLinkedProposal.length === 0}
    >
      <ul className="space-y-1.5">
        {data.ordersWithoutLinkedProposal.map((row) => (
          <li key={row.salesOrderId}>
            <button
              type="button"
              onClick={() => onSelectCustomer(row.customerId, { displayName: row.customerName })}
              className={listButtonClass}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{row.orderCode}</p>
                <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-800">
                  Rastreabilidade
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">
                {row.customerName}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                {formatDateShortPt(row.issueDate)} · {formatIntelCurrency(row.totalNetValue)} ·{" "}
                {row.isInvoiced ? "Faturado" : "Em carteira"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {displayLine(row.responsible)}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </ManagementListPanel>
  </div>
);
