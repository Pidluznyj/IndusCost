import React from "react";
import {
  dailyRadarDayCardLabel,
  type DailyRadarPayableRow,
  type DailyRadarReceivableRow,
} from "@/src/lib/financeCashFlowDailyRadar";
import type { FinanceExecutiveReportCashRadar } from "@/src/lib/financeExecutiveReportCashRadar";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import { formatDailyRadarPayableScheduledDisplay } from "@/src/lib/financeCashFlowDailyRadar";
import { cn } from "@/src/lib/utils";

function netTone(net: number): string {
  if (net > 0) return "text-[#059669]";
  if (net < 0) return "text-[#DC2626]";
  return "text-[#6B7280]";
}

export function FinanceCashFlowDailyRadarPdfSection({
  cashRadar,
}: {
  cashRadar: FinanceExecutiveReportCashRadar;
}) {
  const payload = cashRadar.radarPayload;
  const detail = cashRadar.selectedRangeDetail ?? payload.selectedDetail;
  const rangeSummary = cashRadar.ranges.find((r) => r.key === cashRadar.defaultOpenRange);

  return (
    <div
      className="executive-report-cash-radar-pdf space-y-4"
      data-testid="executive-report-cash-radar-pdf"
    >
      <div>
        <h2 className="executive-print-section-title text-base font-bold text-[#111827]">
          Radar Diário de Caixa
        </h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          Comparativo diário de entradas e saídas conforme os filtros do Relatório Presidencial.
        </p>
        <p className="text-[10px] text-[#9CA3AF] mt-1">
          Data-base operacional: {formatFinanceDate(cashRadar.baseDate)}
        </p>
      </div>

      <div className="executive-print-filter-lines text-[10px] text-[#374151]">
        <strong>Filtros aplicados:</strong>{" "}
        {cashRadar.filtersApplied
          .filter((f) => !f.notApplicable)
          .map((f) => `${f.label}: ${f.value}`)
          .join(" · ")}
      </div>

      <div className="grid grid-cols-2 gap-2 executive-print-cash-radar-ranges">
        {cashRadar.ranges.map((range) => (
          <div
            key={range.key}
            className={cn(
              "rounded-lg border border-[#E5E7EB] p-3 text-[10px]",
              range.key === cashRadar.defaultOpenRange && "ring-1 ring-[#2563EB]"
            )}
            data-testid={`executive-report-cash-radar-pdf-range-${range.key}`}
          >
            <p className="font-bold uppercase text-[#6B7280]">{range.label}</p>
            <p className="text-[#059669]">Entradas: {formatFinanceCurrency(range.receivableTotal)}</p>
            <p className="text-[#DC2626]">Saídas: {formatFinanceCurrency(range.payableTotal)}</p>
            <p className={netTone(range.netTotal)}>
              Saldo: {formatFinanceCurrency(range.netTotal)}
            </p>
            <p className="text-[#9CA3AF]">
              {formatFinanceInteger(range.receivableCount)} AR · {formatFinanceInteger(range.payableCount)} AP
            </p>
          </div>
        ))}
      </div>

      {payload.selectedRange && rangeSummary ? (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-[#111827]">
            Dias da faixa: {rangeSummary.label}
          </h3>
          <table className="executive-print-data-table w-full text-[9px]">
            <thead>
              <tr>
                <th>Dia</th>
                <th>Data</th>
                <th>Entradas</th>
                <th>Saídas</th>
                <th>Saldo</th>
                <th>AR</th>
                <th>AP</th>
              </tr>
            </thead>
            <tbody>
              {payload.selectedRange.days.map((day) => (
                <tr key={day.date}>
                  <td>{dailyRadarDayCardLabel(day.dayOffset)}</td>
                  <td>{formatFinanceDate(day.date)}</td>
                  <td>{formatFinanceCurrency(day.receivableTotal)}</td>
                  <td>{formatFinanceCurrency(day.payableTotal)}</td>
                  <td>{formatFinanceCurrency(day.netTotal)}</td>
                  <td>{formatFinanceInteger(day.receivableCount)}</td>
                  <td>{formatFinanceInteger(day.payableCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {detail ? (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-[#111827]">
            Detalhe da faixa — {detail.rangeLabel}
          </h3>
          <p className="text-[10px] text-[#374151]">
            Entradas: {formatFinanceCurrency(detail.entriesTotal)} · Saídas:{" "}
            {formatFinanceCurrency(detail.exitsTotal)} · Saldo:{" "}
            {formatFinanceCurrency(detail.netTotal)}
          </p>

          <div className="space-y-2">
            <h4 className="text-xs font-bold">Contas a Receber</h4>
            {detail.receivables.summary.count === 0 ? (
              <p className="text-[10px] text-[#6B7280]">
                Nenhuma conta a receber encontrada na faixa.
              </p>
            ) : (
              <table className="executive-print-data-table w-full text-[8px]">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Empresa</th>
                    <th>Descrição</th>
                    <th>Documento/NF</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.receivables.rows.map((row: DailyRadarReceivableRow) => (
                    <tr key={row.id}>
                      <td>{displayFinanceText(row.customer)}</td>
                      <td>{displayFinanceText(row.company)}</td>
                      <td>{displayFinanceText(row.description)}</td>
                      <td>{displayFinanceText(row.document)}</td>
                      <td>{formatFinanceDate(row.operationalDate)}</td>
                      <td>{formatFinanceCurrency(row.amount)}</td>
                      <td>{displayFinanceText(row.status)}</td>
                      <td>Nomus AR</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td colSpan={5}>Total ({formatFinanceInteger(detail.receivables.summary.count)})</td>
                    <td>{formatFinanceCurrency(detail.receivables.summary.total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold">Contas a Pagar</h4>
            {detail.payables.summary.count === 0 ? (
              <p className="text-[10px] text-[#6B7280]">
                Nenhuma conta a pagar encontrada na faixa.
              </p>
            ) : (
              <table className="executive-print-data-table w-full text-[8px]">
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>Empresa</th>
                    <th>Descrição</th>
                    <th>Documento/NF</th>
                    <th>Vencimento</th>
                    <th>Valor</th>
                    <th>Status</th>
                    <th>Origem</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.payables.rows.map((row: DailyRadarPayableRow) => (
                    <tr key={row.id}>
                      <td>{displayFinanceText(row.supplier)}</td>
                      <td>{displayFinanceText(row.company)}</td>
                      <td>{displayFinanceText(row.description)}</td>
                      <td>{displayFinanceText(row.document)}</td>
                      <td>{formatDailyRadarPayableScheduledDisplay(row)}</td>
                      <td>{formatFinanceCurrency(row.amount)}</td>
                      <td>{displayFinanceText(row.status)}</td>
                      <td>Nomus AP</td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td colSpan={5}>Total ({formatFinanceInteger(detail.payables.summary.count)})</td>
                    <td>{formatFinanceCurrency(detail.payables.summary.total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
