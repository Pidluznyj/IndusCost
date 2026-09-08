/**
 * Dono financeiro de um título de Contas a Pagar — autoridade PURA (sem Prisma).
 *
 * Cardinalidade financeira V1 do IndusCost:
 *
 *   Um título pode ter VÁRIAS evidências/candidatos de Pedido de Compra, mas,
 *   enquanto não existir rateio financeiro explícito (allocatedAmount), um
 *   título só pode ter UM dono financeiro:
 *
 *     FINANCIAL_OWNER(payableExternalId) ∈ { nenhum, exatamente um pedido }
 *
 *   Nunca { PO A, PO B }. Isso NÃO afirma que o Nomus imponha 1 título = 1
 *   pedido; é um invariante do IndusCost para impedir dupla contagem
 *   (R$ 10.000 reais virando R$ 20.000 atribuídos).
 *
 * Precedência:
 *   1. CONFIRMED_OWNER  — vínculo persistido (confirmação humana) vence qualquer
 *                         evidência automática de outro pedido.
 *   2. AUTO_SINGLE_OWNER — sem vínculo confirmado e evidência automática oficial
 *                         apontando para UM único pedido (várias evidências para o
 *                         mesmo pedido não são conflito).
 *   3. AUTO_CONFLICT    — sem vínculo confirmado e evidências automáticas apontando
 *                         para mais de um pedido: NINGUÉM conta (contribuição 0 em
 *                         todos) até um humano confirmar. Nunca se escolhe o "mais
 *                         forte", o mais novo, o maior ou o primeiro encontrado.
 *   4. UNOWNED          — nenhuma evidência.
 *
 *   CONFIRMED_CONFLICT é defensivo: dois vínculos persistidos para o mesmo título
 *   não podem existir depois da unique global de payableExternalId; se aparecerem
 *   (dado anterior à migration), ninguém conta e o dado deve ser auditado.
 *
 * O dono financeiro é definido pelos vínculos ATIVOS e pelas evidências atuais —
 * nunca pelo histórico. Desvincular libera o título para outro pedido.
 */

export type PayableClaimSource = "CONFIRMED" | "AUTOMATIC";

/** Uma evidência "pedido X reivindica o título Y" (persistida ou automática). */
export type PayableOwnershipClaim = {
  nomusPurchaseOrderId: string;
  payableExternalId: number;
  source: PayableClaimSource;
  /** Camada/método da evidência (informativo; não altera a precedência). */
  method?: string | null;
};

export type PayableFinancialOwnershipKind =
  | "CONFIRMED_OWNER"
  | "AUTO_SINGLE_OWNER"
  | "AUTO_CONFLICT"
  | "CONFIRMED_CONFLICT"
  | "UNOWNED";

export type PayableFinancialOwnership = {
  payableExternalId: number;
  kind: PayableFinancialOwnershipKind;
  /** Pedido que conta o título financeiramente (null em conflito ou sem dono). */
  ownerOrderId: string | null;
  /** Pedidos com vínculo persistido (0 ou 1 após a unique global). */
  confirmedOrderIds: string[];
  /** Pedidos com evidência automática oficial (deduplicados). */
  automaticOrderIds: string[];
};

export type PayableFinancialOwnershipMap = ReadonlyMap<number, PayableFinancialOwnership>;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/**
 * Resolve o dono financeiro de cada título a partir de TODAS as evidências
 * conhecidas (de qualquer pedido). Determinístico e set-based: nenhuma consulta,
 * nenhuma escolha por força/recência/valor.
 */
export function resolvePayableFinancialOwnership(
  claims: readonly PayableOwnershipClaim[]
): Map<number, PayableFinancialOwnership> {
  const confirmedByPayable = new Map<number, Set<string>>();
  const automaticByPayable = new Map<number, Set<string>>();
  for (const claim of claims) {
    const bucket = claim.source === "CONFIRMED" ? confirmedByPayable : automaticByPayable;
    const set = bucket.get(claim.payableExternalId) ?? new Set<string>();
    set.add(claim.nomusPurchaseOrderId);
    bucket.set(claim.payableExternalId, set);
  }

  const payableIds = new Set<number>([...confirmedByPayable.keys(), ...automaticByPayable.keys()]);
  const result = new Map<number, PayableFinancialOwnership>();
  for (const payableExternalId of [...payableIds].sort((a, b) => a - b)) {
    const confirmedOrderIds = uniqueSorted(confirmedByPayable.get(payableExternalId) ?? []);
    const automaticOrderIds = uniqueSorted(automaticByPayable.get(payableExternalId) ?? []);
    let kind: PayableFinancialOwnershipKind;
    let ownerOrderId: string | null = null;
    if (confirmedOrderIds.length === 1) {
      kind = "CONFIRMED_OWNER";
      ownerOrderId = confirmedOrderIds[0];
    } else if (confirmedOrderIds.length > 1) {
      kind = "CONFIRMED_CONFLICT";
    } else if (automaticOrderIds.length === 1) {
      kind = "AUTO_SINGLE_OWNER";
      ownerOrderId = automaticOrderIds[0];
    } else if (automaticOrderIds.length > 1) {
      kind = "AUTO_CONFLICT";
    } else {
      kind = "UNOWNED";
    }
    result.set(payableExternalId, { payableExternalId, kind, ownerOrderId, confirmedOrderIds, automaticOrderIds });
  }
  return result;
}

/** Dono financeiro atual (null = nenhum ou conflito). */
export function financialOwnerOf(
  ownership: PayableFinancialOwnershipMap | null | undefined,
  payableExternalId: number
): string | null {
  return ownership?.get(payableExternalId)?.ownerOrderId ?? null;
}

/**
 * O título conta (vinculado/pago/aberto/quitado) para este pedido?
 * Sem mapa de ownership (chamador legado/puro), o título conta para o pedido
 * que o apresenta — comportamento anterior, usado apenas em testes puros.
 */
export function payableCountsForOrder(
  ownership: PayableFinancialOwnershipMap | null | undefined,
  payableExternalId: number,
  orderId: string
): boolean {
  if (!ownership) return true;
  const entry = ownership.get(payableExternalId);
  if (!entry) return true;
  return entry.ownerOrderId === orderId;
}

export function isPayableOwnershipConflict(kind: PayableFinancialOwnershipKind): boolean {
  return kind === "AUTO_CONFLICT" || kind === "CONFIRMED_CONFLICT";
}

/**
 * Contribuição financeira de um título em cada pedido — V1 sem rateio:
 * 0 em todos, ou 100% em exatamente um. Útil para provar o invariante
 * SUM(contribuição em todos os pedidos) <= valor canônico do título.
 */
export function distributePayableFinancialContribution(input: {
  ownership: PayableFinancialOwnershipMap;
  payableExternalId: number;
  amount: number;
  orderIds: readonly string[];
}): Map<string, number> {
  const owner = financialOwnerOf(input.ownership, input.payableExternalId);
  const out = new Map<string, number>();
  for (const orderId of input.orderIds) {
    out.set(orderId, owner != null && owner === orderId ? input.amount : 0);
  }
  return out;
}

export const PAYABLE_FINANCIAL_OWNERSHIP_LABELS: Record<PayableFinancialOwnershipKind, string> = {
  CONFIRMED_OWNER: "Dono financeiro confirmado",
  AUTO_SINGLE_OWNER: "Dono financeiro por evidência automática",
  AUTO_CONFLICT: "Conflito de vínculo — evidência em mais de um pedido",
  CONFIRMED_CONFLICT: "Conflito de vínculo — confirmado em mais de um pedido (auditar)",
  UNOWNED: "Sem dono financeiro",
};
