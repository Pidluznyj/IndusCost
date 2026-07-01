import type { PrismaClient } from "@prisma/client";
import { COMMISSION_SETTINGS_KEYS, type CommissionSettingsSnapshot } from "./commission-types.js";

const DEFAULT_SETTINGS: CommissionSettingsSnapshot = {
  releaseDefaultRule: "EACH_RECEIVABLE_PAID",
  forecastEnabled: true,
  outputDocumentSupersedesForecast: true,
  paidCommissionBlockAutoChange: true,
};

function parseSettingsValue(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

export async function loadCommissionSettings(
  db: Pick<PrismaClient, "commissionSettings">
): Promise<CommissionSettingsSnapshot> {
  const rows = await db.commissionSettings.findMany({
    where: {
      key: {
        in: Object.values(COMMISSION_SETTINGS_KEYS),
      },
    },
  });

  const map = new Map(rows.map((r) => [r.key, parseSettingsValue(r.valueJson)]));
  const releaseRaw = map.get(COMMISSION_SETTINGS_KEYS.releaseDefaultRule);
  const releaseDefaultRule =
    typeof releaseRaw === "string" &&
    ["SALES_ORDER_CREATED", "OUTPUT_DOCUMENT_CREATED", "FIRST_RECEIVABLE_PAID", "EACH_RECEIVABLE_PAID"].includes(
      releaseRaw
    )
      ? (releaseRaw as CommissionSettingsSnapshot["releaseDefaultRule"])
      : DEFAULT_SETTINGS.releaseDefaultRule;

  return {
    releaseDefaultRule,
    forecastEnabled: map.has(COMMISSION_SETTINGS_KEYS.forecastEnabled)
      ? Boolean(map.get(COMMISSION_SETTINGS_KEYS.forecastEnabled))
      : DEFAULT_SETTINGS.forecastEnabled,
    outputDocumentSupersedesForecast: map.has(
      COMMISSION_SETTINGS_KEYS.outputDocumentSupersedesForecast
    )
      ? Boolean(map.get(COMMISSION_SETTINGS_KEYS.outputDocumentSupersedesForecast))
      : DEFAULT_SETTINGS.outputDocumentSupersedesForecast,
    paidCommissionBlockAutoChange: map.has(COMMISSION_SETTINGS_KEYS.paidCommissionBlockAutoChange)
      ? Boolean(map.get(COMMISSION_SETTINGS_KEYS.paidCommissionBlockAutoChange))
      : DEFAULT_SETTINGS.paidCommissionBlockAutoChange,
  };
}
