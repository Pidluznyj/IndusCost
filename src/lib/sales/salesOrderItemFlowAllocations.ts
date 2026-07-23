/**
 * Alocações documentais e fiscais por item.
 *
 * KAN-LINK-07: exclusivamente via grafo canônico
 * (`buildSalesOrderOperationalEvidenceGraphFromPack` → adapt).
 * Resolvedores KAN-LINK-04/05 alimentam o grafo; não há caminho paralelo ao motor.
 */

import type { SalesOrderFlowEvidencePack } from "./salesOrderFlowEvidence.js";
import type {
  SalesOrderItemFlowDocumentAllocationInput,
  SalesOrderItemFlowNfeAllocationInput,
} from "./salesOrderItemFlowEngine.js";
import { adaptPackItemToMotorAllocations } from "./salesOrderOperationalEvidenceFromPack.js";

export type SalesOrderItemFlowAllocationBuildResult = {
  documentAllocations: SalesOrderItemFlowDocumentAllocationInput[];
  nfeAllocations: SalesOrderItemFlowNfeAllocationInput[];
};

/**
 * Monta alocações DS/NF para um item a partir do pack OP-49
 * via contrato canônico de evidências operacionais.
 */
export function buildSalesOrderItemFlowAllocationsFromEvidence(
  pack: SalesOrderFlowEvidencePack,
  item: SalesOrderFlowEvidencePack["items"][number]
): SalesOrderItemFlowAllocationBuildResult {
  const adapted = adaptPackItemToMotorAllocations(pack, item.id);
  return {
    documentAllocations: adapted.documentAllocations,
    nfeAllocations: adapted.nfeAllocations,
  };
}
