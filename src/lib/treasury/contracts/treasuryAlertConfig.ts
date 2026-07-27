/**
 * Configuração de alertas da Tesouraria — client-safe.
 * Padrão alinhado a MaterialMarketAlertGlobalConfig (singleton GLOBAL + limiares).
 */

import type { TreasuryExceptionSeverity } from "./treasuryEnums.js";

export const TREASURY_ALERT_SETTINGS_GLOBAL_ID = "GLOBAL" as const;

export const TREASURY_ALERT_KINDS = [
  "NEGATIVE_BALANCE",
  "BELOW_MINIMUM",
  "RELEVANT_RECEIPT_NOT_RECEIVED",
  "CUSTOMER_CONCENTRATION",
  "SYNC_DELAYED",
  "STALE_BALANCE",
  "EXPIRED_PROMISE",
  "CRITICAL_PAYMENT",
] as const;
export type TreasuryAlertKind = (typeof TREASURY_ALERT_KINDS)[number];

export const TREASURY_ALERT_KIND_LABELS: Record<TreasuryAlertKind, string> = {
  NEGATIVE_BALANCE: "Saldo negativo",
  BELOW_MINIMUM: "Saldo abaixo do mínimo",
  RELEVANT_RECEIPT_NOT_RECEIVED: "Recebimento relevante não realizado",
  CUSTOMER_CONCENTRATION: "Concentração em poucos clientes",
  SYNC_DELAYED: "Sincronização atrasada",
  STALE_BALANCE: "Saldo desatualizado",
  EXPIRED_PROMISE: "Promessa vencida",
  CRITICAL_PAYMENT: "Pagamento crítico",
};

export type TreasuryAlertSeverityByKind = Record<
  TreasuryAlertKind,
  TreasuryExceptionSeverity
>;
export type TreasuryAlertEnabledByKind = Record<TreasuryAlertKind, boolean>;

export type TreasuryAlertSettingsFields = {
  alertsEnabled: boolean;
  /** Valor mínimo (string decimal) para considerar recebimento “relevante”. */
  relevantReceiptMinAmount: string;
  /** Quantos maiores clientes entram no cálculo de concentração. */
  customerConcentrationTopN: number;
  /** Participação mínima (%) dos top N sobre o aberto total. */
  customerConcentrationMinSharePercent: string;
  staleBalanceHours: number;
  syncMaxAgeHours: number;
  severityByKind: TreasuryAlertSeverityByKind;
  enabledByKind: TreasuryAlertEnabledByKind;
};

export const DEFAULT_TREASURY_ALERT_SEVERITY_BY_KIND: TreasuryAlertSeverityByKind =
  {
    NEGATIVE_BALANCE: "CRITICAL",
    BELOW_MINIMUM: "CRITICAL",
    RELEVANT_RECEIPT_NOT_RECEIVED: "WARNING",
    CUSTOMER_CONCENTRATION: "WARNING",
    SYNC_DELAYED: "WARNING",
    STALE_BALANCE: "WARNING",
    EXPIRED_PROMISE: "WARNING",
    CRITICAL_PAYMENT: "CRITICAL",
  };

export const DEFAULT_TREASURY_ALERT_ENABLED_BY_KIND: TreasuryAlertEnabledByKind =
  {
    NEGATIVE_BALANCE: true,
    BELOW_MINIMUM: true,
    RELEVANT_RECEIPT_NOT_RECEIVED: true,
    CUSTOMER_CONCENTRATION: true,
    SYNC_DELAYED: true,
    STALE_BALANCE: true,
    EXPIRED_PROMISE: true,
    CRITICAL_PAYMENT: true,
  };

export const DEFAULT_TREASURY_ALERT_SETTINGS: TreasuryAlertSettingsFields = {
  alertsEnabled: true,
  relevantReceiptMinAmount: "10000.00",
  customerConcentrationTopN: 3,
  customerConcentrationMinSharePercent: "50.00",
  staleBalanceHours: 36,
  syncMaxAgeHours: 24,
  severityByKind: { ...DEFAULT_TREASURY_ALERT_SEVERITY_BY_KIND },
  enabledByKind: { ...DEFAULT_TREASURY_ALERT_ENABLED_BY_KIND },
};

export function isTreasuryAlertKind(value: string): value is TreasuryAlertKind {
  return (TREASURY_ALERT_KINDS as readonly string[]).includes(value);
}
