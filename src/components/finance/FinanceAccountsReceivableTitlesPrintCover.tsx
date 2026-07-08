import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { FinanceArTitlesPrintBrand } from "@/src/components/finance/FinanceArTitlesPrintBrand";
import type { FinanceArAnalyticalUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceCurrency,
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildFinanceArTitlesPrintFilterLines,
  FINANCE_AR_TITLES_PRINT_DATA_SOURCE,
  FINANCE_AR_TITLES_PRINT_DISCLAIMER,
  FINANCE_AR_TITLES_PRINT_SUBTITLE,
  FINANCE_AR_TITLES_PRINT_TITLE,
  getFinanceArTitlesPrintCoverSections,
} from "@/src/lib/financeArTitlesPrintMeta";
import type { FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles";
import { safeTrim } from "@/src/lib/safeTrim";

function coverCustomerLabel(filters: FinanceArAnalyticalUiFilters): string | null {
  const name = safeTrim(filters.customerName) || safeTrim(filters.personName);
  return name || null;
}

export function FinanceAccountsReceivableTitlesPrintCover({
  payload,
  filters,
  generatedAt,
  emitterName,
  titlesCount,
  branding,
}: {
  payload: FinanceArTitlesPayload;
  filters: FinanceArAnalyticalUiFilters;
  generatedAt: string;
  emitterName?: string | null;
  titlesCount: number;
  branding: BrandingSettingsDTO;
}) {
  const { summary } = payload;
  const filterLines = buildFinanceArTitlesPrintFilterLines(filters);
  const customerLabel = coverCustomerLabel(filters);

  const kpiCards = [
    { label: "Títulos", value: formatFinanceInteger(titlesCount), tone: "neutral" as const },
    { label: "Valor original", value: formatFinanceCurrency(summary.totalOriginalValue), tone: "neutral" as const },
    { label: "Valor recebido", value: formatFinanceCurrency(summary.totalReceivedValue), tone: "received" as const },
    { label: "Em aberto", value: formatFinanceCurrency(summary.totalOpenValue), tone: "open" as const },
    { label: "Vencido", value: formatFinanceCurrency(summary.totalOverdueValue), tone: "risk" as const },
    { label: "A vencer", value: formatFinanceCurrency(summary.totalDueValue), tone: "success" as const },
    { label: "Ticket médio", value: formatFinanceCurrency(summary.averageTicket), tone: "neutral" as const, wide: true },
  ];

  return (
    <section className="finance-ar-titles-print-cover-page" aria-label="Capa do relatório">
      <div className="finance-ar-titles-print-cover-inner">
        <FinanceArTitlesPrintBrand branding={branding} />

        <h1 className="finance-ar-titles-print-cover-title">{FINANCE_AR_TITLES_PRINT_TITLE}</h1>
        <p className="finance-ar-titles-print-cover-subtitle">{FINANCE_AR_TITLES_PRINT_SUBTITLE}</p>

        {customerLabel ? (
          <p className="finance-ar-titles-print-cover-customer">
            <span className="finance-ar-titles-print-cover-label">Cliente: </span>
            {customerLabel}
          </p>
        ) : null}

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
            <p className="finance-ar-titles-print-cover-label">Origem dos dados</p>
            <p className="finance-ar-titles-print-cover-value">{FINANCE_AR_TITLES_PRINT_DATA_SOURCE}</p>
          </div>
        </div>

        {filterLines.length > 0 ? (
          <div className="finance-ar-titles-print-filter-band">
            <p className="finance-ar-titles-print-filter-band-label">Filtros aplicados</p>
            <p className="finance-ar-titles-print-filter-band-value">{filterLines.join(" · ")}</p>
          </div>
        ) : null}

        <div className="finance-ar-titles-print-cover-kpi-panel">
          <p className="finance-ar-titles-print-cover-kpi-heading">Resumo executivo</p>
          <div className="finance-ar-titles-print-cover-kpi-grid">
            {kpiCards.map((card) => (
              <div
                key={card.label}
                className={[
                  "finance-ar-titles-print-cover-kpi-card",
                  card.wide ? "finance-ar-titles-print-cover-kpi-card--wide" : "",
                  card.tone !== "neutral" ? `finance-ar-titles-print-cover-kpi-card--${card.tone}` : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <p className="finance-ar-titles-print-cover-kpi-label">{card.label}</p>
                <p className="finance-ar-titles-print-cover-kpi-value">{card.value}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="finance-ar-titles-print-cover-disclaimer">{FINANCE_AR_TITLES_PRINT_DISCLAIMER}</p>

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
