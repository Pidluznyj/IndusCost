import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { formatFinanceDateTime, formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import type { RawMaterialPlanningResponse } from "@/src/components/materials/rawMaterialPlanningUi";
import { RawMaterialPlanningTable } from "@/src/components/materials/RawMaterialPlanningTable";
import type { MaterialDemandFilterChip } from "@/src/components/contextual/MaterialDemandDashboardPanels";

export function RawMaterialPlanningPrintDocument({
  data,
  branding,
  filterChips,
}: {
  data: RawMaterialPlanningResponse;
  branding: BrandingSettingsDTO;
  filterChips: MaterialDemandFilterChip[];
}) {
  const filterLines = filterChips.map((chip) => chip.label).join(" · ");

  const metaLines = useMemo(() => {
    return [
      { label: "Emitido em", value: formatFinanceDateTime(data.generatedAt) },
      { label: "Materiais analisados", value: formatFinanceInteger(data.materials.length) },
      { label: "Data-base", value: formatFinanceDateTime(data.asOfDate + "T00:00:00Z").substring(0, 10) },
      { label: "Horizonte (dias)", value: data.horizon },
    ];
  }, [data]);

  return (
    <div id="rmp-print-root">
      <div className="rmp-print-document">
        <PrintHeader
          branding={branding}
          documentTitle="Planejamento de Matéria-Prima"
          documentHighlight="Relatório Gerencial"
          metaLines={metaLines}
          className="print-doc-header"
        />

        {filterLines ? (
          <div className="rmp-print-filter-band">
            <p className="rmp-print-filter-band-label">Filtros aplicados</p>
            <p className="rmp-print-filter-band-value">{filterLines}</p>
          </div>
        ) : null}

        <section className="rmp-print-section">
          {data.materials.length === 0 ? (
            <p style={{ marginTop: "1rem" }}>Nenhum material encontrado com os filtros atuais.</p>
          ) : (
            <RawMaterialPlanningTable
              rows={data.materials}
              expandedMaterialId={null}
              onToggleRow={() => {}}
            />
          )}
        </section>
      </div>
    </div>
  );
}
