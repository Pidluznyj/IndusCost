export const FINANCE_SUPPLIER_RULE_AUDIT_ENTITY = "SupplierCostCenterRule";

export const FINANCE_SUPPLIER_RULE_AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DEACTIVATE: "DEACTIVATE",
  BATCH_CREATE: "BATCH_CREATE",
} as const;

/** Tolerância para soma de percentuais de rateio (= 100%). */
export const FINANCE_SUPPLIER_RULE_PERCENTAGE_TOLERANCE = 0.01;
