/**
 * Margem oficial de Proposta com custo de produção vigente na data
 * (paridade com Pedido de Venda / getEffectiveProductProductionCostsForPairs).
 */
import type { PrismaClient } from "@prisma/client";
import { getEffectiveProductProductionCostsForPairs } from "./productionCostTables.server.js";
import { effectiveProductionCostLookupKey } from "./productionCostVersioning.js";
import { calculateProposalLineMargin } from "./proposalLineMargin.js";
import {
  enrichProposalListRowMargin,
  resolveProposalOfficialMarginFromItems,
  type ProposalListMarginItemInput,
} from "./proposalListMargin.js";

export type ProposalMarginDateSource = {
  externalOpenedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

export type ProposalItemForMarginCost = {
  id?: string | null;
  productId?: string | null;
  quantity?: unknown;
  negotiatedPrice?: unknown;
  discountValue?: unknown;
  taxesPerc?: unknown;
  commissionPerc?: unknown;
  freightValue?: unknown;
  pricingSnapshotJson?: unknown;
  unitCost?: unknown;
};

function toValidDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Data de referência da proposta: abertura Nomus, senão createdAt. */
export function resolveProposalMarginReferenceDate(
  proposal: ProposalMarginDateSource
): Date | null {
  return (
    toValidDate(proposal.externalOpenedAt) ?? toValidDate(proposal.createdAt)
  );
}

/**
 * Anexa `unitCost` de produção vigente em cada item (somente em memória).
 * Itens sem custo vigente ficam com unitCost = null (margem indisponível).
 */
export async function attachProposalProductionCostsForMargin(
  prisma: PrismaClient,
  proposals: ReadonlyArray<{
    externalOpenedAt?: Date | string | null;
    createdAt?: Date | string | null;
    items?: ReadonlyArray<ProposalItemForMarginCost> | null;
  }>
): Promise<
  Array<{
    items: Array<ProposalListMarginItemInput & { unitCost: number | null }>;
  } & Record<string, unknown>>
> {
  const pairs: Array<{ productId: string; referenceDate: Date }> = [];

  for (const proposal of proposals) {
    const ref = resolveProposalMarginReferenceDate(proposal);
    if (!ref) continue;
    for (const item of proposal.items ?? []) {
      const productId = typeof item.productId === "string" ? item.productId.trim() : "";
      if (!productId) continue;
      pairs.push({ productId, referenceDate: ref });
    }
  }

  const costs =
    pairs.length > 0
      ? await getEffectiveProductProductionCostsForPairs(prisma, pairs)
      : new Map();

  return proposals.map((proposal) => {
    const ref = resolveProposalMarginReferenceDate(proposal);
    const items = (proposal.items ?? []).map((item) => {
      const productId = typeof item.productId === "string" ? item.productId.trim() : "";
      let unitCost: number | null = null;
      if (productId && ref) {
        const key = effectiveProductionCostLookupKey(productId, ref);
        const effective = costs.get(key);
        if (
          effective &&
          effective.status === "OK" &&
          Number.isFinite(effective.unitProductionCost)
        ) {
          unitCost = Math.max(0, Number(effective.unitProductionCost));
        }
      }
      return {
        ...item,
        unitCost,
      };
    });
    return {
      ...(proposal as Record<string, unknown>),
      items,
    };
  });
}

export async function enrichProposalsWithOfficialProductionMargins(
  prisma: PrismaClient,
  proposals: Array<Record<string, unknown>>
): Promise<
  Array<
    Record<string, unknown> & {
      totalMarginPerc: number | null;
      totalMarginValue: number | null;
      marginSource: "ITEMS" | "HEADER" | "NONE";
    }
  >
> {
  const withCosts = await attachProposalProductionCostsForMargin(
    prisma,
    proposals as Array<{
      externalOpenedAt?: Date | string | null;
      createdAt?: Date | string | null;
      items?: ProposalItemForMarginCost[] | null;
    }>
  );
  return withCosts.map((row) => enrichProposalListRowMargin(row));
}

/** Aplica custos de produção nos itens de uma proposta (GET detalhe / formulário). */
export async function applyProductionCostsToProposalDetail<
  T extends {
    externalOpenedAt?: Date | string | null;
    createdAt?: Date | string | null;
    items?: Array<Record<string, unknown> & { productId?: string | null }> | null;
  },
>(prisma: PrismaClient, proposal: T): Promise<T> {
  const [enriched] = await attachProposalProductionCostsForMargin(prisma, [
    {
      externalOpenedAt: proposal.externalOpenedAt,
      createdAt: proposal.createdAt,
      items: proposal.items ?? [],
    },
  ]);
  const costByIndex = enriched?.items ?? [];
  const items = (proposal.items ?? []).map((item, index) => ({
    ...item,
    unitCost: costByIndex[index]?.unitCost ?? null,
  }));
  const margin = resolveProposalOfficialMarginFromItems(items);
  return {
    ...proposal,
    items,
    totalMarginPerc: margin.totalMarginPerc,
    totalMarginValue: margin.totalMarginValue,
    totalCost: margin.totalCost,
  };
}

/**
 * No write (POST/PUT): grava unitCost de produção vigente na data da proposta
 * e recalcula margem da linha (não usa custo congelado da tabela comercial).
 * unitCost/margin ausentes → 0 no banco (Decimal obrigatório); listagem reenriquece.
 */
export async function stampProposalItemsWithProductionCostsForWrite(
  prisma: PrismaClient,
  items: ReadonlyArray<Record<string, unknown>>,
  dateSource: ProposalMarginDateSource & { createdAt?: Date | string | null }
): Promise<Array<Record<string, unknown>>> {
  const [enriched] = await attachProposalProductionCostsForMargin(prisma, [
    {
      externalOpenedAt: dateSource.externalOpenedAt,
      createdAt: dateSource.createdAt ?? new Date(),
      items: [...items],
    },
  ]);
  const costRows = enriched?.items ?? [];
  return items.map((item, index) => {
    const unitCost = costRows[index]?.unitCost ?? null;
    const margin = calculateProposalLineMargin({
      quantity: Number(item.quantity) || 0,
      negotiatedPrice: Number(item.negotiatedPrice) || 0,
      discountValue: Number(item.discountValue) || 0,
      taxesPerc: Number(item.taxesPerc) || 0,
      commissionPerc: Number(item.commissionPerc) || 0,
      freightValue: Number(item.freightValue) || 0,
      unitCost,
    });
    return {
      ...item,
      unitCost: unitCost ?? 0,
      marginValue: margin.marginValue ?? 0,
      marginPerc: margin.marginPerc ?? 0,
    };
  });
}
