import React, { useMemo } from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import {
  RAW_MATERIAL_PLANNING_CONFIDENCE_LABELS,
  RAW_MATERIAL_PLANNING_STATUS_LABELS,
  type RawMaterialPlanningRow,
} from "@/src/components/materials/rawMaterialPlanningUi";
import { RawMaterialPlanningDetailContent } from "@/src/components/materials/RawMaterialPlanningTable";

/**
 * PDF de UMA matéria-prima do Planejamento — mesmo layout/CSS do relatório
 * geral (reaproveita raw-material-planning-print.css via a classe
 * .rmp-print-root), mas só com o racional daquela linha: memória do
 * cálculo, linha do tempo projetada, pedidos consumidores e entradas
 * confirmadas. Nenhuma lib nova, nenhum CSS novo — mesmo window.print()
 * já usado pelo relatório principal.
 */
export function RawMaterialPlanningMaterialPrintDocument({
  row,
  branding,
}: {
  row: RawMaterialPlanningRow;
  branding: BrandingSettingsDTO;
}) {
  const metaLines = useMemo(
    () => [
      { label: "Emitido em", value: formatFinanceDateTime(new Date().toISOString()) },
      { label: "Situação", value: RAW_MATERIAL_PLANNING_STATUS_LABELS[row.situation] },
      { label: "Confiança", value: RAW_MATERIAL_PLANNING_CONFIDENCE_LABELS[row.confidence] },
    ],
    [row]
  );

  return (
    <div id="rmp-material-print-root" className="rmp-print-root">
      <div className="rmp-print-document">
        <PrintHeader
          branding={branding}
          documentTitle={`${row.code ? `[${row.code}] ` : ""}${row.description}`}
          documentHighlight="Memória do Cálculo — Matéria-Prima"
          metaLines={metaLines}
          className="print-doc-header"
        />
        <section className="rmp-print-section">
          <RawMaterialPlanningDetailContent row={row} defaultOpenMemory />
        </section>
      </div>
    </div>
  );
}
