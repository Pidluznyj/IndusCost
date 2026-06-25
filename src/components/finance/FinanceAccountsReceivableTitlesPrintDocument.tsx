import React from "react";
import type { FinanceArAnalyticalUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import { safeTrim } from "@/src/lib/safeTrim";
import {
  displayFinanceText,
  formatFinanceCalculatedStatus,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { FinanceArTitleListItem, FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles";

function originLabel(origin: string): string {
  return origin === "WITH_NFE" ? "Com NF" : "Sem NF";
}

function filterLines(filters: FinanceArAnalyticalUiFilters): string[] {
  const lines: string[] = [];
  const companyName = safeTrim(filters.companyName);
  const customerName = safeTrim(filters.customerName) || safeTrim(filters.personName);
  const year = safeTrim(filters.year);
  const dueDateFrom = safeTrim(filters.dueDateFrom);
  const dueDateTo = safeTrim(filters.dueDateTo);
  const issueDateFrom = safeTrim(filters.issueDateFrom);
  const issueDateTo = safeTrim(filters.issueDateTo);
  const document = safeTrim(filters.document);
  if (companyName) lines.push(`Empresa: ${companyName}`);
  if (customerName) lines.push(`Cliente: ${customerName}`);
  if (year) lines.push(`Ano vencimento: ${year}`);
  if (filters.status !== "all") lines.push(`Status: ${filters.status}`);
  if (dueDateFrom || dueDateTo) {
    lines.push(`Vencimento: ${dueDateFrom || "…"} — ${dueDateTo || "…"}`);
  }
  if (issueDateFrom || issueDateTo) {
    lines.push(`Emissão: ${issueDateFrom || "…"} — ${issueDateTo || "…"}`);
  }
  if (document) lines.push(`Documento: ${document}`);
  if (filters.origin !== "all") lines.push(`Origem: ${filters.origin}`);
  if (filters.delaySituation !== "all") lines.push(`Situação: ${filters.delaySituation}`);
  return lines;
}

export function FinanceAccountsReceivableTitlesPrintDocument({
  payload,
  filters,
  allItems,
  generatedAt,
  emitterName,
}: {
  payload: FinanceArTitlesPayload;
  filters: FinanceArAnalyticalUiFilters;
  allItems: FinanceArTitleListItem[];
  generatedAt: string;
  emitterName?: string | null;
}) {
  const { summary } = payload;
  const applied = filterLines(filters);

  return (
    <div id="ar-titles-print-root">
      <div className="finance-ar-titles-print-document">
        <header className="finance-ar-titles-print-header">
          <div className="finance-ar-titles-print-brand">
            <span className="finance-ar-titles-print-brand-main">IndusCost</span>
            <span className="finance-ar-titles-print-brand-sub">Grupo Lazarios</span>
          </div>
          <h1 className="finance-ar-titles-print-title">Contas a Receber — Títulos</h1>
          <p className="finance-ar-titles-print-subtitle">Grid analítico de títulos filtrados</p>
          <table className="finance-ar-titles-print-meta">
            <tbody>
              <tr>
                <th>Emitido em</th>
                <td>{formatFinanceDateTime(generatedAt)}</td>
                <th>Emitido por</th>
                <td>{emitterName?.trim() || "—"}</td>
              </tr>
              {applied.length > 0 ? (
                <tr>
                  <th>Filtros aplicados</th>
                  <td colSpan={3}>{applied.join(" · ")}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </header>

        <section className="finance-ar-titles-print-section">
          <h2>Totalizadores</h2>
          <table className="finance-ar-titles-print-kpi">
            <tbody>
              <tr>
                <th>Títulos</th>
                <td>{formatFinanceInteger(summary.totalTitles)}</td>
                <th>Valor original</th>
                <td>{formatFinanceCurrency(summary.totalOriginalValue)}</td>
                <th>Valor recebido</th>
                <td>{formatFinanceCurrency(summary.totalReceivedValue)}</td>
              </tr>
              <tr>
                <th>Em aberto</th>
                <td>{formatFinanceCurrency(summary.totalOpenValue)}</td>
                <th>Vencido</th>
                <td>{formatFinanceCurrency(summary.totalOverdueValue)}</td>
                <th>A vencer</th>
                <td>{formatFinanceCurrency(summary.totalDueValue)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="finance-ar-titles-print-section">
          <h2>Títulos ({formatFinanceInteger(allItems.length)})</h2>
          <table className="finance-ar-titles-print-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Empresa</th>
                <th>Documento</th>
                <th>Emissão</th>
                <th>Vencimento</th>
                <th>Recebimento</th>
                <th>Status</th>
                <th>Dias</th>
                <th>Original</th>
                <th>Recebido</th>
                <th>Aberto</th>
              </tr>
            </thead>
            <tbody>
              {allItems.map((row) => (
                <tr key={row.externalId}>
                  <td>{displayFinanceText(row.personName)}</td>
                  <td>{displayFinanceText(row.companyName)}</td>
                  <td>
                    {displayFinanceText(
                      row.sourceInvoiceNumber ??
                        (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null)
                    )}
                  </td>
                  <td>{formatFinanceDate(row.competenceDate)}</td>
                  <td>{formatFinanceDate(row.dueDate)}</td>
                  <td>{formatFinanceDate(row.settlementDate)}</td>
                  <td>{formatFinanceCalculatedStatus(row.calculatedStatus)}</td>
                  <td>{formatFinanceDaysOverdue(row.daysOverdue)}</td>
                  <td>{formatFinanceCurrency(row.amountReceivable)}</td>
                  <td>{formatFinanceCurrency(row.amountReceived)}</td>
                  <td>{formatFinanceCurrency(row.balanceReceivable)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8}>Total</td>
                <td>{formatFinanceCurrency(summary.totalOriginalValue)}</td>
                <td>{formatFinanceCurrency(summary.totalReceivedValue)}</td>
                <td>{formatFinanceCurrency(summary.totalOpenValue)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <footer className="finance-ar-titles-print-footer">
          Gerado em {formatFinanceDateTime(generatedAt)} · Origem: Nomus Contas a Receber
        </footer>
      </div>
    </div>
  );
}
