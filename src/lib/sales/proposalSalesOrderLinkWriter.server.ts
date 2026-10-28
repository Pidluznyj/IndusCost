import { Prisma } from "@prisma/client";
import {
  decideProposalSalesOrderLink,
  type CurrentProposalLink,
  type ExplicitProposalReferenceResolution,
  type ProposalLinkCandidateInfo,
  type ProposalLinkDecision,
  type ProposalLinkLineEvidence,
  type ProposalLinkSourceValue,
  type ProposalLinkStatusValue,
} from "./proposalSalesOrderLinkPolicy.js";
import type { NomusProposalReferenceValue } from "../nomus/nomusProposalOrderReference.js";

/**
 * Leitura das evidências e gravação da decisão de vínculo Pedido → Proposta (política em
 * proposalSalesOrderLinkPolicy.ts). Toda gravação acontece dentro da transação do chamador com:
 *   - lock consultivo por pedido (duas execuções concorrentes do sync/reconciliação não decidem o mesmo pedido ao
 *     mesmo tempo; o estado atual é relido depois do lock);
 *   - lock consultivo por proposta candidata antes de conferir a vaga 1:1 (SalesOrder.proposalId é único), em
 *     ordem fixa (pedido → propostas ordenadas) para não haver deadlock;
 *   - evento em SalesOrderProposalLinkEvent somente quando vínculo, origem ou situação mudam.
 */

/** Namespaces dos locks consultivos (pg_advisory_xact_lock(int, int)). */
export const PROPOSAL_LINK_ORDER_LOCK_NAMESPACE = 0x534f4c4b; // "SOLK"
export const PROPOSAL_LINK_PROPOSAL_LOCK_NAMESPACE = 0x50524f50; // "PROP"

const CUSTOMER_CHUNK = 500;

export type ProposalLinkCandidateIndex = {
  /** `${customerId}|${productId}` → propostas do cliente que contêm o produto. */
  byCustomerProduct: Map<string, Set<string>>;
  proposals: Map<string, ProposalLinkCandidateInfo>;
};

/**
 * Propostas (Nomus e criadas no IndusCost) dos clientes informados, indexadas por produto LOCAL — cobre propostas
 * do IndusCost, cujos itens não têm externalProductId.
 */
export async function loadProposalLinkCandidateIndex(
  db: Pick<Prisma.TransactionClient, "proposalItem">,
  customerIds: Iterable<string>
): Promise<ProposalLinkCandidateIndex> {
  const ids = [...new Set(customerIds)].filter(Boolean).sort();
  const index: ProposalLinkCandidateIndex = { byCustomerProduct: new Map(), proposals: new Map() };
  for (let i = 0; i < ids.length; i += CUSTOMER_CHUNK) {
    const rows = await db.proposalItem.findMany({
      where: { Proposal: { customerId: { in: ids.slice(i, i + CUSTOMER_CHUNK) } } },
      select: {
        proposalId: true,
        productId: true,
        Proposal: { select: { customerId: true, commercialDate: true } },
      },
    });
    for (const row of rows) {
      const key = `${row.Proposal.customerId}|${row.productId}`;
      const set = index.byCustomerProduct.get(key) ?? new Set<string>();
      set.add(row.proposalId);
      index.byCustomerProduct.set(key, set);
      if (!index.proposals.has(row.proposalId)) {
        index.proposals.set(row.proposalId, {
          proposalId: row.proposalId,
          customerId: row.Proposal.customerId,
          commercialDate: row.Proposal.commercialDate ?? null,
        });
      }
    }
  }
  return index;
}

export function buildProposalLinkLineEvidence(
  index: ProposalLinkCandidateIndex,
  customerId: string,
  lines: Array<{ lineKey: string; productId: string }>
): ProposalLinkLineEvidence[] {
  return lines.map((line) => ({
    lineKey: line.lineKey,
    productId: line.productId,
    candidateProposalIds: [...(index.byCustomerProduct.get(`${customerId}|${line.productId}`) ?? [])].sort(),
  }));
}

/** Converte as referências explícitas lidas do payload em proposta local (mesma origem NOMUS). */
export async function resolveExplicitProposalReference(
  db: Pick<Prisma.TransactionClient, "proposal">,
  references: NomusProposalReferenceValue[]
): Promise<ExplicitProposalReferenceResolution> {
  if (references.length === 0) return { kind: "NONE" };
  const found = new Set<string>();
  for (const ref of references) {
    const rows = await db.proposal.findMany({
      where:
        ref.identifies === "EXTERNAL_ID"
          ? { sourceSystem: "NOMUS", externalProposalId: Number(ref.value) }
          : { sourceSystem: "NOMUS", externalProposalCode: ref.value },
      select: { id: true },
      take: 3,
    });
    for (const row of rows) found.add(row.id);
  }
  const label = { field: references.map((r) => r.field).join(","), value: references.map((r) => r.value).join(",") };
  if (found.size === 0) return { kind: "UNRESOLVED", ...label };
  if (found.size > 1) return { kind: "AMBIGUOUS", ...label, proposalIds: [...found].sort() };
  return { kind: "RESOLVED", ...label, proposalId: [...found][0]! };
}

export type ApplyProposalLinkInput = {
  salesOrderId: string;
  orderCustomerId: string;
  orderIssueDate: Date | null;
  explicit: ExplicitProposalReferenceResolution;
  lines: ProposalLinkLineEvidence[];
  proposals: ReadonlyMap<string, ProposalLinkCandidateInfo>;
  actor: string;
  runId: string | null;
  /** Só calcula e devolve a decisão (dry-run); nada é gravado. Os locks continuam sendo tomados. */
  dryRun?: boolean;
};

export type AppliedProposalLink = {
  decision: ProposalLinkDecision;
  previous: CurrentProposalLink;
  written: boolean;
};

async function advisoryXactLock(tx: Prisma.TransactionClient, namespace: number, key: string): Promise<void> {
  // pg_advisory_xact_lock retorna void; ::text evita coluna void no $queryRaw.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))::text AS locked`;
}

function candidateIdsFor(input: ApplyProposalLinkInput): string[] {
  const ids = new Set<string>();
  if (input.explicit.kind === "RESOLVED") ids.add(input.explicit.proposalId);
  for (const line of input.lines) for (const id of line.candidateProposalIds) ids.add(id);
  return [...ids].sort();
}

/**
 * Decide e grava o vínculo de UM pedido dentro da transação `tx`. O pedido precisa existir.
 * Nunca apaga nem troca proposalId existente (ver política).
 */
export async function applyProposalSalesOrderLinkInTx(
  tx: Prisma.TransactionClient,
  input: ApplyProposalLinkInput
): Promise<AppliedProposalLink> {
  await advisoryXactLock(tx, PROPOSAL_LINK_ORDER_LOCK_NAMESPACE, input.salesOrderId);

  const row = await tx.salesOrder.findUnique({
    where: { id: input.salesOrderId },
    select: { proposalId: true, proposalLinkSource: true, proposalLinkStatus: true },
  });
  if (!row) throw new Error(`[proposal-link] pedido ${input.salesOrderId} não encontrado`);
  const previous: CurrentProposalLink = {
    proposalId: row.proposalId,
    source: (row.proposalLinkSource as ProposalLinkSourceValue | null) ?? null,
    status: (row.proposalLinkStatus as ProposalLinkStatusValue | null) ?? null,
  };

  const proposals = new Map(input.proposals);
  const missingInfo = [previous.proposalId, input.explicit.kind === "RESOLVED" ? input.explicit.proposalId : null]
    .filter((id): id is string => !!id && !proposals.has(id));
  if (missingInfo.length > 0) {
    const rows = await tx.proposal.findMany({
      where: { id: { in: missingInfo } },
      select: { id: true, customerId: true, commercialDate: true },
    });
    for (const p of rows) {
      proposals.set(p.id, { proposalId: p.id, customerId: p.customerId, commercialDate: p.commercialDate ?? null });
    }
  }

  // A vaga 1:1 só importa quando o pedido ainda não tem proposta.
  const slotOwnerByProposalId = new Map<string, string>();
  if (!previous.proposalId) {
    const candidates = candidateIdsFor(input);
    for (const proposalId of candidates) await advisoryXactLock(tx, PROPOSAL_LINK_PROPOSAL_LOCK_NAMESPACE, proposalId);
    if (candidates.length > 0) {
      const owners = await tx.salesOrder.findMany({
        where: { proposalId: { in: candidates } },
        select: { id: true, proposalId: true },
      });
      for (const owner of owners) if (owner.proposalId) slotOwnerByProposalId.set(owner.proposalId, owner.id);
    }
  }

  const decision = decideProposalSalesOrderLink({
    salesOrderId: input.salesOrderId,
    orderCustomerId: input.orderCustomerId,
    orderIssueDate: input.orderIssueDate,
    current: previous,
    explicit: input.explicit,
    lines: input.lines,
    proposals,
    slotOwnerByProposalId,
  });

  if (input.dryRun) return { decision, previous, written: false };

  const now = new Date();
  await tx.salesOrder.update({
    where: { id: input.salesOrderId },
    data: {
      // A política só devolve proposalId diferente do atual quando o atual é vazio.
      ...(decision.proposalId !== previous.proposalId ? { proposalId: decision.proposalId } : {}),
      proposalLinkSource: decision.source,
      proposalLinkStatus: decision.status,
      proposalLinkEvidence: decision.evidence as unknown as Prisma.InputJsonValue,
      ...(decision.eventKind ? { proposalLinkUpdatedAt: now } : {}),
    },
  });

  if (decision.eventKind) {
    await tx.salesOrderProposalLinkEvent.create({
      data: {
        salesOrderId: input.salesOrderId,
        kind: decision.eventKind,
        previousProposalId: previous.proposalId,
        newProposalId: decision.proposalId,
        candidateProposalId: decision.candidateProposalId,
        previousSource: previous.source,
        newSource: decision.source,
        previousStatus: previous.status,
        newStatus: decision.status,
        reason: decision.reason,
        evidence: decision.evidence as unknown as Prisma.InputJsonValue,
        actor: input.actor,
        runId: input.runId,
        createdAt: now,
      },
    });
  }

  return { decision, previous, written: true };
}

/**
 * Pedido gerado a partir da proposta dentro do IndusCost: trava a vaga 1:1 da proposta na transação. Devolve o
 * pedido que já ocupa a vaga (gerado por outra requisição concorrente), ou null quando a vaga está livre.
 */
export async function lockProposalSlotForGeneratedOrderInTx(
  tx: Prisma.TransactionClient,
  proposalId: string
): Promise<{ id: string } | null> {
  await advisoryXactLock(tx, PROPOSAL_LINK_PROPOSAL_LOCK_NAMESPACE, proposalId);
  return tx.salesOrder.findUnique({ where: { proposalId }, select: { id: true } });
}

/** Dados de rastreabilidade do pedido gerado pela proposta (vínculo confirmado na origem). */
export function generatedSalesOrderLinkData(proposalId: string, now: Date) {
  return {
    proposalId,
    proposalLinkSource: "INDUSCOST_GENERATED" as const,
    proposalLinkStatus: "CONFIRMED" as const,
    proposalLinkEvidence: { policyVersion: 1, reason: "GENERATED_FROM_PROPOSAL", proposalId } as Prisma.InputJsonValue,
    proposalLinkUpdatedAt: now,
  };
}

export async function recordGeneratedSalesOrderLinkEventInTx(
  tx: Prisma.TransactionClient,
  input: { salesOrderId: string; proposalId: string; actor: string; now: Date }
): Promise<void> {
  await tx.salesOrderProposalLinkEvent.create({
    data: {
      salesOrderId: input.salesOrderId,
      kind: "LINKED",
      previousProposalId: null,
      newProposalId: input.proposalId,
      newSource: "INDUSCOST_GENERATED",
      newStatus: "CONFIRMED",
      reason: "GENERATED_FROM_PROPOSAL",
      evidence: { policyVersion: 1, reason: "GENERATED_FROM_PROPOSAL", proposalId: input.proposalId },
      actor: input.actor,
      createdAt: input.now,
    },
  });
}

/** P2002 na coluna única SalesOrder.proposalId (escritor concorrente que não usou o lock). */
export function isProposalSlotUniqueViolation(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return text.includes("proposalId");
}
