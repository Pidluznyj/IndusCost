import React from "react";
import { Link } from "react-router-dom";
import type { SalesOrdersDashboardTab } from "@/src/lib/executiveDashboardTypes";
import { formatExecutiveCurrency, formatExecutiveInteger } from "@/src/lib/executiveDashboardFormatters";
import { ExecutiveMonthlyComboChart, ExecutiveTargetPanel } from "@/src/components/dashboard/ExecutiveDashboardCharts";

function SummaryCards({ cards }: { cards: SalesOrdersDashboardTab["summaryCards"] }) {
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

export function ExecutiveSalesOrdersTab({ tab }: { tab: SalesOrdersDashboardTab }) {
  return (
    <div className="space-y-6">
      <SummaryCards cards={tab.summaryCards} />
      <ExecutiveTargetPanel title="Realizado vs meta do mês" target={tab.target} />
      <ExecutiveMonthlyComboChart
        title="Evolução mensal — pedidos emitidos"
        series={tab.monthlySeries}
        config={tab.chartSeries}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold">Status dos pedidos</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-semibold">Status</th>
                  <th className="pb-2 pr-3 font-semibold">Qtd</th>
                  <th className="pb-2 font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {tab.statusBreakdown.map((row) => (
                  <tr key={row.status} className="border-b border-border/60">
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="py-2 pr-3">{formatExecutiveInteger(row.count)}</td>
                    <td className="py-2">{formatExecutiveCurrency(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Pedidos atrasados</h3>
            <Link to="/sales-orders" className="text-xs font-bold text-primary hover:underline">
              Ver pedidos
            </Link>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {formatExecutiveInteger(tab.overdueOrders.count)} pedido(s) ·{" "}
            {tab.overdueOrders.formattedTotalValue}
          </p>
          {tab.overdueOrders.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum pedido atrasado no momento.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-2">Pedido</th>
                    <th className="pb-2 pr-2">Cliente</th>
                    <th className="pb-2 pr-2">Entrega</th>
                    <th className="pb-2 pr-2">Atraso</th>
                    <th className="pb-2">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {tab.overdueOrders.items.map((row) => (
                    <tr key={row.orderId} className="border-b border-border/60">
                      <td className="py-2 pr-2 font-medium">{row.orderCode}</td>
                      <td className="py-2 pr-2">{row.customerName}</td>
                      <td className="py-2 pr-2">
                        {new Date(row.expectedDeliveryDate).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="py-2 pr-2">{formatExecutiveInteger(row.daysOverdue)} d</td>
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
