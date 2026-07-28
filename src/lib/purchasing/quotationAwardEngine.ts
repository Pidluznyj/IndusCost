/**
 * Adjudicação / aprovação de cotação vencedora (OP-19) — puro, sem Prisma.
 * Sem recebimento / PO / Contas a Pagar.
 */

export class QuotationAwardError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "QuotationAwardError";
  }
}

export type AwardMode = "SINGLE" | "SPLIT";

export type AwardDemandItem = {
  quotationItemId: string;
  quantityDemanded: number;
};

export type AwardOfferItemRef = {
  offerId: string;
  offerItemId: string;
  quotationItemId: string;
  offerStatus: string;
  unitPrice: number;
  quantityOffered: number | null;
  validityDate: string | null; // YYYY-MM-DD
  currency: string;
};

export type AwardAllocationInput = {
  offerId: string;
  quotationItemId: string;
  quantityAwarded: number;
};

export type AwardRejectionInput = {
  offerId: string;
  reason: string;
};

export type AwardValidationInput = {
  quotationStatus: string;
  currency: string;
  mode: AwardMode;
  justification: string;
  finalRoundId: string | null | undefined;
  hasClosedRound: boolean;
  openRoundExists: boolean;
  demandItems: AwardDemandItem[];
  offerItems: AwardOfferItemRef[];
  allocations: AwardAllocationInput[];
  rejections: AwardRejectionInput[];
  activeEvidenceCount: number;
  exceptionJustification?: string | null;
  hasExceptionPermission?: boolean;
  todayIsoDate?: string; // YYYY-MM-DD
  existingPendingOrApprovedAward?: boolean;
};

export type AwardValidationResult = {
  usedEvidenceException: boolean;
  winnerOfferIds: string[];
  rejectedOfferIds: string[];
};

const AWARDABLE_STATUSES = new Set(["RECEBIDA", "VENCEDORA"]);

export function assertQuotationReadyForAward(status: string): void {
  if (status === "ADJUDICADA") {
    throw new QuotationAwardError("Cotação já adjudicada.", "ALREADY_AWARDED");
  }
  if (status === "CANCELADA" || status === "EXPIRADA") {
    throw new QuotationAwardError("Cotação bloqueada para adjudicação.", "QUOTATION_LOCKED");
  }
  if (status === "RASCUNHO") {
    throw new QuotationAwardError(
      "Cotação precisa estar concluída (enviada/em análise) antes da adjudicação.",
      "QUOTATION_NOT_READY"
    );
  }
}

export function assertAwardJustification(justification: string | null | undefined): string {
  const text = String(justification ?? "").trim();
  if (text.length < 10) {
    throw new QuotationAwardError(
      "Justificativa da adjudicação obrigatória (mín. 10 caracteres).",
      "JUSTIFICATION_REQUIRED"
    );
  }
  return text;
}

export function assertNoConflictingWinners(input: {
  mode: AwardMode;
  winnerOfferIds: string[];
}): void {
  const unique = [...new Set(input.winnerOfferIds)];
  if (unique.length === 0) {
    throw new QuotationAwardError("Informe ao menos um fornecedor vencedor.", "NO_WINNER");
  }
  if (input.mode === "SINGLE" && unique.length > 1) {
    throw new QuotationAwardError(
      "Modo SINGLE não permite múltiplos vencedores — use SPLIT para divisão.",
      "CONFLICTING_WINNERS"
    );
  }
}

export function validateAwardPackage(input: AwardValidationInput): AwardValidationResult {
  assertQuotationReadyForAward(input.quotationStatus);
  assertAwardJustification(input.justification);

  if (input.existingPendingOrApprovedAward) {
    throw new QuotationAwardError(
      "Já existe adjudicação pendente ou aprovada para esta cotação.",
      "AWARD_EXISTS"
    );
  }

  if (input.openRoundExists) {
    throw new QuotationAwardError(
      "Feche a rodada de negociação aberta antes de adjudicar.",
      "OPEN_ROUND"
    );
  }

  if (input.hasClosedRound && !input.finalRoundId) {
    throw new QuotationAwardError(
      "Informe a rodada final da negociação.",
      "FINAL_ROUND_REQUIRED"
    );
  }

  const reportEvidenceOk =
    input.activeEvidenceCount > 0 ||
    (Boolean(input.hasExceptionPermission) &&
      String(input.exceptionJustification ?? "").trim().length >= 10);
  if (!reportEvidenceOk) {
    throw new QuotationAwardError(
      "Evidência insuficiente para adjudicar (ou justificativa excepcional autorizada).",
      "EVIDENCE_REQUIRED"
    );
  }
  const usedEvidenceException =
    input.activeEvidenceCount <= 0 &&
    Boolean(input.hasExceptionPermission) &&
    String(input.exceptionJustification ?? "").trim().length >= 10;

  if (!input.allocations.length) {
    throw new QuotationAwardError("Informe alocações por item/quantidade.", "ALLOCATIONS_REQUIRED");
  }

  const offerByItem = new Map(
    input.offerItems.map((o) => [`${o.offerId}:${o.quotationItemId}`, o] as const)
  );
  const offerIds = new Set(input.offerItems.map((o) => o.offerId));
  const demandById = new Map(input.demandItems.map((d) => [d.quotationItemId, d] as const));
  const today = input.todayIsoDate ?? new Date().toISOString().slice(0, 10);

  const qtyByItem = new Map<string, number>();
  const winnerOfferIds = new Set<string>();

  for (const alloc of input.allocations) {
    if (!Number.isFinite(alloc.quantityAwarded) || alloc.quantityAwarded <= 0) {
      throw new QuotationAwardError("Quantidade adjudicada deve ser > 0.", "QTY_INVALID");
    }
    const ref = offerByItem.get(`${alloc.offerId}:${alloc.quotationItemId}`);
    if (!ref) {
      throw new QuotationAwardError(
        "Alocação aponta para oferta/item inexistente.",
        "ALLOCATION_UNKNOWN"
      );
    }
    if (!AWARDABLE_STATUSES.has(ref.offerStatus)) {
      throw new QuotationAwardError(
        `Oferta ${alloc.offerId} não está apta (status ${ref.offerStatus}).`,
        "OFFER_STATUS"
      );
    }
    if (!Number.isFinite(ref.unitPrice) || ref.unitPrice < 0) {
      throw new QuotationAwardError("Preço unitário inválido na adjudicação.", "PRICE_INVALID");
    }
    if (ref.currency.toUpperCase() !== input.currency.toUpperCase()) {
      throw new QuotationAwardError(
        `Moeda da oferta (${ref.currency}) incompatível com a cotação (${input.currency}).`,
        "CURRENCY_MISMATCH"
      );
    }
    if (ref.validityDate && ref.validityDate < today) {
      throw new QuotationAwardError(
        `Proposta com validade expirada (${ref.validityDate}).`,
        "VALIDITY_EXPIRED"
      );
    }
    if (ref.quantityOffered != null && alloc.quantityAwarded - ref.quantityOffered > 1e-9) {
      throw new QuotationAwardError(
        "Quantidade adjudicada excede quantidade ofertada.",
        "QTY_OVER_OFFERED"
      );
    }
    winnerOfferIds.add(alloc.offerId);
    qtyByItem.set(
      alloc.quotationItemId,
      (qtyByItem.get(alloc.quotationItemId) ?? 0) + alloc.quantityAwarded
    );
  }

  for (const demand of input.demandItems) {
    const awarded = qtyByItem.get(demand.quotationItemId) ?? 0;
    if (Math.abs(awarded - demand.quantityDemanded) > 1e-6) {
      throw new QuotationAwardError(
        `Quantidade atendida do item ${demand.quotationItemId} (${awarded}) ≠ demanda (${demand.quantityDemanded}).`,
        "QTY_MISMATCH"
      );
    }
  }

  // Impede alocar item inexistente na demanda
  for (const itemId of qtyByItem.keys()) {
    if (!demandById.has(itemId)) {
      throw new QuotationAwardError("Alocação para item fora da demanda.", "ITEM_UNKNOWN");
    }
  }

  assertNoConflictingWinners({
    mode: input.mode,
    winnerOfferIds: [...winnerOfferIds],
  });

  if (input.mode === "SPLIT" && winnerOfferIds.size < 2) {
    throw new QuotationAwardError(
      "Modo SPLIT exige ao menos dois fornecedores com quantidade.",
      "SPLIT_REQUIRES_MULTI"
    );
  }

  const rejectedOfferIds: string[] = [];
  const rejectionSet = new Set<string>();
  for (const rej of input.rejections) {
    const reason = String(rej.reason ?? "").trim();
    if (reason.length < 5) {
      throw new QuotationAwardError(
        "Motivo de rejeição obrigatório (mín. 5 caracteres).",
        "REJECTION_REASON"
      );
    }
    if (!offerIds.has(rej.offerId)) {
      throw new QuotationAwardError("Rejeição aponta para oferta inexistente.", "REJECTION_UNKNOWN");
    }
    if (winnerOfferIds.has(rej.offerId)) {
      throw new QuotationAwardError(
        "Fornecedor não pode ser vencedor e rejeitado ao mesmo tempo.",
        "WINNER_AND_REJECTED"
      );
    }
    if (rejectionSet.has(rej.offerId)) {
      throw new QuotationAwardError("Rejeição duplicada para o mesmo fornecedor.", "REJECTION_DUP");
    }
    rejectionSet.add(rej.offerId);
    rejectedOfferIds.push(rej.offerId);
  }

  return {
    usedEvidenceException,
    winnerOfferIds: [...winnerOfferIds],
    rejectedOfferIds,
  };
}

export function computeAwardGainSnapshot(input: {
  initialComparableTotal: number;
  awardedComparableTotal: number;
}): { totalGain: number; percentGain: number | null } {
  const totalGain = input.initialComparableTotal - input.awardedComparableTotal;
  const percentGain =
    Math.abs(input.initialComparableTotal) < 1e-9
      ? null
      : (totalGain / input.initialComparableTotal) * 100;
  return { totalGain, percentGain };
}
