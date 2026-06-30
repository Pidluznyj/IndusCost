/**
 * Configuração oficial da margem de Pedidos Nomus — persistida em IndirectCost GLOBAL_PARAM.
 */
import type { PrismaClient } from "@prisma/client";
import type { SalesMarginTaxMode } from "./salesMarginRulesEngine.types.js";
import type { SalesOrderMarginCostPolicy } from "./salesOrderMarginTypes.js";

export const SALES_MARGIN_NOMUS_CONFIG_DESCRIPTION = "SALES_MARGIN_NOMUS_CONFIG" as const;

export type SalesMarginNomusConfig = {
  defaultTaxRuleId: string | null;
  taxMode: SalesMarginTaxMode;
  useFrozenUnitCostFirst: boolean;
  allowLiveCostFallback: boolean;
  showPartialCoverageWarning: boolean;
};

export const DEFAULT_SALES_MARGIN_NOMUS_CONFIG: SalesMarginNomusConfig = {
  defaultTaxRuleId: null,
  taxMode: "deductFromGross",
  useFrozenUnitCostFirst: true,
  allowLiveCostFallback: true,
  showPartialCoverageWarning: true,
};

export function salesMarginNomusConfigToCostPolicy(
  config: SalesMarginNomusConfig
): SalesOrderMarginCostPolicy {
  return {
    useFrozenUnitCostFirst: config.useFrozenUnitCostFirst,
    allowLiveCostFallback: config.allowLiveCostFallback,
  };
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1) return true;
  if (value === "false" || value === 0) return false;
  return fallback;
}

function parseTaxMode(value: unknown): SalesMarginTaxMode {
  return value === "none" ? "none" : "deductFromGross";
}

export function parseSalesMarginNomusConfigJson(raw: unknown): SalesMarginNomusConfig {
  if (raw == null || typeof raw !== "object") {
    return { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG };
  }
  const obj = raw as Record<string, unknown>;
  const taxRuleId =
    typeof obj.defaultTaxRuleId === "string" && obj.defaultTaxRuleId.trim()
      ? obj.defaultTaxRuleId.trim()
      : null;
  return {
    defaultTaxRuleId: taxRuleId,
    taxMode: parseTaxMode(obj.taxMode),
    useFrozenUnitCostFirst: parseBoolean(obj.useFrozenUnitCostFirst, true),
    allowLiveCostFallback: parseBoolean(obj.allowLiveCostFallback, true),
    showPartialCoverageWarning: parseBoolean(obj.showPartialCoverageWarning, true),
  };
}

export function serializeSalesMarginNomusConfig(config: SalesMarginNomusConfig): string {
  return JSON.stringify({
    defaultTaxRuleId: config.defaultTaxRuleId,
    taxMode: config.taxMode,
    useFrozenUnitCostFirst: config.useFrozenUnitCostFirst,
    allowLiveCostFallback: config.allowLiveCostFallback,
    showPartialCoverageWarning: config.showPartialCoverageWarning,
  });
}

export function normalizeSalesMarginNomusConfigInput(
  body: Record<string, unknown> | null | undefined
): SalesMarginNomusConfig {
  return parseSalesMarginNomusConfigJson(body ?? {});
}

export async function loadSalesMarginNomusConfig(
  db: Pick<PrismaClient, "indirectCost">
): Promise<{ config: SalesMarginNomusConfig; configRowId: string | null }> {
  const row = await db.indirectCost.findFirst({
    where: {
      category: "GLOBAL_PARAM",
      description: SALES_MARGIN_NOMUS_CONFIG_DESCRIPTION,
    },
    select: { id: true, allocationCriteria: true },
  });
  if (!row?.allocationCriteria) {
    return { config: { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG }, configRowId: row?.id ?? null };
  }
  try {
    const json = JSON.parse(row.allocationCriteria) as unknown;
    return { config: parseSalesMarginNomusConfigJson(json), configRowId: row.id };
  } catch {
    return { config: { ...DEFAULT_SALES_MARGIN_NOMUS_CONFIG }, configRowId: row.id };
  }
}

export async function saveSalesMarginNomusConfig(
  db: Pick<PrismaClient, "indirectCost">,
  config: SalesMarginNomusConfig,
  existingRowId?: string | null
): Promise<{ config: SalesMarginNomusConfig; configRowId: string }> {
  const payload = serializeSalesMarginNomusConfig(config);
  if (existingRowId) {
    const updated = await db.indirectCost.update({
      where: { id: existingRowId },
      data: {
        allocationCriteria: payload,
        monthlyValue: 1,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    return { config, configRowId: updated.id };
  }
  const created = await db.indirectCost.create({
    data: {
      description: SALES_MARGIN_NOMUS_CONFIG_DESCRIPTION,
      category: "GLOBAL_PARAM",
      monthlyValue: 1,
      allocationCriteria: payload,
      costCenter: null,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return { config, configRowId: created.id };
}
