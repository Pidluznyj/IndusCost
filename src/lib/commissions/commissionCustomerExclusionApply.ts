import {
  CUSTOMER_COMMISSION_EXCLUSION_MESSAGE,
  resolveApplicableCustomerExclusionRule,
  type CustomerExclusionRuleSnapshot,
  type FindApplicableCustomerExclusionResult,
} from "./commissionCustomerExclusion.js";

export type CustomerExclusionMetadata = {
  customerExcluded: boolean;
  isCommissionable: boolean;
  exclusionReason: string | null;
  exclusionRuleId: string | null;
  exclusionMessage: string | null;
  originalRatePercent: number | null;
  originalCommissionAmount: number | null;
};

export function parseCustomerExclusionFromMetadata(
  metadataJson: unknown
): CustomerExclusionMetadata {
  if (!metadataJson || typeof metadataJson !== "object") {
    return {
      customerExcluded: false,
      isCommissionable: true,
      exclusionReason: null,
      exclusionRuleId: null,
      exclusionMessage: null,
      originalRatePercent: null,
      originalCommissionAmount: null,
    };
  }
  const meta = metadataJson as Record<string, unknown>;
  const customerExcluded = meta.customerExcluded === true;
  return {
    customerExcluded,
    isCommissionable: customerExcluded ? false : meta.isCommissionable !== false,
    exclusionReason:
      typeof meta.exclusionReason === "string" ? meta.exclusionReason.trim() || null : null,
    exclusionRuleId:
      typeof meta.exclusionRuleId === "string" ? meta.exclusionRuleId.trim() || null : null,
    exclusionMessage:
      typeof meta.exclusionMessage === "string" ? meta.exclusionMessage.trim() || null : null,
    originalRatePercent:
      typeof meta.originalRatePercent === "number" ? meta.originalRatePercent : null,
    originalCommissionAmount:
      typeof meta.originalCommissionAmount === "number"
        ? meta.originalCommissionAmount
        : null,
  };
}

export function buildCustomerExclusionMetadataPatch(
  exclusion: FindApplicableCustomerExclusionResult,
  originalRatePercent: number,
  originalCommissionAmount: number
): Record<string, unknown> {
  return {
    customerExcluded: true,
    isCommissionable: false,
    exclusionRuleId: exclusion.rule.id,
    exclusionReason: exclusion.reason,
    exclusionMessage: exclusion.exclusionMessage,
    originalRatePercent,
    originalCommissionAmount,
  };
}

export function resolveCustomerExclusionForSale(input: {
  customerId?: string | null;
  customerExternalId?: number | null;
  customerName?: string | null;
  referenceDate: Date;
  rules: CustomerExclusionRuleSnapshot[];
}): FindApplicableCustomerExclusionResult | null {
  return resolveApplicableCustomerExclusionRule(
    {
      customerId: input.customerId ?? null,
      customerExternalId: input.customerExternalId ?? null,
      customerName: input.customerName ?? null,
      referenceDate: input.referenceDate,
    },
    input.rules
  );
}

export function applyCustomerExclusionToCommission(input: {
  exclusion: FindApplicableCustomerExclusionResult | null;
  ratePercent: number;
  commissionAmount: number;
}): {
  ratePercent: number;
  commissionAmount: number;
  excluded: boolean;
  shouldPersist: boolean;
  metadataPatch: Record<string, unknown>;
} {
  if (!input.exclusion) {
    return {
      ratePercent: input.ratePercent,
      commissionAmount: input.commissionAmount,
      excluded: false,
      shouldPersist: input.commissionAmount > 0,
      metadataPatch: {},
    };
  }

  return {
    ratePercent: 0,
    commissionAmount: 0,
    excluded: true,
    shouldPersist: true,
    metadataPatch: buildCustomerExclusionMetadataPatch(
      input.exclusion,
      input.ratePercent,
      input.commissionAmount
    ),
  };
}

export function resolveVisualAuditCustomerExclusion(input: {
  metadataJson: unknown;
  customerExternalId: number | null;
  legacyExceptionCustomerIds: Set<number>;
  commissionExpected: number;
  commissionReleased: number;
  itemRatePercent: number;
}): {
  customerNoCommission: boolean;
  isCommissionable: boolean;
  exclusionReason: string | null;
  exclusionRuleId: string | null;
  commissionExpected: number;
  commissionReleased: number;
  itemRatePercent: number;
} {
  const meta = parseCustomerExclusionFromMetadata(input.metadataJson);
  const legacyExcluded =
    !meta.customerExcluded &&
    input.customerExternalId != null &&
    input.legacyExceptionCustomerIds.has(input.customerExternalId);
  const customerNoCommission = meta.customerExcluded || legacyExcluded;

  if (!customerNoCommission) {
    return {
      customerNoCommission: false,
      isCommissionable: true,
      exclusionReason: null,
      exclusionRuleId: null,
      commissionExpected: input.commissionExpected,
      commissionReleased: input.commissionReleased,
      itemRatePercent: input.itemRatePercent,
    };
  }

  return {
    customerNoCommission: true,
    isCommissionable: false,
    exclusionReason:
      meta.exclusionReason ??
      meta.exclusionMessage ??
      (legacyExcluded ? CUSTOMER_COMMISSION_EXCLUSION_MESSAGE : null),
    exclusionRuleId: meta.exclusionRuleId,
    commissionExpected: 0,
    commissionReleased: 0,
    itemRatePercent: 0,
  };
}

export function customerExclusionAlertLabel(exclusionReason: string | null): string {
  if (exclusionReason?.trim()) {
    return `${CUSTOMER_COMMISSION_EXCLUSION_MESSAGE} — ${exclusionReason.trim()}`;
  }
  return CUSTOMER_COMMISSION_EXCLUSION_MESSAGE;
}
