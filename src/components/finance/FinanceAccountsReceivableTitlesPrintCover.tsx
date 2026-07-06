import React from "react";
import type { FinanceArAnalyticalUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildFinanceArTitlesPrintFilterLines,
  FINANCE_AR_TITLES_PRINT_SUBTITLE,
  FINANCE_AR_TITLES_PRINT_TITLE,
  getFinanceArTitlesPrintCoverSections,
} from "@/src/lib/financeArTitlesPrintMeta";
import type { FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles";

export function FinanceAccountsReceivableTitlesPrintCover({
  payload,
  filters,
  generatedAt,
  emitterName,
  titlesCount,
}: {
  payload: FinanceArTitlesPayload;
  filters: FinanceArAnalyticalUiFilters;
  generatedAt: string;
  emitterName?: string | null;
  titlesCount: number;
}) {
  const { summary } = payload;
  const filterLines = buildFinanceArTitlesPrintFilterLines(filters);

  return (
    <section className="finance-ar-titles-print-cover-page" aria-label="Capa do relatório">
      <div className="finance-ar-titles-print-cover-inner">
        <div className="finance-ar-titles-print-brand">
          <span className="finance-ar-titles-print-brand-main">IndusCost</span>
          <span className="finance-ar-titles-print-brand-sub">Grupo Lazarios</span>
        </div>

        <h1 className="finance-ar-titles-print-cover-title">{FINANCE_AR_TITLES_PRINT_TITLE}</h1>
        <p className="finance-ar-titles-print-cover-subtitle">{FINANCE_AR_TITLES_PRINT_SUBTITLE}</p>

        <div className="finance-ar-titles-print-cover-meta-grid">
          <div>
            <p className="finance-ar-titles-print-cover-label">Emitido em</p>
            <p className="finance-ar-titles-print-cover-value">{formatFinanceDateTime(generatedAt)}</p>
          </div>
          <div>
            <p className="finance-ar-titles-print-cover-label">Emitido por</p>
            <p className="finance-ar-titles-print-cover-value">{emitterName?.trim() || "—"}</p>
          </div>
          <div>
            <p className="finance-ar-titles-print-cover-label">Títulos no relatório</p>
            <p className="finance-ar-titles-print-cover-value">{formatFinanceInteger(titlesCount)}</p>
          </div>
          <div>
            <p className="finance-ar-titles-print-cover-label">Origem dos dados</p>
            <p className="finance-ar-titles-print-cover-value">Contas a Receber Nomus</p>
          </div>
        </div>

        {filterLines.length > 0 ? (
          <p className="finance-ar-titles-print-cover-filters">
            <span className="finance-ar-titles-print-cover-label">Filtros: </span>
            {filterLines.join(" · ")}
          </p>
        ) : null}

        <div className="finance-ar-titles-print-cover-kpi-panel">
          <p className="finance-ar-titles-print-cover-kpi-heading">Resumo do relatório</p>
          <div className="finance-ar-titles-print-cover-kpi-grid">
            <div className="finance-ar-titles-print-cover-kpi-card">
              <p className="finance-ar-titles-print-cover-kpi-label">Valor original</p>
              <p className="finance-ar-titles-print-cover-kpi-value">
                {formatFinanceCurrency(summary.totalOriginalValue)}
              </p>
            </div>
            <div className="finance-ar-titles-print-cover-kpi-card">
              <p className="finance-ar-titles-print-cover-kpi-label">Valor recebido</p>
              <p className="finance-ar-titles-print-cover-kpi-value">
                {formatFinanceCurrency(summary.totalReceivedValue)}
              </p>
            </div>
            <div className="finance-ar-titles-print-cover-kpi-card">
              <p className="finance-ar-titles-print-cover-kpi-label">Em aberto</p>
              <p className="finance-ar-titles-print-cover-kpi-value">
                {formatFinanceCurrency(summary.totalOpenValue)}
              </p>
            </div>
            <div className="finance-ar-titles-print-cover-kpi-card">
              <p className="finance-ar-titles-print-cover-kpi-label">Vencido</p>
              <p className="finance-ar-titles-print-cover-kpi-value">
                {formatFinanceCurrency(summary.totalOverdueValue)}
              </p>
            </div>
            <div className="finance-ar-titles-print-cover-kpi-card">
              <p className="finance-ar-titles-print-cover-kpi-label">A vencer</p>
              <p className="finance-ar-titles-print-cover-kpi-value">
                {formatFinanceCurrency(summary.totalDueValue)}
              </p>
            </div>
            <div className="finance-ar-titles-print-cover-kpi-card finance-ar-titles-print-cover-kpi-card--wide">
              <p className="finance-ar-titles-print-cover-kpi-label">Ticket médio</p>
              <p className="finance-ar-titles-print-cover-kpi-value">
                {formatFinanceCurrency(summary.averageTicket)}
              </p>
            </div>
          </div>
        </div>

        <div className="finance-ar-titles-print-cover-contents">
          <p className="finance-ar-titles-print-cover-label">Conteúdo nas próximas páginas</p>
          <ol className="finance-ar-titles-print-cover-contents-list">
            {getFinanceArTitlesPrintCoverSections().map((section) => (
              <li key={section}>{section}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
