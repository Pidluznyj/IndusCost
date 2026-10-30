/**
 * Grava a decisão humana do vínculo. Não apaga histórico e não altera cadastro Nomus.
 * As duas pontas recebem o mesmo estado, na mesma transação, para o grupo enxergar o vínculo.
 *
 * Confirmar ou rejeitar exige indício atual do par (o servidor recalcula, não confia no navegador).
 * Encerrar exige vínculo manual confirmado. Vínculo formal (QSA, mesma raiz) não se encerra aqui:
 * é fato do cadastro público.
 * Repetir a mesma decisão sobre a mesma evidência não grava nada (idempotente).
 * Cada ponta gravada deixa uma linha de auditoria com estado anterior, estado novo e justificativa.
 */

import {
  corporateCandidateFingerprint,
  corporatePairFingerprints,
  type CorporateCandidate,
} from "./corporateRelation.js";
import {
  assessCorporateLinkReview,
  corporateLinkActionStatus,
  type CorporateLinkAction,
  type CorporateLinkReviewActor,
} from "./corporateLinkReview.js";

type LinkRow = { id: string; status: string };

export type CorporateLinkSnapshot = {
  id: string;
  customerId: string;
  relatedCustomerId: string;
  status: string | null;
  evidenceKind: string | null;
  justification: string | null;
  actorUserId: string | null;
  evidenceFingerprint: string | null;
  closedAt: Date | string | null;
  updatedAt?: Date | string | null;
};

export type CorporateLinkReviewTx = {
  customerCorporateLink: {
    findMany(args: unknown): Promise<CorporateLinkSnapshot[]>;
    upsert(args: {
      where: { customerId_relatedCustomerId: { customerId: string; relatedCustomerId: string } };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<LinkRow>;
  };
  commercialAuditLog: {
    create(args: {
      data: {
        entityType: string;
        entityId: string;
        action: string;
        fieldName: string | null;
        oldValue: string | null;
        newValue: string | null;
        performedBy: string | null;
      };
    }): Promise<unknown>;
  };
};

export type CorporateLinkReviewStore = CorporateLinkReviewTx & {
  $transaction?<T>(fn: (tx: CorporateLinkReviewTx) => Promise<T>): Promise<T>;
};

export type CorporateLinkEvidence = Pick<CorporateCandidate, "relatedCustomerId" | "basis" | "evidenceLabel">;

export type CorporateLinkReviewResult =
  | { ok: true; status: string; changed: boolean }
  | { ok: false; code: string; message: string; httpStatus: number };

const EVIDENCE_KIND: Record<string, string> = {
  confirm: "MANUAL",
  reject: "REJECTED_CANDIDATE",
  close: "CLOSED",
};

function snapshot(row: CorporateLinkSnapshot | undefined) {
  if (!row) return null;
  return {
    status: row.status || "CONFIRMED",
    evidenceKind: row.evidenceKind,
    justification: row.justification,
    actorUserId: row.actorUserId,
    evidenceFingerprint: row.evidenceFingerprint,
    closedAt: row.closedAt ? new Date(row.closedAt).toISOString() : null,
  };
}

export async function applyCorporateLinkReview(
  db: CorporateLinkReviewStore,
  input: {
    actor: CorporateLinkReviewActor & { id: string };
    subjectCustomerId: string;
    relatedCustomerId: string;
    action: string;
    justification: string;
    /** Indícios atuais do cliente, recalculados no servidor antes das decisões humanas. */
    evidence: readonly CorporateLinkEvidence[];
    now?: Date;
  }
): Promise<CorporateLinkReviewResult> {
  const verdict = assessCorporateLinkReview(input);
  if (!verdict.ok) {
    const failure = verdict as { ok: false; code: string; message: string };
    return {
      ok: false,
      code: failure.code,
      message: failure.message,
      httpStatus: failure.code.startsWith("EXCEPTION_") ? 403 : 400,
    };
  }
  const assessed = verdict as {
    ok: true;
    action: CorporateLinkAction;
    authorizationBasis: "ROLE_SUPER_ADMIN" | "ASSIGNED_PERMISSION";
    permission: string | null;
    justification: string;
  };
  const now = input.now ?? new Date();
  const status = corporateLinkActionStatus(assessed.action);
  const pairEvidence = input.evidence.filter((item) => item.relatedCustomerId === input.relatedCustomerId);
  const fingerprint = corporatePairFingerprints(
    pairEvidence.map((item) => ({ ...item, subjectCustomerId: input.subjectCustomerId })) as CorporateCandidate[],
    input.relatedCustomerId
  );

  const run = async (tx: CorporateLinkReviewTx): Promise<CorporateLinkReviewResult> => {
    const existing = await tx.customerCorporateLink.findMany({
      where: {
        OR: [
          { customerId: input.subjectCustomerId, relatedCustomerId: input.relatedCustomerId },
          { customerId: input.relatedCustomerId, relatedCustomerId: input.subjectCustomerId },
        ],
      },
    });
    const forward = existing.find(
      (row) => row.customerId === input.subjectCustomerId && row.relatedCustomerId === input.relatedCustomerId
    );
    const backward = existing.find(
      (row) => row.customerId === input.relatedCustomerId && row.relatedCustomerId === input.subjectCustomerId
    );
    const currentStatus = forward ? (forward.closedAt ? "CLOSED" : forward.status || "CONFIRMED") : null;
    const backwardStatus = backward ? (backward.closedAt ? "CLOSED" : backward.status || "CONFIRMED") : null;

    if (assessed.action === "close") {
      if (currentStatus !== "CONFIRMED" && backwardStatus !== "CONFIRMED") {
        if (currentStatus === "CLOSED" && backwardStatus === "CLOSED") return { ok: true, status, changed: false };
        return {
          ok: false,
          code: "CORPORATE_LINK_NOT_CONFIRMED",
          message: "Só um vínculo confirmado manualmente pode ser encerrado.",
          httpStatus: 409,
        };
      }
    } else if (pairEvidence.length === 0) {
      const repeated = currentStatus === status && backwardStatus === status;
      if (repeated) return { ok: true, status, changed: false };
      return {
        ok: false,
        code: "CORPORATE_LINK_NO_EVIDENCE",
        message: "Não há indício atual entre estas empresas. Atualize a ficha e tente de novo.",
        httpStatus: 409,
      };
    }

    const sameDecision =
      currentStatus === status &&
      backwardStatus === status &&
      (assessed.action !== "reject" || (forward?.evidenceFingerprint ?? null) === fingerprint);
    if (sameDecision) return { ok: true, status, changed: false };

    // Encerrar guarda a evidência atual do par: a mesma evidência não reabre a pendência; evidência nova reabre.
    const payload = {
      status,
      evidenceKind: EVIDENCE_KIND[assessed.action],
      justification: assessed.justification,
      actorUserId: input.actor.id,
      evidenceFingerprint: assessed.action === "close" ? fingerprint ?? forward?.evidenceFingerprint ?? null : fingerprint,
      closedAt: assessed.action === "close" ? now : null,
    };
    const evidenceSummary = pairEvidence.map((item) => ({
      basis: item.basis,
      fingerprint: corporateCandidateFingerprint(item),
    }));
    // Ordem fixa (menor id primeiro): duas revisões simultâneas, uma de cada ficha, esperam uma pela outra em vez de
    // travarem em impasse; a última decisão vale para as duas direções.
    const pairs = (
      [
        [input.subjectCustomerId, input.relatedCustomerId, forward],
        [input.relatedCustomerId, input.subjectCustomerId, backward],
      ] as Array<[string, string, CorporateLinkSnapshot | undefined]>
    ).sort((left, right) => left[0].localeCompare(right[0]));
    for (const [customerId, relatedCustomerId, before] of pairs) {
      const written = await tx.customerCorporateLink.upsert({
        where: { customerId_relatedCustomerId: { customerId, relatedCustomerId } },
        create: { customerId, relatedCustomerId, ...payload },
        update: payload,
      });
      await tx.commercialAuditLog.create({
        data: {
          entityType: "CustomerCorporateLink",
          entityId: written.id,
          action: `CORPORATE_LINK_${assessed.action.toUpperCase()}`,
          fieldName: "status",
          oldValue: JSON.stringify(snapshot(before)),
          newValue: JSON.stringify({
            status,
            at: now.toISOString(),
            actorUserId: input.actor.id,
            actorRole: input.actor.role,
            authorizationBasis: assessed.authorizationBasis,
            permission: assessed.permission,
            reviewedFromCustomerId: input.subjectCustomerId,
            customerId,
            relatedCustomerId,
            justification: assessed.justification,
            evidenceFingerprint: payload.evidenceFingerprint,
            evidence: evidenceSummary,
          }),
          performedBy: input.actor.id,
        },
      });
    }
    return { ok: true, status, changed: true };
  };

  if (typeof db.$transaction === "function") return db.$transaction((tx) => run(tx));
  return run(db);
}

/**
 * Pedido da rota POST /api/customers/:id/corporate-links.
 * Ordem: permissão e formato antes de qualquer leitura; depois as duas empresas; por fim a evidência atual,
 * recalculada no servidor (todos os indícios do par, antes das decisões humanas).
 */
export async function reviewCorporateLinkRequest(
  db: CorporateLinkReviewStore & {
    customer: { findUnique(args: unknown): Promise<{ id?: string; taxId?: string | null } | null> };
  },
  input: {
    actor: CorporateLinkReviewActor & { id: string };
    subjectCustomerId: string;
    relatedCustomerId: string;
    action: string;
    justification: string;
    now?: Date;
    loadEvidence?: (customer: { id: string; taxId: string | null }) => Promise<readonly CorporateLinkEvidence[]>;
  }
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const precheck = assessCorporateLinkReview(input);
  if (!precheck.ok) {
    const failure = precheck as { ok: false; code: string; message: string };
    return {
      httpStatus: failure.code.startsWith("EXCEPTION_") ? 403 : 400,
      body: { error: failure.message, code: failure.code },
    };
  }
  const subject = await db.customer.findUnique({ where: { id: input.subjectCustomerId }, select: { id: true, taxId: true } });
  if (!subject) return { httpStatus: 404, body: { error: "Cliente não encontrado." } };
  const related = await db.customer.findUnique({ where: { id: input.relatedCustomerId }, select: { id: true } });
  if (!related) return { httpStatus: 404, body: { error: "Empresa relacionada não encontrada." } };
  const loadEvidence =
    input.loadEvidence ??
    (async (customer: { id: string; taxId: string | null }) => {
      const { loadCorporateRelationAssessment } = await import("./corporateRelation.server.js");
      const assessment = await loadCorporateRelationAssessment(db as never, {
        customerId: customer.id,
        cnpj: customer.taxId,
        now: input.now ?? new Date(),
      });
      return assessment.evidenceCandidates;
    });
  const evidence = await loadEvidence({ id: input.subjectCustomerId, taxId: subject.taxId ?? null });
  const result = await applyCorporateLinkReview(db, { ...input, evidence });
  if (!result.ok) {
    const failure = result as { ok: false; code: string; message: string; httpStatus: number };
    return { httpStatus: failure.httpStatus, body: { error: failure.message, code: failure.code } };
  }
  const done = result as { ok: true; status: string; changed: boolean };
  return { httpStatus: 200, body: { status: done.status, changed: done.changed } };
}

export type CorporateLinkReviewRow = {
  relatedCustomerId: string;
  relatedCompanyName: string;
  relatedCnpj: string | null;
  status: "CONFIRMED" | "REJECTED" | "CLOSED";
  evidenceKind: string | null;
  justification: string | null;
  actorName: string | null;
  reviewedAt: string | null;
};

/** Decisões humanas gravadas a partir deste cliente (uma linha por empresa relacionada). */
export async function loadCorporateLinkReviews(
  db: object,
  customerId: string
): Promise<{ rows: CorporateLinkReviewRow[]; readFailed: boolean }> {
  const models = db as {
    customerCorporateLink?: { findMany?(args: unknown): Promise<CorporateLinkSnapshot[]> };
    customer?: { findMany?(args: unknown): Promise<Array<{ id: string; companyName: string; taxId: string | null }>> };
    appUser?: { findMany?(args: unknown): Promise<Array<{ id: string; name: string }>> };
  };
  if (!models.customerCorporateLink?.findMany) return { rows: [], readFailed: false };
  try {
    const links = await models.customerCorporateLink.findMany({
      where: { customerId },
      orderBy: { updatedAt: "desc" },
    });
    const relatedIds = [...new Set(links.map((row) => row.relatedCustomerId).filter(Boolean))];
    const actorIds = [...new Set(links.map((row) => row.actorUserId).filter((id): id is string => Boolean(id)))];
    const [customers, actors] = await Promise.all([
      relatedIds.length && models.customer?.findMany
        ? models.customer.findMany({ where: { id: { in: relatedIds } }, select: { id: true, companyName: true, taxId: true } })
        : Promise.resolve([]),
      actorIds.length && models.appUser?.findMany
        ? models.appUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);
    const customerById = new Map(customers.map((row) => [row.id, row]));
    const actorById = new Map(actors.map((row) => [row.id, row.name]));
    const rows = links
      .filter((row) => row.relatedCustomerId && row.relatedCustomerId !== customerId)
      .map((row): CorporateLinkReviewRow => {
        const raw = row.closedAt ? "CLOSED" : row.status || "CONFIRMED";
        const status = raw === "REJECTED" || raw === "CLOSED" ? raw : "CONFIRMED";
        const related = customerById.get(row.relatedCustomerId);
        const reviewedAt = row.closedAt ?? row.updatedAt ?? null;
        return {
          relatedCustomerId: row.relatedCustomerId,
          relatedCompanyName: related?.companyName ?? "Empresa relacionada",
          relatedCnpj: related?.taxId ?? null,
          status,
          evidenceKind: row.evidenceKind,
          justification: row.justification,
          actorName: row.actorUserId ? actorById.get(row.actorUserId) ?? "Usuário do sistema" : null,
          reviewedAt: reviewedAt ? new Date(reviewedAt).toISOString() : null,
        };
      });
    return { rows, readFailed: false };
  } catch (error) {
    console.error("corporate-link-reviews", error instanceof Error ? error.name : "error");
    return { rows: [], readFailed: true };
  }
}
