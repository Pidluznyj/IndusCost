import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
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

/** Cabeçalho institucional — mesmo grid 3 colunas da proposta/pedido de venda. */
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

  const metaLines = useMemo(() => {
    const lines = [
      { label: "Emitido em", value: formatFinanceDateTime(generatedAt) },
      { label: "Emitido por", value: emitterName?.trim() || "—" },
      { label: "Títulos", value: formatFinanceInteger(titlesCount) },
      { label: "Origem", value: FINANCE_AR_TITLES_PRINT_DATA_SOURCE },
    ];
    if (customerLabel) {
      lines.unshift({ label: "Cliente", value: customerLabel });
    }
    return lines;
  }, [customerLabel, emitterName, generatedAt, titlesCount]);

  return (
    <div className="finance-ar-titles-print-cover">
      <PrintHeader
        branding={branding}
        documentTitle="CONTAS A RECEBER"
        documentHighlight="TÍTULOS"
        metaLines={metaLines}
        subtitle={FINANCE_AR_TITLES_PRINT_SUBTITLE}
        className="finance-ar-titles-print-doc-header"
      />

      {filterLines.length > 0 ? (
        <div className="finance-ar-titles-print-filter-band">
          <p className="finance-ar-titles-print-filter-band-label">Filtros aplicados</p>
          <p className="finance-ar-titles-print-filter-band-value">{filterLines.join(" · ")}</p>
        </div>
      ) : null}
    </div>
  );
}
