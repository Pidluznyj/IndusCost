/** Confirmação textual obrigatória para apply de rebuild de fornecedores AP. */
export const FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT = "RECONSTRUIR FORNECEDORES AP";

export const FINANCE_SUPPLIER_REBUILD_AUDIT_ENTITY = {
  SUPPLIER: "FinancialSupplier",
  SUPPLIER_ALIAS: "FinancialSupplierAlias",
  REBUILD_RUN: "FinancialSupplierRebuild",
} as const;

export const FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  STATS_UPDATE: "STATS_UPDATE",
  /** Preenchimento ADITIVO do documento (CNPJ/CPF) a partir de evidência oficial — nunca sobrescreve. */
  DOCUMENT_ENRICH: "DOCUMENT_ENRICH",
  BATCH_APPLY: "BATCH_APPLY",
} as const;
