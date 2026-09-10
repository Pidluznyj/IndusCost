/**
 * Diagnóstico read-only: Material.quantity × saldo físico canônico do Inventory.
 * Não escreve. Não adivinha vínculo por descrição.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  classifyMaterialInventoryBalance,
  formatQuantityForReport,
  unitsCompatible,
  type MaterialInventoryBalanceStatus,
} from "./materialInventoryBalanceDiagnostic.js";
import { sumCanonicalPhysicalQuantity, toInventoryDecimal } from "./materialInventoryProjection.server.js";

export type MaterialInventoryBalanceRow = {
  status: MaterialInventoryBalanceStatus;
  materialId: string;
  materialCode: string;
  materialDescription: string;
  materialUnit: string;
  materialQuantity: string;
  inventoryItemId: string | null;
  inventoryItemCode: string | null;
  inventoryItemStatus: string | null;
  canonicalPhysical: string;
  absoluteDifference: string;
  percentDifference: string | null;
  warehouseOrLocationCount: number;
  lastMovementAt: string | null;
  lastCountSessionId: string | null;
  unitMismatch: boolean;
  linkIssue: string | null;
};

function decimalAbsDiff(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  const diff = a.sub(b);
  return diff.isNegative() ? diff.neg() : diff;
}

export async function diagnoseMaterialInventoryBalances(
  db: PrismaClient,
  options?: { materialCode?: string | null; materialId?: string | null }
): Promise<{
  rows: MaterialInventoryBalanceRow[];
  summary: Record<MaterialInventoryBalanceStatus, number> & { totalMaterials: number };
}> {
  const materialWhere: Prisma.MaterialWhereInput = {};
  if (options?.materialId?.trim()) materialWhere.id = options.materialId.trim();
  if (options?.materialCode?.trim()) materialWhere.code = options.materialCode.trim();

  const materials = await db.material.findMany({
    where: materialWhere,
    select: {
      id: true,
      code: true,
      description: true,
      unit: true,
      quantity: true,
    },
    orderBy: { code: "asc" },
  });

  const materialIds = materials.map((m) => m.id);
  const items = materialIds.length
    ? await db.inventoryItem.findMany({
        where: { materialId: { in: materialIds } },
        select: {
          id: true,
          code: true,
          status: true,
          unit: true,
          materialId: true,
          controlsLocation: true,
        },
      })
    : [];

  const itemsByMaterial = new Map<string, typeof items>();
  for (const item of items) {
    if (!item.materialId) continue;
    const list = itemsByMaterial.get(item.materialId) ?? [];
    list.push(item);
    itemsByMaterial.set(item.materialId, list);
  }

  const activeItems = items.filter((i) => i.status === "ACTIVE");
  const activeItemIds = activeItems.map((i) => i.id);
  const balances = activeItemIds.length
    ? await db.inventoryBalance.findMany({
        where: { itemId: { in: activeItemIds } },
        select: {
          itemId: true,
          locationId: true,
          physicalQuantity: true,
          lastMovementAt: true,
        },
      })
    : [];

  const balancesByItem = new Map<string, typeof balances>();
  for (const row of balances) {
    const list = balancesByItem.get(row.itemId) ?? [];
    list.push(row);
    balancesByItem.set(row.itemId, list);
  }

  const lastCountByItem = new Map<string, string>();
  if (activeItemIds.length) {
    const countLines = await db.inventoryCountLine.findMany({
      where: { itemId: { in: activeItemIds }, session: { status: { in: ["ADJUSTED", "APPROVED"] } } },
      select: { itemId: true, sessionId: true, session: { select: { finishedAt: true, updatedAt: true } } },
      orderBy: { updatedAt: "desc" },
    });
    for (const line of countLines) {
      if (!lastCountByItem.has(line.itemId)) lastCountByItem.set(line.itemId, line.sessionId);
    }
  }

  const summary = {
    MATCH: 0,
    QUANTITY_DIVERGENCE: 0,
    NO_INVENTORY_LINK: 0,
    NO_MATERIAL: 0,
    UNIT_MISMATCH: 0,
    MULTIPLE_ACTIVE_LINKS: 0,
    NO_BALANCE: 0,
    OTHER_INCONSISTENCY: 0,
    totalMaterials: materials.length,
  };

  const rows: MaterialInventoryBalanceRow[] = materials.map((material) => {
    const linked = itemsByMaterial.get(material.id) ?? [];
    const active = linked.filter((i) => i.status === "ACTIVE");
    const materialQty = toInventoryDecimal(material.quantity);
    let canonical = new Prisma.Decimal(0);
    let warehouseOrLocationCount = 0;
    let lastMovementAt: string | null = null;
    let lastCountSessionId: string | null = null;
    let unitMismatch = false;
    let linkIssue: string | null = null;
    const primary = active[0] ?? null;

    if (active.length === 1 && primary) {
      const itemBalances = balancesByItem.get(primary.id) ?? [];
      canonical = sumCanonicalPhysicalQuantity(itemBalances, primary.controlsLocation === true);
      warehouseOrLocationCount = itemBalances.length;
      for (const b of itemBalances) {
        if (b.lastMovementAt) {
          const iso = b.lastMovementAt.toISOString();
          if (!lastMovementAt || iso > lastMovementAt) lastMovementAt = iso;
        }
      }
      lastCountSessionId = lastCountByItem.get(primary.id) ?? null;
      unitMismatch = !unitsCompatible(material.unit, primary.unit);
    } else if (active.length > 1) {
      linkIssue = "Mais de um InventoryItem ACTIVE para o mesmo materialId";
    } else if (linked.length > 0) {
      linkIssue = "Somente vínculos inativos";
    }

    const status = classifyMaterialInventoryBalance({
      materialId: material.id,
      activeLinkCount: active.length,
      materialUnit: material.unit,
      itemUnit: primary?.unit ?? null,
      hasBalanceRow: warehouseOrLocationCount > 0,
      quantityEqualsCanonical: materialQty.eq(canonical),
    });
    summary[status] += 1;

    const abs = decimalAbsDiff(materialQty, canonical);
    let percent: string | null = null;
    if (!canonical.eq(0)) {
      percent = abs.div(canonical).mul(100).toFixed(4);
    }

    return {
      status,
      materialId: material.id,
      materialCode: material.code,
      materialDescription: material.description,
      materialUnit: material.unit,
      materialQuantity: formatQuantityForReport(materialQty),
      inventoryItemId: primary?.id ?? null,
      inventoryItemCode: primary?.code ?? null,
      inventoryItemStatus: primary?.status ?? (linked[0]?.status ?? null),
      canonicalPhysical: formatQuantityForReport(canonical),
      absoluteDifference: formatQuantityForReport(abs),
      percentDifference: percent,
      warehouseOrLocationCount,
      lastMovementAt,
      lastCountSessionId,
      unitMismatch,
      linkIssue,
    };
  });

  return { rows, summary };
}

export type ExactMaterialLinkCandidate = {
  inventoryItemId: string;
  inventoryItemCode: string;
  materialId: string;
  materialCode: string;
  unitOk: boolean;
  blockedReason: string | null;
};

export async function diagnoseUnlinkedInventoryItems(
  db: PrismaClient
): Promise<{
  candidates: ExactMaterialLinkCandidate[];
  skipped: ExactMaterialLinkCandidate[];
}> {
  const unlinked = await db.inventoryItem.findMany({
    where: { materialId: null, itemType: "RAW_MATERIAL" },
    select: { id: true, code: true, unit: true, status: true },
  });
  const codes = [...new Set(unlinked.map((i) => i.code))];
  const materials = codes.length
    ? await db.material.findMany({
        where: { code: { in: codes } },
        select: { id: true, code: true, unit: true, status: true },
      })
    : [];
  const materialsByCode = new Map<string, typeof materials>();
  for (const m of materials) {
    const list = materialsByCode.get(m.code) ?? [];
    list.push(m);
    materialsByCode.set(m.code, list);
  }

  const existingActive = await db.inventoryItem.findMany({
    where: { materialId: { not: null }, status: "ACTIVE" },
    select: { materialId: true },
  });
  const activeMaterialIds = new Set(
    existingActive.map((i) => i.materialId).filter((id): id is string => Boolean(id))
  );

  const candidates: ExactMaterialLinkCandidate[] = [];
  const skipped: ExactMaterialLinkCandidate[] = [];

  for (const item of unlinked) {
    const matches = materialsByCode.get(item.code) ?? [];
    const base = {
      inventoryItemId: item.id,
      inventoryItemCode: item.code,
      materialId: matches[0]?.id ?? "",
      materialCode: item.code,
      unitOk: matches.length === 1 && unitsCompatible(matches[0]?.unit, item.unit),
      blockedReason: null as string | null,
    };
    if (matches.length === 0) {
      skipped.push({ ...base, blockedReason: "NO_MATERIAL" });
      continue;
    }
    if (matches.length > 1) {
      skipped.push({ ...base, blockedReason: "MULTIPLE_MATERIALS_SAME_CODE" });
      continue;
    }
    const material = matches[0]!;
    if (!unitsCompatible(material.unit, item.unit)) {
      skipped.push({
        ...base,
        materialId: material.id,
        unitOk: false,
        blockedReason: "UNIT_MISMATCH",
      });
      continue;
    }
    if (item.status === "ACTIVE" && activeMaterialIds.has(material.id)) {
      skipped.push({
        ...base,
        materialId: material.id,
        blockedReason: "MATERIAL_ALREADY_LINKED_ACTIVE",
      });
      continue;
    }
    candidates.push({
      ...base,
      materialId: material.id,
      unitOk: true,
      blockedReason: null,
    });
  }

  return { candidates, skipped };
}
