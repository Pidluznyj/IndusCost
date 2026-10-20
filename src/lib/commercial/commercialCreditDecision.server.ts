/**
 * Carga e aplicação da decisão de crédito.
 * Lê inadimplência, vínculo societário, protesto externo e exceção formal.
 * Não grava Contas a Receber e não libera crédito pelo papel SUPER_ADMIN.
 */

import type { PrismaClient } from "@prisma/client";
import { analyzeCustomerDelinquency, type CustomerDelinquencyDb } from "./customerDelinquencyAnalysis.server.js";
import {
  applyExternalProtestConsultation,
  COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT,
  CommercialCreditDeniedError,
  CommercialCreditExceptionError,
  decideCommercialCredit,
  resolveCommercialCreditExceptionPermission,
  validateCommercialCreditExceptionDraft,
  type CommercialCreditAdvanceConfirmation,
  type CommercialCreditDecision,
  type CommercialCreditEnforcement,
  type CommercialExternalProtestStatus,
} from "./commercialCreditDecision.js";
import { buildCommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import type { CommercialCreditIntelligenceView } from "./commercialCreditIntelligenceView.js";
import {
  occurrenceHistoryLine,
  presentCommercialCreditOccurrence,
  resolveConfirmedPendingProtest,
} from "./commercialCreditOccurrence.js";
import {
  creditStatusLabel,
  loadCorporateRelations,
  presentCorporateRelation,
  type CorporateRelationView,
} from "./corporateRelation.server.js";
import type { ExternalProtestCreditFact } from "./externalProtest/externalProtestProvider.js";
import type { ExternalProtestCache } from "./externalProtest/externalProtestQuery.js";
import {
  commercialCreditEvaluationDraft,
  formatCommercialCreditException,
  readStoredCadastralScore,
} from "./commercialCreditOperation.js";
import type { ExternalProtestConfig, ExternalProtestProvider } from "./externalProtest/externalProtestProvider.js";
import { resolveExternalProtestForDecision } from "./externalProtest/externalProtestQuery.server.js";

type CreditModels = Pick<
  PrismaClient,
  | "commercialCreditException"
  | "customerCorporateLink"
  | "commercialExternalProtest"
  | "commercialCreditOccurrence"
  | "customerCnpjLookup"
>;

export type CommercialCreditDb = CustomerDelinquencyDb & CreditModels & {
  $transaction<T>(fn: (tx: CreditModels) => Promise<T>): Promise<T>;
};

type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  performedBy?: string | null;
};

async function writeAudit(writer: ((entry: AuditEntry) => Promise<void>) | undefined, entry: AuditEntry) {
  if (writer) {
    await writer(entry);
    return;
  }
  const { writeCommercialAuditLog } = await import("@/src/lib/commercialAuditLog.js");
  await writeCommercialAuditLog(entry);
}

function decisionAuditValue(decision: CommercialCreditDecision): string {
  return JSON.stringify({
    status: decision.status,
    customerStatus: decision.customerStatus,
    reason: decision.reason,
    saleKind: decision.saleKind,
    appliedExceptionIds: decision.appliedExceptionIds,
  });
}

export function resolveStoredExternalProtest(
  rows: ReadonlyArray<{ status: string; effectiveFrom: Date; effectiveUntil: Date | null }>,
  now: Date
): CommercialExternalProtestStatus {
  const current = rows.filter((row) => {
    const until = row.effectiveUntil;
    return row.effectiveFrom.getTime() <= now.getTime() && (until == null || until.getTime() > now.getTime());
  });
  if (current.some((row) => row.status === "CONFIRMED_CURRENT")) return "CONFIRMED_CURRENT";
  if (current.some((row) => row.status === "UNREADABLE")) return "UNREADABLE";
  return "ABSENT";
}

export async function readCommercialCreditDecision(
  db: CommercialCreditDb,
  input: {
    customerId: string;
    enforcement: CommercialCreditEnforcement;
    paymentTerms: unknown;
    advanceConfirmation?: CommercialCreditAdvanceConfirmation | null;
    cadastral?: { score: number | null; verdict: string | null } | null;
    now?: Date;
    externalProtestQuery?: {
      config?: ExternalProtestConfig;
      provider?: ExternalProtestProvider;
      cache?: ExternalProtestCache;
      sleep?: (ms: number) => Promise<void>;
      audit?: (entry: {
        entityType: string;
        entityId: string;
        action: string;
        fieldName?: string | null;
        newValue?: string | null;
        performedBy?: string | null;
      }) => Promise<void>;
      env?: Record<string, string | undefined>;
    };
  }
): Promise<{
  decision: CommercialCreditDecision;
  delinquency: Awaited<ReturnType<typeof analyzeCustomerDelinquency>>;
  externalProtest: CommercialExternalProtestStatus;
  externalProtestConsultation: ExternalProtestCreditFact;
  occurrenceLines: string[];
  corporateRelations: CorporateRelationView[];
  activeExceptions: Array<{ id: string; scope: string; expiresAt: Date; grantedByPermission: string | null }>;
  confirmedPendingProtest: boolean;
}> {
  const now = input.now ?? new Date();
  const [delinquency, links, protests, exceptions, occurrences] = await Promise.all([
    analyzeCustomerDelinquency(db, input.customerId, now),
    db.customerCorporateLink.findMany({
      where: { customerId: input.customerId },
      select: { relatedCustomerId: true },
      take: COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT + 1,
    }),
    db.commercialExternalProtest.findMany({
      where: { customerId: input.customerId },
      select: { status: true, effectiveFrom: true, effectiveUntil: true },
    }),
    db.commercialCreditException.findMany({
      where: { customerId: input.customerId, activeKey: "ACTIVE", revokedAt: null },
      select: { id: true, scope: true, expiresAt: true, revokedAt: true, grantedByPermission: true },
    }),
    db.commercialCreditOccurrence.findMany({
      where: { customerId: input.customerId },
      select: {
        id: true,
        kind: true,
        status: true,
        origin: true,
        occurredAt: true,
        titleExternalId: true,
        responsibleUserId: true,
        justification: true,
        closedAt: true,
      },
      orderBy: { occurredAt: "desc" },
    }),
  ]);

  const qsaRelations = await loadCorporateRelations(db as never, {
    customerId: input.customerId,
    cnpj: delinquency.evidence.cnpj,
    now,
  });
  const relatedIds = [
    ...new Set([
      ...links.map((link) => link.relatedCustomerId),
      ...qsaRelations.map((relation) => relation.relatedCustomerId),
    ]),
  ].filter((id) => id !== input.customerId);
  const relatedPartyOverflow = relatedIds.length > COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT;
  const relatedSlice = relatedIds.slice(0, COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT);
  const relatedParties = await Promise.all(
    relatedSlice.map(async (relatedCustomerId) => ({
      customerId: relatedCustomerId,
      delinquency: await analyzeCustomerDelinquency(db, relatedCustomerId, now),
    }))
  );
  const statusByCustomer = new Map(relatedParties.map((party) => [party.customerId, creditStatusLabel(party.delinquency.status)]));
  const corporateRelations = qsaRelations
    .filter((relation) => relatedSlice.includes(relation.relatedCustomerId))
    .map((relation) => presentCorporateRelation(relation, statusByCustomer.get(relation.relatedCustomerId) ?? "Não consultado"));
  const storedExternalProtest = resolveStoredExternalProtest(protests, now);
  const externalProtestConsultation = await resolveExternalProtestForDecision({
    cnpj: delinquency.evidence.cnpj,
    customerId: input.customerId,
    now,
    ...input.externalProtestQuery,
  });
  const mergedExternalProtest = applyExternalProtestConsultation({
    stored: storedExternalProtest,
    confirmedCurrent: externalProtestConsultation.confirmedCurrent,
    review: externalProtestConsultation.review,
  });
  const formalProtest = resolveConfirmedPendingProtest({
    occurrences,
    openProtestedTitleIds: delinquency.evidence.protestedTitleIds,
    settledProtestedTitleIds: delinquency.evidence.settledProtestedTitleIds ?? [],
  });
  const occurrenceLines = occurrences.map((row) => occurrenceHistoryLine(presentCommercialCreditOccurrence(row)));
  const decision = decideCommercialCredit({
    customerId: input.customerId,
    enforcement: input.enforcement,
    paymentTerms: typeof input.paymentTerms === "number" && Number.isFinite(input.paymentTerms)
      ? String(input.paymentTerms)
      : typeof input.paymentTerms === "string"
        ? input.paymentTerms
        : null,
    delinquency,
    externalProtest: mergedExternalProtest.externalProtest,
    externalProtestReview: mergedExternalProtest.review,
    relatedParties,
    relatedPartyOverflow,
    exceptions,
    confirmedPendingProtest: formalProtest.confirmedPending,
    suppressedProtestTitleIds: formalProtest.suppressedTitleIds,
    advanceConfirmation: input.advanceConfirmation ?? null,
    cadastral: input.cadastral ?? null,
    now,
  });
  return {
    decision,
    delinquency,
    externalProtest: mergedExternalProtest.externalProtest,
    externalProtestConsultation,
    occurrenceLines,
    corporateRelations,
    activeExceptions: exceptions
      .filter((row) => row.revokedAt == null && row.expiresAt.getTime() > now.getTime())
      .map((row) => ({
        id: row.id,
        scope: row.scope,
        expiresAt: row.expiresAt,
        grantedByPermission: row.grantedByPermission ?? null,
      })),
    confirmedPendingProtest: formalProtest.confirmedPending,
  };
}

export async function assertCommercialCreditAllows(
  db: CommercialCreditDb,
  input: {
    customerId: string;
    enforcement: CommercialCreditEnforcement;
    paymentTerms: unknown;
    advanceConfirmation?: CommercialCreditAdvanceConfirmation | null;
    cadastral?: { score: number | null; verdict: string | null } | null;
    now?: Date;
    audit?: { entityId: string; action: string; performedBy: string | null } | null;
    auditWriter?: (entry: AuditEntry) => Promise<void>;
  }
): Promise<CommercialCreditDecision> {
  const read = await readCommercialCreditDecision(db, input);
  const { decision } = read;
  const appliedValidity = read.activeExceptions
    .filter((row) => decision.appliedExceptionIds.includes(row.id))
    .map((row) => row.expiresAt.getTime())
    .sort((left, right) => left - right)[0];
  try {
    const evaluationDb = db as {
      commercialCreditEvaluation?: { create(args: { data: ReturnType<typeof commercialCreditEvaluationDraft> }): Promise<unknown> };
    };
    await evaluationDb.commercialCreditEvaluation?.create({
      data: commercialCreditEvaluationDraft({
        customerId: input.customerId,
        decision,
        evaluatedAt: input.now ?? new Date(),
        evaluatedBy: input.audit?.performedBy ?? null,
        enforcement: input.enforcement,
        validUntil: appliedValidity == null ? null : new Date(appliedValidity),
        entityType: input.audit ? "CommercialCreditDecision" : null,
        entityId: input.audit?.entityId ?? null,
      }),
    });
  } catch (error) {
    console.error("commercial credit evaluation", error instanceof Error ? error.name : "evaluation");
  }

  if (!decision.allowed && input.audit) {
    try {
      await writeAudit(input.auditWriter, {
        entityType: "CommercialCreditDecision",
        entityId: input.audit.entityId,
        action: input.audit.action,
        fieldName: decision.reason,
        newValue: decisionAuditValue(decision),
        performedBy: input.audit.performedBy,
      });
    } catch (error) {
      console.error("commercial credit audit", error instanceof Error ? error.name : "audit");
    }
  }

  if (!decision.allowed) throw new CommercialCreditDeniedError(decision);
  return decision;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

export async function grantCommercialCreditException(
  db: CommercialCreditDb,
  input: {
    customerId: string;
    scope: string;
    justification: string;
    expiresAt: Date;
    actor: { id: string; role: string; assignedPermissions: readonly string[] };
    now?: Date;
    auditWriter?: (entry: AuditEntry) => Promise<void>;
  }
) {
  const now = input.now ?? new Date();
  const permission = resolveCommercialCreditExceptionPermission({
    role: input.actor.role,
    assignedPermissions: input.actor.assignedPermissions,
  });
  if (permission.ok === false) {
    throw new CommercialCreditExceptionError(
      permission.code,
      permission.code === "EXCEPTION_IMPLICIT_SUPER_ADMIN"
        ? "SUPER_ADMIN não concede exceção de crédito. É necessária a permissão explícita de Financeiro ou Diretoria."
        : "Exceção de crédito restrita a Financeiro ou Diretoria."
    );
  }
  const draft = validateCommercialCreditExceptionDraft({
    customerId: input.customerId,
    scope: input.scope,
    justification: input.justification,
    expiresAt: input.expiresAt,
    now,
  });
  if (draft.ok === false) throw new CommercialCreditExceptionError(draft.code, draft.message);

  const created = await db.$transaction(async (tx) => {
    const existing = await tx.commercialCreditException.findFirst({
      where: { customerId: input.customerId, scope: input.scope, activeKey: "ACTIVE" },
    });
    if (existing && existing.revokedAt == null && existing.expiresAt.getTime() > now.getTime()) {
      throw new CommercialCreditExceptionError(
        "EXCEPTION_ALREADY_ACTIVE",
        "Já existe exceção vigente para este cliente e escopo."
      );
    }
    if (existing) {
      await tx.commercialCreditException.update({
        where: { id: existing.id },
        data: { activeKey: existing.id, revokedAt: existing.revokedAt ?? now },
      });
    }
    try {
      return await tx.commercialCreditException.create({
        data: {
          customerId: input.customerId,
          scope: input.scope,
          justification: input.justification.trim(),
          expiresAt: input.expiresAt,
          grantedByUserId: input.actor.id,
          grantedByPermission: permission.permission,
          activeKey: "ACTIVE",
          revokedAt: null,
        },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new CommercialCreditExceptionError(
          "EXCEPTION_ALREADY_ACTIVE",
          "Já existe exceção vigente para este cliente e escopo."
        );
      }
      throw error;
    }
  });

  try {
    await writeAudit(input.auditWriter, {
      entityType: "CommercialCreditException",
      entityId: created.id,
      action: "GRANT",
      fieldName: created.scope,
      newValue: JSON.stringify({
        customerId: created.customerId,
        scope: created.scope,
        expiresAt: created.expiresAt.toISOString(),
        permission: created.grantedByPermission,
      }),
      performedBy: input.actor.id,
    });
  } catch (error) {
    await db.commercialCreditException.update({
      where: { id: created.id },
      data: { activeKey: created.id, revokedAt: now },
    });
    throw error;
  }

  return created;
}

export function commercialCreditDenialBody(error: CommercialCreditDeniedError) {
  return {
    error: error.message,
    code: error.code,
    status: error.status,
    reason: error.reason,
  };
}

/** Leitura da decisão de prazo para a consulta CNPJ. Não grava e não usa o score cadastral. */
export async function loadCustomerCommercialCreditIntelligence(
  db: CommercialCreditDb,
  customerId: string,
  options: { revealFinancial: boolean; now?: Date } = { revealFinancial: false }
): Promise<CommercialCreditIntelligenceView> {
  const lookup = await db.customerCnpjLookup.findFirst({
    where: { customerId },
    orderBy: { fetchedAt: "desc" },
  });
  const cadastral = readStoredCadastralScore(lookup && "normalizedSummary" in lookup ? lookup.normalizedSummary : null);
  const read = await readCommercialCreditDecision(db, {
    customerId,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    now: options.now,
    cadastral,
  });
  return buildCommercialCreditIntelligenceView({
    decision: read.decision,
    delinquency: read.delinquency,
    externalProtest: read.externalProtest,
    externalProtestConsultation: read.externalProtestConsultation,
    revealFinancial: options.revealFinancial,
    occurrenceLines: read.occurrenceLines,
    corporateRelations: read.corporateRelations,
    authorizedExceptions: read.activeExceptions.map((row) =>
      formatCommercialCreditException({
        scope: row.scope,
        expiresAt: row.expiresAt,
        permission: row.grantedByPermission,
      })
    ),
  });
}
