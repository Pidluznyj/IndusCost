/**
 * Adapter server — recálculo em lote da margem comercial de Propostas.
 * Não importa server.ts. Não consulta Pedido. Não chama Nomus.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "./financeCivilDate.js";
import {
  loadProposalCommercialFormationsBatch,
  type ProposalCommercialFormation,
} from "./proposalCommercialMargin.server.js";
import type { ProposalCommercialMarginReasonCode } from "./proposalCommercialMargin.js";
import { serializeProposalCommercialPricingSnapshot } from "./proposalCommercialMarginSnapshot.js";
import {
  aggregateProposalCommercialRecalcPreview,
  assertProposalCommercialRecalcApplyConfirmation,
  classifyProposalCommercialMarginSource,
  isProposalImported,
  itemNeedsRecalc,
  resolveProposalCommercialRecalcItem,
  toNum,
  type ProposalCommercialFormationInput,
  type ProposalCommercialRecalcCliArgs,
  type ProposalCommercialRecalcItemInput,
  type ProposalCommercialRecalcItemResult,
  type ProposalCommercialRecalcPreview,
} from "./proposalCommercialMarginRecalc.js";

const AUDIT_ACTION = "PROPOSAL_ITEM_COMMERCIAL_MARGIN_RECALC";
const AUDIT_FIELD = "commercialPricingSnapshotJson";

function parseCivilDate(value: string | null): Date | null {
  if (!value) return null;
  const key = toCivilDateKey(value);
  if (!key) return null;
  const d = new Date(`${key}T12:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function proposalReferenceDate(row: {
  externalOpenedAt: Date | null;
  createdAt: Date;
}): string {
  const raw = row.externalOpenedAt ?? row.createdAt;
  return toCivilDateKey(raw) ?? toCivilDateKey(new Date())!;
}

function formationToInput(
  formation: ProposalCommercialFormation
): ProposalCommercialFormationInput {
  return {
    formationContextId: formation.formationContextId,
    referenceDate: formation.referenceDate,
    frozenCostUnit: formation.frozenCostUnit,
    taxRate: formation.taxRate,
    freightRate: formation.freightRate,
    freightAbsoluteUnit: formation.freightAbsoluteUnit,
    otherVariablesRate: formation.otherVariablesRate,
    tiers: formation.tiers,
  };
}

function buildProposalWhere(
  args: ProposalCommercialRecalcCliArgs
): Prisma.ProposalWhereInput {
  const and: Prisma.ProposalWhereInput[] = [];
  if (args.proposalId) and.push({ id: args.proposalId });
  if (args.proposalCode) {
    const asNumber = Number(args.proposalCode);
    if (Number.isFinite(asNumber) && Number.isInteger(asNumber)) {
      and.push({
        OR: [{ number: asNumber }, { externalProposalCode: args.proposalCode }],
      });
    } else {
      and.push({ externalProposalCode: args.proposalCode });
    }
  }
  const from = parseCivilDate(args.dateFrom);
  const to = parseCivilDate(args.dateTo);
  if (from || to) {
    and.push({
      createdAt: {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1) } : {}),
      },
    });
  }
  if (args.source === "IMPORTED") {
    and.push({
      OR: [
        { externalProposalId: { not: null } },
        {
          AND: [{ sourceSystem: { not: null } }, { NOT: { sourceSystem: "" } }],
        },
      ],
    });
  } else if (args.source === "INTERNAL") {
    and.push({ externalProposalId: null });
    and.push({ OR: [{ sourceSystem: null }, { sourceSystem: "" }] });
  }
  return and.length > 0 ? { AND: and } : {};
}

function toItemInput(
  item: {
    id: string;
    proposalId: string;
    productId: string;
    quantity: unknown;
    suggestedPrice: unknown;
    negotiatedPrice: unknown;
    discountPerc: unknown;
    discountValue: unknown;
    priceTableId: string | null;
    priceTableVersionId: string | null;
    commercialPricingSnapshotJson: unknown;
  },
  proposal: {
    id: string;
    number: number;
    externalProposalCode: string | null;
    externalProposalId: number | null;
    sourceSystem: string | null;
    externalOpenedAt: Date | null;
    createdAt: Date;
  }
): ProposalCommercialRecalcItemInput {
  return {
    proposalItemId: item.id,
    proposalId: proposal.id,
    proposalNumber: proposal.number,
    externalProposalCode: proposal.externalProposalCode,
    productId: item.productId,
    quantity: toNum(item.quantity) ?? 0,
    suggestedPrice: toNum(item.suggestedPrice) ?? 0,
    negotiatedPrice: toNum(item.negotiatedPrice) ?? 0,
    discountPerc: toNum(item.discountPerc) ?? 0,
    discountValue: toNum(item.discountValue) ?? 0,
    priceTableId: item.priceTableId,
    priceTableVersionId: item.priceTableVersionId,
    commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
    proposalReferenceDate: proposalReferenceDate(proposal),
    isImported: isProposalImported(proposal),
  };
}

async function resolveVersionReferenceDates(
  db: PrismaClient,
  versionIds: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(versionIds.filter(Boolean))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const versions = await db.priceTableVersion.findMany({
    where: { id: { in: unique } },
    select: { id: true, effectiveFrom: true, publishedAt: true, createdAt: true },
  });
  for (const v of versions) {
    const key =
      toCivilDateKey(v.effectiveFrom) ??
      toCivilDateKey(v.publishedAt) ??
      toCivilDateKey(v.createdAt);
    if (key) map.set(v.id, key);
  }
  return map;
}

function resolveItemWithLookups(
  item: ProposalCommercialRecalcItemInput,
  versionDates: Map<string, string>,
  formationLookup: Map<
    string,
    Awaited<ReturnType<typeof loadProposalCommercialFormationsBatch>>
  >
): ProposalCommercialRecalcItemResult {
  const sourceClass = classifyProposalCommercialMarginSource({
    commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
    priceTableVersionId: item.priceTableVersionId,
  });

  if (sourceClass === "EXACT_PROPOSAL_FORMATION_SNAPSHOT") {
    return resolveProposalCommercialRecalcItem({ item });
  }

  let dateKey = item.proposalReferenceDate;
  let formationFailureReason: ProposalCommercialMarginReasonCode | null = null;

  if (sourceClass === "EXACT_PROPOSAL_PRICE_TABLE_VERSION") {
    if (!item.priceTableVersionId || !versionDates.has(item.priceTableVersionId)) {
      formationFailureReason = "PRICE_TABLE_VERSION_NOT_FOUND";
    } else {
      dateKey = versionDates.get(item.priceTableVersionId)!;
    }
  }

  let formation: ProposalCommercialFormationInput | null = null;
  if (!formationFailureReason) {
    const loaded = formationLookup.get(dateKey)?.get(item.productId);
    if (loaded?.ok) {
      formation = formationToInput(loaded);
    } else if (loaded && !loaded.ok) {
      formationFailureReason = loaded.reasonCode;
    } else {
      formationFailureReason = "HISTORICAL_FORMATION_NOT_FOUND";
    }
  }

  return resolveProposalCommercialRecalcItem({
    item,
    formation,
    formationFailureReason,
  });
}

/**
 * Analisa (e opcionalmente aplica) o recálculo de margem comercial em Propostas.
 * Atualiza somente `commercialPricingSnapshotJson` + auditoria.
 * Lotes pequenos por Proposta — falha não deixa snapshot parcial incoerente.
 */
export async function runProposalCommercialMarginRecalc(
  db: PrismaClient,
  args: ProposalCommercialRecalcCliArgs,
  options?: { performedBy?: string | null }
): Promise<ProposalCommercialRecalcPreview> {
  assertProposalCommercialRecalcApplyConfirmation(args);

  const proposals = await db.proposal.findMany({
    where: buildProposalWhere(args),
    orderBy: { createdAt: "desc" },
    take: args.limit,
    select: {
      id: true,
      number: true,
      externalProposalCode: true,
      externalProposalId: true,
      sourceSystem: true,
      externalOpenedAt: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          proposalId: true,
          productId: true,
          quantity: true,
          suggestedPrice: true,
          negotiatedPrice: true,
          discountPerc: true,
          discountValue: true,
          priceTableId: true,
          priceTableVersionId: true,
          commercialPricingSnapshotJson: true,
        },
      },
    },
  });

  const proposalIds = new Set(proposals.map((p) => p.id));
  const allResults: ProposalCommercialRecalcItemResult[] = [];
  const batchSize = args.batchSize;

  for (let offset = 0; offset < proposals.length; offset += batchSize) {
    const proposalBatch = proposals.slice(offset, offset + batchSize);
    const batchItems: ProposalCommercialRecalcItemInput[] = [];
    for (const p of proposalBatch) {
      for (const item of p.items) {
        const input = toItemInput(item, p);
        if (!itemNeedsRecalc(input, args.onlyMissing)) continue;
        batchItems.push(input);
      }
    }

    const versionIds = batchItems
      .map((i) => i.priceTableVersionId)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    const versionDates = await resolveVersionReferenceDates(db, versionIds);

    const productIdsByDate = new Map<string, Set<string>>();
    for (const item of batchItems) {
      const sourceClass = classifyProposalCommercialMarginSource({
        commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
        priceTableVersionId: item.priceTableVersionId,
      });
      if (sourceClass === "EXACT_PROPOSAL_FORMATION_SNAPSHOT") continue;
      let dateKey = item.proposalReferenceDate;
      if (
        sourceClass === "EXACT_PROPOSAL_PRICE_TABLE_VERSION" &&
        item.priceTableVersionId &&
        versionDates.has(item.priceTableVersionId)
      ) {
        dateKey = versionDates.get(item.priceTableVersionId)!;
      }
      let set = productIdsByDate.get(dateKey);
      if (!set) {
        set = new Set();
        productIdsByDate.set(dateKey, set);
      }
      set.add(item.productId);
    }

    const formationLookup = new Map<
      string,
      Awaited<ReturnType<typeof loadProposalCommercialFormationsBatch>>
    >();
    for (const [dateKey, productIds] of productIdsByDate) {
      const date = new Date(`${dateKey}T12:00:00.000Z`);
      formationLookup.set(
        dateKey,
        await loadProposalCommercialFormationsBatch(db, [...productIds], date)
      );
    }

    const batchResults = batchItems.map((item) =>
      resolveItemWithLookups(item, versionDates, formationLookup)
    );

    if (args.apply) {
      const changed = batchResults.filter((r) => r.changed && r.nextSnapshot);
      if (changed.length > 0) {
        const recalculatedAt = new Date().toISOString();
        await db.$transaction(async (tx) => {
          for (const row of changed) {
            const payload = serializeProposalCommercialPricingSnapshot(row.nextSnapshot!);
            await tx.proposalItem.update({
              where: { id: row.proposalItemId },
              data: {
                commercialPricingSnapshotJson: payload as Prisma.InputJsonValue,
              },
            });
            await tx.commercialAuditLog.create({
              data: {
                entityType: "ProposalItem",
                entityId: row.proposalItemId,
                action: AUDIT_ACTION,
                fieldName: AUDIT_FIELD,
                oldValue: row.currentSnapshot
                  ? JSON.stringify(
                      serializeProposalCommercialPricingSnapshot(row.currentSnapshot)
                    )
                  : null,
                newValue: JSON.stringify({
                  snapshot: payload,
                  sourceClass: row.sourceClass,
                  reasonCode: row.reasonCode,
                  recalculatedAt,
                }),
                performedBy:
                  options?.performedBy ?? "script:recalculateProposalCommercialMargins",
              },
            });
          }
        });
      }
    }

    allResults.push(...batchResults);
  }

  return aggregateProposalCommercialRecalcPreview(allResults, proposalIds);
}
