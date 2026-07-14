/**
 * Persistência auxiliar do distrato (campos, status, versionamento).
 * Mantém o calc em supplierServiceTerminationCalc.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  ServiceTerminationCommissionTreatmentDto,
  ServiceTerminationDistratoFields,
  ServiceTerminationDto,
  ServiceTerminationNoticeOriginDto,
  ServiceTerminationPreviewInput,
  ServiceTerminationStatusDto,
  ServiceTerminationTerminationModalityDto,
} from "./supplierServiceTerminationTypes.js";
import {
  isServiceTerminationLockedStatus,
  normalizeServiceTerminationStatus,
  redactSensitiveDistratoFields,
  validateDistratoForStatusTransition,
} from "./supplierServiceTerminationDistrato.js";

export class SupplierServiceTerminationError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus = 400
  ) {
    super(message);
    this.name = "SupplierServiceTerminationError";
  }
}

export function generateDocumentCode(id: string, when = new Date()): string {
  const y = when.getUTCFullYear();
  const m = String(when.getUTCMonth() + 1).padStart(2, "0");
  return `DST-${y}${m}-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function buildIntegrityCode(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function optStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function optYmd(v: unknown): string | null {
  const s = optStr(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  return s.slice(0, 10);
}

function parseModality(
  v: unknown
): ServiceTerminationTerminationModalityDto | null {
  if (
    v === "MUTUAL_AGREEMENT" ||
    v === "CONTRACTOR_INITIATIVE" ||
    v === "CONTRACTED_INITIATIVE"
  ) {
    return v;
  }
  return null;
}

function parseCommissionTreatment(
  v: unknown
): ServiceTerminationCommissionTreatmentDto | null {
  if (v === "NONE_PENDING" || v === "HAS_PENDING" || v === "NEGOTIATED_INCLUDED") {
    return v;
  }
  return null;
}

function parseNoticeOrigin(v: unknown): ServiceTerminationNoticeOriginDto | null {
  if (v === "CONTRACT_CLAUSE" || v === "AGREEMENT" || v === "OTHER") return v;
  return null;
}

export function extractDistratoFieldsFromBody(
  body: ServiceTerminationPreviewInput
): ServiceTerminationDistratoFields {
  return {
    documentCode: optStr(body.documentCode),
    documentVersion: Number(body.documentVersion) > 0 ? Number(body.documentVersion) : 1,
    supersedesId: optStr(body.supersedesId),
    originalContractDate: optYmd(body.originalContractDate),
    originalContractReference: optStr(body.originalContractReference),
    contractingPartyName: optStr(body.contractingPartyName),
    contractingPartyDocument: optStr(body.contractingPartyDocument),
    contractingPartyRepName: optStr(body.contractingPartyRepName),
    contractingPartyRepRole: optStr(body.contractingPartyRepRole),
    contractingPartyRepDocument: optStr(body.contractingPartyRepDocument),
    contractedPartyName: optStr(body.contractedPartyName),
    contractedPartyDocument: optStr(body.contractedPartyDocument),
    contractedPartyRepName: optStr(body.contractedPartyRepName),
    contractedPartyRepDocument: optStr(body.contractedPartyRepDocument),
    contractedServiceDescription: optStr(body.contractedServiceDescription),
    signaturePlace: optStr(body.signaturePlace),
    terminationModality: parseModality(body.terminationModality),
    terminationReason: optStr(body.terminationReason),
    paymentDueDate: optYmd(body.paymentDueDate),
    paymentMethod: optStr(body.paymentMethod),
    paymentTransactionId: optStr(body.paymentTransactionId),
    paymentEffectiveDate: optYmd(body.paymentEffectiveDate),
    paymentConfirmedAmount:
      body.paymentConfirmedAmount != null && Number.isFinite(Number(body.paymentConfirmedAmount))
        ? Number(body.paymentConfirmedAmount)
        : null,
    paymentProofStorageKey: optStr(body.paymentProofStorageKey),
    paymentProofFileName: optStr(body.paymentProofFileName),
    paymentProofWaiverReason: optStr(body.paymentProofWaiverReason),
    commissionTreatment: parseCommissionTreatment(body.commissionTreatment),
    commissionPendingNotes: optStr(body.commissionPendingNotes),
    commissionNegotiatedAmount:
      body.commissionNegotiatedAmount != null &&
      Number.isFinite(Number(body.commissionNegotiatedAmount))
        ? Number(body.commissionNegotiatedAmount)
        : null,
    commissionNegotiatedOrders: optStr(body.commissionNegotiatedOrders),
    commissionNegotiatedJustification: optStr(body.commissionNegotiatedJustification),
    commissionNegotiatedApprover: optStr(body.commissionNegotiatedApprover),
    noticePenaltyOrigin: parseNoticeOrigin(body.noticePenaltyOrigin),
    noticePenaltyClauseNumber: optStr(body.noticePenaltyClauseNumber),
    noticePenaltyClauseDescription: optStr(body.noticePenaltyClauseDescription),
    proportionalCompensationJustification: optStr(
      body.proportionalCompensationJustification
    ),
    extraServicesDescription: optStr(body.extraServicesDescription),
    otherDiscountsDescription: optStr(body.otherDiscountsDescription),
    contractualNotes: optStr(body.contractualNotes),
    pendingObligationsNotes: optStr(body.pendingObligationsNotes),
    hasPendingObligations: Boolean(body.hasPendingObligations),
    witness1Name: optStr(body.witness1Name),
    witness1Document: optStr(body.witness1Document),
    witness2Name: optStr(body.witness2Name),
    witness2Document: optStr(body.witness2Document),
    integrityCode: optStr(body.integrityCode),
    settledSnapshotJson: body.settledSnapshotJson ?? null,
    contractTypeConfirmedPj: Boolean(body.contractTypeConfirmedPj),
  };
}

export function distratoFieldsToPrismaData(
  fields: ServiceTerminationDistratoFields,
  options?: { includeDocumentCode?: boolean }
): Record<string, unknown> {
  const parseDate = (ymd: string | null) =>
    ymd ? new Date(`${ymd}T12:00:00.000Z`) : null;

  const data: Record<string, unknown> = {
    originalContractDate: parseDate(fields.originalContractDate),
    originalContractReference: fields.originalContractReference,
    contractingPartyName: fields.contractingPartyName,
    contractingPartyDocument: fields.contractingPartyDocument,
    contractingPartyRepName: fields.contractingPartyRepName,
    contractingPartyRepRole: fields.contractingPartyRepRole,
    contractingPartyRepDocument: fields.contractingPartyRepDocument,
    contractedPartyName: fields.contractedPartyName,
    contractedPartyDocument: fields.contractedPartyDocument,
    contractedPartyRepName: fields.contractedPartyRepName,
    contractedPartyRepDocument: fields.contractedPartyRepDocument,
    contractedServiceDescription: fields.contractedServiceDescription,
    signaturePlace: fields.signaturePlace,
    terminationModality: fields.terminationModality ?? null,
    terminationReason: fields.terminationReason,
    paymentDueDate: parseDate(fields.paymentDueDate),
    paymentMethod: fields.paymentMethod,
    paymentTransactionId: fields.paymentTransactionId,
    paymentEffectiveDate: parseDate(fields.paymentEffectiveDate),
    paymentConfirmedAmount: fields.paymentConfirmedAmount,
    paymentProofStorageKey: fields.paymentProofStorageKey,
    paymentProofFileName: fields.paymentProofFileName,
    paymentProofWaiverReason: fields.paymentProofWaiverReason,
    commissionTreatment: fields.commissionTreatment ?? null,
    commissionPendingNotes: fields.commissionPendingNotes,
    commissionNegotiatedAmount: fields.commissionNegotiatedAmount,
    commissionNegotiatedOrders: fields.commissionNegotiatedOrders,
    commissionNegotiatedJustification: fields.commissionNegotiatedJustification,
    commissionNegotiatedApprover: fields.commissionNegotiatedApprover,
    noticePenaltyOrigin: fields.noticePenaltyOrigin ?? null,
    noticePenaltyClauseNumber: fields.noticePenaltyClauseNumber,
    noticePenaltyClauseDescription: fields.noticePenaltyClauseDescription,
    proportionalCompensationJustification: fields.proportionalCompensationJustification,
    extraServicesDescription: fields.extraServicesDescription,
    otherDiscountsDescription: fields.otherDiscountsDescription,
    contractualNotes: fields.contractualNotes,
    pendingObligationsNotes: fields.pendingObligationsNotes,
    hasPendingObligations: fields.hasPendingObligations,
    witness1Name: fields.witness1Name,
    witness1Document: fields.witness1Document,
    witness2Name: fields.witness2Name,
    witness2Document: fields.witness2Document,
    contractTypeConfirmedPj: fields.contractTypeConfirmedPj,
  };

  if (options?.includeDocumentCode && fields.documentCode) {
    data.documentCode = fields.documentCode;
  }
  return data;
}

export function mapDistratoRowFields(row: Record<string, unknown>): ServiceTerminationDistratoFields {
  const toYmd = (d: unknown): string | null => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().slice(0, 10);
    const s = String(d);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
  };
  const toNum = (n: unknown): number | null => {
    if (n == null) return null;
    if (typeof n === "number") return n;
    try {
      return (n as Prisma.Decimal).toNumber();
    } catch {
      const v = Number(n);
      return Number.isFinite(v) ? v : null;
    }
  };

  return {
    documentCode: (row.documentCode as string | null) ?? null,
    documentVersion: Number(row.documentVersion ?? 1) || 1,
    supersedesId: (row.supersedesId as string | null) ?? null,
    originalContractDate: toYmd(row.originalContractDate),
    originalContractReference: (row.originalContractReference as string | null) ?? null,
    contractingPartyName: (row.contractingPartyName as string | null) ?? null,
    contractingPartyDocument: (row.contractingPartyDocument as string | null) ?? null,
    contractingPartyRepName: (row.contractingPartyRepName as string | null) ?? null,
    contractingPartyRepRole: (row.contractingPartyRepRole as string | null) ?? null,
    contractingPartyRepDocument: (row.contractingPartyRepDocument as string | null) ?? null,
    contractedPartyName: (row.contractedPartyName as string | null) ?? null,
    contractedPartyDocument: (row.contractedPartyDocument as string | null) ?? null,
    contractedPartyRepName: (row.contractedPartyRepName as string | null) ?? null,
    contractedPartyRepDocument: (row.contractedPartyRepDocument as string | null) ?? null,
    contractedServiceDescription: (row.contractedServiceDescription as string | null) ?? null,
    signaturePlace: (row.signaturePlace as string | null) ?? null,
    terminationModality: parseModality(row.terminationModality),
    terminationReason: (row.terminationReason as string | null) ?? null,
    paymentDueDate: toYmd(row.paymentDueDate),
    paymentMethod: (row.paymentMethod as string | null) ?? null,
    paymentTransactionId: (row.paymentTransactionId as string | null) ?? null,
    paymentEffectiveDate: toYmd(row.paymentEffectiveDate),
    paymentConfirmedAmount: toNum(row.paymentConfirmedAmount),
    paymentProofStorageKey: (row.paymentProofStorageKey as string | null) ?? null,
    paymentProofFileName: (row.paymentProofFileName as string | null) ?? null,
    paymentProofWaiverReason: (row.paymentProofWaiverReason as string | null) ?? null,
    commissionTreatment: parseCommissionTreatment(row.commissionTreatment),
    commissionPendingNotes: (row.commissionPendingNotes as string | null) ?? null,
    commissionNegotiatedAmount: toNum(row.commissionNegotiatedAmount),
    commissionNegotiatedOrders: (row.commissionNegotiatedOrders as string | null) ?? null,
    commissionNegotiatedJustification:
      (row.commissionNegotiatedJustification as string | null) ?? null,
    commissionNegotiatedApprover: (row.commissionNegotiatedApprover as string | null) ?? null,
    noticePenaltyOrigin: parseNoticeOrigin(row.noticePenaltyOrigin),
    noticePenaltyClauseNumber: (row.noticePenaltyClauseNumber as string | null) ?? null,
    noticePenaltyClauseDescription:
      (row.noticePenaltyClauseDescription as string | null) ?? null,
    proportionalCompensationJustification:
      (row.proportionalCompensationJustification as string | null) ?? null,
    extraServicesDescription: (row.extraServicesDescription as string | null) ?? null,
    otherDiscountsDescription: (row.otherDiscountsDescription as string | null) ?? null,
    contractualNotes: (row.contractualNotes as string | null) ?? null,
    pendingObligationsNotes: (row.pendingObligationsNotes as string | null) ?? null,
    hasPendingObligations: Boolean(row.hasPendingObligations),
    witness1Name: (row.witness1Name as string | null) ?? null,
    witness1Document: (row.witness1Document as string | null) ?? null,
    witness2Name: (row.witness2Name as string | null) ?? null,
    witness2Document: (row.witness2Document as string | null) ?? null,
    integrityCode: (row.integrityCode as string | null) ?? null,
    settledSnapshotJson: row.settledSnapshotJson ?? null,
    contractTypeConfirmedPj: Boolean(row.contractTypeConfirmedPj),
  };
}

export function assertCanEditTermination(status: string): void {
  if (isServiceTerminationLockedStatus(status)) {
    throw new SupplierServiceTerminationError(
      "Documento quitado ou cancelado não pode ser alterado. Cancele e gere nova versão se necessário.",
      "DOCUMENT_LOCKED",
      409
    );
  }
}

export function assertStatusTransitionAllowed(
  from: string,
  to: ServiceTerminationStatusDto
): void {
  const current = normalizeServiceTerminationStatus(from);
  if (current === to) return;
  if (current === "CANCELED") {
    throw new SupplierServiceTerminationError(
      "Documento cancelado não pode mudar de status.",
      "CANCELED",
      409
    );
  }
  const allowed: Record<ServiceTerminationStatusDto, ServiceTerminationStatusDto[]> = {
    DRAFT: ["AWAITING_SIGNATURE", "CANCELED"],
    AWAITING_SIGNATURE: ["DRAFT", "SIGNED_AWAITING_PAYMENT", "CANCELED"],
    SIGNED_AWAITING_PAYMENT: ["AWAITING_SIGNATURE", "PAID_AND_SETTLED", "CANCELED"],
    // Quitado: só cancelamento para gerar nova versão (não edita in-place).
    PAID_AND_SETTLED: ["CANCELED"],
    CANCELED: [],
  };
  if (!allowed[current]?.includes(to)) {
    throw new SupplierServiceTerminationError(
      `Transição de status inválida: ${current} → ${to}.`,
      "INVALID_STATUS_TRANSITION",
      409
    );
  }
}

export function assertDistratoValidForTarget(
  dto: ServiceTerminationDto,
  targetStatus: ServiceTerminationStatusDto
): void {
  if (
    (targetStatus === "AWAITING_SIGNATURE" ||
      targetStatus === "SIGNED_AWAITING_PAYMENT" ||
      targetStatus === "PAID_AND_SETTLED") &&
    !dto.contractTypeConfirmedPj
  ) {
    throw new SupplierServiceTerminationError(
      "Confirme que o contrato é de prestação de serviços PJ antes de avançar.",
      "PJ_CONFIRMATION_REQUIRED",
      400
    );
  }
  const issues = validateDistratoForStatusTransition({ dto, targetStatus });
  if (issues.length) {
    throw new SupplierServiceTerminationError(
      issues.map((i) => i.message).join(" "),
      issues[0]!.code,
      400
    );
  }
}

export function buildSettledSnapshot(dto: ServiceTerminationDto): object {
  return redactSensitiveDistratoFields({
    ...dto,
    settledAt: new Date().toISOString(),
  } as Record<string, unknown>);
}

export { redactSensitiveDistratoFields };
