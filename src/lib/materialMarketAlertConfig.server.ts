/**
 * Persistência de configuração de alertas de mercado (Prisma).
 */

import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_MATERIAL_MARKET_ALERT_CONFIG,
  MATERIAL_MARKET_ALERT_CONFIG_GLOBAL_ID,
  normalizeMaterialMarketAlertConfigFields,
  resolveAlertConfig,
  serializeMaterialMarketAlertConfigForApi,
  type EffectiveAlertConfig,
  type MaterialMarketAlertConfigAuditApiItem,
  type MaterialMarketAlertConfigFields,
  type MaterialMarketAlertConfigPartial,
} from "./materialMarketAlertConfig.js";

type DbClient = Pick<
  PrismaClient,
  | "materialMarketAlertGlobalConfig"
  | "materialMarketAlertConfig"
  | "materialMarketAlertConfigAudit"
>;

function toConfigFields(row: {
  risePercentThreshold: unknown;
  fallPercentThreshold: unknown;
  daysWithoutQuote: number;
  alertsEnabled: boolean;
}): MaterialMarketAlertConfigFields {
  return normalizeMaterialMarketAlertConfigFields({
    risePercentThreshold: Number(row.risePercentThreshold),
    fallPercentThreshold: Number(row.fallPercentThreshold),
    daysWithoutQuote: row.daysWithoutQuote,
    alertsEnabled: row.alertsEnabled,
  });
}

function toPartialConfig(row: {
  risePercentThreshold: unknown | null;
  fallPercentThreshold: unknown | null;
  daysWithoutQuote: number | null;
  alertsEnabled: boolean | null;
}): MaterialMarketAlertConfigPartial {
  return {
    risePercentThreshold:
      row.risePercentThreshold != null ? Number(row.risePercentThreshold) : null,
    fallPercentThreshold:
      row.fallPercentThreshold != null ? Number(row.fallPercentThreshold) : null,
    daysWithoutQuote: row.daysWithoutQuote,
    alertsEnabled: row.alertsEnabled,
  };
}

export async function ensureMaterialMarketAlertGlobalConfig(
  db: DbClient
): Promise<MaterialMarketAlertConfigFields> {
  const existing = await db.materialMarketAlertGlobalConfig.findUnique({
    where: { id: MATERIAL_MARKET_ALERT_CONFIG_GLOBAL_ID },
  });
  if (existing) return toConfigFields(existing);

  const created = await db.materialMarketAlertGlobalConfig.create({
    data: { id: MATERIAL_MARKET_ALERT_CONFIG_GLOBAL_ID },
  });
  return toConfigFields(created);
}

export async function loadEffectiveMaterialMarketAlertConfig(
  db: DbClient,
  materialId?: string
): Promise<EffectiveAlertConfig> {
  const global = await ensureMaterialMarketAlertGlobalConfig(db);
  if (!materialId) return resolveAlertConfig(global, null);

  const materialRow = await db.materialMarketAlertConfig.findUnique({
    where: { materialId },
  });
  return resolveAlertConfig(global, materialRow ? toPartialConfig(materialRow) : null);
}

async function writeConfigAudit(
  db: DbClient,
  input: {
    scope: "GLOBAL" | "MATERIAL";
    materialId?: string | null;
    beforeJson: Record<string, unknown> | null;
    afterJson: Record<string, unknown> | null;
    updatedBy?: string | null;
  }
): Promise<void> {
  await db.materialMarketAlertConfigAudit.create({
    data: {
      scope: input.scope,
      materialId: input.materialId ?? null,
      beforeJson: input.beforeJson,
      afterJson: input.afterJson,
      updatedBy: input.updatedBy ?? null,
    },
  });
}

export async function saveMaterialMarketAlertGlobalConfig(
  db: DbClient,
  value: MaterialMarketAlertConfigFields,
  updatedBy?: string | null
) {
  const before = await ensureMaterialMarketAlertGlobalConfig(db);
  const saved = await db.materialMarketAlertGlobalConfig.upsert({
    where: { id: MATERIAL_MARKET_ALERT_CONFIG_GLOBAL_ID },
    create: {
      id: MATERIAL_MARKET_ALERT_CONFIG_GLOBAL_ID,
      ...value,
      updatedBy: updatedBy ?? null,
    },
    update: {
      ...value,
      updatedBy: updatedBy ?? null,
    },
  });

  await writeConfigAudit(db, {
    scope: "GLOBAL",
    beforeJson: before,
    afterJson: toConfigFields(saved),
    updatedBy,
  });

  return serializeMaterialMarketAlertConfigForApi(resolveAlertConfig(toConfigFields(saved), null), {
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
  });
}

export async function saveMaterialMarketAlertMaterialConfig(
  db: DbClient,
  materialId: string,
  value: MaterialMarketAlertConfigPartial,
  options: { clearOverrides?: boolean; updatedBy?: string | null } = {}
) {
  const global = await ensureMaterialMarketAlertGlobalConfig(db);
  const existing = await db.materialMarketAlertConfig.findUnique({ where: { materialId } });
  const beforeEffective = resolveAlertConfig(
    global,
    existing ? toPartialConfig(existing) : null
  );

  if (options.clearOverrides) {
    if (existing) {
      await db.materialMarketAlertConfig.delete({ where: { materialId } });
    }
    const afterEffective = resolveAlertConfig(global, null);
    await writeConfigAudit(db, {
      scope: "MATERIAL",
      materialId,
      beforeJson: beforeEffective,
      afterJson: afterEffective,
      updatedBy: options.updatedBy,
    });
    return serializeMaterialMarketAlertConfigForApi(afterEffective, { materialId });
  }

  const saved = await db.materialMarketAlertConfig.upsert({
    where: { materialId },
    create: {
      materialId,
      risePercentThreshold: value.risePercentThreshold ?? null,
      fallPercentThreshold: value.fallPercentThreshold ?? null,
      daysWithoutQuote: value.daysWithoutQuote ?? null,
      alertsEnabled: value.alertsEnabled ?? null,
      updatedBy: options.updatedBy ?? null,
    },
    update: {
      ...(value.risePercentThreshold !== undefined
        ? { risePercentThreshold: value.risePercentThreshold }
        : {}),
      ...(value.fallPercentThreshold !== undefined
        ? { fallPercentThreshold: value.fallPercentThreshold }
        : {}),
      ...(value.daysWithoutQuote !== undefined ? { daysWithoutQuote: value.daysWithoutQuote } : {}),
      ...(value.alertsEnabled !== undefined ? { alertsEnabled: value.alertsEnabled } : {}),
      updatedBy: options.updatedBy ?? null,
    },
  });

  const afterEffective = resolveAlertConfig(global, toPartialConfig(saved));
  await writeConfigAudit(db, {
    scope: "MATERIAL",
    materialId,
    beforeJson: beforeEffective,
    afterJson: afterEffective,
    updatedBy: options.updatedBy,
  });

  return serializeMaterialMarketAlertConfigForApi(afterEffective, {
    materialId,
    updatedAt: saved.updatedAt,
    updatedBy: saved.updatedBy,
  });
}

export async function listMaterialMarketAlertConfigAudit(
  db: DbClient,
  options?: { materialId?: string; limit?: number }
): Promise<{ items: MaterialMarketAlertConfigAuditApiItem[]; total: number }> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  const rows = await db.materialMarketAlertConfigAudit.findMany({
    where: options?.materialId ? { materialId: options.materialId } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const items: MaterialMarketAlertConfigAuditApiItem[] = rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    materialId: row.materialId,
    beforeJson: (row.beforeJson as Record<string, unknown> | null) ?? null,
    afterJson: (row.afterJson as Record<string, unknown> | null) ?? null,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
  }));

  return { items, total: items.length };
}

export function getDefaultMaterialMarketAlertConfigFields(): MaterialMarketAlertConfigFields {
  return { ...DEFAULT_MATERIAL_MARKET_ALERT_CONFIG };
}
