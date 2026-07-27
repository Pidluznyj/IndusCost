/**
 * Contratos compartilhados da Central de Tesouraria (DTOs / API).
 * Sem Prisma e sem I/O — seguro para frontend e backend.
 */

/** Valores monetários em trânsito: sempre string decimal (nunca number nativo). */
export type TreasuryMoneyString = string;

export type TreasuryModuleId = "treasury";

export type TreasuryAvailabilityStatus = "available" | "disabled" | "scaffold";

export type TreasuryAvailabilityResponse = {
  ok: true;
  module: TreasuryModuleId;
  status: TreasuryAvailabilityStatus;
  enabled: boolean;
  /** Scaffold version — sem regras financeiras ainda. */
  scaffoldVersion: string;
  serverTimeIso: string;
};

export type TreasuryErrorBody = {
  error: string;
  code?: string;
};

/** Prefixo HTTP canônico do módulo. */
export const TREASURY_API_PREFIX = "/api/finance/treasury" as const;

export const TREASURY_AVAILABILITY_PATH =
  `${TREASURY_API_PREFIX}/availability` as const;

export const TREASURY_SCAFFOLD_VERSION = "0.1.0-scaffold" as const;
