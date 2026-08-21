/**
 * Resolução server-only de preço oficial publicado (PriceTableItem) por pedido/data.
 */
import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "./financeCivilDate.js";
import type {
  SalesOrderMarginOfficialPriceMeta,
} from "./salesOrderMarginTypes.js";
import type { OfficialPriceTableItemSnapshot } from "./salesOrderMarginOfficialPrice.js";

export type OfficialPriceLookupKey = string;

export function officialPriceLookupKey(
  priceTableId: string,
  productId: string,
  referenceDate: Date
): OfficialPriceLookupKey {
  return `${priceTableId}:${productId}:${toCivilDateKey(referenceDate) ?? referenceDate.toISOString().slice(0, 10)}`;
}

export type ResolvedOfficialPriceRow = {
  meta: SalesOrderMarginOfficialPriceMeta;
  item: OfficialPriceTableItemSnapshot;
};

export async function loadOfficialPriceTableItemsForPairs(
  db: PrismaClient,
  pairs: Array<{ priceTableId: string; productId: string; referenceDate: Date }>
): Promise<Map<OfficialPriceLookupKey, ResolvedOfficialPriceRow>> {
  const result = new Map<OfficialPriceLookupKey, ResolvedOfficialPriceRow>();
  if (pairs.length === 0) return result;

  const groups = new Map<
    string,
    { priceTableId: string; referenceDate: Date; productIds: Set<string> }
  >();

  for (const pair of pairs) {
    const dateKey = toCivilDateKey(pair.referenceDate) ?? pair.referenceDate.toISOString().slice(0, 10);
    const groupKey = `${pair.priceTableId}:${dateKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.productIds.add(pair.productId);
    } else {
      groups.set(groupKey, {
        priceTableId: pair.priceTableId,
        referenceDate: pair.referenceDate,
        productIds: new Set([pair.productId]),
      });
    }
  }

  // Tabelas + versões em lote (antes: 2 consultas sequenciais por tabela×data).
  const tableIds = [...new Set([...groups.values()].map((g) => g.priceTableId))];
  const [priceTables, versionRows] = await Promise.all([
    db.priceTable.findMany({
      where: { id: { in: tableIds } },
      select: { id: true, code: true, name: true, status: true },
    }),
    db.priceTableVersion.findMany({
      where: {
        priceTableId: { in: tableIds },
        status: { in: ["PUBLISHED", "ARCHIVED"] },
      },
      select: {
        id: true,
        priceTableId: true,
        versionNumber: true,
        effectiveFrom: true,
        effectiveTo: true,
        publishedAt: true,
      },
    }),
  ]);

  const priceTableById = new Map(priceTables.map((table) => [table.id, table]));
  type VersionRow = (typeof versionRows)[number];
  const versionsByTableId = new Map<string, VersionRow[]>();
  for (const row of versionRows) {
    const list = versionsByTableId.get(row.priceTableId) ?? [];
    list.push(row);
    versionsByTableId.set(row.priceTableId, list);
  }
  // Mesmo orderBy de resolvePublishedPriceTableVersionForDate:
  // [{ effectiveFrom: desc }, { publishedAt: desc }, { versionNumber: desc }]
  // — DESC no Postgres ordena NULL primeiro (NULL conta como "maior").
  const nullableDesc = (a: Date | null, b: Date | null): number => {
    if (a == null && b == null) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    return b.getTime() - a.getTime();
  };
  for (const list of versionsByTableId.values()) {
    list.sort(
      (a, b) =>
        nullableDesc(a.effectiveFrom, b.effectiveFrom) ||
        nullableDesc(a.publishedAt, b.publishedAt) ||
        b.versionNumber - a.versionNumber
    );
  }
  const pickVersionForDate = (tableId: string, referenceDate: Date): VersionRow | null => {
    const ref = referenceDate.getTime();
    for (const version of versionsByTableId.get(tableId) ?? []) {
      if (version.effectiveFrom != null && version.effectiveFrom.getTime() > ref) continue;
      if (version.effectiveTo != null && version.effectiveTo.getTime() <= ref) continue;
      return version;
    }
    return null;
  };

  // Grupos que resolvem para a MESMA versão compartilham uma única consulta de itens.
  type ResolvedGroup = {
    priceTableId: string;
    referenceDate: Date;
    productIds: Set<string>;
    version: VersionRow;
  };
  const groupsByVersionId = new Map<string, ResolvedGroup[]>();
  for (const group of groups.values()) {
    const priceTable = priceTableById.get(group.priceTableId);
    if (!priceTable || String(priceTable.status).toUpperCase() !== "ACTIVE") continue;
    const version = pickVersionForDate(group.priceTableId, group.referenceDate);
    if (!version) continue;
    const list = groupsByVersionId.get(version.id) ?? [];
    list.push({ ...group, version });
    groupsByVersionId.set(version.id, list);
  }

  for (const [versionId, resolvedGroups] of groupsByVersionId) {
    const unionProductIds = [
      ...new Set(resolvedGroups.flatMap((group) => [...group.productIds])),
    ];
    const items = await db.priceTableItem.findMany({
      where: {
        priceTableVersionId: versionId,
        productId: { in: unionProductIds },
      },
      select: {
        id: true,
        productId: true,
        salePrice: true,
        frozenTotalCost: true,
      },
    });
    const itemsByProductId = new Map(items.map((row) => [row.productId, row]));

    for (const group of resolvedGroups) {
      const priceTable = priceTableById.get(group.priceTableId)!;
      const version = group.version;
      const metaBase: Omit<SalesOrderMarginOfficialPriceMeta, "orderIssueDate"> = {
        priceTableId: priceTable.id,
        priceTableCode: priceTable.code,
        priceTableName: priceTable.name,
        priceTableVersionId: version.id,
        versionNumber: version.versionNumber,
        effectiveFrom: version.effectiveFrom ? toCivilDateKey(version.effectiveFrom) : null,
        effectiveTo: version.effectiveTo ? toCivilDateKey(version.effectiveTo) : null,
        priceTableItemId: "",
      };

      for (const productId of group.productIds) {
        const row = itemsByProductId.get(productId);
        if (!row) continue;
        const salePrice = Number(row.salePrice);
        if (!Number.isFinite(salePrice) || salePrice <= 0) continue;
        const key = officialPriceLookupKey(group.priceTableId, row.productId, group.referenceDate);
        result.set(key, {
          meta: {
            ...metaBase,
            priceTableItemId: row.id,
            orderIssueDate: toCivilDateKey(group.referenceDate),
          },
          item: {
            priceTableItemId: row.id,
            salePrice,
            frozenTotalCost: Number.isFinite(Number(row.frozenTotalCost))
              ? Number(row.frozenTotalCost)
              : null,
          },
        });
      }
    }
  }

  return result;
}

export async function loadSalesOrderMarginPriceTableContext(
  db: PrismaClient,
  orders: Array<{
    id: string;
    proposalId?: string | null;
    items?: Array<{ id: string; proposalItemId?: string | null }>;
  }>
): Promise<{
  priceTableByOrderId: Map<string, { priceTableId: string | null; priceTableCode: string | null }>;
  priceTableByItemId: Map<string, { priceTableId: string | null; priceTableCode: string | null }>;
}> {
  const priceTableByOrderId = new Map<
    string,
    { priceTableId: string | null; priceTableCode: string | null }
  >();
  const priceTableByItemId = new Map<
    string,
    { priceTableId: string | null; priceTableCode: string | null }
  >();

  const proposalIds = [...new Set(orders.map((o) => o.proposalId).filter(Boolean))] as string[];
  const proposalItemIds = [
    ...new Set(
      orders.flatMap((o) => (o.items ?? []).map((i) => i.proposalItemId).filter(Boolean))
    ),
  ] as string[];

  const [proposals, proposalItems] = await Promise.all([
    proposalIds.length > 0
      ? db.proposal.findMany({
          where: { id: { in: proposalIds } },
          select: { id: true, priceTableId: true, priceTableCode: true },
        })
      : Promise.resolve([]),
    proposalItemIds.length > 0
      ? db.proposalItem.findMany({
          where: { id: { in: proposalItemIds } },
          select: { id: true, priceTableId: true, priceTableCode: true },
        })
      : Promise.resolve([]),
  ]);

  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const proposalItemById = new Map(proposalItems.map((p) => [p.id, p]));

  for (const order of orders) {
    const proposal = order.proposalId ? proposalById.get(order.proposalId) : undefined;
    priceTableByOrderId.set(order.id, {
      priceTableId: proposal?.priceTableId ?? null,
      priceTableCode: proposal?.priceTableCode ?? null,
    });

    for (const item of order.items ?? []) {
      const pi = item.proposalItemId ? proposalItemById.get(item.proposalItemId) : undefined;
      priceTableByItemId.set(item.id, {
        priceTableId: pi?.priceTableId ?? proposal?.priceTableId ?? null,
        priceTableCode: pi?.priceTableCode ?? proposal?.priceTableCode ?? null,
      });
    }
  }

  return { priceTableByOrderId, priceTableByItemId };
}
