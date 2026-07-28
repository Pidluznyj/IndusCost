/**
 * Regras puras — ações de cobrança (CR).
 * Não muta título oficial; cancelamento é lógico.
 */

import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export function assertReceivableAllowsCollectionAction(
  official: OfficialReceivableView
): void {
  if (official.cancellation.isCancelledOrRemovedFromSource) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Título cancelado/ausente não permite nova ação de cobrança.",
      "titleId"
    );
  }
}

export function assertCollectionActionCancellable(row: {
  cancelledAt: Date | null;
  version: number;
  expectedVersion: number;
}): void {
  if (row.cancelledAt) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Ação de cobrança já está cancelada.",
      "actionId"
    );
  }
  if (row.version !== row.expectedVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão da ação de cobrança desatualizada.",
      "expectedVersion"
    );
  }
}

/** nextAction do complemento é espelho operacional — nunca apaga histórico de ações. */
export function shouldMirrorCollectionNextActionOnComplement(
  nextAction: string | null | undefined
): boolean {
  return Boolean(nextAction?.trim());
}
