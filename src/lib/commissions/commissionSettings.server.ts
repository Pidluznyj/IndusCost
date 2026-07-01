import { prisma } from "@/src/lib/prisma.js";
import {
  COMMISSION_SETTINGS_KEYS,
  type CommissionSettingsAuditFlags,
  type CommissionSettingsSnapshot,
  type CommissionSettingsUpdateResult,
} from "./commission-types.js";
import {
  DEFAULT_COMMISSION_SETTINGS,
  loadCommissionSettings,
} from "./commission-settings.server.js";
import { CommissionValidationError, type CommissionSettingsWriteInput } from "./commissionApiValidation.js";

export { CommissionValidationError };
export type { CommissionSettingsWriteInput };

const SNAPSHOT_TO_KEY: Record<keyof CommissionSettingsSnapshot, string> = {
  releaseDefaultRule: COMMISSION_SETTINGS_KEYS.releaseDefaultRule,
  forecastEnabled: COMMISSION_SETTINGS_KEYS.forecastEnabled,
  outputDocumentSupersedesForecast: COMMISSION_SETTINGS_KEYS.outputDocumentSupersedesForecast,
  receivableAsDefinitiveReleaseSource: COMMISSION_SETTINGS_KEYS.receivableAsDefinitiveReleaseSource,
  paidCommissionBlockAutoChange: COMMISSION_SETTINGS_KEYS.paidCommissionBlockAutoChange,
  manualPaymentEnabled: COMMISSION_SETTINGS_KEYS.manualPaymentEnabled,
  partialPaymentEnabled: COMMISSION_SETTINGS_KEYS.partialPaymentEnabled,
  requireApprovalBeforePaid: COMMISSION_SETTINGS_KEYS.requireApprovalBeforePaid,
  auditOrderWithoutSeller: COMMISSION_SETTINGS_KEYS.auditOrderWithoutSeller,
  auditOrderWithoutRepresentative: COMMISSION_SETTINGS_KEYS.auditOrderWithoutRepresentative,
  auditNfeWithoutOutputDocument: COMMISSION_SETTINGS_KEYS.auditNfeWithoutOutputDocument,
  auditNfeWithoutReceivable: COMMISSION_SETTINGS_KEYS.auditNfeWithoutReceivable,
  auditPaidWithoutRelease: COMMISSION_SETTINGS_KEYS.auditPaidWithoutRelease,
  calculateForSellers: COMMISSION_SETTINGS_KEYS.calculateForSellers,
  calculateForRepresentatives: COMMISSION_SETTINGS_KEYS.calculateForRepresentatives,
  allowFixedPersonInRule: COMMISSION_SETTINGS_KEYS.allowFixedPersonInRule,
};

export function validateCommissionSettingsSnapshot(
  snapshot: CommissionSettingsSnapshot
): { ok: true; warnings: string[] } | { ok: false; error: string } {
  const hasCalculationSource =
    snapshot.forecastEnabled ||
    snapshot.outputDocumentSupersedesForecast ||
    snapshot.receivableAsDefinitiveReleaseSource;
  if (!hasCalculationSource) {
    return {
      ok: false,
      error:
        "Pelo menos uma fonte de cálculo/liberação deve permanecer ativa (previsão, documento de saída ou contas a receber).",
    };
  }

  if (!snapshot.calculateForSellers && !snapshot.calculateForRepresentatives) {
    return {
      ok: false,
      error: "Ative o cálculo para vendedores ou representantes.",
    };
  }

  const warnings: string[] = [];
  if (!snapshot.receivableAsDefinitiveReleaseSource) {
    warnings.push(
      "Contas a Receber deixaram de ser a fonte definitiva de liberação. Liberações podem ocorrer antes do recebimento real — revise regras e pagamentos."
    );
  }

  const impactsCalculation =
    !snapshot.forecastEnabled ||
    !snapshot.outputDocumentSupersedesForecast ||
    !snapshot.calculateForSellers ||
    !snapshot.calculateForRepresentatives ||
    !snapshot.allowFixedPersonInRule;
  if (impactsCalculation) {
    warnings.push(
      "Alterações de cálculo ou escopo exigem reprocessamento do período para refletir nos registros existentes."
    );
  }

  return { ok: true, warnings };
}

export async function getCommissionSettingsPayload(): Promise<CommissionSettingsSnapshot> {
  return loadCommissionSettings(prisma);
}

export async function updateCommissionSettings(
  input: CommissionSettingsWriteInput
): Promise<CommissionSettingsUpdateResult> {
  const current = await loadCommissionSettings(prisma);
  const merged: CommissionSettingsSnapshot = { ...current, ...input };

  const validation = validateCommissionSettingsSnapshot(merged);
  if (!validation.ok) {
    throw new CommissionValidationError("INVALID_FIELD", validation.error);
  }

  const updates = Object.entries(input) as Array<
    [keyof CommissionSettingsSnapshot, CommissionSettingsSnapshot[keyof CommissionSettingsSnapshot]]
  >;
  if (updates.length === 0) {
    return { ...current, warnings: validation.warnings };
  }

  for (const [field, value] of updates) {
    const key = SNAPSHOT_TO_KEY[field];
    await prisma.commissionSettings.upsert({
      where: { key },
      create: { key, valueJson: value as import("@prisma/client").Prisma.InputJsonValue },
      update: { valueJson: value as import("@prisma/client").Prisma.InputJsonValue },
    });
  }

  const saved = await loadCommissionSettings(prisma);
  return { ...saved, warnings: validation.warnings };
}

export async function restoreCommissionSettingsDefaults(): Promise<CommissionSettingsUpdateResult> {
  return updateCommissionSettings({ ...DEFAULT_COMMISSION_SETTINGS });
}

export function resolveActiveBeneficiaryTypes(
  settings: CommissionSettingsSnapshot
): Array<"SELLER" | "REPRESENTATIVE"> {
  const types: Array<"SELLER" | "REPRESENTATIVE"> = [];
  if (settings.calculateForSellers) types.push("SELLER");
  if (settings.calculateForRepresentatives) types.push("REPRESENTATIVE");
  return types;
}

export function filterRulesByScope<T extends { beneficiaryType: string }>(
  rules: T[],
  settings: CommissionSettingsSnapshot
): T[] {
  return rules.filter((rule) => {
    if (rule.beneficiaryType === "FIXED_PERSON" && !settings.allowFixedPersonInRule) {
      return false;
    }
    if (rule.beneficiaryType === "SELLER" && !settings.calculateForSellers) return false;
    if (rule.beneficiaryType === "REPRESENTATIVE" && !settings.calculateForRepresentatives) {
      return false;
    }
    return true;
  });
}

export function assertFixedPersonRuleAllowed(settings: CommissionSettingsSnapshot): void {
  if (!settings.allowFixedPersonInRule) {
    throw new CommissionValidationError(
      "INVALID_FIELD",
      "Regras com pessoa fixa estão desabilitadas nas configurações do módulo."
    );
  }
}

export function extractAuditSettings(
  settings: CommissionSettingsSnapshot
): CommissionSettingsAuditFlags {
  return {
    auditOrderWithoutSeller: settings.auditOrderWithoutSeller,
    auditOrderWithoutRepresentative: settings.auditOrderWithoutRepresentative,
    auditNfeWithoutOutputDocument: settings.auditNfeWithoutOutputDocument,
    auditNfeWithoutReceivable: settings.auditNfeWithoutReceivable,
    auditPaidWithoutRelease: settings.auditPaidWithoutRelease,
  };
}
