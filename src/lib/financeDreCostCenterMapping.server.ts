/**
 * Persistência e seed dos papéis de CC na DRE Gerencial.
 */

import type { PrismaClient } from "@prisma/client";
import {
  classifyDreCostCenterRole,
  DRE_COST_CENTER_ROLE_LABELS,
  isDreCostCenterRole,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import type {
  DreCostCenterMappingSource,
  FinanceDreCostCenterMappingRow,
} from "@/src/lib/financeDreCostCenterMappingTypes.js";

export type { DreCostCenterMappingSource, FinanceDreCostCenterMappingRow };

export async function loadDreCostCenterRoleMap(
  db: PrismaClient
): Promise<Map<string, DreCostCenterRole>> {
  await ensureDreCostCenterMappingsSeeded(db);
  const rows = await db.financialDreCostCenterMapping.findMany({
    select: { costCenterId: true, role: true },
  });
  const map = new Map<string, DreCostCenterRole>();
  for (const row of rows) {
    if (isDreCostCenterRole(row.role)) {
      map.set(row.costCenterId, row.role);
    }
  }
  return map;
}

/**
 * Garante uma linha por CC ACTIVE ausente no mapa, com role do classificador (SEED).
 * Não sobrescreve MANUAL nem SEED já existentes.
 */
export async function ensureDreCostCenterMappingsSeeded(db: PrismaClient): Promise<number> {
  const centers = await db.financialCostCenter.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, code: true, name: true },
  });
  if (centers.length === 0) return 0;

  const existing = await db.financialDreCostCenterMapping.findMany({
    select: { costCenterId: true },
  });
  const have = new Set(existing.map((r) => r.costCenterId));
  const missing = centers.filter((c) => !have.has(c.id));
  if (missing.length === 0) return 0;

  await db.financialDreCostCenterMapping.createMany({
    data: missing.map((c) => ({
      costCenterId: c.id,
      role: classifyDreCostCenterRole(c.code, c.name),
      source: "SEED",
    })),
    skipDuplicates: true,
  });
  return missing.length;
}

export async function listDreCostCenterMappings(
  db: PrismaClient
): Promise<FinanceDreCostCenterMappingRow[]> {
  await ensureDreCostCenterMappingsSeeded(db);
  const centers = await db.financialCostCenter.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ code: "asc" }, { name: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      dreRoleMapping: {
        select: { role: true, source: true, updatedAt: true },
      },
    },
  });

  return centers.map((c) => {
    const role = isDreCostCenterRole(c.dreRoleMapping?.role)
      ? c.dreRoleMapping!.role
      : classifyDreCostCenterRole(c.code, c.name);
    const source: DreCostCenterMappingSource =
      c.dreRoleMapping?.source === "MANUAL" ? "MANUAL" : "SEED";
    return {
      costCenterId: c.id,
      code: c.code,
      name: c.name,
      status: c.status,
      role,
      roleLabel: DRE_COST_CENTER_ROLE_LABELS[role],
      source,
      updatedAt: c.dreRoleMapping?.updatedAt?.toISOString() ?? null,
    };
  });
}

export async function replaceDreCostCenterMappings(
  db: PrismaClient,
  items: Array<{ costCenterId: string; role: DreCostCenterRole }>,
  userId?: string | null
): Promise<FinanceDreCostCenterMappingRow[]> {
  await ensureDreCostCenterMappingsSeeded(db);

  const activeIds = new Set(
    (
      await db.financialCostCenter.findMany({
        where: { status: "ACTIVE" },
        select: { id: true },
      })
    ).map((r) => r.id)
  );

  const cleaned: Array<{ costCenterId: string; role: DreCostCenterRole }> = [];
  for (const item of items) {
    const id = String(item.costCenterId ?? "").trim();
    if (!id || !activeIds.has(id) || !isDreCostCenterRole(item.role)) continue;
    cleaned.push({ costCenterId: id, role: item.role });
  }

  if (cleaned.length > 0) {
    await db.$transaction(
      cleaned.map((item) =>
        db.financialDreCostCenterMapping.upsert({
          where: { costCenterId: item.costCenterId },
          create: {
            costCenterId: item.costCenterId,
            role: item.role,
            source: "MANUAL",
            updatedByUserId: userId ?? null,
          },
          update: {
            role: item.role,
            source: "MANUAL",
            updatedByUserId: userId ?? null,
          },
        })
      )
    );
  }

  return listDreCostCenterMappings(db);
}
