import {
  accountsPayableMatchesCompany,
  accountsPayableMatchesFinancialSupplier,
  type SupplierWithAliases,
} from "@/src/lib/financeSupplierCostCenterRules.js";
import type { FinancialCostCenterClassificationRuleType } from "@/src/lib/financeCostCenterClassificationRulesShared.js";

export type ClassificationApRow = {
  externalId: number;
  personId?: number | null;
  personName?: string | null;
  personCnpj?: string | null;
  companyId?: number | null;
  companyName?: string | null;
  classification?: string | null;
  description?: string | null;
  comments?: string | null;
  documentNumber?: string | null;
  status?: boolean | null;
  balancePayable?: number;
  amountPayable?: number;
  rawPayload?: unknown;
};

export type SupplierRuleMatchRow = {
  kind: "SUPPLIER";
  tier: number;
  priority: number;
  ruleId: string;
  ruleName: string;
  costCenterId: string;
  percentage: number;
  supplierId: string;
  reason: string;
};

export type ClassificationRuleMatchRow = {
  kind: "CLASSIFICATION";
  tier: number;
  priority: number;
  ruleId: string;
  ruleName: string;
  ruleType: FinancialCostCenterClassificationRuleType;
  costCenterId: string;
  percentage: number;
  supplierId: string | null;
  reason: string;
};

export type ResolvedClassificationMatch = SupplierRuleMatchRow | ClassificationRuleMatchRow;

export type SupplierRuleCandidate = {
  id: string;
  supplierId: string;
  costCenterId: string;
  percentage: number;
  priority: number;
  autoApply: boolean;
  isActive: boolean;
  company: string | null;
};

export type ClassificationRuleCandidate = {
  id: string;
  name: string;
  ruleType: FinancialCostCenterClassificationRuleType;
  costCenterId: string;
  percentage: number;
  priority: number;
  autoApply: boolean;
  isActive: boolean;
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
};

const RULE_TYPE_TIER: Record<FinancialCostCenterClassificationRuleType, number> = {
  MANUAL: 10,
  COMPOSITE: 20,
  SUPPLIER: 30,
  NOMUS_CLASSIFICATION: 40,
  DESCRIPTION_CONTAINS: 50,
  DOCUMENT_CONTAINS: 50,
  KEYWORDS: 50,
  FINANCIAL_NATURE: 50,
  NO_SUPPLIER: 60,
};

const HIGH_PRIORITY_KEYWORD_THRESHOLD = 150;

function resolveClassificationRuleTier(rule: ClassificationRuleCandidate): number {
  const base = RULE_TYPE_TIER[rule.ruleType];
  if (
    (rule.ruleType === "KEYWORDS" ||
      rule.ruleType === "DESCRIPTION_CONTAINS" ||
      rule.ruleType === "DOCUMENT_CONTAINS") &&
    rule.priority >= HIGH_PRIORITY_KEYWORD_THRESHOLD
  ) {
    return 25;
  }
  return base;
}

export function normalizeClassificationSearchText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function resolveTitleAmount(ap: ClassificationApRow): number {
  const balance = Math.abs(Number(ap.balancePayable ?? 0));
  const payable = Math.abs(Number(ap.amountPayable ?? 0));
  return Math.round((balance > 0 ? balance : payable) * 100) / 100;
}

function hasResolvableSupplier(ap: ClassificationApRow, supplier: SupplierWithAliases | null): boolean {
  if (!supplier) return false;
  const name = normalizeClassificationSearchText(ap.personName);
  const doc = normalizeClassificationSearchText(ap.personCnpj);
  return name.length > 0 || doc.length > 0;
}

function textBlob(ap: ClassificationApRow): string {
  return normalizeClassificationSearchText(
    [ap.description, ap.comments, ap.personName].filter(Boolean).join(" ")
  );
}

function matchesKeywords(ap: ClassificationApRow, keywords: string[]): string | null {
  const blob = textBlob(ap);
  if (!blob) return null;
  for (const keyword of keywords) {
    const normalized = normalizeClassificationSearchText(keyword);
    if (normalized && blob.includes(normalized)) return keyword;
  }
  return null;
}

function matchesContains(ap: ClassificationApRow, needle: string | null, fields: Array<keyof ClassificationApRow>): string | null {
  if (!needle?.trim()) return null;
  const normalizedNeedle = normalizeClassificationSearchText(needle);
  for (const field of fields) {
    const value = ap[field];
    if (typeof value === "string" && normalizeClassificationSearchText(value).includes(normalizedNeedle)) {
      return needle.trim();
    }
  }
  return null;
}

function matchesAmount(ap: ClassificationApRow, minAmount: number | null, maxAmount: number | null): boolean {
  const amount = resolveTitleAmount(ap);
  if (minAmount != null && amount < minAmount) return false;
  if (maxAmount != null && amount > maxAmount) return false;
  return true;
}

function matchesTitleStatus(ap: ClassificationApRow, titleStatus: string | null): boolean {
  if (!titleStatus?.trim()) return true;
  const normalized = titleStatus.trim().toLowerCase();
  if (normalized === "open") return (ap.balancePayable ?? 0) > 0;
  if (normalized === "closed") return (ap.balancePayable ?? 0) <= 0;
  if (normalized === "paid") return Boolean(ap.status);
  return true;
}

export function evaluateClassificationRuleCandidate(
  ap: ClassificationApRow,
  rule: ClassificationRuleCandidate,
  supplier: SupplierWithAliases | null,
  options?: { requireAutoApply?: boolean }
): { matches: boolean; reason: string | null } {
  if (!rule.isActive) return { matches: false, reason: null };
  if (options?.requireAutoApply !== false && !rule.autoApply) {
    return { matches: false, reason: null };
  }
  if (!accountsPayableMatchesCompany(ap, rule.company)) {
    return { matches: false, reason: null };
  }
  if (!matchesAmount(ap, rule.minAmount, rule.maxAmount)) {
    return { matches: false, reason: null };
  }
  if (!matchesTitleStatus(ap, rule.titleStatus)) {
    return { matches: false, reason: null };
  }

  switch (rule.ruleType) {
    case "MANUAL": {
      if (rule.accountsPayableId == null || rule.accountsPayableId !== ap.externalId) {
        return { matches: false, reason: null };
      }
      return { matches: true, reason: `AP específico ${ap.externalId}` };
    }
    case "COMPOSITE": {
      if (rule.supplierId) {
        if (!supplier || supplier.id !== rule.supplierId) {
          return { matches: false, reason: null };
        }
        if (!accountsPayableMatchesFinancialSupplier(ap, supplier)) {
          return { matches: false, reason: null };
        }
      }
      const keywordHit = rule.keywords.length > 0 ? matchesKeywords(ap, rule.keywords) : null;
      const descHit = matchesContains(ap, rule.descriptionContains, ["description", "comments"]);
      const nomusHit =
        rule.nomusClassification &&
        normalizeClassificationSearchText(ap.classification).includes(
          normalizeClassificationSearchText(rule.nomusClassification)
        )
          ? rule.nomusClassification
          : null;
      if (!keywordHit && !descHit && !nomusHit) return { matches: false, reason: null };
      const reasonParts = [
        keywordHit ? `palavra-chave “${keywordHit}”` : null,
        descHit ? `descrição contém “${descHit}”` : null,
        nomusHit ? `classificação Nomus “${nomusHit}”` : null,
      ].filter(Boolean);
      return { matches: true, reason: reasonParts.join("; ") };
    }
    case "NOMUS_CLASSIFICATION": {
      if (!rule.nomusClassification?.trim()) return { matches: false, reason: null };
      const hit = matchesContains(ap, rule.nomusClassification, ["classification"]);
      return hit
        ? { matches: true, reason: `classificação Nomus contém “${hit}”` }
        : { matches: false, reason: null };
    }
    case "DESCRIPTION_CONTAINS": {
      const hit = matchesContains(ap, rule.descriptionContains, ["description", "comments"]);
      return hit
        ? { matches: true, reason: `descrição contém “${hit}”` }
        : { matches: false, reason: null };
    }
    case "DOCUMENT_CONTAINS": {
      const hit = matchesContains(ap, rule.documentContains, ["documentNumber"]);
      return hit
        ? { matches: true, reason: `documento contém “${hit}”` }
        : { matches: false, reason: null };
    }
    case "KEYWORDS": {
      const hit = matchesKeywords(ap, rule.keywords);
      return hit
        ? { matches: true, reason: `descrição contém “${hit}”` }
        : { matches: false, reason: null };
    }
    case "NO_SUPPLIER": {
      if (hasResolvableSupplier(ap, supplier)) return { matches: false, reason: null };
      return { matches: true, reason: "fornecedor vazio ou não identificado" };
    }
    case "FINANCIAL_NATURE": {
      if (!rule.financialNature?.trim()) return { matches: false, reason: null };
      const hit = matchesContains(ap, rule.financialNature, ["description", "comments", "classification"]);
      return hit
        ? { matches: true, reason: `natureza financeira “${hit}”` }
        : { matches: false, reason: null };
    }
    case "SUPPLIER": {
      if (!rule.supplierId || !supplier || supplier.id !== rule.supplierId) {
        return { matches: false, reason: null };
      }
      if (!accountsPayableMatchesFinancialSupplier(ap, supplier)) {
        return { matches: false, reason: null };
      }
      return { matches: true, reason: `fornecedor ${supplier.displayName}` };
    }
    default:
      return { matches: false, reason: null };
  }
}

function compareMatches(a: ResolvedClassificationMatch, b: ResolvedClassificationMatch): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return 0;
}

export function resolveBestClassificationMatch(input: {
  ap: ClassificationApRow;
  supplier: SupplierWithAliases | null;
  supplierRules: SupplierRuleCandidate[];
  classificationRules: ClassificationRuleCandidate[];
  requireAutoApply?: boolean;
}): ResolvedClassificationMatch | null {
  const candidates: ResolvedClassificationMatch[] = [];
  const { ap, supplier, requireAutoApply } = input;

  for (const rule of input.classificationRules) {
    const evaluation = evaluateClassificationRuleCandidate(ap, rule, supplier, { requireAutoApply });
    if (!evaluation.matches) continue;
    candidates.push({
      kind: "CLASSIFICATION",
      tier: resolveClassificationRuleTier(rule),
      priority: rule.priority,
      ruleId: rule.id,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      costCenterId: rule.costCenterId,
      percentage: rule.percentage,
      supplierId: supplier?.id ?? null,
      reason: evaluation.reason ?? rule.name,
    });
  }

  if (supplier) {
    const activeSupplierRules = input.supplierRules.filter(
      (rule) =>
        rule.supplierId === supplier.id &&
        rule.isActive &&
        (requireAutoApply === false || rule.autoApply) &&
        accountsPayableMatchesCompany(ap, rule.company)
    );
    if (activeSupplierRules.length > 0) {
      const maxPriority = Math.max(...activeSupplierRules.map((rule) => rule.priority));
      for (const rule of activeSupplierRules.filter((row) => row.priority === maxPriority)) {
        if (!accountsPayableMatchesFinancialSupplier(ap, supplier)) continue;
        candidates.push({
          kind: "SUPPLIER",
          tier: RULE_TYPE_TIER.SUPPLIER,
          priority: rule.priority,
          ruleId: rule.id,
          ruleName: `Fornecedor ${supplier.displayName}`,
          costCenterId: rule.costCenterId,
          percentage: rule.percentage,
          supplierId: supplier.id,
          reason: `fornecedor ${supplier.displayName}`,
        });
      }
    }
  }

  if (candidates.length === 0) return null;
  return candidates.sort(compareMatches)[0] ?? null;
}

export function classificationRuleTypeLabel(
  ruleType: FinancialCostCenterClassificationRuleType
): string {
  const labels: Record<FinancialCostCenterClassificationRuleType, string> = {
    SUPPLIER: "Regra por fornecedor",
    NOMUS_CLASSIFICATION: "Regra por classificação Nomus",
    DESCRIPTION_CONTAINS: "Regra por descrição",
    DOCUMENT_CONTAINS: "Regra por documento",
    KEYWORDS: "Regra por palavras-chave",
    NO_SUPPLIER: "Regra sem fornecedor",
    FINANCIAL_NATURE: "Regra por natureza financeira",
    MANUAL: "Regra manual",
    COMPOSITE: "Regra composta",
  };
  return labels[ruleType];
}

export function allocationSourceLabelFromMatch(match: ResolvedClassificationMatch): string {
  if (match.kind === "SUPPLIER") return "Regra por fornecedor";
  return classificationRuleTypeLabel(match.ruleType);
}
