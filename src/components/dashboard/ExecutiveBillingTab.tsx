import React from "react";
import { Link } from "react-router-dom";
import type { BillingDashboardTab } from "@/src/lib/executiveDashboardTypes";
import { formatExecutiveCurrency, formatExecutiveInteger } from "@/src/lib/executiveDashboardFormatters";
import {
  ExecutiveCumulativeChart,
  ExecutiveMonthlyComboChart,
  ExecutiveRealizedVsProjectedChart,
  ExecutiveTargetPanel,
} from "@/src/components/dashboard/ExecutiveDashboardCharts";

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
      <p className="rounded-xl border border-border bg-accent/20 px-4 py-3 text-xs text-muted-foreground">
        {tab.marketBillingNote}
      </p>

      <SummaryCards cards={tab.summaryCards} />

      <ExecutiveTargetPanel title="Meta do mês — realizado vs ano anterior (+30%)" target={tab.target} />

      <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
        <h3 className="mb-4 text-lg font-bold">Comparativo anual acumulado</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "YTD ano atual", value: tab.yearComparison.formatted.yearToDateCurrent },
            { label: "YTD ano anterior", value: tab.yearComparison.formatted.yearToDatePrevious },
            { label: "Ano anterior (total)", value: tab.yearComparison.formatted.previousYearTotal },
            { label: "Meta anual (+30%)", value: tab.yearComparison.formatted.annualTarget },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl border border-border bg-accent/20 p-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{item.label}</p>
              <p className="mt-1 truncate text-lg font-black" title={item.value}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <ExecutiveRealizedVsProjectedChart
          title="Realizado vs projetado vs meta"
          data={tab.realizedVsProjected}
          config={tab.chartSeries}
        />
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold">Projeção do mês</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-border bg-accent/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Média faturamento/dia útil YTD
              </p>
              <p className="mt-2 text-xl font-black">{tab.projection.formatted.dailyAverage}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {tab.projection.workdaysElapsed} dias úteis decorridos no ano
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground" title={tab.projection.ytdDailyAverageHint}>
                {tab.projection.ytdDailyAverageHint}
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-accent/20 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Projeção do mês (YTD)
              </p>
              <p className="mt-2 text-xl font-black">{tab.projection.formatted.projectedMonth}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Média YTD × {tab.projection.workdaysInMonth} dias úteis no mês
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-accent/20 p-4 sm:col-span-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Projeção anual (YTD)
              </p>
              <p className="mt-2 text-xl font-black">{tab.projection.formatted.projectedYear}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Média YTD × {tab.projection.workdaysInYear} dias úteis no ano
              </p>
            </div>
          </div>
        </section>
      </div>

      <ExecutiveCumulativeChart
        title="Faturamento acumulado por mês"
        data={tab.cumulativeBilling}
        config={tab.chartSeries}
      />
      <ExecutiveMonthlyComboChart
        title="Faturamento mês a mês"
        series={tab.monthlySeries}
        config={tab.chartSeries}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold">Top clientes — mercado (ano)</h3>
          {tab.topCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem faturamento de mercado no ano.</p>
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
            <h3 className="text-lg font-bold">Faturamentos recentes</h3>
            <Link to="/sales-orders" className="text-xs font-bold text-primary hover:underline">
              Ver pedidos
            </Link>
          </div>
          {tab.recentInvoicedOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum faturamento de mercado registrado.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="pb-2 pr-2">Pedido</th>
                    <th className="pb-2 pr-2">Cliente</th>
                    <th className="pb-2 pr-2">Processamento</th>
                    <th className="pb-2 pr-2">Status NF</th>
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
                      <td className="py-2 pr-2">{row.invoiceStatus ?? "—"}</td>
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
