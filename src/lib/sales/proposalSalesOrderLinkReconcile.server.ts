import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  extractNomusProposalReferences,
  listCandidateProposalReferenceKeys,
  type NomusProposalReferenceField,
  NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS,
} from "../nomus/nomusProposalOrderReference.js";
import {
  decideProposalSalesOrderLink,
  type ProposalLinkSourceValue,
  type ProposalLinkStatusValue,
} from "./proposalSalesOrderLinkPolicy.js";
import {
  applyProposalSalesOrderLinkInTx,
  buildProposalLinkLineEvidence,
  loadProposalLinkCandidateIndex,
  PROPOSAL_LINK_ORDER_LOCK_NAMESPACE,
  PROPOSAL_LINK_PROPOSAL_LOCK_NAMESPACE,
  resolveExplicitProposalReference,
} from "./proposalSalesOrderLinkWriter.server.js";

/**
 * Reconciliação do vínculo Pedido → Proposta.
 *
 * DRY-RUN (padrão): calcula, sem gravar, a decisão da política para cada pedido e monta o plano. O plano tem um
 * hash (`planHash`) das ações aplicáveis; o APPLY exige `--confirm=<planHash>`, então só aplica exatamente o que foi
 * revisado (se o banco mudou, o hash muda e o APPLY recusa).
 *
 * APPLY aplica SOMENTE:
 *   - APPLY_EXPLICIT: referência explícita do Nomus resolvida, mesmo cliente, vaga livre;
 *   - MANUAL: linhas de um arquivo revisado por pessoa (pedido, proposta, revisor), mesmo cliente, vaga livre;
 *     trocar um vínculo existente exige `replaceExisting: true` na linha.
 * Inferência por itens nunca é aplicada pela reconciliação (o sync de pedidos aplica a inferência inequívoca).
 * Cada ação roda na própria transação, com os mesmos locks do sync, e grava evento com `runId`; `--revert=<runId>`
 * desfaz as ações daquele APPLY (só onde o vínculo ainda está como o APPLY deixou).
 */

export type ReconcileAction =
  | "APPLY_EXPLICIT"
  | "MANUAL"
  | "KEEP"
  | "SYNC_WILL_INFER"
  | "REVIEW_CONFLICT"
  | "REVIEW_AMBIGUOUS"
  | "NO_EVIDENCE"
  | "STATUS_ONLY";

export type ReconcilePlanRow = {
  salesOrderId: string;
  orderCode: string | null;
  sourceSystem: string | null;
  currentProposalId: string | null;
  currentProposalCode: string | null;
  currentSource: ProposalLinkSourceValue | null;
  currentStatus: ProposalLinkStatusValue | null;
  candidateProposalId: string | null;
  candidateProposalCode: string | null;
  decidedStatus: ProposalLinkStatusValue;
  reason: string;
  action: ReconcileAction;
  matchedLines: number;
  unmatchedLines: number;
  candidateProposalCount: number;
  /** Para MANUAL. */
  reviewer?: string | null;
  replaceExisting?: boolean;
};

export type ManualReviewEntry = {
  salesOrderId: string;
  proposalId: string;
  reviewer: string;
  note?: string | null;
  replaceExisting?: boolean;
};

export type ReconcilePlan = {
  generatedAt: string;
  totals: {
    orders: number;
    linked: number;
    unlinked: number;
    byAction: Record<string, number>;
    byReason: Record<string, number>;
    byDecidedStatus: Record<string, number>;
    newLinksApplicable: number;
    preservedLinks: number;
    conflicts: number;
    inconclusive: number;
  };
  /** Somente nomes de chaves (nunca valores) com cara de referência à proposta nos payloads de pedido. */
  candidateReferenceKeys: Record<string, number>;
  confirmedReferenceFields: string[];
  rows: ReconcilePlanRow[];
  applicable: Array<{ salesOrderId: string; proposalId: string; action: "APPLY_EXPLICIT" | "MANUAL" }>;
  planHash: string;
};

type Db = PrismaClient;

const ORDER_BATCH = 500;

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function hashReconcileApplicable(applicable: ReconcilePlan["applicable"]): string {
  const canonical = [...applicable]
    .map((a) => `${a.action}|${a.salesOrderId}|${a.proposalId}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

export async function buildProposalLinkReconcilePlan(
  db: Db,
  options: {
    manual?: ManualReviewEntry[];
    referenceFields?: readonly NomusProposalReferenceField[];
    salesOrderIds?: string[];
  } = {}
): Promise<ReconcilePlan> {
  const referenceFields = options.referenceFields ?? NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS;
  const manualByOrder = new Map((options.manual ?? []).map((m) => [m.salesOrderId, m]));
  const rows: ReconcilePlanRow[] = [];
  const candidateReferenceKeys: Record<string, number> = {};
  const totals: ReconcilePlan["totals"] = {
    orders: 0,
    linked: 0,
    unlinked: 0,
    byAction: {},
    byReason: {},
    byDecidedStatus: {},
    newLinksApplicable: 0,
    preservedLinks: 0,
    conflicts: 0,
    inconclusive: 0,
  };

  const proposalCodes = new Map<string, string | null>();
  const codeOf = async (ids: Array<string | null>) => {
    const missing = [...new Set(ids.filter((id): id is string => !!id && !proposalCodes.has(id)))];
    if (missing.length === 0) return;
    const found = await db.proposal.findMany({
      where: { id: { in: missing } },
      select: { id: true, externalProposalCode: true, number: true },
    });
    for (const p of found) proposalCodes.set(p.id, p.externalProposalCode ?? `#${p.number}`);
  };

  let cursor: string | undefined;
  for (;;) {
    const orders = await db.salesOrder.findMany({
      where: options.salesOrderIds ? { id: { in: options.salesOrderIds } } : undefined,
      orderBy: { id: "asc" },
      take: ORDER_BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: {
        id: true,
        orderCode: true,
        sourceSystem: true,
        customerId: true,
        issueDate: true,
        proposalId: true,
        proposalLinkSource: true,
        proposalLinkStatus: true,
        nomusRawResponse: true,
        items: { select: { id: true, productId: true, nomusItemExternalId: true, nomusItemSequence: true } },
      },
    });
    if (orders.length === 0) break;
    cursor = orders[orders.length - 1]!.id;

    const index = await loadProposalLinkCandidateIndex(db, orders.map((o) => o.customerId));
    const slotIds = new Set<string>();
    for (const o of orders) for (const it of o.items) {
      for (const p of index.byCustomerProduct.get(`${o.customerId}|${it.productId}`) ?? []) slotIds.add(p);
    }
    for (const m of manualByOrder.values()) slotIds.add(m.proposalId);
    const owners = slotIds.size
      ? await db.salesOrder.findMany({ where: { proposalId: { in: [...slotIds] } }, select: { id: true, proposalId: true } })
      : [];
    const slotOwnerByProposalId = new Map(owners.map((o) => [o.proposalId as string, o.id] as const));

    for (const order of orders) {
      totals.orders += 1;
      if (order.proposalId) totals.linked += 1;
      else totals.unlinked += 1;
      for (const key of listCandidateProposalReferenceKeys(order.nomusRawResponse)) bump(candidateReferenceKeys, key);

      const explicit = await resolveExplicitProposalReference(
        db,
        extractNomusProposalReferences(order.nomusRawResponse, referenceFields)
      );
      const proposals = new Map(index.proposals);
      const extraIds = [order.proposalId, explicit.kind === "RESOLVED" ? explicit.proposalId : null].filter(
        (id): id is string => !!id && !proposals.has(id)
      );
      if (extraIds.length) {
        for (const p of await db.proposal.findMany({
          where: { id: { in: extraIds } },
          select: { id: true, customerId: true, commercialDate: true },
        })) {
          proposals.set(p.id, { proposalId: p.id, customerId: p.customerId, commercialDate: p.commercialDate ?? null });
        }
      }
      const lines = buildProposalLinkLineEvidence(
        index,
        order.customerId,
        order.items.map((it, i) => ({
          lineKey:
            it.nomusItemExternalId != null && it.nomusItemExternalId > 0
              ? `line:${it.nomusItemExternalId}`
              : `seq:${it.nomusItemSequence ?? i + 1}`,
          productId: it.productId,
        }))
      );
      const current = {
        proposalId: order.proposalId,
        source: (order.proposalLinkSource as ProposalLinkSourceValue | null) ?? null,
        status: (order.proposalLinkStatus as ProposalLinkStatusValue | null) ?? null,
      };
      const decision = decideProposalSalesOrderLink({
        salesOrderId: order.id,
        orderCustomerId: order.customerId,
        orderIssueDate: order.issueDate,
        current,
        explicit,
        lines,
        proposals,
        slotOwnerByProposalId,
      });

      let action: ReconcileAction;
      let candidateProposalId = decision.candidateProposalId ?? (decision.proposalId !== current.proposalId ? decision.proposalId : null);
      const manual = manualByOrder.get(order.id);
      let reviewer: string | null = null;
      let replaceExisting = false;
      if (manual) {
        const target = proposals.get(manual.proposalId) ??
          (await db.proposal.findUnique({ where: { id: manual.proposalId }, select: { id: true, customerId: true, commercialDate: true } })
            .then((p) => (p ? { proposalId: p.id, customerId: p.customerId, commercialDate: p.commercialDate ?? null } : undefined)));
        const owner = slotOwnerByProposalId.get(manual.proposalId);
        const sameCustomer = target?.customerId === order.customerId;
        const slotFree = !owner || owner === order.id;
        const canReplace = !current.proposalId || current.proposalId === manual.proposalId || manual.replaceExisting === true;
        candidateProposalId = manual.proposalId;
        reviewer = manual.reviewer;
        replaceExisting = manual.replaceExisting === true;
        action = sameCustomer && slotFree && canReplace ? "MANUAL" : "REVIEW_CONFLICT";
      } else if (decision.eventKind === "LINKED" && decision.source === "NOMUS_REFERENCE") {
        action = "APPLY_EXPLICIT";
      } else if (decision.eventKind === "LINKED" && decision.source === "INFERRED_ITEMS") {
        action = "SYNC_WILL_INFER";
      } else if (decision.status === "CONFLICT") {
        action = "REVIEW_CONFLICT";
      } else if (decision.status === "AMBIGUOUS") {
        action = "REVIEW_AMBIGUOUS";
      } else if (decision.status === "NO_EVIDENCE") {
        action = "NO_EVIDENCE";
      } else if (current.proposalId) {
        action = decision.eventKind ? "STATUS_ONLY" : "KEEP";
      } else {
        action = "NO_EVIDENCE";
      }

      if (current.proposalId) totals.preservedLinks += 1;
      if (action === "REVIEW_CONFLICT") totals.conflicts += 1;
      if (action === "REVIEW_AMBIGUOUS" || action === "NO_EVIDENCE") totals.inconclusive += 1;
      if (action === "APPLY_EXPLICIT" || action === "MANUAL") totals.newLinksApplicable += 1;
      bump(totals.byAction, action);
      bump(totals.byReason, decision.reason);
      bump(totals.byDecidedStatus, decision.status);

      rows.push({
        salesOrderId: order.id,
        orderCode: order.orderCode,
        sourceSystem: order.sourceSystem,
        currentProposalId: current.proposalId,
        currentProposalCode: null,
        currentSource: current.source,
        currentStatus: current.status,
        candidateProposalId,
        candidateProposalCode: null,
        decidedStatus: decision.status,
        reason: decision.reason,
        action,
        matchedLines: decision.evidence.matchedLines,
        unmatchedLines: decision.evidence.unmatchedLines,
        candidateProposalCount: new Set(decision.evidence.lines.flatMap((l) => l.candidateProposalIds)).size,
        ...(manual ? { reviewer, replaceExisting } : {}),
      });
    }
  }

  await codeOf(rows.flatMap((r) => [r.currentProposalId, r.candidateProposalId]));
  for (const row of rows) {
    row.currentProposalCode = row.currentProposalId ? (proposalCodes.get(row.currentProposalId) ?? null) : null;
    row.candidateProposalCode = row.candidateProposalId ? (proposalCodes.get(row.candidateProposalId) ?? null) : null;
  }

  const applicable = rows
    .filter((r) => (r.action === "APPLY_EXPLICIT" || r.action === "MANUAL") && r.candidateProposalId)
    .map((r) => ({ salesOrderId: r.salesOrderId, proposalId: r.candidateProposalId!, action: r.action as "APPLY_EXPLICIT" | "MANUAL" }));

  return {
    generatedAt: new Date().toISOString(),
    totals,
    candidateReferenceKeys,
    confirmedReferenceFields: referenceFields.map((f) => f.path),
    rows,
    applicable,
    planHash: hashReconcileApplicable(applicable),
  };
}

async function lock(tx: Prisma.TransactionClient, namespace: number, key: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))::text AS locked`;
}

export type ReconcileApplyResult = {
  runId: string;
  applied: number;
  skipped: Array<{ salesOrderId: string; reason: string }>;
};

/**
 * APPLY protegido. Recalcula o plano e só prossegue se o hash for o mesmo revisado no dry-run.
 */
export async function applyProposalLinkReconcilePlan(
  db: Db,
  input: {
    confirmPlanHash: string;
    authorizedBy: string;
    manual?: ManualReviewEntry[];
    referenceFields?: readonly NomusProposalReferenceField[];
    runId?: string;
  }
): Promise<ReconcileApplyResult> {
  if (!input.authorizedBy.trim()) throw new Error("APPLY exige --authorized-by=<responsável>.");
  const plan = await buildProposalLinkReconcilePlan(db, { manual: input.manual, referenceFields: input.referenceFields });
  if (plan.planHash !== input.confirmPlanHash) {
    throw new Error(
      `Plano mudou desde o dry-run (hash atual ${plan.planHash}, confirmado ${input.confirmPlanHash}). Gere e revise um novo dry-run.`
    );
  }
  const runId = input.runId ?? `reconcile-${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
  const actor = `reconcile:${runId}:${input.authorizedBy.trim()}`;
  const manualByOrder = new Map((input.manual ?? []).map((m) => [m.salesOrderId, m]));
  const skipped: ReconcileApplyResult["skipped"] = [];
  let applied = 0;

  for (const item of plan.applicable) {
    const outcome = await db.$transaction(async (tx) => {
      if (item.action === "APPLY_EXPLICIT") {
        const order = await tx.salesOrder.findUnique({
          where: { id: item.salesOrderId },
          select: {
            id: true,
            customerId: true,
            issueDate: true,
            nomusRawResponse: true,
            items: { select: { productId: true, nomusItemExternalId: true, nomusItemSequence: true } },
          },
        });
        if (!order) return "pedido não encontrado";
        const explicit = await resolveExplicitProposalReference(
          tx,
          extractNomusProposalReferences(order.nomusRawResponse, input.referenceFields ?? NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS)
        );
        const index = await loadProposalLinkCandidateIndex(tx, [order.customerId]);
        const result = await applyProposalSalesOrderLinkInTx(tx, {
          salesOrderId: order.id,
          orderCustomerId: order.customerId,
          orderIssueDate: order.issueDate,
          explicit,
          lines: buildProposalLinkLineEvidence(
            index,
            order.customerId,
            order.items.map((it, i) => ({
              lineKey: it.nomusItemExternalId ? `line:${it.nomusItemExternalId}` : `seq:${it.nomusItemSequence ?? i + 1}`,
              productId: it.productId,
            }))
          ),
          proposals: index.proposals,
          actor,
          runId,
        });
        return result.decision.proposalId === item.proposalId && result.previous.proposalId !== item.proposalId
          ? null
          : `decisão sob lock: ${result.decision.reason}`;
      }

      const manual = manualByOrder.get(item.salesOrderId)!;
      await lock(tx, PROPOSAL_LINK_ORDER_LOCK_NAMESPACE, item.salesOrderId);
      await lock(tx, PROPOSAL_LINK_PROPOSAL_LOCK_NAMESPACE, item.proposalId);
      const order = await tx.salesOrder.findUnique({
        where: { id: item.salesOrderId },
        select: { id: true, customerId: true, proposalId: true, proposalLinkSource: true, proposalLinkStatus: true },
      });
      const proposal = await tx.proposal.findUnique({ where: { id: item.proposalId }, select: { customerId: true } });
      const owner = await tx.salesOrder.findUnique({ where: { proposalId: item.proposalId }, select: { id: true } });
      if (!order || !proposal) return "pedido ou proposta não encontrado";
      if (proposal.customerId !== order.customerId) return "proposta de outro cliente";
      if (owner && owner.id !== order.id) return "proposta já vinculada a outro pedido";
      if (order.proposalId && order.proposalId !== item.proposalId && manual.replaceExisting !== true) {
        return "pedido já tem outra proposta (replaceExisting não autorizado)";
      }
      if (order.proposalId === item.proposalId && order.proposalLinkSource === "MANUAL") return "já aplicado";
      const now = new Date();
      const evidence = {
        policyVersion: 1,
        reason: "MANUAL_REVIEW",
        reviewer: manual.reviewer,
        note: manual.note ?? null,
        replaceExisting: manual.replaceExisting === true,
      };
      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          proposalId: item.proposalId,
          proposalLinkSource: "MANUAL",
          proposalLinkStatus: "CONFIRMED",
          proposalLinkEvidence: evidence,
          proposalLinkUpdatedAt: now,
        },
      });
      await tx.salesOrderProposalLinkEvent.create({
        data: {
          salesOrderId: order.id,
          kind: order.proposalId && order.proposalId !== item.proposalId ? "RELINKED" : "CONFIRMED",
          previousProposalId: order.proposalId,
          newProposalId: item.proposalId,
          previousSource: order.proposalLinkSource,
          newSource: "MANUAL",
          previousStatus: order.proposalLinkStatus,
          newStatus: "CONFIRMED",
          reason: "MANUAL_REVIEW",
          evidence,
          actor,
          runId,
          createdAt: now,
        },
      });
      return null;
    });
    if (outcome) skipped.push({ salesOrderId: item.salesOrderId, reason: outcome });
    else applied += 1;
  }
  return { runId, applied, skipped };
}

/**
 * Reverte um APPLY: para cada evento do runId (mais recente primeiro), restaura o estado anterior se o pedido ainda
 * estiver exatamente como o APPLY deixou. Grava evento REVERTED.
 */
export async function revertProposalLinkReconcileRun(
  db: Db,
  input: { runId: string; authorizedBy: string }
): Promise<{ reverted: number; skipped: Array<{ salesOrderId: string; reason: string }> }> {
  if (!input.authorizedBy.trim()) throw new Error("Reversão exige --authorized-by=<responsável>.");
  const events = await db.salesOrderProposalLinkEvent.findMany({
    where: { runId: input.runId, actor: { startsWith: `reconcile:${input.runId}:` }, kind: { not: "REVERTED" } },
    orderBy: { createdAt: "desc" },
  });
  const skipped: Array<{ salesOrderId: string; reason: string }> = [];
  let reverted = 0;
  for (const event of events) {
    const outcome = await db.$transaction(async (tx) => {
      await lock(tx, PROPOSAL_LINK_ORDER_LOCK_NAMESPACE, event.salesOrderId);
      if (event.previousProposalId) await lock(tx, PROPOSAL_LINK_PROPOSAL_LOCK_NAMESPACE, event.previousProposalId);
      const order = await tx.salesOrder.findUnique({
        where: { id: event.salesOrderId },
        select: { proposalId: true, proposalLinkSource: true, proposalLinkStatus: true },
      });
      if (!order) return "pedido não encontrado";
      if (
        order.proposalId !== event.newProposalId ||
        order.proposalLinkSource !== event.newSource ||
        order.proposalLinkStatus !== event.newStatus
      ) {
        return "vínculo mudou depois do APPLY";
      }
      if (event.previousProposalId) {
        const owner = await tx.salesOrder.findUnique({ where: { proposalId: event.previousProposalId }, select: { id: true } });
        if (owner && owner.id !== event.salesOrderId) return "proposta anterior ocupada por outro pedido";
      }
      const now = new Date();
      await tx.salesOrder.update({
        where: { id: event.salesOrderId },
        data: {
          proposalId: event.previousProposalId,
          proposalLinkSource: event.previousSource,
          proposalLinkStatus: event.previousStatus,
          proposalLinkUpdatedAt: now,
        },
      });
      await tx.salesOrderProposalLinkEvent.create({
        data: {
          salesOrderId: event.salesOrderId,
          kind: "REVERTED",
          previousProposalId: event.newProposalId,
          newProposalId: event.previousProposalId,
          previousSource: event.newSource,
          newSource: event.previousSource,
          previousStatus: event.newStatus,
          newStatus: event.previousStatus,
          reason: `REVERT_OF:${event.id}`,
          actor: `revert:${input.runId}:${input.authorizedBy.trim()}`,
          runId: `revert-${input.runId}`,
          createdAt: now,
        },
      });
      return null;
    });
    if (outcome) skipped.push({ salesOrderId: event.salesOrderId, reason: outcome });
    else reverted += 1;
  }
  return { reverted, skipped };
}
