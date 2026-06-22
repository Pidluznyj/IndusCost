/** Confirmação textual obrigatória para apply em lote de classificação AP. */
export const FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT = "APLICAR CENTROS DE CUSTO AP";

export const FINANCE_AP_ALLOCATION_AUDIT_ENTITY = {
  ALLOCATION: "AccountsPayableCostCenterAllocation",
  BATCH_RUN: "AccountsPayableAllocationBatch",
} as const;

export const FINANCE_AP_ALLOCATION_AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  BATCH_APPLY: "BATCH_APPLY",
} as const;

export const FINANCE_AP_ALLOCATION_PERCENTAGE_TOLERANCE = 0.01;
export const FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE = 0.01;
