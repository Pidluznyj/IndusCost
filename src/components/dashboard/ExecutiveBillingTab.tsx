import React from "react";
import { Link } from "react-router-dom";
import type { BillingDashboardTab } from "@/src/lib/executiveDashboardTypes";
import { formatExecutiveCurrency, formatExecutiveInteger } from "@/src/lib/executiveDashboardFormatters";
import { ExecutiveMonthlyChart, ExecutiveTargetPanel } from "@/src/components/dashboard/ExecutiveDashboardCharts";

function SummaryCards({ cards }: { cards: BillingDashboardTab["summaryCards"] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div key={card.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{card.label}</p>
          <p className="mt-2 truncate text-xl font-black lg:text-2xl" title={card.formatted}>
            {card.compactFormatted ?? card.formatted}
          </p>
          {card.hint ? <p className="mt-1 text-[11px] text-muted-foreground">{card.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function ExecutiveBillingTab({ tab }: { tab: BillingDashboardTab }) {
  return (
    <div className="space-y-6">
      <SummaryCards cards={tab.summaryCards} />
      <ExecutiveTargetPanel title="Faturamento — realizado vs meta do mês" target={tab.target} />
      <ExecutiveMonthlyChart title="Faturamento mensal" data={tab.monthlyBilling} />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold">Top clientes (ano)</h3>
          {tab.topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem faturamento consolidado no ano.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-semibold">Cliente</th>
                    <th className="pb-2 pr-3 font-semibold">Pedidos</th>
                    <th className="pb-2 font-semibold">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.topCustomers.map((row) => (
                    <tr key={row.customerId} className="border-b border-border/60">
                      <td className="py-2 pr-3">{row.customerName}</td>
                      <td className="py-2 pr-3">{formatExecutiveInteger(row.orderCount)}</td>
                      <td className="py-2">{formatExecutiveCurrency(row.totalNetValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Pedidos faturados recentes</h3>
            <Link to="/sales-orders" className="text-xs font-bold text-primary hover:underline">
              Ver pedidos
            </Link>
          </div>
          {tab.recentInvoicedOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido faturado registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-2">Pedido</th>
                    <th className="pb-2 pr-2">Cliente</th>
                    <th className="pb-2 pr-2">NF processada</th>
                    <th className="pb-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.recentInvoicedOrders.map((row) => (
                    <tr key={row.orderId} className="border-b border-border/60">
                      <td className="py-2 pr-2 font-medium">{row.orderCode}</td>
                      <td className="py-2 pr-2">{row.customerName}</td>
                      <td className="py-2 pr-2">
                        {new Date(row.invoiceDate).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-2">{formatExecutiveCurrency(row.totalNetValue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
