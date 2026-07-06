/** Tipos client-safe — regras gerenciais de classificação AP → centro de custo. */

export const FINANCE_CLASSIFICATION_RULE_TYPES = [
  { value: "SUPPLIER", label: "Fornecedor" },
  { value: "NOMUS_CLASSIFICATION", label: "Classificação Nomus" },
  { value: "DESCRIPTION_CONTAINS", label: "Descrição contém" },
  { value: "DOCUMENT_CONTAINS", label: "Documento contém" },
  { value: "KEYWORDS", label: "Palavras-chave" },
  { value: "NO_SUPPLIER", label: "Sem fornecedor / Fornecedor vazio" },
  { value: "FINANCIAL_NATURE", label: "Natureza financeira" },
  { value: "MANUAL", label: "Regra manual (AP específico)" },
  { value: "COMPOSITE", label: "Regra composta" },
] as const;

export type FinancialCostCenterClassificationRuleType =
  (typeof FINANCE_CLASSIFICATION_RULE_TYPES)[number]["value"];

export const FINANCE_CLASSIFICATION_RULE_TYPE_LABEL: Record<
  FinancialCostCenterClassificationRuleType,
  string
> = Object.fromEntries(
  FINANCE_CLASSIFICATION_RULE_TYPES.map((row) => [row.value, row.label])
) as Record<FinancialCostCenterClassificationRuleType, string>;

export const FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT =
  "CONFIRMAR APLICACAO REGRA CLASSIFICACAO" as const;

export const FINANCE_CLASSIFICATION_RULE_AUDIT_ENTITY = "CLASSIFICATION_RULE" as const;

export const FINANCE_CLASSIFICATION_RULE_AUDIT_ACTION = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DEACTIVATE: "DEACTIVATE",
  PREVIEW: "PREVIEW",
  APPLY: "APPLY",
} as const;

export const FINANCE_ESTORNOS_KEYWORDS = [
  "estorno",
  "ressarcimento",
  "devolução",
  "devolucao",
  "pagamento indevido",
  "crédito cliente",
  "credito cliente",
  "reembolso cliente",
  "devolver cliente",
] as const;

export const FINANCE_ESTORNOS_COST_CENTER_CODE =
  "CC_ADMINISTRATIVO_ESTORNOS_RESSARCIMENTOS" as const;

export const FINANCE_ESTORNOS_COST_CENTER_NAME = "ESTORNOS E RESSARCIMENTOS" as const;

export const FINANCE_ESTORNOS_RULE_NAME = "Estornos e ressarcimentos (palavras-chave)" as const;

export type ClassificationRuleDto = {
  id: string;
  name: string;
  ruleType: FinancialCostCenterClassificationRuleType;
  costCenterId: string;
  percentage: number;
  priority: number;
  isActive: boolean;
  autoApply: boolean;
  supplierId: string | null;
  nomusClassification: string | null;
  descriptionContains: string | null;
  documentContains: string | null;
  keywords: string[];
  financialNature: string | null;
  company: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  titleStatus: string | null;
  accountsPayableId: number | null;
  notes: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  costCenterCode?: string | null;
  costCenterName?: string | null;
  supplierName?: string | null;
};

export type ClassificationRulePreviewPayload = {
  rule: ClassificationRuleDto;
  matchedTitlesCount: number;
  matchedAmount: number;
  wouldApplyCount: number;
  wouldApplyAmount: number;
  manualLockedCount: number;
  wouldOverwriteCount: number;
  closedPeriodCount: number;
  warnings: string[];
  sampleTitles: Array<{
    accountsPayableId: number;
    personName: string | null;
    description: string | null;
    amount: number;
    matchReason: string;
    action: "create" | "replace" | "skip";
  }>;
  requiredConfirmationText: typeof FINANCE_CLASSIFICATION_RULE_APPLY_CONFIRMATION_TEXT;
};

export type ClassificationRuleApplyResult = {
  ok: true;
  appliedAt: string;
  ruleId: string;
  appliedCount: number;
  appliedAmount: number;
  skippedCount: number;
};
