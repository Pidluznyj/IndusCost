import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { FinanceArTitlesPrintBrand } from "@/src/components/finance/FinanceArTitlesPrintBrand";
import type { FinanceArAnalyticalUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildFinanceArTitlesPrintFilterLines,
  FINANCE_AR_TITLES_PRINT_DATA_SOURCE,
  FINANCE_AR_TITLES_PRINT_SUBTITLE,
  FINANCE_AR_TITLES_PRINT_TITLE,
} from "@/src/lib/financeArTitlesPrintMeta";
import { safeTrim } from "@/src/lib/safeTrim";

function coverCustomerLabel(filters: FinanceArAnalyticalUiFilters): string | null {
  const name = safeTrim(filters.customerName) || safeTrim(filters.personName);
  return name || null;
}

/** Cabeçalho executivo compacto — logo à esquerda, metadados à direita (sem quebra de página). */
export function FinanceAccountsReceivableTitlesPrintCover({
  filters,
  generatedAt,
  emitterName,
  titlesCount,
  branding,
}: {
  filters: FinanceArAnalyticalUiFilters;
  generatedAt: string;
  emitterName?: string | null;
  titlesCount: number;
  branding: BrandingSettingsDTO;
}) {
  const filterLines = buildFinanceArTitlesPrintFilterLines(filters);
  const customerLabel = coverCustomerLabel(filters);

  return (
    <header className="finance-ar-titles-print-executive-header" aria-label="Cabeçalho do relatório">
      <div className="finance-ar-titles-print-executive-header-row">
        <FinanceArTitlesPrintBrand branding={branding} />
        <div className="finance-ar-titles-print-executive-header-text">
          <h1 className="finance-ar-titles-print-executive-title">{FINANCE_AR_TITLES_PRINT_TITLE}</h1>
          <p className="finance-ar-titles-print-executive-subtitle">{FINANCE_AR_TITLES_PRINT_SUBTITLE}</p>
          {customerLabel ? (
            <p className="finance-ar-titles-print-executive-customer">Cliente: {customerLabel}</p>
          ) : null}
          <p className="finance-ar-titles-print-executive-origin">
            Origem: {FINANCE_AR_TITLES_PRINT_DATA_SOURCE}
          </p>
        </div>
      </div>

      <div className="finance-ar-titles-print-meta-cards">
        <div className="finance-ar-titles-print-meta-card">
          <p className="finance-ar-titles-print-meta-card-label">Emitido em</p>
          <p className="finance-ar-titles-print-meta-card-value">{formatFinanceDateTime(generatedAt)}</p>
        </div>
        <div className="finance-ar-titles-print-meta-card">
          <p className="finance-ar-titles-print-meta-card-label">Emitido por</p>
          <p className="finance-ar-titles-print-meta-card-value">{emitterName?.trim() || "—"}</p>
        </div>
        <div className="finance-ar-titles-print-meta-card">
          <p className="finance-ar-titles-print-meta-card-label">Origem dos dados</p>
          <p className="finance-ar-titles-print-meta-card-value">{FINANCE_AR_TITLES_PRINT_DATA_SOURCE}</p>
        </div>
        <div className="finance-ar-titles-print-meta-card">
          <p className="finance-ar-titles-print-meta-card-label">Títulos no relatório</p>
          <p className="finance-ar-titles-print-meta-card-value">{formatFinanceInteger(titlesCount)}</p>
        </div>
      </div>

      {filterLines.length > 0 ? (
        <div className="finance-ar-titles-print-filter-band">
          <p className="finance-ar-titles-print-filter-band-label">Filtros aplicados</p>
          <p className="finance-ar-titles-print-filter-band-value">{filterLines.join(" · ")}</p>
        </div>
      ) : null}
    </header>
  );
}
