import { prisma } from "@/src/lib/prisma.js";
import {
  COMMISSION_SETTINGS_KEYS,
  type CommissionSettingsSnapshot,
} from "./commission-types.js";
import { loadCommissionSettings } from "./commission-settings.server.js";
import {
  CommissionValidationError,
  type CommissionSettingsWriteInput,
} from "./commissionApiValidation.js";

export { CommissionValidationError };

export async function getCommissionSettingsPayload(): Promise<CommissionSettingsSnapshot> {
  return loadCommissionSettings(prisma);
}

export async function updateCommissionSettings(
  input: CommissionSettingsWriteInput
): Promise<CommissionSettingsSnapshot> {
  const updates: Array<{ key: string; value: unknown }> = [];
  if (input.releaseDefaultRule !== undefined) {
    updates.push({ key: COMMISSION_SETTINGS_KEYS.releaseDefaultRule, value: input.releaseDefaultRule });
  }
  if (input.forecastEnabled !== undefined) {
    updates.push({ key: COMMISSION_SETTINGS_KEYS.forecastEnabled, value: input.forecastEnabled });
  }
  if (input.outputDocumentSupersedesForecast !== undefined) {
    updates.push({
      key: COMMISSION_SETTINGS_KEYS.outputDocumentSupersedesForecast,
      value: input.outputDocumentSupersedesForecast,
    });
  }
  if (input.paidCommissionBlockAutoChange !== undefined) {
    updates.push({
      key: COMMISSION_SETTINGS_KEYS.paidCommissionBlockAutoChange,
      value: input.paidCommissionBlockAutoChange,
    });
  }

  for (const u of updates) {
    await prisma.commissionSettings.upsert({
      where: { key: u.key },
      create: { key: u.key, valueJson: u.value },
      update: { valueJson: u.value },
    });
  }

  return loadCommissionSettings(prisma);
}

