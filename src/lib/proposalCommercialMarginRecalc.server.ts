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
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import {
  aggregateProposalCommercialHeaderFromRecalcResults,
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
  >,
  forceFromFormation: boolean
): ProposalCommercialRecalcItemResult {
  const sourceClass = classifyProposalCommercialMarginSource({
    commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
    priceTableVersionId: item.priceTableVersionId,
    forceFromFormation,
  });

  if (sourceClass === "EXACT_PROPOSAL_FORMATION_SNAPSHOT") {
    return resolveProposalCommercialRecalcItem({ item, forceFromFormation });
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
    if (loaded && loaded.ok === true) {
      formation = formationToInput(loaded);
    } else if (loaded && loaded.ok === false) {
      formationFailureReason = loaded.reasonCode;
    } else {
      formationFailureReason = "HISTORICAL_FORMATION_NOT_FOUND";
    }
  }

  return resolveProposalCommercialRecalcItem({
    item,
    formation,
    formationFailureReason,
    forceFromFormation,
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
    skip: args.skip,
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
        forceFromFormation: args.forceFromFormation,
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
      resolveItemWithLookups(
        item,
        versionDates,
        formationLookup,
        args.forceFromFormation
      )
    );

    if (args.apply) {
      const changed = batchResults.filter((r) => r.changed && r.nextSnapshot);
      const headerByProposal =
        aggregateProposalCommercialHeaderFromRecalcResults(batchResults);
      if (changed.length > 0 || headerByProposal.size > 0) {
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
          // Cabeçalho da listagem = margem comercial consolidada (não a margem Nomus).
          for (const [proposalId, header] of headerByProposal) {
            if (header.totalMarginPerc == null && header.totalMarginValue == null) {
              continue;
            }
            await tx.proposal.update({
              where: { id: proposalId },
              data: {
                totalMarginPerc: header.totalMarginPerc ?? 0,
                totalMarginValue: header.totalMarginValue ?? 0,
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

const DEFAULT_ALL_PAGES_SIZE = 200;

/**
 * Percorre todas as páginas de propostas (skip/limit) até esgotar.
 * Usado pelo hook pós-sync Nomus e por recálculos completos.
 */
export async function runProposalCommercialMarginRecalcAllPages(
  db: PrismaClient,
  args: ProposalCommercialRecalcCliArgs,
  options?: { performedBy?: string | null; pageSize?: number }
): Promise<ProposalCommercialRecalcPreview & { pagesProcessed: number }> {
  const pageSize = Math.max(
    1,
    Math.min(5000, options?.pageSize ?? Math.min(args.limit, DEFAULT_ALL_PAGES_SIZE))
  );
  let skip = Math.max(0, args.skip);
  let pagesProcessed = 0;
  const allResults: ProposalCommercialRecalcItemResult[] = [];
  const allProposalIds = new Set<string>();

  while (true) {
    const page = await runProposalCommercialMarginRecalc(
      db,
      { ...args, skip, limit: pageSize },
      options
    );
    pagesProcessed += 1;
    for (const row of page.results) {
      allResults.push(row);
      allProposalIds.add(row.proposalId);
    }
    // Conta propostas da página via set do preview (mesmo sem itens elegíveis).
    const fetched = page.proposalsAnalyzed;
    if (fetched === 0) break;
    // Quando onlyMissing filtra todos os itens, proposalsAnalyzed ainda reflete o findMany.
    // Se a página veio “cheia” mas sem results, avançamos pelo tamanho da página.
    const advanceBy = fetched > 0 ? fetched : pageSize;
    // proposalsAnalyzed = size do set de propostas carregadas nesta página.
    skip += advanceBy;
    if (fetched < pageSize) break;
    // Proteção: se a página não avançar ids (anomalia), evita loop infinito.
    if (advanceBy <= 0) break;
  }

  return {
    ...aggregateProposalCommercialRecalcPreview(allResults, allProposalIds),
    pagesProcessed,
  };
}

/**
 * Margem comercial para a listagem (GET /api/proposals).
 * Usa snapshot + formação vigente na data — mesma lógica do formulário/save.
 * Não grava nada.
 */
export async function resolveProposalCommercialListMargins(
  db: PrismaClient,
  proposalIds: ReadonlyArray<string>
): Promise<
  Map<string, { totalMarginPerc: number | null; totalMarginValue: number | null }>
> {
  const resolved = await resolveProposalCommercialItemDetails(db, proposalIds);
  const results = [...resolved.values()];
  const header = aggregateProposalCommercialHeaderFromRecalcResults(
    results.map((row) => row.result)
  );
  // Garante chave para ids sem itens.
  for (const id of proposalIds) {
    const key = String(id).trim();
    if (key && !header.has(key)) {
      header.set(key, { totalMarginPerc: null, totalMarginValue: null });
    }
  }
  return header;
}

export type ProposalCommercialItemResolvedDetails = {
  result: ProposalCommercialRecalcItemResult;
  marginPerc: number | null;
  marginValue: number | null;
  commissionPerc: number | null;
  commissionValue: number | null;
  commercialPricingSnapshotJson: Record<string, unknown> | null;
};

/**
 * Detalhe comercial por item — mesma cadeia da listagem/formulário
 * (snapshot + formação vigente). Usado no relatório gerencial interno.
 * Não grava nada.
 */
export async function resolveProposalCommercialItemDetails(
  db: PrismaClient,
  proposalIds: ReadonlyArray<string>
): Promise<Map<string, ProposalCommercialItemResolvedDetails>> {
  const ids = [...new Set(proposalIds.map((id) => String(id).trim()).filter(Boolean))];
  const out = new Map<string, ProposalCommercialItemResolvedDetails>();
  if (ids.length === 0) return out;

  const proposals = await db.proposal.findMany({
    where: { id: { in: ids } },
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

  const batchItems: ProposalCommercialRecalcItemInput[] = [];
  for (const p of proposals) {
    for (const item of p.items) {
      batchItems.push(toItemInput(item, p));
    }
  }

  if (batchItems.length === 0) return out;

  const versionIds = batchItems
    .map((i) => i.priceTableVersionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const versionDates = await resolveVersionReferenceDates(db, versionIds);

  const productIdsByDate = new Map<string, Set<string>>();
  for (const item of batchItems) {
    const sourceClass = classifyProposalCommercialMarginSource({
      commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
      priceTableVersionId: item.priceTableVersionId,
      forceFromFormation: true,
    });
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

  for (const item of batchItems) {
    const result = resolveItemWithLookups(item, versionDates, formationLookup, true);
    const snap = result.nextSnapshot ?? result.currentSnapshot;
    const rateRaw = snap?.calculatedCommissionRate;
    const commissionRate =
      rateRaw != null && Number.isFinite(rateRaw)
        ? rateRaw > 1
          ? rateRaw / 100
          : rateRaw
        : null;
    const commissionPerc =
      commissionRate != null ? roundPricingPercent(commissionRate * 100) : null;
    const commissionValue =
      commissionRate != null && result.netLineValue > 0
        ? roundPricingMoney(result.netLineValue * commissionRate)
        : commissionRate === 0
          ? 0
          : null;

    out.set(item.proposalItemId, {
      result,
      marginPerc: result.commercialMarginPercent,
      marginValue: result.commercialMarginValue,
      commissionPerc,
      commissionValue,
      commercialPricingSnapshotJson: snap
        ? serializeProposalCommercialPricingSnapshot(snap)
        : null,
    });
  }

  return out;
}
