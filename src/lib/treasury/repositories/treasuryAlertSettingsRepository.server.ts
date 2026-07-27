/**
 * Repository — configuração global de alertas (singleton GLOBAL).
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  TREASURY_ALERT_SETTINGS_GLOBAL_ID,
  type TreasuryAlertSettingsFields,
} from "../contracts/treasuryAlertConfig.js";
import { normalizeTreasuryAlertSettingsFields } from "../domain/treasuryAlertSettingsRules.js";

export type TreasuryAlertSettingsDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryAlertSettingsRow = TreasuryAlertSettingsFields & {
  id: string;
  updatedAt: Date;
  updatedByUserId: string | null;
};

function mapRow(row: {
  id: string;
  alertsEnabled: boolean;
  relevantReceiptMinAmount: Prisma.Decimal | { toFixed(d: number): string };
  customerConcentrationTopN: number;
  customerConcentrationMinSharePercent:
    | Prisma.Decimal
    | { toFixed(d: number): string };
  staleBalanceHours: number;
  syncMaxAgeHours: number;
  severityByKindJson: Prisma.JsonValue | null;
  enabledByKindJson: Prisma.JsonValue | null;
  updatedAt: Date;
  updatedByUserId: string | null;
}): TreasuryAlertSettingsRow {
  const fields = normalizeTreasuryAlertSettingsFields({
    alertsEnabled: row.alertsEnabled,
    relevantReceiptMinAmount: row.relevantReceiptMinAmount.toFixed(2),
    customerConcentrationTopN: row.customerConcentrationTopN,
    customerConcentrationMinSharePercent:
      row.customerConcentrationMinSharePercent.toFixed(2),
    staleBalanceHours: row.staleBalanceHours,
    syncMaxAgeHours: row.syncMaxAgeHours,
    severityByKindJson: row.severityByKindJson,
    enabledByKindJson: row.enabledByKindJson,
  });
  return {
    id: row.id,
    ...fields,
    updatedAt: row.updatedAt,
    updatedByUserId: row.updatedByUserId,
  };
}

export type TreasuryAlertSettingsRepository = {
  getOrCreate(db?: TreasuryAlertSettingsDb): Promise<TreasuryAlertSettingsRow>;
  save(
    fields: TreasuryAlertSettingsFields,
    updatedByUserId: string | null,
    db?: TreasuryAlertSettingsDb
  ): Promise<TreasuryAlertSettingsRow>;
};

export function createTreasuryAlertSettingsRepository(
  prisma: PrismaClient
): TreasuryAlertSettingsRepository {
  function client(db?: TreasuryAlertSettingsDb): TreasuryAlertSettingsDb {
    return db ?? prisma;
  }

  return {
    async getOrCreate(db) {
      const c = client(db);
      const existing = await c.treasuryAlertSettings.findUnique({
        where: { id: TREASURY_ALERT_SETTINGS_GLOBAL_ID },
      });
      if (existing) return mapRow(existing);
      const created = await c.treasuryAlertSettings.create({
        data: { id: TREASURY_ALERT_SETTINGS_GLOBAL_ID },
      });
      return mapRow(created);
    },

    async save(fields, updatedByUserId, db) {
      const c = client(db);
      const row = await c.treasuryAlertSettings.upsert({
        where: { id: TREASURY_ALERT_SETTINGS_GLOBAL_ID },
        create: {
          id: TREASURY_ALERT_SETTINGS_GLOBAL_ID,
          alertsEnabled: fields.alertsEnabled,
          relevantReceiptMinAmount: new Prisma.Decimal(
            fields.relevantReceiptMinAmount
          ),
          customerConcentrationTopN: fields.customerConcentrationTopN,
          customerConcentrationMinSharePercent: new Prisma.Decimal(
            fields.customerConcentrationMinSharePercent
          ),
          staleBalanceHours: fields.staleBalanceHours,
          syncMaxAgeHours: fields.syncMaxAgeHours,
          severityByKindJson: fields.severityByKind as Prisma.InputJsonValue,
          enabledByKindJson: fields.enabledByKind as Prisma.InputJsonValue,
          updatedByUserId,
        },
        update: {
          alertsEnabled: fields.alertsEnabled,
          relevantReceiptMinAmount: new Prisma.Decimal(
            fields.relevantReceiptMinAmount
          ),
          customerConcentrationTopN: fields.customerConcentrationTopN,
          customerConcentrationMinSharePercent: new Prisma.Decimal(
            fields.customerConcentrationMinSharePercent
          ),
          staleBalanceHours: fields.staleBalanceHours,
          syncMaxAgeHours: fields.syncMaxAgeHours,
          severityByKindJson: fields.severityByKind as Prisma.InputJsonValue,
          enabledByKindJson: fields.enabledByKind as Prisma.InputJsonValue,
          updatedByUserId,
        },
      });
      return mapRow(row);
    },
  };
}
