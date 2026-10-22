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
  confirmedRelatedExposure,
  CommercialCreditDeniedError,
  CommercialCreditExceptionError,
  decideCommercialCredit,
  interpretIeptbConsultations,
  resolveCommercialCreditExceptionPermission,
  type CommercialIeptbEvidence,
  type CommercialQuodEvidence,
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
  loadCorporateLinkGraph,
  loadCorporateRelationAssessment,
  presentCorporateCandidate,
  presentCorporateRelation,
  type CorporateRelationView,
} from "./corporateRelation.server.js";
import { loadCreditRelationSignals } from "./creditRelationFacts.server.js";
import {
  IEPTB_READ_FAILED,
  QUOD_READ_FAILED,
  selectIeptbCreditEvidence,
  selectQuodCreditEvidence,
  type StoredQuodConsultation,
} from "./creditEvidenceSelection.js";
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

const QUOD_NOT_CONSULTED: CommercialQuodEvidence = {
  state: "NOT_CONSULTED",
  confirmedRestriction: false,
  insufficient: false,
  cnpjMatches: true,
};

/** Lê só os indicadores já persistidos. Sem payload, sem score e sem consulta paga. */
export async function loadQuodCreditEvidence(
  db: object,
  customerId: string,
  now: Date,
  customerCnpj?: string | null
): Promise<CommercialQuodEvidence> {
  const model = (db as {
    quodDossierConsultation?: {
      findMany?(args: unknown): Promise<StoredQuodConsultation[]>;
      findFirst?(args: unknown): Promise<StoredQuodConsultation | null>;
    };
  }).quodDossierConsultation;
  if (!model?.findMany && !model?.findFirst) return QUOD_NOT_CONSULTED;
  try {
    const rows = model.findMany
      ? await model.findMany({
          where: { customerId },
          orderBy: { consultedAt: "desc" },
          select: {
            cnpj: true,
            status: true,
            confirmedRestriction: true,
            insufficient: true,
            validUntil: true,
            consultedAt: true,
          },
        })
      : [await model.findFirst!({
          where: { customerId, status: "SUCCEEDED" },
          orderBy: { consultedAt: "desc" },
          select: { cnpj: true, confirmedRestriction: true, insufficient: true, validUntil: true, consultedAt: true },
        })].filter((row): row is StoredQuodConsultation => row != null).map((row) => ({ ...row, status: row.status ?? "SUCCEEDED" }));
    return selectQuodCreditEvidence(rows, now, customerCnpj);
  } catch (error) {
    console.error("quod-credit-evidence", error instanceof Error ? error.name : "error");
    return QUOD_READ_FAILED;
  }
}

const IEPTB_NOT_CONSULTED: CommercialIeptbEvidence = {
  state: "NOT_CONSULTED",
  confirmedProtest: false,
  insufficient: false,
};

/** Lê só o indicador da consulta IEPTB já persistida. Sem payload e sem consulta paga. */
export async function loadIeptbCreditEvidence(
  db: object,
  customerId: string,
  now: Date,
  customerCnpj?: string | null
): Promise<CommercialIeptbEvidence> {
  const model = (db as {
    ieptbOnlineConsultation?: {
      findMany?(args: unknown): Promise<
        Array<{
          status?: string | null;
          confirmedProtest: boolean;
          confirmedClear?: boolean | null;
          insufficient: boolean;
          validUntil: Date | null;
          consultedAt?: Date | null;
        }>
      >;
      findFirst?(args: unknown): Promise<{
        status?: string | null;
        confirmedProtest: boolean;
        confirmedClear?: boolean | null;
        insufficient: boolean;
        validUntil: Date | null;
        consultedAt?: Date | null;
      } | null>;
    };
  }).ieptbOnlineConsultation;
  if (!model?.findMany && !model?.findFirst) return IEPTB_NOT_CONSULTED;
  try {
    if (model.findMany) {
      const rows = await model.findMany({
        where: { customerId },
        orderBy: { consultedAt: "desc" },
        take: 8,
        select: {
          cnpj: true,
          status: true,
          confirmedProtest: true,
          confirmedClear: true,
          insufficient: true,
          validUntil: true,
          consultedAt: true,
        },
      });
      return selectIeptbCreditEvidence(rows, now, customerCnpj);
    }
    const row = await model.findFirst!({
      where: { customerId, status: "SUCCEEDED" },
      orderBy: { consultedAt: "desc" },
      select: {
        status: true,
        confirmedProtest: true,
        confirmedClear: true,
        insufficient: true,
        validUntil: true,
        consultedAt: true,
      },
    });
    return selectIeptbCreditEvidence(row ? [{ ...row, status: row.status ?? "SUCCEEDED" }] : [], now, customerCnpj);
  } catch (error) {
    console.error("ieptb-credit-evidence", error instanceof Error ? error.name : "error");
    return IEPTB_READ_FAILED;
  }
}

async function loadRelatedConfirmedProtests(
  db: object,
  customerIds: readonly string[],
  now: Date
): Promise<Set<string>> {
  const found = new Set<string>();
  if (customerIds.length === 0) return found;
  const allowed = new Set(customerIds);
  const external = (db as {
    commercialExternalProtest?: {
      findMany(args: unknown): Promise<
        Array<{ customerId?: string; status: string; effectiveFrom: Date; effectiveUntil: Date | null }>
      >;
    };
  }).commercialExternalProtest;
  if (external?.findMany) {
    try {
      const rows = await external.findMany({
        where: { customerId: { in: [...customerIds] } },
        select: { customerId: true, status: true, effectiveFrom: true, effectiveUntil: true },
      });
      for (const row of rows) {
        if (!row.customerId || !allowed.has(row.customerId)) continue;
        if (resolveStoredExternalProtest([row], now) === "CONFIRMED_CURRENT") found.add(row.customerId);
      }
    } catch (error) {
      console.error("related-external-protest", error instanceof Error ? error.name : "error");
    }
  }
  const ieptb = (db as {
    ieptbOnlineConsultation?: {
      findMany(args: unknown): Promise<
        Array<{
          customerId: string;
          status?: string | null;
          confirmedProtest: boolean;
          confirmedClear?: boolean | null;
          insufficient?: boolean | null;
          validUntil: Date | null;
          consultedAt?: Date | null;
        }>
      >;
    };
  }).ieptbOnlineConsultation;
  if (ieptb?.findMany) {
    try {
      const rows = await ieptb.findMany({
        where: { customerId: { in: [...customerIds] } },
        orderBy: { consultedAt: "desc" },
        select: {
          customerId: true,
          status: true,
          confirmedProtest: true,
          confirmedClear: true,
          insufficient: true,
          validUntil: true,
          consultedAt: true,
        },
      });
      const grouped = new Map<string, typeof rows>();
      for (const row of rows) {
        if (!allowed.has(row.customerId)) continue;
        const list = grouped.get(row.customerId) ?? [];
        if (list.length >= 8) continue;
        list.push(row);
        grouped.set(row.customerId, list);
      }
      for (const [customerId, list] of grouped) {
        const evidence = interpretIeptbConsultations(list, now);
        if (evidence.state === "VALID" && evidence.confirmedProtest) found.add(customerId);
      }
    } catch (error) {
      console.error("related-ieptb", error instanceof Error ? error.name : "error");
    }
  }
  return found;
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
    quod?: CommercialQuodEvidence | null;
    ieptb?: CommercialIeptbEvidence | null;
    now?: Date;
    relationLimits?: { examineLimit?: number; maxCatalogRows?: number };
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
  pendingCorporateRelations: CorporateRelationView[];
  relatedRestrictionFacts: Array<{
    companyName: string;
    cnpj: string | null;
    titleCount: number | null;
    overdueAmount: number | null;
    maxDaysOverdue: number | null;
    syncedAt: string | null;
    protest: boolean;
  }>;
  ownCustomerStatus: CommercialCreditDecision["customerStatus"];
  activeExceptions: Array<{ id: string; scope: string; expiresAt: Date; grantedByPermission: string | null }>;
  confirmedPendingProtest: boolean;
}> {
  const now = input.now ?? new Date();
  const [delinquency, linkGraph, protests, exceptions, occurrences] = await Promise.all([
    analyzeCustomerDelinquency(db, input.customerId, now),
    loadCorporateLinkGraph(db, input.customerId),
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

  let qsa: Awaited<ReturnType<typeof loadCorporateRelationAssessment>>;
  try {
    qsa = await loadCorporateRelationAssessment(db as never, {
      customerId: input.customerId,
      cnpj: delinquency.evidence.cnpj,
      now,
      rejected: linkGraph.rejected,
    });
  } catch (error) {
    console.error("corporate-relation-assessment", error instanceof Error ? error.name : "error");
    qsa = { relations: [], candidates: [], radarReadFailed: true };
  }
  const signals = await loadCreditRelationSignals(
    db,
    [{ id: input.customerId, taxId: delinquency.evidence.cnpj }],
    now,
    new Map([[input.customerId, linkGraph.rejected]]),
    input.relationLimits
  );
  const signal = signals.byCustomer.get(input.customerId) ?? {
    confirmedIds: [],
    pendingCount: 1,
    overflow: true,
    readFailed: true,
  };
  const relatedIds = [...new Set([...linkGraph.confirmedIds, ...signal.confirmedIds])]
    .filter((id) => id !== input.customerId)
    .sort();
  const relatedPartyOverflow = linkGraph.overflow || signal.overflow || signal.readFailed || relatedIds.length > COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT;
  const relatedSlice = relatedIds.slice(0, COMMERCIAL_CREDIT_RELATED_PARTY_LIMIT);
  const relatedProtests = await loadRelatedConfirmedProtests(db, relatedSlice, now);
  const relatedParties = await Promise.all(
    relatedSlice.map(async (relatedCustomerId) => {
      const [delinquency, quod, ieptb] = await Promise.all([
        analyzeCustomerDelinquency(db, relatedCustomerId, now),
        loadQuodCreditEvidence(db, relatedCustomerId, now),
        loadIeptbCreditEvidence(db, relatedCustomerId, now),
      ]);
      const exposure = confirmedRelatedExposure({
        quod,
        ieptb,
        externalProtest: relatedProtests.has(relatedCustomerId) ? "CONFIRMED_CURRENT" : "ABSENT",
      });
      return {
        customerId: relatedCustomerId,
        delinquency,
        confirmedProtest: relatedProtests.has(relatedCustomerId),
        owesMarket: exposure.owesMarket,
        incomplete: exposure.incomplete,
      };
    })
  );
  const statusByCustomer = new Map(
    relatedParties.map((party) => [
      party.customerId,
      party.confirmedProtest && party.delinquency.status !== "OVERDUE" && party.delinquency.status !== "PROTESTED"
        ? "Protesto confirmado"
        : creditStatusLabel(party.delinquency.status),
    ])
  );
  const corporateRelations = qsa.relations
    .filter((relation) => relatedSlice.includes(relation.relatedCustomerId))
    .map((relation) => presentCorporateRelation(relation, statusByCustomer.get(relation.relatedCustomerId) ?? "Não consultado"));
  const pendingCorporateRelations = qsa.candidates.map((candidate) => presentCorporateCandidate(candidate));
  let relatedNames = new Map<string, { companyName: string; taxId: string | null }>();
  try {
    const named = await db.customer.findMany({
      where: { id: { in: relatedSlice } },
      select: { id: true, companyName: true, taxId: true },
    });
    relatedNames = new Map(named.map((row) => [row.id, { companyName: row.companyName, taxId: row.taxId }]));
  } catch {
    relatedNames = new Map();
  }
  const relatedRestrictionFacts = relatedParties
    .filter(
      (party) =>
        party.delinquency.status === "OVERDUE" ||
        party.delinquency.status === "PROTESTED" ||
        party.confirmedProtest === true
    )
    .map((party) => {
      const named = relatedNames.get(party.customerId);
      const relation = qsa.relations.find((item) => item.relatedCustomerId === party.customerId);
      return {
        companyName: named?.companyName || relation?.relatedCompanyName || "Empresa relacionada",
        cnpj: named?.taxId || relation?.relatedCnpj || party.delinquency.evidence.cnpj,
        titleCount: party.delinquency.overdueTitleCount,
        overdueAmount: party.delinquency.overdueAmount,
        maxDaysOverdue: party.delinquency.maxDaysOverdue,
        syncedAt: party.delinquency.lastSyncedAt,
        protest: party.confirmedProtest === true || party.delinquency.status === "PROTESTED",
      };
    });
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
  const quod = input.quod === undefined ? await loadQuodCreditEvidence(db, input.customerId, now, delinquency.evidence.cnpj) : input.quod;
  const ieptb = input.ieptb === undefined ? await loadIeptbCreditEvidence(db, input.customerId, now, delinquency.evidence.cnpj) : input.ieptb;
  const formalProtest = resolveConfirmedPendingProtest({
    occurrences,
    openProtestedTitleIds: delinquency.evidence.protestedTitleIds,
    settledProtestedTitleIds: delinquency.evidence.settledProtestedTitleIds ?? [],
  });
  const occurrenceLines = occurrences.map((row) => occurrenceHistoryLine(presentCommercialCreditOccurrence(row)));
  const paymentTerms =
    typeof input.paymentTerms === "number" && Number.isFinite(input.paymentTerms)
      ? String(input.paymentTerms)
      : typeof input.paymentTerms === "string"
        ? input.paymentTerms
        : null;
  const decisionInput = {
    customerId: input.customerId,
    enforcement: input.enforcement,
    paymentTerms,
    delinquency,
    externalProtest: mergedExternalProtest.externalProtest,
    externalProtestReview: mergedExternalProtest.review,
    exceptions,
    confirmedPendingProtest: formalProtest.confirmedPending,
    suppressedProtestTitleIds: formalProtest.suppressedTitleIds,
    advanceConfirmation: input.advanceConfirmation ?? null,
    cadastral: input.cadastral ?? null,
    quod,
    ieptb,
    now,
  };
  const decision = decideCommercialCredit({
    ...decisionInput,
    relatedParties,
    relatedPartyOverflow,
    pendingRelatedPartyCount: signal.pendingCount,
  });
  const ownDecision = decideCommercialCredit({
    ...decisionInput,
    relatedParties: [],
    relatedPartyOverflow: false,
    pendingRelatedPartyCount: 0,
  });
  return {
    decision,
    delinquency,
    externalProtest: mergedExternalProtest.externalProtest,
    externalProtestConsultation,
    occurrenceLines,
    corporateRelations,
    pendingCorporateRelations,
    relatedRestrictionFacts,
    ownCustomerStatus: ownDecision.customerStatus,
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
    pendingCorporateRelations: read.pendingCorporateRelations,
    relatedRestrictionFacts: read.relatedRestrictionFacts,
    ownCustomerStatus: read.ownCustomerStatus,
    authorizedExceptions: read.activeExceptions.map((row) =>
      formatCommercialCreditException({
        scope: row.scope,
        expiresAt: row.expiresAt,
        permission: row.grantedByPermission,
      })
    ),
  });
}
