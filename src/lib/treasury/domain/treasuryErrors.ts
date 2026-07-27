/** Erros de domínio da Tesouraria (sem I/O) — códigos no contrato client-safe. */

export {
  TREASURY_ERROR_CODES,
  TreasuryContractError,
  isTreasuryErrorCode,
  type TreasuryErrorBody,
  type TreasuryErrorCode,
} from "../contracts/treasuryErrorCodes.js";

import {
  TreasuryContractError,
  type TreasuryErrorCode,
} from "../contracts/treasuryErrorCodes.js";

/** Alias estável para serviços de domínio. */
export class TreasuryDomainError extends TreasuryContractError {
  constructor(code: TreasuryErrorCode, message: string, field?: string) {
    super(code, message, field);
    this.name = "TreasuryDomainError";
  }
}
