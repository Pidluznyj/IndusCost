/**
 * Classificação e rótulo de vendedor para telas/APIs de comissão.
 * Fonte oficial: CommissionRecord.commissionPersonId → CommissionPerson.name.
 */

export type CommissionSellerResolutionStatus =
  | "RESOLVED"
  | "BROKEN_COMMISSION_PERSON_REFERENCE"
  | "SELLER_UNRESOLVED"
  | "NO_SELLER";

export type CommissionSellerDisplaySource = "COMMISSION_PERSON" | "UNRESOLVED";

export type CommissionSellerDisplayDto = {
  id: string | null;
  name: string | null;
  nomusPersonId: number | null;
  resolutionStatus: CommissionSellerResolutionStatus;
  source: CommissionSellerDisplaySource;
  label: string;
};

export type CommissionSellerDisplayInput = {
  commissionPersonId?: string | null;
  commissionPerson?: {
    id: string;
    name: string;
    nomusPersonId?: number | null;
  } | null;
  nomusSellerId?: number | null;
};

export function resolveCommissionSellerDisplay(
  input: CommissionSellerDisplayInput
): CommissionSellerDisplayDto {
  const person = input.commissionPerson ?? null;
  const personId = person?.id ?? input.commissionPersonId ?? null;
  const personName = person?.name?.trim() ?? null;
  const nomusPersonId = person?.nomusPersonId ?? input.nomusSellerId ?? null;

  if (personId && personName) {
    return {
      id: personId,
      name: personName,
      nomusPersonId,
      resolutionStatus: "RESOLVED",
      source: "COMMISSION_PERSON",
      label: personName,
    };
  }

  if (personId && !personName) {
    return {
      id: personId,
      name: null,
      nomusPersonId,
      resolutionStatus: "BROKEN_COMMISSION_PERSON_REFERENCE",
      source: "UNRESOLVED",
      label: "Pessoa comissionada não encontrada",
    };
  }

  if (input.nomusSellerId != null) {
    return {
      id: null,
      name: null,
      nomusPersonId: input.nomusSellerId,
      resolutionStatus: "SELLER_UNRESOLVED",
      source: "UNRESOLVED",
      label: `Vendedor Nomus não mapeado: ID ${input.nomusSellerId}`,
    };
  }

  return {
    id: null,
    name: null,
    nomusPersonId: null,
    resolutionStatus: "NO_SELLER",
    source: "UNRESOLVED",
    label: "Sem vendedor no pedido Nomus",
  };
}

/** Verdadeiro quando a linha deve entrar em contadores/filtros de “sem vendedor”. */
export function isCommissionRecordWithoutResolvedSeller(
  input: CommissionSellerDisplayInput
): boolean {
  const status = resolveCommissionSellerDisplay(input).resolutionStatus;
  return status === "NO_SELLER" || status === "SELLER_UNRESOLVED";
}

export function commissionSellerDisplayLabel(
  seller: CommissionSellerDisplayDto
): string {
  if (seller.resolutionStatus === "RESOLVED" && seller.name) {
    return seller.name;
  }
  return seller.label;
}

export function buildCommissionSellerDisplayDto(
  input: CommissionSellerDisplayInput
): CommissionSellerDisplayDto {
  return resolveCommissionSellerDisplay(input);
}
