import type { PrismaClient } from "@prisma/client";
import { COMMISSION_SETTINGS_KEYS, type CommissionSettingsSnapshot } from "./commission-types.js";

export const DEFAULT_COMMISSION_SETTINGS: CommissionSettingsSnapshot = {
  releaseDefaultRule: "EACH_RECEIVABLE_PAID",
  forecastEnabled: true,
  outputDocumentSupersedesForecast: true,
  receivableAsDefinitiveReleaseSource: true,
  paidCommissionBlockAutoChange: true,
  manualPaymentEnabled: true,
  partialPaymentEnabled: true,
  requireApprovalBeforePaid: true,
  auditOrderWithoutSeller: true,
  auditOrderWithoutRepresentative: true,
  auditNfeWithoutOutputDocument: true,
  auditNfeWithoutReceivable: true,
  auditPaidWithoutRelease: true,
  calculateForSellers: true,
  calculateForRepresentatives: true,
  allowFixedPersonInRule: true,
};

const RELEASE_RULES = new Set<CommissionSettingsSnapshot["releaseDefaultRule"]>([
  "SALES_ORDER_CREATED",
  "OUTPUT_DOCUMENT_CREATED",
  "FIRST_RECEIVABLE_PAID",
  "EACH_RECEIVABLE_PAID",
]);

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

function loadBoolean(
  map: Map<string, unknown>,
  key: string,
  defaultValue: boolean
): boolean {
  return map.has(key) ? Boolean(map.get(key)) : defaultValue;
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
    typeof releaseRaw === "string" && RELEASE_RULES.has(releaseRaw as CommissionSettingsSnapshot["releaseDefaultRule"])
      ? (releaseRaw as CommissionSettingsSnapshot["releaseDefaultRule"])
      : DEFAULT_COMMISSION_SETTINGS.releaseDefaultRule;

  const d = DEFAULT_COMMISSION_SETTINGS;
  return {
    releaseDefaultRule,
    forecastEnabled: loadBoolean(map, COMMISSION_SETTINGS_KEYS.forecastEnabled, d.forecastEnabled),
    outputDocumentSupersedesForecast: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.outputDocumentSupersedesForecast,
      d.outputDocumentSupersedesForecast
    ),
    receivableAsDefinitiveReleaseSource: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.receivableAsDefinitiveReleaseSource,
      d.receivableAsDefinitiveReleaseSource
    ),
    paidCommissionBlockAutoChange: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.paidCommissionBlockAutoChange,
      d.paidCommissionBlockAutoChange
    ),
    manualPaymentEnabled: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.manualPaymentEnabled,
      d.manualPaymentEnabled
    ),
    partialPaymentEnabled: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.partialPaymentEnabled,
      d.partialPaymentEnabled
    ),
    requireApprovalBeforePaid: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.requireApprovalBeforePaid,
      d.requireApprovalBeforePaid
    ),
    auditOrderWithoutSeller: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.auditOrderWithoutSeller,
      d.auditOrderWithoutSeller
    ),
    auditOrderWithoutRepresentative: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.auditOrderWithoutRepresentative,
      d.auditOrderWithoutRepresentative
    ),
    auditNfeWithoutOutputDocument: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.auditNfeWithoutOutputDocument,
      d.auditNfeWithoutOutputDocument
    ),
    auditNfeWithoutReceivable: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.auditNfeWithoutReceivable,
      d.auditNfeWithoutReceivable
    ),
    auditPaidWithoutRelease: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.auditPaidWithoutRelease,
      d.auditPaidWithoutRelease
    ),
    calculateForSellers: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.calculateForSellers,
      d.calculateForSellers
    ),
    calculateForRepresentatives: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.calculateForRepresentatives,
      d.calculateForRepresentatives
    ),
    allowFixedPersonInRule: loadBoolean(
      map,
      COMMISSION_SETTINGS_KEYS.allowFixedPersonInRule,
      d.allowFixedPersonInRule
    ),
  };
}
