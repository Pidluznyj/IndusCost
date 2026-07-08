/**
 * Governança de cotação oficial — fluxo de aprovação para matérias HIGH/CRITICAL.
 */

import type { MaterialMarketCriticality } from "./materialMarketMonitoring.js";
import { isMaterialMarketCriticality } from "./materialMarketMonitoring.js";
import { planSetMaterialOfficialQuote } from "./materialOfficialQuote.js";

export const MATERIAL_MARKET_QUOTE_APPROVE_PERMISSION =
  "materials.market_quote.approve";

export const MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_VALUES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "OFFICIAL",
  "REPLACED",
] as const;

export type MaterialMarketQuoteOfficialStatus =
  (typeof MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_VALUES)[number];

export const MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_LABELS: Record<
  MaterialMarketQuoteOfficialStatus,
  string
> = {
  DRAFT: "Rascunho",
  PENDING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovada",
  REJECTED: "Rejeitada",
  OFFICIAL: "Oficial",
  REPLACED: "Substituída",
};

export const MATERIAL_OFFICIAL_QUOTE_AUDIT_ACTION_VALUES = [
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "SET_OFFICIAL",
  "REPLACED",
] as const;

export type MaterialOfficialQuoteAuditAction =
  (typeof MATERIAL_OFFICIAL_QUOTE_AUDIT_ACTION_VALUES)[number];

export type MaterialMarketQuoteGovernanceRow = {
  id: string;
  materialId: string;
  officialStatus?: string | null;
  isOfficialReference?: boolean;
  rejectionReason?: string | null;
  submittedForApprovalBy?: string | null;
  submittedForApprovalAt?: Date | string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  setOfficialBy?: string | null;
  setOfficialAt?: Date | string | null;
};

export type MaterialMarketQuoteGovernanceContext = {
  materialId: string;
  marketCriticality?: string | null;
  quotes: MaterialMarketQuoteGovernanceRow[];
};

export function isMaterialMarketQuoteOfficialStatus(
  value: unknown
): value is MaterialMarketQuoteOfficialStatus {
  return (
    typeof value === "string" &&
    (MATERIAL_MARKET_QUOTE_OFFICIAL_STATUS_VALUES as readonly string[]).includes(value)
  );
}

export function parseMaterialMarketQuoteOfficialStatus(
  value: unknown
): MaterialMarketQuoteOfficialStatus {
  return isMaterialMarketQuoteOfficialStatus(value) ? value : "DRAFT";
}

export function isCriticalMaterialForQuoteApproval(
  criticality: string | null | undefined
): boolean {
  return criticality === "HIGH" || criticality === "CRITICAL";
}

export function resolveMaterialMarketCriticality(
  value: string | null | undefined
): MaterialMarketCriticality | null {
  return isMaterialMarketCriticality(value) ? value : null;
}

export function canApproveMaterialMarketQuote(check: {
  hasPermission: (permission: string) => boolean;
}): boolean {
  return check.hasPermission(MATERIAL_MARKET_QUOTE_APPROVE_PERMISSION);
}

function findQuote(
  quotes: MaterialMarketQuoteGovernanceRow[],
  quoteId: string
): MaterialMarketQuoteGovernanceRow | undefined {
  return quotes.find((quote) => quote.id === quoteId);
}

export function validateSubmitMaterialQuoteForApproval(input: {
  materialId: string;
  quoteId: string;
  marketCriticality?: string | null;
  quotes: MaterialMarketQuoteGovernanceRow[];
}):
  | { ok: true; quote: MaterialMarketQuoteGovernanceRow }
  | {
      ok: false;
      code:
        | "QUOTE_NOT_FOUND"
        | "NOT_CRITICAL_MATERIAL"
        | "INVALID_OFFICIAL_STATUS";
      message: string;
    } {
  if (!isCriticalMaterialForQuoteApproval(input.marketCriticality)) {
    return {
      ok: false,
      code: "NOT_CRITICAL_MATERIAL",
      message:
        "Envio para aprovação só se aplica a matérias com criticidade Alta ou Crítica.",
    };
  }

  const quote = findQuote(input.quotes, input.quoteId);
  if (!quote || quote.materialId !== input.materialId) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  const status = parseMaterialMarketQuoteOfficialStatus(quote.officialStatus);
  if (status !== "DRAFT" && status !== "REJECTED") {
    return {
      ok: false,
      code: "INVALID_OFFICIAL_STATUS",
      message: "Somente cotações em rascunho ou rejeitadas podem ser enviadas para aprovação.",
    };
  }

  return { ok: true, quote };
}

export function validateRejectMaterialMarketQuote(input: {
  materialId: string;
  quoteId: string;
  reason?: unknown;
  quotes: MaterialMarketQuoteGovernanceRow[];
}):
  | { ok: true; quote: MaterialMarketQuoteGovernanceRow; reason: string }
  | {
      ok: false;
      code: "QUOTE_NOT_FOUND" | "INVALID_OFFICIAL_STATUS" | "REJECTION_REASON_REQUIRED";
      message: string;
      field?: string;
    } {
  const quote = findQuote(input.quotes, input.quoteId);
  if (!quote || quote.materialId !== input.materialId) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  const status = parseMaterialMarketQuoteOfficialStatus(quote.officialStatus);
  if (status !== "PENDING_APPROVAL") {
    return {
      ok: false,
      code: "INVALID_OFFICIAL_STATUS",
      message: "Somente cotações aguardando aprovação podem ser rejeitadas.",
    };
  }

  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) {
    return {
      ok: false,
      code: "REJECTION_REASON_REQUIRED",
      field: "reason",
      message: "Motivo da rejeição é obrigatório.",
    };
  }

  return { ok: true, quote, reason };
}

export function validateApproveMaterialMarketQuote(input: {
  materialId: string;
  quoteId: string;
  quotes: MaterialMarketQuoteGovernanceRow[];
}):
  | { ok: true; quote: MaterialMarketQuoteGovernanceRow; plan: ReturnType<typeof planSetMaterialOfficialQuote> extends { ok: true; plan: infer P } ? P : never }
  | {
      ok: false;
      code: "QUOTE_NOT_FOUND" | "INVALID_OFFICIAL_STATUS";
      message: string;
    } {
  const quote = findQuote(input.quotes, input.quoteId);
  if (!quote || quote.materialId !== input.materialId) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  const status = parseMaterialMarketQuoteOfficialStatus(quote.officialStatus);
  if (status !== "PENDING_APPROVAL") {
    return {
      ok: false,
      code: "INVALID_OFFICIAL_STATUS",
      message: "Somente cotações aguardando aprovação podem ser aprovadas.",
    };
  }

  const planned = planSetMaterialOfficialQuote({
    materialId: input.materialId,
    quoteId: input.quoteId,
    quotes: input.quotes,
  });
  if (planned.ok === false) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  return { ok: true, quote, plan: planned.plan };
}

export function validateSetMaterialMarketQuoteOfficial(input: {
  materialId: string;
  quoteId: string;
  marketCriticality?: string | null;
  quotes: MaterialMarketQuoteGovernanceRow[];
}):
  | { ok: true; quote: MaterialMarketQuoteGovernanceRow; plan: ReturnType<typeof planSetMaterialOfficialQuote> extends { ok: true; plan: infer P } ? P : never }
  | {
      ok: false;
      code:
        | "QUOTE_NOT_FOUND"
        | "INVALID_OFFICIAL_STATUS"
        | "APPROVAL_REQUIRED";
      message: string;
    } {
  const quote = findQuote(input.quotes, input.quoteId);
  if (!quote || quote.materialId !== input.materialId) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  const status = parseMaterialMarketQuoteOfficialStatus(quote.officialStatus);
  const critical = isCriticalMaterialForQuoteApproval(input.marketCriticality);

  if (critical) {
    if (status !== "APPROVED") {
      return {
        ok: false,
        code: "APPROVAL_REQUIRED",
        message:
          "Matérias de criticidade Alta ou Crítica exigem aprovação antes de definir a cotação como oficial.",
      };
    }
  } else if (status !== "DRAFT" && status !== "APPROVED") {
    return {
      ok: false,
      code: "INVALID_OFFICIAL_STATUS",
      message: "Somente cotações em rascunho ou aprovadas podem ser definidas como oficiais.",
    };
  }

  const planned = planSetMaterialOfficialQuote({
    materialId: input.materialId,
    quoteId: input.quoteId,
    quotes: input.quotes,
  });
  if (planned.ok === false) {
    return {
      ok: false,
      code: "QUOTE_NOT_FOUND",
      message: "Cotação não encontrada para esta matéria-prima.",
    };
  }

  return { ok: true, quote, plan: planned.plan };
}

export type MaterialMarketQuoteGovernanceAuditInput = {
  materialId: string;
  quoteId: string;
  action: MaterialOfficialQuoteAuditAction;
  changedBy: string | null;
  changedAt: Date;
  previousQuoteId?: string | null;
  newQuoteId?: string | null;
  reason?: string | null;
  rejectionReason?: string | null;
};

export function buildMaterialMarketQuoteGovernanceAuditRecord(
  input: MaterialMarketQuoteGovernanceAuditInput
) {
  return {
    materialId: input.materialId,
    quoteId: input.quoteId,
    action: input.action,
    previousQuoteId: input.previousQuoteId ?? null,
    newQuoteId: input.newQuoteId ?? null,
    changedBy: input.changedBy,
    changedAt: input.changedAt,
    reason: input.reason?.trim() || null,
    rejectionReason: input.rejectionReason?.trim() || null,
  };
}

export function canShowSubmitForApprovalAction(input: {
  officialStatus: MaterialMarketQuoteOfficialStatus;
  marketCriticality?: string | null;
  canEdit: boolean;
}): boolean {
  if (!input.canEdit) return false;
  if (!isCriticalMaterialForQuoteApproval(input.marketCriticality)) return false;
  return input.officialStatus === "DRAFT" || input.officialStatus === "REJECTED";
}

export function canShowApproveRejectActions(input: {
  officialStatus: MaterialMarketQuoteOfficialStatus;
  canApprove: boolean;
}): boolean {
  return input.canApprove && input.officialStatus === "PENDING_APPROVAL";
}

export function canShowSetOfficialAction(input: {
  officialStatus: MaterialMarketQuoteOfficialStatus;
  marketCriticality?: string | null;
  canEdit: boolean;
  canApprove: boolean;
}): boolean {
  const critical = isCriticalMaterialForQuoteApproval(input.marketCriticality);
  if (critical) {
    return (
      (input.canEdit || input.canApprove) && input.officialStatus === "APPROVED"
    );
  }
  return input.canEdit && (input.officialStatus === "DRAFT" || input.officialStatus === "APPROVED");
}
