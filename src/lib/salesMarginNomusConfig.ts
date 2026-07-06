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
  useFrozenUnitCostFirst: false,
  allowLiveCostFallback: false,
  showPartialCoverageWarning: true,
};

export const SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE =
  "Selecione uma regra fiscal ativa para calcular a margem gerencial com imposto." as const;

export type SalesMarginNomusFiscalConfigStatus = "OK" | "ALERTA" | "BLOQUEANTE";

export type SalesMarginNomusFiscalConfigAssessment = {
  status: SalesMarginNomusFiscalConfigStatus;
  reasons: string[];
  usesFallback: boolean;
  requiresTaxRule: boolean;
};

export type SalesMarginNomusConfigValidationResult =
  | { ok: true }
  | { ok: false; error: string; code: string };

export type SalesMarginNomusTaxRuleRef = {
  status: string | null;
  totalPercent: number;
} | null;

export function salesMarginNomusRequiresDefaultTaxRule(config: SalesMarginNomusConfig): boolean {
  return config.taxMode === "deductFromGross";
}

export function validateSalesMarginNomusConfigForSave(
  config: SalesMarginNomusConfig,
  resolvedTaxRule?: SalesMarginNomusTaxRuleRef
): SalesMarginNomusConfigValidationResult {
  if (!salesMarginNomusRequiresDefaultTaxRule(config)) {
    return { ok: true };
  }
  if (!config.defaultTaxRuleId?.trim()) {
    return {
      ok: false,
      code: "TAX_RULE_REQUIRED",
      error: SALES_MARGIN_NOMUS_TAX_RULE_REQUIRED_MESSAGE,
    };
  }
  if (!resolvedTaxRule) {
    return {
      ok: false,
      code: "TAX_RULE_NOT_FOUND",
      error: "TaxRule selecionada não existe ou não está ativa.",
    };
  }
  if (resolvedTaxRule.status !== "ACTIVE") {
    return {
      ok: false,
      code: "TAX_RULE_INACTIVE",
      error: "TaxRule selecionada não está ativa. Escolha uma regra ACTIVE em Tributos.",
    };
  }
  if (!Number.isFinite(resolvedTaxRule.totalPercent) || resolvedTaxRule.totalPercent <= 0) {
    return {
      ok: false,
      code: "TAX_RULE_ZERO_PERCENT",
      error: "TaxRule selecionada possui percentual total 0% — configure os componentes fiscais.",
    };
  }
  return { ok: true };
}

export function assessSalesMarginNomusFiscalConfig(
  config: SalesMarginNomusConfig,
  resolvedTaxRule?: SalesMarginNomusTaxRuleRef,
  taxRuleSource?: string | null
): SalesMarginNomusFiscalConfigAssessment {
  const reasons: string[] = [];
  const requiresTaxRule = salesMarginNomusRequiresDefaultTaxRule(config);
  const usesFallback = Boolean(
    taxRuleSource?.includes("fallback") || taxRuleSource?.includes("primeira TaxRule ACTIVE")
  );

  if (!requiresTaxRule) {
    return { status: "OK", reasons: [], usesFallback: false, requiresTaxRule: false };
  }

  if (!config.defaultTaxRuleId?.trim()) {
    reasons.push("Modo gerencial com imposto exige TaxRule padrão configurada.");
    return { status: "BLOQUEANTE", reasons, usesFallback: false, requiresTaxRule: true };
  }

  if (!resolvedTaxRule) {
    reasons.push("TaxRule salva não encontrada ou inativa.");
    return { status: "BLOQUEANTE", reasons, usesFallback: false, requiresTaxRule: true };
  }

  if (resolvedTaxRule.status !== "ACTIVE") {
    reasons.push(`TaxRule salva com status ${resolvedTaxRule.status ?? "—"} (esperado ACTIVE).`);
    return { status: "BLOQUEANTE", reasons, usesFallback: false, requiresTaxRule: true };
  }

  if (!Number.isFinite(resolvedTaxRule.totalPercent) || resolvedTaxRule.totalPercent <= 0) {
    reasons.push("TaxRule salva possui percentual total 0%.");
    return { status: "BLOQUEANTE", reasons, usesFallback: false, requiresTaxRule: true };
  }

  if (usesFallback) {
    reasons.push("Motor está usando fallback fiscal em vez da TaxRule configurada.");
    return { status: "ALERTA", reasons, usesFallback: true, requiresTaxRule: true };
  }

  return { status: "OK", reasons: [], usesFallback: false, requiresTaxRule: true };
}

export function salesMarginNomusConfigToCostPolicy(
  config: SalesMarginNomusConfig
): SalesOrderMarginCostPolicy {
  return {
    useFrozenUnitCostFirst: false,
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
    useFrozenUnitCostFirst: false,
    allowLiveCostFallback: parseBoolean(obj.allowLiveCostFallback, false),
    showPartialCoverageWarning: parseBoolean(obj.showPartialCoverageWarning, true),
  };
}

export function serializeSalesMarginNomusConfig(config: SalesMarginNomusConfig): string {
  return JSON.stringify({
    defaultTaxRuleId: config.defaultTaxRuleId,
    taxMode: config.taxMode,
    useFrozenUnitCostFirst: false,
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
