/**
 * Códigos de erro da Central de Tesouraria (client-safe).
 */

export const TREASURY_ERROR_CODES = [
  "MODULE_DISABLED",
  "FEATURE_DISABLED",
  "NOT_IMPLEMENTED",
  "VALIDATION_ERROR",
  "REQUIRED_FIELD",
  "INVALID_MONEY",
  "INVALID_CIVIL_DATE",
  "INVALID_TIMESTAMP",
  "INVALID_ENUM",
  "UNKNOWN_SORT_FIELD",
  "PAYLOAD_TOO_LARGE",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "DAY_CLOSED",
  "RATE_LIMITED",
] as const;

export type TreasuryErrorCode = (typeof TREASURY_ERROR_CODES)[number];

export type TreasuryErrorBody = {
  error: string;
  code?: TreasuryErrorCode;
  field?: string;
};

export class TreasuryContractError extends Error {
  readonly code: TreasuryErrorCode;
  readonly field?: string;

  constructor(code: TreasuryErrorCode, message: string, field?: string) {
    super(message);
    this.name = "TreasuryContractError";
    this.code = code;
    this.field = field;
  }
}

export function isTreasuryErrorCode(value: unknown): value is TreasuryErrorCode {
  return (
    typeof value === "string" &&
    (TREASURY_ERROR_CODES as readonly string[]).includes(value)
  );
}
