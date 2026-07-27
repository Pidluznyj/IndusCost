/**
 * Parse/normalize da configuração de alertas (puro).
 */

import {
  DEFAULT_TREASURY_ALERT_ENABLED_BY_KIND,
  DEFAULT_TREASURY_ALERT_SETTINGS,
  DEFAULT_TREASURY_ALERT_SEVERITY_BY_KIND,
  TREASURY_ALERT_KINDS,
  type TreasuryAlertEnabledByKind,
  type TreasuryAlertSettingsFields,
  type TreasuryAlertSeverityByKind,
  isTreasuryAlertKind,
} from "../contracts/treasuryAlertConfig.js";
import { TREASURY_EXCEPTION_SEVERITIES } from "../contracts/treasuryEnums.js";
import { TreasuryDomainError } from "./treasuryErrors.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

function parseSeverityMap(raw: unknown): TreasuryAlertSeverityByKind {
  const out: TreasuryAlertSeverityByKind = {
    ...DEFAULT_TREASURY_ALERT_SEVERITY_BY_KIND,
  };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTreasuryAlertKind(k)) continue;
    if (typeof v !== "string") continue;
    if (!(TREASURY_EXCEPTION_SEVERITIES as readonly string[]).includes(v)) {
      continue;
    }
    out[k] = v as TreasuryAlertSeverityByKind[typeof k];
  }
  return out;
}

function parseEnabledMap(raw: unknown): TreasuryAlertEnabledByKind {
  const out: TreasuryAlertEnabledByKind = {
    ...DEFAULT_TREASURY_ALERT_ENABLED_BY_KIND,
  };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTreasuryAlertKind(k)) continue;
    if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export function normalizeTreasuryAlertSettingsFields(
  partial: Partial<TreasuryAlertSettingsFields> & {
    severityByKindJson?: unknown;
    enabledByKindJson?: unknown;
    relevantReceiptMinAmount?: string | number;
    customerConcentrationMinSharePercent?: string | number;
  }
): TreasuryAlertSettingsFields {
  const base = DEFAULT_TREASURY_ALERT_SETTINGS;
  const relevant =
    partial.relevantReceiptMinAmount != null
      ? normalizeTreasuryMoneyString(String(partial.relevantReceiptMinAmount))
      : base.relevantReceiptMinAmount;
  const shareRaw =
    partial.customerConcentrationMinSharePercent != null
      ? String(partial.customerConcentrationMinSharePercent)
      : base.customerConcentrationMinSharePercent;
  const share = normalizeTreasuryMoneyString(shareRaw);
  const topN = Number(
    partial.customerConcentrationTopN ?? base.customerConcentrationTopN
  );
  const stale = Number(partial.staleBalanceHours ?? base.staleBalanceHours);
  const sync = Number(partial.syncMaxAgeHours ?? base.syncMaxAgeHours);
  return {
    alertsEnabled: partial.alertsEnabled ?? base.alertsEnabled,
    relevantReceiptMinAmount: relevant,
    customerConcentrationTopN:
      Number.isFinite(topN) && topN >= 1 ? Math.trunc(topN) : base.customerConcentrationTopN,
    customerConcentrationMinSharePercent: share,
    staleBalanceHours:
      Number.isFinite(stale) && stale >= 1 ? Math.trunc(stale) : base.staleBalanceHours,
    syncMaxAgeHours:
      Number.isFinite(sync) && sync >= 1 ? Math.trunc(sync) : base.syncMaxAgeHours,
    severityByKind: parseSeverityMap(
      partial.severityByKind ?? partial.severityByKindJson
    ),
    enabledByKind: parseEnabledMap(
      partial.enabledByKind ?? partial.enabledByKindJson
    ),
  };
}

export function parseTreasuryAlertSettingsInput(
  body: Record<string, unknown>
): TreasuryAlertSettingsFields {
  const normalized = normalizeTreasuryAlertSettingsFields({
    alertsEnabled:
      body.alertsEnabled === undefined
        ? DEFAULT_TREASURY_ALERT_SETTINGS.alertsEnabled
        : Boolean(body.alertsEnabled),
    relevantReceiptMinAmount:
      body.relevantReceiptMinAmount != null
        ? String(body.relevantReceiptMinAmount)
        : DEFAULT_TREASURY_ALERT_SETTINGS.relevantReceiptMinAmount,
    customerConcentrationTopN:
      body.customerConcentrationTopN != null
        ? Number(body.customerConcentrationTopN)
        : DEFAULT_TREASURY_ALERT_SETTINGS.customerConcentrationTopN,
    customerConcentrationMinSharePercent:
      body.customerConcentrationMinSharePercent != null
        ? String(body.customerConcentrationMinSharePercent)
        : DEFAULT_TREASURY_ALERT_SETTINGS.customerConcentrationMinSharePercent,
    staleBalanceHours:
      body.staleBalanceHours != null
        ? Number(body.staleBalanceHours)
        : DEFAULT_TREASURY_ALERT_SETTINGS.staleBalanceHours,
    syncMaxAgeHours:
      body.syncMaxAgeHours != null
        ? Number(body.syncMaxAgeHours)
        : DEFAULT_TREASURY_ALERT_SETTINGS.syncMaxAgeHours,
    severityByKind: body.severityByKind as TreasuryAlertSeverityByKind | undefined,
    enabledByKind: body.enabledByKind as TreasuryAlertEnabledByKind | undefined,
  });

  if (Number(normalized.customerConcentrationMinSharePercent) > 100) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "customerConcentrationMinSharePercent deve ser ≤ 100.",
      "customerConcentrationMinSharePercent"
    );
  }
  for (const kind of TREASURY_ALERT_KINDS) {
    if (!(kind in normalized.severityByKind)) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        `severityByKind incompleto: ${kind}`,
        "severityByKind"
      );
    }
  }
  return normalized;
}
