import React from "react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";

function formatOptionalCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatCurrency(value);
}

function formatOptionalPercent(value: number | null | undefined): string {
  if (value == null) return "Sem base";
  return `${value.toFixed(1)}%`;
}

function growthStatusLabel(
  status: CustomerIntelligenceReport["history"]["analysis"]["growthStatus"]
): string {
  switch (status) {
    case "growth":
      return "Crescimento";
    case "decline":
      return "Queda";
    case "stable":
      return "Estável";
    case "sem_base":
      return "Sem base";
    default:
      return "Histórico insuficiente";
  }
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-3 shadow-sm min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </p>
      <p className="text-lg font-bold mt-1 truncate" title={value}>
        {value}
      </p>
      {hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p> : null}
    </div>
  );
}

function ExecutiveTable({
  title,
  headers,
  rows,
  emptyMessage,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  emptyMessage: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 overflow-x-auto">
      <h2 className="text-sm font-bold mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <table className="w-full text-sm border-collapse min-w-[20rem]">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              {headers.map((h) => (
                <th key={h} className="py-2 pr-3 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr key={idx} className="border-b border-border/60 last:border-0">
                {row.map((cell, cidx) => (
                  <td key={cidx} className="py-2 pr-3 whitespace-nowrap">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function CustomerIntelligencePurchasesTab({ report }: { report: CustomerIntelligenceReport }) {
  const { history, seasonality, lifetimeSummary, filteredSummary, filtersApplied } = report;
  const analysis = history.analysis;
  const hasLifetimeHistory = history.byYear.length > 0;
  const hasFilteredHistory = history.byMonth.length > 0 || filteredSummary.validOrdersCount > 0;

  const strongestMonthLabel =
    seasonality.strongestMonth?.monthName ??
    history.strongestMonths[0]?.monthName ??
    "—";

  const seasonalityMatrix = history.strongestMonths.map((m) => ({
    month: m.monthName,
    revenue: formatCurrency(m.totalRevenue),
    orders: formatNumber(m.ordersCount),
    recurrence:
      m.recurrenceScore != null ? `${(m.recurrenceScore * 100).toFixed(0)}%` : "—",
  }));

  const managerialReadings = [
    analysis.trendReading,
    seasonality.reading,
  ].filter((line): line is string => Boolean(line?.trim()));

  if (!hasLifetimeHistory && !hasFilteredHistory) {
    return (
      <div className="customer-intelligence-tab-panel rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
        <p className="font-semibold">Sem histórico de compras</p>
        <p className="text-sm text-muted-foreground mt-2">
          Não há pedidos válidos para montar evolução anual, sazonalidade ou ranking de meses.
        </p>
      </div>
    );
  }

  return (
    <div className="customer-intelligence-tab-panel space-y-5">
      {history.scopeNotice ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border bg-muted/15 px-3 py-2">
          {history.scopeNotice}
          {filtersApplied.summary ? ` Filtro: ${filtersApplied.summary}.` : null}
        </p>
      ) : null}

      <section
        className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]"
        aria-label="Indicadores de compras no filtro"
      >
        <KpiCard
          label="Total comprado (filtro)"
          value={formatCurrency(filteredSummary.revenue)}
          hint={`${formatNumber(filteredSummary.validOrdersCount)} pedido(s) válido(s)`}
        />
        <KpiCard
          label="Total histórico comprado"
          value={formatCurrency(lifetimeSummary.revenue)}
          hint={`${formatNumber(lifetimeSummary.validOrdersCount)} pedido(s) no histórico`}
        />
        <KpiCard
          label="Pedidos no filtro"
          value={formatNumber(filteredSummary.ordersCount)}
        />
        <KpiCard
          label="Pedidos históricos"
          value={formatNumber(lifetimeSummary.ordersCount)}
        />
        <KpiCard
          label="Melhor ano (filtro)"
          value={analysis.bestYear != null ? String(analysis.bestYear) : "—"}
          hint={
            analysis.bestYearRevenue != null
              ? formatCurrency(analysis.bestYearRevenue)
              : undefined
          }
        />
        <KpiCard
          label="Receita ano de referência"
          value={
            analysis.referenceYear != null ? String(analysis.referenceYear) : "—"
          }
          hint={formatOptionalCurrency(analysis.referenceYearRevenue)}
        />
        <KpiCard
          label="Crescimento vs ano anterior"
          value={formatOptionalPercent(analysis.growthPercentVsPreviousYear)}
          hint={growthStatusLabel(analysis.growthStatus)}
        />
        <KpiCard label="Mês mais forte (histórico)" value={strongestMonthLabel} />
        <KpiCard
          label="Meses ativos"
          value={formatNumber(seasonality.activeMonthsCount)}
          hint={
            seasonality.hasSeasonality ? "Sazonalidade detectada" : "Sem sazonalidade marcante"
          }
        />
      </section>

      {managerialReadings.length > 0 ? (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2">
          <h2 className="text-sm font-bold">Leitura gerencial</h2>
          <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
            {managerialReadings.map((line, idx) => (
              <li key={idx}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ExecutiveTable
          title="Histórico por ano (total disponível)"
          headers={["Ano", "Pedidos", "Receita", "Ticket médio", "Crescimento YoY"]}
          emptyMessage="Sem dados anuais."
          rows={history.byYear.map((y) => [
            String(y.year),
            formatNumber(y.ordersCount),
            formatCurrency(y.revenue),
            formatOptionalCurrency(y.averageTicket),
            formatOptionalPercent(y.growthPercentVsPreviousYear),
          ])}
        />
        <ExecutiveTable
          title="Receita por ano (total disponível)"
          headers={["Ano", "Receita", "Margem", "Margem %", "Pedidos válidos"]}
          emptyMessage="Sem dados anuais."
          rows={history.byYear.map((y) => [
            String(y.year),
            formatCurrency(y.revenue),
            formatOptionalCurrency(y.marginAmount),
            y.marginPercent != null ? `${y.marginPercent.toFixed(1)}%` : "—",
            formatNumber(y.validOrdersCount),
          ])}
        />
      </div>

      <ExecutiveTable
        title="Histórico mensal (filtro)"
        headers={["Período", "Pedidos", "Receita", "Ticket médio"]}
        emptyMessage="Sem dados mensais."
        rows={history.byMonth.map((m) => [
          m.label,
          formatNumber(m.ordersCount),
          formatCurrency(m.revenue),
          formatOptionalCurrency(m.averageTicket),
        ])}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ExecutiveTable
          title="Matriz de sazonalidade (mês calendário)"
          headers={["Mês", "Receita acumulada", "Pedidos", "Recorrência"]}
          emptyMessage="Sem base para sazonalidade."
          rows={seasonalityMatrix.map((m) => [m.month, m.revenue, m.orders, m.recurrence])}
        />
        <ExecutiveTable
          title="Ranking — meses mais fortes"
          headers={["#", "Mês", "Receita", "Pedidos", "Rank qtd."]}
          emptyMessage="Sem meses ranqueados."
          rows={history.strongestMonths.slice(0, 12).map((m) => [
            String(m.rankByRevenue),
            m.monthName,
            formatCurrency(m.totalRevenue),
            formatNumber(m.ordersCount),
            String(m.rankByQuantity),
          ])}
        />
      </div>

      {analysis.declinedYear != null && analysis.bestYear != null ? (
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <p>
            <span className="font-semibold">Ano mais fraco no histórico:</span>{" "}
            {analysis.declinedYear} ({formatOptionalCurrency(analysis.declinedYearRevenue)})
            {analysis.bestYear !== analysis.declinedYear ? (
              <>
                {" "}
                — melhor desempenho em {analysis.bestYear} (
                {formatOptionalCurrency(analysis.bestYearRevenue)}).
              </>
            ) : null}
          </p>
        </section>
      ) : null}
    </div>
  );
}
