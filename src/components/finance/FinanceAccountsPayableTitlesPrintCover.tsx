import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import type { FinanceApUiFilters } from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  formatFinanceDateTime,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import {
  buildFinanceApTitlesPrintFilterLines,
  FINANCE_AP_TITLES_PRINT_DATA_SOURCE,
  FINANCE_AP_TITLES_PRINT_SUBTITLE,
} from "@/src/lib/financeApTitlesPrintMeta";
import { safeTrim } from "@/src/lib/safeTrim";

function coverSupplierLabel(filters: FinanceApUiFilters): string | null {
  const name = safeTrim(filters.personName);
  return name || null;
}

/** Cabeçalho institucional — mesmo padrão do PDF de Contas a Receber > Títulos. */
export function FinanceAccountsPayableTitlesPrintCover({
  filters,
  generatedAt,
  emitterName,
  titlesCount,
  branding,
}: {
  filters: FinanceApUiFilters;
  generatedAt: string;
  emitterName?: string | null;
  titlesCount: number;
  branding: BrandingSettingsDTO;
}) {
  const filterLines = buildFinanceApTitlesPrintFilterLines(filters);
  const supplierLabel = coverSupplierLabel(filters);

  const metaLines = useMemo(() => {
    const lines = [
      { label: "Emitido em", value: formatFinanceDateTime(generatedAt) },
      { label: "Emitido por", value: emitterName?.trim() || "—" },
      { label: "Títulos", value: formatFinanceInteger(titlesCount) },
      { label: "Origem", value: FINANCE_AP_TITLES_PRINT_DATA_SOURCE },
    ];
    if (supplierLabel) {
      lines.unshift({ label: "Fornecedor", value: supplierLabel });
    }
    return lines;
  }, [emitterName, generatedAt, supplierLabel, titlesCount]);

  return (
    <div className="finance-ap-titles-print-cover">
      <PrintHeader
        branding={branding}
        documentTitle="CONTAS A PAGAR"
        documentHighlight="TÍTULOS"
        metaLines={metaLines}
        subtitle={FINANCE_AP_TITLES_PRINT_SUBTITLE}
        className="finance-ap-titles-print-doc-header"
      />

      {filterLines.length > 0 ? (
        <div className="finance-ap-titles-print-filter-band">
          <p className="finance-ap-titles-print-filter-band-label">Filtros aplicados</p>
          <p className="finance-ap-titles-print-filter-band-value">{filterLines.join(" · ")}</p>
        </div>
      ) : null}
    </div>
  );
}
