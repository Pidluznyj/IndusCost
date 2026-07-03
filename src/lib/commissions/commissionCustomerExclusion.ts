import { normalizeSearchString } from "@/src/lib/utils.js";
import type { CommissionCustomerExclusionRuleStatus } from "@prisma/client";

/** Mensagem padrão exibida quando a comissão é zerada por exclusão de cliente. */
export const CUSTOMER_COMMISSION_EXCLUSION_MESSAGE =
  "Cliente excluído de comissionamento";

export type CustomerExclusionRuleSnapshot = {
  id: string;
  customerId: string | null;
  customerExternalId: number | null;
  customerNameSnapshot: string;
  normalizedCustomerName: string;
  reason: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: CommissionCustomerExclusionRuleStatus;
  notes: string | null;
};

export type FindApplicableCustomerExclusionInput = {
  customerId?: string | null;
  customerExternalId?: number | null;
  customerName?: string | null;
  referenceDate: Date;
};

export type FindApplicableCustomerExclusionResult = {
  rule: CustomerExclusionRuleSnapshot;
  reason: string;
  exclusionMessage: string;
};

export function normalizeCustomerNameForExclusion(
  value: string | null | undefined
): string {
  if (!value?.trim()) return "";
  return normalizeSearchString(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

export function isCustomerExclusionEffectiveOn(
  rule: Pick<CustomerExclusionRuleSnapshot, "effectiveFrom" | "effectiveTo" | "status">,
  referenceDate: Date
): boolean {
  if (rule.status !== "ACTIVE") return false;
  const ref = startOfUtcDay(referenceDate).getTime();
  const from = startOfUtcDay(rule.effectiveFrom).getTime();
  if (ref < from) return false;
  if (rule.effectiveTo) {
    const to = startOfUtcDay(rule.effectiveTo).getTime();
    if (ref > to) return false;
  }
  return true;
}

export function exclusionDateRangesOverlap(
  a: Pick<CustomerExclusionRuleSnapshot, "effectiveFrom" | "effectiveTo">,
  b: Pick<CustomerExclusionRuleSnapshot, "effectiveFrom" | "effectiveTo">
): boolean {
  const aStart = startOfUtcDay(a.effectiveFrom).getTime();
  const aEnd = a.effectiveTo ? startOfUtcDay(a.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
  const bStart = startOfUtcDay(b.effectiveFrom).getTime();
  const bEnd = b.effectiveTo ? startOfUtcDay(b.effectiveTo).getTime() : Number.POSITIVE_INFINITY;
  return aStart <= bEnd && bStart <= aEnd;
}

export type CustomerExclusionIdentity = {
  customerId: string | null;
  customerExternalId: number | null;
  normalizedCustomerName: string;
};

export function buildCustomerExclusionIdentity(input: {
  customerId?: string | null;
  customerExternalId?: number | null;
  customerNameSnapshot?: string | null;
}): CustomerExclusionIdentity {
  return {
    customerId: input.customerId ?? null,
    customerExternalId: input.customerExternalId ?? null,
    normalizedCustomerName: normalizeCustomerNameForExclusion(
      input.customerNameSnapshot ?? ""
    ),
  };
}

export function exclusionRulesTargetSameCustomer(
  a: CustomerExclusionIdentity,
  b: CustomerExclusionIdentity
): boolean {
  if (a.customerId && b.customerId && a.customerId === b.customerId) return true;
  if (
    a.customerExternalId != null &&
    b.customerExternalId != null &&
    a.customerExternalId === b.customerExternalId
  ) {
    return true;
  }
  if (
    a.normalizedCustomerName &&
    b.normalizedCustomerName &&
    a.normalizedCustomerName === b.normalizedCustomerName
  ) {
    return true;
  }
  return false;
}

export function findConflictingActiveExclusionRule(
  candidate: CustomerExclusionIdentity & {
    effectiveFrom: Date;
    effectiveTo: Date | null;
  },
  existingActiveRules: Array<
    CustomerExclusionIdentity & {
      id: string;
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }
  >,
  excludeRuleId?: string | null
): { id: string } | null {
  for (const rule of existingActiveRules) {
    if (excludeRuleId && rule.id === excludeRuleId) continue;
    if (!exclusionRulesTargetSameCustomer(candidate, rule)) continue;
    if (
      exclusionDateRangesOverlap(candidate, rule)
    ) {
      return { id: rule.id };
    }
  }
  return null;
}

function ruleMatchesCustomerId(
  rule: CustomerExclusionRuleSnapshot,
  customerId: string
): boolean {
  return rule.customerId === customerId;
}

function ruleMatchesExternalId(
  rule: CustomerExclusionRuleSnapshot,
  customerExternalId: number
): boolean {
  return rule.customerExternalId === customerExternalId;
}

function ruleMatchesNormalizedName(
  rule: CustomerExclusionRuleSnapshot,
  normalizedCustomerName: string
): boolean {
  return (
    normalizedCustomerName.length > 0 &&
    rule.normalizedCustomerName === normalizedCustomerName
  );
}

/**
 * Resolve regra aplicável na data de referência (NF ou pedido).
 * Prioridade: customerId → customerExternalId → normalizedCustomerName.
 */
export function resolveApplicableCustomerExclusionRule(
  input: FindApplicableCustomerExclusionInput,
  rules: CustomerExclusionRuleSnapshot[]
): FindApplicableCustomerExclusionResult | null {
  const applicable = rules.filter((rule) =>
    isCustomerExclusionEffectiveOn(rule, input.referenceDate)
  );
  if (applicable.length === 0) return null;

  const customerId = input.customerId?.trim() || null;
  if (customerId) {
    const byCustomerId = applicable.find((rule) =>
      ruleMatchesCustomerId(rule, customerId)
    );
    if (byCustomerId) {
      return mapApplicableResult(byCustomerId);
    }
  }

  const externalId =
    input.customerExternalId != null && Number.isFinite(input.customerExternalId)
      ? input.customerExternalId
      : null;
  if (externalId != null) {
    const byExternalId = applicable.find((rule) =>
      ruleMatchesExternalId(rule, externalId)
    );
    if (byExternalId) {
      return mapApplicableResult(byExternalId);
    }
  }

  const normalizedName = normalizeCustomerNameForExclusion(input.customerName);
  if (normalizedName) {
    const byName = applicable.find((rule) =>
      ruleMatchesNormalizedName(rule, normalizedName)
    );
    if (byName) {
      return mapApplicableResult(byName);
    }
  }

  return null;
}

function mapApplicableResult(
  rule: CustomerExclusionRuleSnapshot
): FindApplicableCustomerExclusionResult {
  return {
    rule,
    reason: rule.reason,
    exclusionMessage: CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
  };
}
