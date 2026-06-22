/** Constantes e tipos client-safe — reclassificação gerencial de centro de custo. */

export const FINANCE_CC_RECLASSIFICATION_DEFAULT_RULE_NAME =
  "Investimento Sócios por descrição AP";

export const FINANCE_CC_RECLASSIFICATION_AUDIT_ACTION = {
  RECLASSIFY_BY_RULE: "RECLASSIFY_BY_RULE",
} as const;

export type ReclassificationMatchMode = "CONTAINS_ANY" | "CONTAINS_ALL";

export type ReclassificationApField = "description" | "comments";

export type ReclassificationRuleMatchFields = {
  apFields: ReclassificationApField[];
  sourceParentNames?: string[];
  excludeParentNames?: string[];
};

export type ReclassificationAllocationSource = "AUTO_RULE" | "MANUAL" | "BATCH";

export type ReclassificationRuleRecord = {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  isActive: boolean;
  sourceCostCenterName: string | null;
  sourceParentName: string | null;
  targetCostCenterId: string;
  matchFields: ReclassificationRuleMatchFields;
  keywords: string[];
  matchMode: ReclassificationMatchMode;
  applyToSources: ReclassificationAllocationSource[];
  skipManual: boolean;
  notes: string | null;
};

export type ReclassificationEvaluationInput = {
  allocation: {
    id: string;
    accountsPayableId: number;
    costCenterId: string;
    source: ReclassificationAllocationSource;
    lockedManual: boolean;
  };
  costCenter: {
    id: string;
    name: string;
    parentName: string | null;
  };
  payable: {
    externalId: number;
    personName: string | null;
    description: string | null;
    comments: string | null;
  };
  rule: ReclassificationRuleRecord;
  targetCostCenterLabel: string;
};

export type ReclassificationEvaluationResult =
  | { applies: false; reason: string }
  | {
      applies: true;
      matchedKeyword: string;
      targetCostCenterId: string;
      targetCostCenterLabel: string;
      ruleId: string;
    };

export type ReclassificationExample = {
  accountsPayableId: number;
  personName: string | null;
  description: string | null;
  comments: string | null;
  currentCostCenter: string;
  targetCostCenter: string;
  matchedKeyword: string;
  ruleName: string;
};

export type ReclassificationPreviewResult = {
  dryRun: boolean;
  matched: number;
  updated: number;
  skippedManual: number;
  alreadyTarget: number;
  skippedInactiveRule: number;
  skippedSource: number;
  skippedParent: number;
  skippedNoKeyword: number;
  targetCostCenter: string | null;
  keywordScan: {
    titlesWithKeywords: number;
    inAdministrativeParent: number;
    alreadyInvestimentoSocios: number;
    wouldReclassify: number;
  };
  examples: ReclassificationExample[];
};
