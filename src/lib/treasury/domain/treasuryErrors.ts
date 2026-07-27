/** Erros de domínio da Tesouraria (sem I/O). */

export type TreasuryErrorCode =
  | "MODULE_DISABLED"
  | "NOT_IMPLEMENTED"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED";

export class TreasuryDomainError extends Error {
  readonly code: TreasuryErrorCode;

  constructor(code: TreasuryErrorCode, message: string) {
    super(message);
    this.name = "TreasuryDomainError";
    this.code = code;
  }
}
