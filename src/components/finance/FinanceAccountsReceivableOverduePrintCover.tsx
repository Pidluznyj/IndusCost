import React from "react";
import type { FinanceArUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildArOverduePrintFilterLines,
  FINANCE_AR_OVERDUE_PRINT_SUBTITLE,
  FINANCE_AR_OVERDUE_PRINT_TITLE,
  formatArOverduePrintPeriod,
  formatArOverduePrintScope,
} from "@/src/lib/financeAccountsReceivableOverduePrintMeta";
import type {
  FinanceArOverduePayload,
  FinanceArOverdueUiFilters,
} from "@/src/lib/financeAccountsReceivableOverdueTypes";

const COVER_SECTIONS = [
  "Resumo executivo",
  "Aging de atraso",
  "Clientes prioritários para cobrança",
  "Detalhamento dos títulos vencidos por cliente",
] as const;

export function FinanceAccountsReceivableOverduePrintCover({
  payload,
  globalFilters,
  overdueFilters,
  emitterName,
}: {
  payload: FinanceArOverduePayload;
  globalFilters: FinanceArUiFilters;
  overdueFilters: FinanceArOverdueUiFilters;
  emitterName?: string | null;
}) {
  const { summary } = payload;
  const periodLabel = formatArOverduePrintPeriod(globalFilters);
  const scopeLabel = formatArOverduePrintScope(globalFilters);
  const filterLines = buildArOverduePrintFilterLines(globalFilters, overdueFilters);
  const topAging = payload.agingBuckets.filter((b) => b.amount > 0).slice(0, 4);

  return (
    <section className="finance-ar-overdue-print-cover-page" aria-label="Capa do relatório">
      <div className="finance-ar-overdue-print-cover-inner">
        <div className="finance-ar-overdue-print-cover-brand">
          <span className="finance-ar-overdue-print-brand-main">IndusCost</span>
          <span className="finance-ar-overdue-print-brand-sub">Grupo Lazarios</span>
        </div>

        <h1 className="finance-ar-overdue-print-cover-title">{FINANCE_AR_OVERDUE_PRINT_TITLE}</h1>
        <p className="finance-ar-overdue-print-cover-subtitle">{FINANCE_AR_OVERDUE_PRINT_SUBTITLE}</p>

        <div className="finance-ar-overdue-print-cover-meta-grid">
          <div>
            <p className="finance-ar-overdue-print-cover-label">Emitido em</p>
            <p className="finance-ar-overdue-print-cover-value">
              {formatFinanceDateTime(payload.generatedAt)}
            </p>
          </div>
          <div>
            <p className="finance-ar-overdue-print-cover-label">Emitido por</p>
            <p className="finance-ar-overdue-print-cover-value">{emitterName?.trim() || "—"}</p>
          </div>
          <div>
            <p className="finance-ar-overdue-print-cover-label">Período analisado</p>
            <p className="finance-ar-overdue-print-cover-value">{periodLabel}</p>
          </div>
          <div>
            <p className="finance-ar-overdue-print-cover-label">Referência de atraso</p>
            <p className="finance-ar-overdue-print-cover-value">
              {formatFinanceDate(payload.referenceDate)}
            </p>
          </div>
          <div>
            <p className="finance-ar-overdue-print-cover-label">Escopo</p>
            <p className="finance-ar-overdue-print-cover-value">{scopeLabel}</p>
          </div>
          <div>
            <p className="finance-ar-overdue-print-cover-label">Origem dos dados</p>
            <p className="finance-ar-overdue-print-cover-value">Contas a Receber Nomus</p>
          </div>
        </div>

        {filterLines.length > 0 ? (
          <p className="finance-ar-overdue-print-cover-filters">
            <span className="finance-ar-overdue-print-cover-label">Filtros: </span>
            {filterLines.join(" · ")}
          </p>
        ) : null}

        <div className="finance-ar-overdue-print-cover-kpi-panel">
          <p className="finance-ar-overdue-print-cover-kpi-heading">Resumo do relatório</p>
          <div className="finance-ar-overdue-print-cover-kpi-grid">
            <div className="finance-ar-overdue-print-cover-kpi-card">
              <p className="finance-ar-overdue-print-cover-kpi-label">Total vencido</p>
              <p className="finance-ar-overdue-print-cover-kpi-value">
                {formatFinanceCurrency(summary.totalOverdueAmount)}
              </p>
            </div>
            <div className="finance-ar-overdue-print-cover-kpi-card">
              <p className="finance-ar-overdue-print-cover-kpi-label">Títulos vencidos</p>
              <p className="finance-ar-overdue-print-cover-kpi-value">
                {formatFinanceInteger(summary.overdueTitlesCount)}
              </p>
            </div>
            <div className="finance-ar-overdue-print-cover-kpi-card">
              <p className="finance-ar-overdue-print-cover-kpi-label">Clientes em atraso</p>
              <p className="finance-ar-overdue-print-cover-kpi-value">
                {formatFinanceInteger(summary.overdueCustomersCount)}
              </p>
            </div>
            <div className="finance-ar-overdue-print-cover-kpi-card">
              <p className="finance-ar-overdue-print-cover-kpi-label">Média de atraso</p>
              <p className="finance-ar-overdue-print-cover-kpi-value">
                {summary.averageDaysOverdue != null
                  ? `${formatFinanceInteger(summary.averageDaysOverdue)} dias`
                  : "—"}
              </p>
            </div>
            <div className="finance-ar-overdue-print-cover-kpi-card">
              <p className="finance-ar-overdue-print-cover-kpi-label">Maior atraso</p>
              <p className="finance-ar-overdue-print-cover-kpi-value">
                {summary.maxDaysOverdue != null
                  ? `${formatFinanceInteger(summary.maxDaysOverdue)} dias`
                  : "—"}
              </p>
            </div>
            <div className="finance-ar-overdue-print-cover-kpi-card finance-ar-overdue-print-cover-kpi-card--wide">
              <p className="finance-ar-overdue-print-cover-kpi-label">Maior cliente devedor</p>
              <p className="finance-ar-overdue-print-cover-kpi-value">
                {summary.topOverdueCustomer
                  ? `${displayFinanceText(summary.topOverdueCustomer.name)} (${formatFinanceCurrency(summary.topOverdueCustomer.amount)})`
                  : "—"}
              </p>
            </div>
          </div>
        </div>

        {topAging.length > 0 ? (
          <div className="finance-ar-overdue-print-cover-aging">
            <p className="finance-ar-overdue-print-cover-label">Principais faixas de aging</p>
            <ul className="finance-ar-overdue-print-cover-aging-list">
              {topAging.map((row) => (
                <li key={row.key}>
                  {row.bucket}: {formatFinanceCurrency(row.amount)} ({row.titlesCount} tít.)
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="finance-ar-overdue-print-cover-contents">
          <p className="finance-ar-overdue-print-cover-label">Conteúdo nas próximas páginas</p>
          <ol className="finance-ar-overdue-print-cover-contents-list">
            {COVER_SECTIONS.map((section) => (
              <li key={section}>{section}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
