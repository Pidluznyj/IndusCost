/**
 * Helpers puros da Central de Atualização Nomus — seguros para frontend e backend.
 * NÃO importar Prisma, @prisma/client ou libs server-side neste arquivo.
 */

import type { CockpitRow, CockpitTotals } from "@/src/lib/nomusEngineeringOperationsCockpitTypes";

export function aggregateCockpitTotals(rows: CockpitRow[]): CockpitTotals {
  let noChanges = 0;
  let ready = 0;
  let needsReview = 0;
  let blocked = 0;
  let newProducts = 0;
  let bomChanged = 0;
  let optionalPending = 0;
  let localExceptions = 0;
  let assemblyLocalExceptions = 0;
  let ambiguous = 0;
  let missingMaterials = 0;
  let missingProducts = 0;

  for (const r of rows) {
    switch (r.operatorStatus) {
      case "OK":
        noChanges += 1;
        break;
      case "READY":
        ready += 1;
        break;
      case "REVIEW":
        needsReview += 1;
        break;
      case "BLOCKED":
        blocked += 1;
        break;
      case "NEW":
        newProducts += 1;
        break;
      case "LOCAL":
        localExceptions += 1;
        break;
      case "OPTIONAL":
        optionalPending += 1;
        break;
      case "AMBIGUOUS":
        ambiguous += 1;
        break;
    }
    if (r.hasStructuralChanges) bomChanged += 1;
    if (r.hasAssemblyLocalException) assemblyLocalExceptions += 1;
    if (r.hasMissingMaterials) missingMaterials += 1;
    if (r.hasMissingChildProducts) missingProducts += 1;
  }

  return {
    total: rows.length,
    noChanges,
    ready,
    needsReview,
    blocked,
    newProducts,
    bomChanged,
    optionalPending,
    localExceptions,
    assemblyLocalExceptions,
    ambiguous,
    missingMaterials,
    missingProducts,
  };
}
