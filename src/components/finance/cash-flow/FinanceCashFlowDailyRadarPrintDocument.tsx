import React from "react";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { formatDailyRadarPayableScheduledDisplay } from "@/src/lib/financeCashFlowDailyRadar";
import { FINANCE_CASH_FLOW_DAILY_RADAR_EXPORT_TITLE } from "@/src/lib/financeCashFlowDailyRadarExportXlsx";
import type { FinanceCashFlowDailyRadarExportPayload } from "@/src/lib/financeCashFlowDailyRadarExport";
import { dailyRadarDayCardLabel } from "@/src/lib/financeCashFlowDailyRadar";

export function FinanceCashFlowDailyRadarPrintDocument({
  payload,
}: {
  payload: FinanceCashFlowDailyRadarExportPayload;
}) {
  const dayLabel = payload.selectedDate
    ? formatFinanceDate(payload.selectedDate)
    : "Todos os dias da faixa";

  return (
    <div id="cash-flow-daily-radar-print-root">
      <div className="finance-cash-flow-daily-radar-print-document">
        <header className="finance-cash-flow-daily-radar-print-doc-header">
          <div className="finance-cash-flow-daily-radar-print-brand">
            <span className="finance-cash-flow-daily-radar-print-brand-main">IndusCost</span>
            <span className="finance-cash-flow-daily-radar-print-brand-sub">Grupo Lazarios</span>
          </div>
          <h1 className="finance-cash-flow-daily-radar-print-doc-title">
            {FINANCE_CASH_FLOW_DAILY_RADAR_EXPORT_TITLE}
          </h1>
          <table className="finance-cash-flow-daily-radar-print-meta-table">
            <tbody>
              <tr>
                <th>Faixa</th>
                <td>{payload.rangeLabel}</td>
                <th>Dia</th>
                <td>{dayLabel}</td>
              </tr>
              <tr>
                <th>Data-base operacional</th>
                <td>{formatFinanceDate(payload.operationalBaseDate)}</td>
                <th>Emitido em</th>
                <td>{formatFinanceDateTime(payload.generatedAt)}</td>
              </tr>
              <tr>
                <th>Emitido por</th>
                <td colSpan={3}>{displayFinanceText(payload.userName)}</td>
              </tr>
            </tbody>
          </table>
        </header>

        <section className="finance-cash-flow-daily-radar-print-section">
          <h2 className="finance-cash-flow-daily-radar-print-section-title">Resumo executivo</h2>
          <table className="finance-cash-flow-daily-radar-print-kpi-table">
            <tbody>
              <tr>
                <th>Entradas</th>
                <td>{formatFinanceCurrency(payload.entriesTotal)}</td>
                <th>Saídas</th>
                <td>{formatFinanceCurrency(payload.exitsTotal)}</td>
                <th>Saldo líquido</th>
                <td>{formatFinanceCurrency(payload.netTotal)}</td>
              </tr>
              <tr>
                <th>Qtd. AR</th>
                <td>{formatFinanceInteger(payload.receivableCount)}</td>
                <th>Qtd. AP</th>
                <td>{formatFinanceInteger(payload.payableCount)}</td>
                <th />
                <td />
              </tr>
            </tbody>
          </table>
        </section>

        {payload.appliedFilters.length > 0 ? (
          <section className="finance-cash-flow-daily-radar-print-section">
            <h2 className="finance-cash-flow-daily-radar-print-section-title">Filtros aplicados</h2>
            <table className="finance-cash-flow-daily-radar-print-filter-table">
              <tbody>
                {payload.appliedFilters.map((line) => (
                  <tr key={line.label}>
                    <th>{line.label}</th>
                    <td>{line.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {payload.level === "range" && payload.daySummaries.length > 0 ? (
          <section className="finance-cash-flow-daily-radar-print-section">
            <h2 className="finance-cash-flow-daily-radar-print-section-title">
              Resumo dos dias da faixa
            </h2>
            <table className="finance-cash-flow-daily-radar-print-data-table">
              <thead>
                <tr>
                  <th>Dia</th>
                  <th>Data</th>
                  <th className="col-money">Entradas</th>
                  <th className="col-money">Saídas</th>
                  <th className="col-money">Saldo</th>
                  <th className="col-num">Qtd. AR</th>
                  <th className="col-num">Qtd. AP</th>
                </tr>
              </thead>
              <tbody>
                {payload.daySummaries.map((day) => (
                  <tr key={day.date}>
                    <td>{dailyRadarDayCardLabel(day.dayOffset)}</td>
                    <td>{formatFinanceDate(day.date)}</td>
                    <td className="col-money">{formatFinanceCurrency(day.receivableTotal)}</td>
                    <td className="col-money">{formatFinanceCurrency(day.payableTotal)}</td>
                    <td className="col-money">{formatFinanceCurrency(day.netTotal)}</td>
                    <td className="col-num">{formatFinanceInteger(day.receivableCount)}</td>
                    <td className="col-num">{formatFinanceInteger(day.payableCount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section className="finance-cash-flow-daily-radar-print-section">
          <h2 className="finance-cash-flow-daily-radar-print-section-title">Contas a Pagar</h2>
          <table className="finance-cash-flow-daily-radar-print-kpi-table">
            <tbody>
              <tr>
                <th>Títulos</th>
                <td>{formatFinanceInteger(payload.payables.summary.count)}</td>
                <th>Total a pagar</th>
                <td>{formatFinanceCurrency(payload.payables.summary.total)}</td>
                <th>Ticket médio</th>
                <td>{formatFinanceCurrency(payload.payables.summary.averageAmount)}</td>
              </tr>
              <tr>
                <th>Vencido</th>
                <td>{formatFinanceCurrency(payload.payables.summary.overdueTotal)}</td>
                <th>A vencer</th>
                <td>{formatFinanceCurrency(payload.payables.summary.upcomingTotal)}</td>
                <th>Maior título</th>
                <td>{formatFinanceCurrency(payload.payables.summary.maxAmount)}</td>
              </tr>
            </tbody>
          </table>
          {payload.payables.rows.length === 0 ? (
            <p className="finance-cash-flow-daily-radar-print-empty">
              Nenhuma conta a pagar encontrada para este filtro.
            </p>
          ) : (
            <table className="finance-cash-flow-daily-radar-print-data-table finance-cash-flow-daily-radar-print-payables-table">
              <thead>
                <tr>
                  <th className="col-supplier">Fornecedor</th>
                  <th className="col-company">Empresa</th>
                  <th className="col-description">Descrição</th>
                  <th className="col-document">Documento</th>
                  <th>Vencimento</th>
                  <th className="col-money">Valor</th>
                  <th>Agendado</th>
                </tr>
              </thead>
              <tbody>
                {payload.payables.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="col-supplier">{displayFinanceText(row.supplier)}</td>
                    <td className="col-company">{displayFinanceText(row.company)}</td>
                    <td className="col-description" title={row.description ?? undefined}>
                      {displayFinanceText(row.description)}
                    </td>
                    <td className="col-document">{displayFinanceText(row.document)}</td>
                    <td>{formatFinanceDate(row.operationalDate)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.amount)}</td>
                    <td>{formatDailyRadarPayableScheduledDisplay(row)}</td>
                  </tr>
                ))}
                <tr className="finance-cash-flow-daily-radar-print-total-row">
                  <td colSpan={5}>
                    Total ({formatFinanceInteger(payload.payables.summary.count)} título(s))
                  </td>
                  <td className="col-money">{formatFinanceCurrency(payload.payables.summary.total)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}
        </section>

        <section className="finance-cash-flow-daily-radar-print-section">
          <h2 className="finance-cash-flow-daily-radar-print-section-title">Contas a Receber</h2>
          <table className="finance-cash-flow-daily-radar-print-kpi-table">
            <tbody>
              <tr>
                <th>Títulos</th>
                <td>{formatFinanceInteger(payload.receivables.summary.count)}</td>
                <th>Total a receber</th>
                <td>{formatFinanceCurrency(payload.receivables.summary.total)}</td>
                <th>Ticket médio</th>
                <td>{formatFinanceCurrency(payload.receivables.summary.averageAmount)}</td>
              </tr>
              <tr>
                <th>Vencido</th>
                <td>{formatFinanceCurrency(payload.receivables.summary.overdueTotal)}</td>
                <th>A vencer</th>
                <td>{formatFinanceCurrency(payload.receivables.summary.upcomingTotal)}</td>
                <th>Maior título</th>
                <td>{formatFinanceCurrency(payload.receivables.summary.maxAmount)}</td>
              </tr>
            </tbody>
          </table>
          {payload.receivables.rows.length === 0 ? (
            <p className="finance-cash-flow-daily-radar-print-empty">
              Nenhuma conta a receber encontrada para este filtro.
            </p>
          ) : (
            <table className="finance-cash-flow-daily-radar-print-data-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Pedido/NF</th>
                  <th>Vencimento</th>
                  <th className="col-money">Valor</th>
                  <th>Status</th>
                  <th>Descrição</th>
                </tr>
              </thead>
              <tbody>
                {payload.receivables.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{displayFinanceText(row.customer)}</td>
                    <td>{displayFinanceText(row.document)}</td>
                    <td>{formatFinanceDate(row.operationalDate)}</td>
                    <td className="col-money">{formatFinanceCurrency(row.amount)}</td>
                    <td>{formatFinanceCalculatedStatus(row.status)}</td>
                    <td>{displayFinanceText(row.description)}</td>
                  </tr>
                ))}
                <tr className="finance-cash-flow-daily-radar-print-total-row">
                  <td colSpan={3}>
                    Total ({formatFinanceInteger(payload.receivables.summary.count)} título(s))
                  </td>
                  <td className="col-money">
                    {formatFinanceCurrency(payload.receivables.summary.total)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          )}
        </section>

        <footer className="finance-cash-flow-daily-radar-print-doc-footer">
          <p>IndusCost · {formatFinanceDateTime(payload.generatedAt)}</p>
        </footer>
      </div>
    </div>
  );
}
