/**
 * Política oficial do vínculo Pedido de Venda → Proposta (SalesOrder.proposalId).
 *
 * Função pura: recebe o estado atual do vínculo e as evidências disponíveis e devolve a decisão. Quem grava
 * (sync de pedidos, reconciliação) usa `proposalSalesOrderLinkWriter.server.ts`.
 *
 * Prioridade das evidências:
 *   1. Referência explícita do Nomus (campo confirmado em src/lib/nomus/nomusProposalOrderReference.ts) com o
 *      mesmo cliente → CONFIRMED / NOMUS_REFERENCE.
 *   2. Vínculo já existente (MANUAL, INDUSCOST_GENERATED, NOMUS_REFERENCE, INFERRED_ITEMS ou LEGACY) é preservado.
 *   3. Inferência pelos itens só quando exatamente UMA proposta do mesmo cliente, emitida até a data do pedido,
 *      cobre todas as linhas que encontraram alguma proposta, e a vaga 1:1 da proposta está livre.
 *   4. Caso contrário o pedido fica sem vínculo, com o motivo (AMBIGUOUS / NO_EVIDENCE / CONFLICT).
 *
 * Garantias:
 *   - Nunca apaga um vínculo existente (nem quando a inferência fica ambígua ou some).
 *   - Nunca troca um vínculo existente: evidência divergente vira CONFLICT com `candidateProposalId`; a troca só
 *     acontece pela reconciliação com APPLY autorizado.
 *   - Nunca vincula proposta de outro cliente.
 *   - Cliente + produto sozinho não é prova: inferência fica INFERRED (nunca CONFIRMED).
 */

export type ProposalLinkSourceValue =
  | "NOMUS_REFERENCE"
  | "MANUAL"
  | "INDUSCOST_GENERATED"
  | "INFERRED_ITEMS"
  | "LEGACY";

export type ProposalLinkStatusValue = "CONFIRMED" | "INFERRED" | "AMBIGUOUS" | "NO_EVIDENCE" | "CONFLICT";

/** Origens que representam confirmação (documento do Nomus, pessoa ou geração pelo próprio IndusCost). */
export const CONFIRMED_PROPOSAL_LINK_SOURCES: ReadonlySet<ProposalLinkSourceValue> = new Set([
  "NOMUS_REFERENCE",
  "MANUAL",
  "INDUSCOST_GENERATED",
]);

export type ProposalLinkReason =
  | "EXPLICIT_REFERENCE"
  | "EXPLICIT_REFERENCE_MATCHES_CURRENT"
  | "EXPLICIT_REFERENCE_DIVERGES_FROM_CURRENT"
  | "EXPLICIT_REFERENCE_OTHER_CUSTOMER"
  | "EXPLICIT_REFERENCE_PROPOSAL_NOT_IMPORTED"
  | "EXPLICIT_REFERENCE_AMBIGUOUS"
  | "CURRENT_LINK_CONFIRMED"
  | "CURRENT_LINK_CORROBORATED_BY_ITEMS"
  | "CURRENT_LINK_PRESERVED_WITHOUT_CORROBORATION"
  | "CURRENT_LINK_OTHER_CUSTOMER"
  | "INFERENCE_DIVERGES_FROM_CURRENT"
  | "INFERRED_SINGLE_PROPOSAL"
  | "PROPOSAL_ALREADY_LINKED_TO_OTHER_ORDER"
  | "LINES_POINT_TO_DIFFERENT_PROPOSALS"
  | "MULTIPLE_PROPOSALS_MATCH"
  | "NO_PROPOSAL_WITH_ORDER_PRODUCTS"
  | "ORDER_WITHOUT_RESOLVED_LINES";

export type ProposalLinkCandidateInfo = {
  proposalId: string;
  customerId: string;
  /** Data comercial da proposta (Proposal.commercialDate). */
  commercialDate: Date | null;
};

export type ExplicitProposalReferenceResolution =
  | { kind: "NONE" }
  | { kind: "RESOLVED"; field: string; value: string; proposalId: string }
  | { kind: "UNRESOLVED"; field: string; value: string }
  | { kind: "AMBIGUOUS"; field: string; value: string; proposalIds: string[] };

export type ProposalLinkLineEvidence = {
  /** Identificação estável da linha no pedido (id do item Nomus ou sequência). */
  lineKey: string;
  productId: string;
  /** Propostas do MESMO cliente que contêm o produto da linha (antes do filtro de data). */
  candidateProposalIds: string[];
};

export type CurrentProposalLink = {
  proposalId: string | null;
  source: ProposalLinkSourceValue | null;
  status: ProposalLinkStatusValue | null;
};

export type ProposalLinkDecisionInput = {
  salesOrderId: string | null;
  orderCustomerId: string;
  orderIssueDate: Date | null;
  current: CurrentProposalLink;
  explicit: ExplicitProposalReferenceResolution;
  lines: ProposalLinkLineEvidence[];
  /** Informações das propostas citadas (atual, explícita e candidatas). */
  proposals: ReadonlyMap<string, ProposalLinkCandidateInfo>;
  /** Pedido que hoje ocupa a vaga 1:1 de cada proposta citada (ausente = livre). */
  slotOwnerByProposalId: ReadonlyMap<string, string>;
};

export type ProposalLinkEventKind = "LINKED" | "CONFIRMED" | "CONFLICT" | "STATUS";

export type ProposalLinkInference =
  | { kind: "NONE"; reason: "ORDER_WITHOUT_RESOLVED_LINES" | "NO_PROPOSAL_WITH_ORDER_PRODUCTS" }
  | { kind: "SINGLE"; proposalId: string }
  | { kind: "AMBIGUOUS"; reason: "LINES_POINT_TO_DIFFERENT_PROPOSALS" | "MULTIPLE_PROPOSALS_MATCH"; proposalIds: string[] };

export type ProposalLinkDecision = {
  /** Valor a gravar em SalesOrder.proposalId. Nunca difere do atual a não ser para preencher um vazio. */
  proposalId: string | null;
  source: ProposalLinkSourceValue | null;
  status: ProposalLinkStatusValue;
  reason: ProposalLinkReason;
  /** Proposta apontada pela evidência quando ela não foi aplicada (conflito, vaga ocupada). */
  candidateProposalId: string | null;
  inference: ProposalLinkInference;
  /** Evento a registrar; null quando nada mudou em relação ao estado atual. */
  eventKind: ProposalLinkEventKind | null;
  evidence: ProposalLinkEvidenceJson;
};

export type ProposalLinkEvidenceJson = {
  policyVersion: 1;
  reason: ProposalLinkReason;
  explicit: ExplicitProposalReferenceResolution;
  inference: ProposalLinkInference;
  candidateProposalId: string | null;
  matchedLines: number;
  unmatchedLines: number;
  lines: Array<{ lineKey: string; candidateProposalIds: string[]; excludedAfterOrderDate: string[] }>;
};

/** Tolerância para fuso/horário: proposta emitida até 1 dia depois da emissão do pedido ainda é aceita. */
const PROPOSAL_AFTER_ORDER_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function proposalPrecedesOrder(info: ProposalLinkCandidateInfo | undefined, orderIssueDate: Date | null): boolean {
  if (!info?.commercialDate || !orderIssueDate) return true;
  return info.commercialDate.getTime() <= orderIssueDate.getTime() + PROPOSAL_AFTER_ORDER_TOLERANCE_MS;
}

/**
 * Inferência pelos itens. Uma linha "encontra" propostas quando o produto dela aparece em propostas do mesmo
 * cliente emitidas até a data do pedido. A proposta inferida precisa estar em TODAS as linhas que encontraram
 * alguma proposta e ser a única nessa interseção.
 */
export function inferProposalFromLines(input: {
  orderCustomerId: string;
  orderIssueDate: Date | null;
  lines: ProposalLinkLineEvidence[];
  proposals: ReadonlyMap<string, ProposalLinkCandidateInfo>;
}): { inference: ProposalLinkInference; lines: ProposalLinkEvidenceJson["lines"] } {
  const evidenceLines: ProposalLinkEvidenceJson["lines"] = [];
  const matchedSets: Array<Set<string>> = [];

  for (const line of input.lines) {
    const kept: string[] = [];
    const excluded: string[] = [];
    for (const proposalId of [...new Set(line.candidateProposalIds)].sort()) {
      const info = input.proposals.get(proposalId);
      // Defesa: candidata de outro cliente nunca entra (o carregador já filtra pelo cliente).
      if (info && info.customerId !== input.orderCustomerId) continue;
      if (proposalPrecedesOrder(info, input.orderIssueDate)) kept.push(proposalId);
      else excluded.push(proposalId);
    }
    evidenceLines.push({ lineKey: line.lineKey, candidateProposalIds: kept, excludedAfterOrderDate: excluded });
    if (kept.length > 0) matchedSets.push(new Set(kept));
  }

  if (input.lines.length === 0) {
    return { inference: { kind: "NONE", reason: "ORDER_WITHOUT_RESOLVED_LINES" }, lines: evidenceLines };
  }
  if (matchedSets.length === 0) {
    return { inference: { kind: "NONE", reason: "NO_PROPOSAL_WITH_ORDER_PRODUCTS" }, lines: evidenceLines };
  }

  let intersection = [...matchedSets[0]!];
  for (const set of matchedSets.slice(1)) intersection = intersection.filter((id) => set.has(id));
  intersection.sort();

  if (intersection.length === 1) {
    return { inference: { kind: "SINGLE", proposalId: intersection[0]! }, lines: evidenceLines };
  }
  if (intersection.length === 0) {
    const union = [...new Set(matchedSets.flatMap((s) => [...s]))].sort();
    return {
      inference: { kind: "AMBIGUOUS", reason: "LINES_POINT_TO_DIFFERENT_PROPOSALS", proposalIds: union },
      lines: evidenceLines,
    };
  }
  return {
    inference: { kind: "AMBIGUOUS", reason: "MULTIPLE_PROPOSALS_MATCH", proposalIds: intersection },
    lines: evidenceLines,
  };
}

function slotTakenByOther(input: ProposalLinkDecisionInput, proposalId: string): boolean {
  const owner = input.slotOwnerByProposalId.get(proposalId);
  return owner != null && owner !== input.salesOrderId;
}

function eventKindFor(
  current: CurrentProposalLink,
  next: { proposalId: string | null; source: ProposalLinkSourceValue | null; status: ProposalLinkStatusValue }
): ProposalLinkEventKind | null {
  if (current.proposalId !== next.proposalId) return "LINKED";
  if (current.source === next.source && current.status === next.status) return null;
  // Primeira classificação de um pedido anterior a esta versão (sem origem nem situação gravadas) sem mudar o
  // vínculo: fica só na linha do pedido; evento apenas se já nascer em conflito.
  if (current.source == null && current.status == null && next.status !== "CONFLICT") return null;
  if (next.status === "CONFLICT") return "CONFLICT";
  if (next.status === "CONFIRMED") return "CONFIRMED";
  return "STATUS";
}

export function decideProposalSalesOrderLink(input: ProposalLinkDecisionInput): ProposalLinkDecision {
  const { current, explicit } = input;
  const inferred = inferProposalFromLines(input);
  const inference = inferred.inference;
  const matchedLines = inferred.lines.filter((l) => l.candidateProposalIds.length > 0).length;

  const finish = (next: {
    proposalId: string | null;
    source: ProposalLinkSourceValue | null;
    status: ProposalLinkStatusValue;
    reason: ProposalLinkReason;
    candidateProposalId?: string | null;
  }): ProposalLinkDecision => {
    const candidateProposalId = next.candidateProposalId ?? null;
    return {
      proposalId: next.proposalId,
      source: next.source,
      status: next.status,
      reason: next.reason,
      candidateProposalId,
      inference,
      eventKind: eventKindFor(current, next),
      evidence: {
        policyVersion: 1,
        reason: next.reason,
        explicit,
        inference,
        candidateProposalId,
        matchedLines,
        unmatchedLines: inferred.lines.length - matchedLines,
        lines: inferred.lines,
      },
    };
  };

  const currentId = current.proposalId;
  // Vínculo anterior a esta versão (sem origem registrada) é LEGADO: preservado, nunca tratado como confirmado.
  const currentSource: ProposalLinkSourceValue | null = currentId ? (current.source ?? "LEGACY") : null;
  const currentInfo = currentId ? input.proposals.get(currentId) : undefined;
  const currentIsConfirmed = currentSource != null && CONFIRMED_PROPOSAL_LINK_SOURCES.has(currentSource);
  const keep = (status: ProposalLinkStatusValue, reason: ProposalLinkReason, candidateProposalId?: string | null) =>
    finish({ proposalId: currentId, source: currentSource, status, reason, candidateProposalId });

  // Vínculo existente com proposta de outro cliente: preservado, mas sinalizado como conflito.
  if (currentId && currentInfo && currentInfo.customerId !== input.orderCustomerId) {
    return keep("CONFLICT", "CURRENT_LINK_OTHER_CUSTOMER");
  }

  // 1. Referência explícita do Nomus.
  if (explicit.kind === "RESOLVED") {
    const info = input.proposals.get(explicit.proposalId);
    if (!info || info.customerId !== input.orderCustomerId) {
      if (currentId) return keep("CONFLICT", "EXPLICIT_REFERENCE_OTHER_CUSTOMER", explicit.proposalId);
      return finish({
        proposalId: null,
        source: null,
        status: "CONFLICT",
        reason: "EXPLICIT_REFERENCE_OTHER_CUSTOMER",
        candidateProposalId: explicit.proposalId,
      });
    }
    if (currentId === explicit.proposalId) {
      // Confirmação: vínculo inferido/legado vira NOMUS_REFERENCE; manual/gerado mantém a origem.
      const source = currentSource === "MANUAL" || currentSource === "INDUSCOST_GENERATED" ? currentSource : "NOMUS_REFERENCE";
      return finish({ proposalId: currentId, source, status: "CONFIRMED", reason: "EXPLICIT_REFERENCE_MATCHES_CURRENT" });
    }
    if (currentId) return keep("CONFLICT", "EXPLICIT_REFERENCE_DIVERGES_FROM_CURRENT", explicit.proposalId);
    if (slotTakenByOther(input, explicit.proposalId)) {
      return finish({
        proposalId: null,
        source: null,
        status: "CONFLICT",
        reason: "PROPOSAL_ALREADY_LINKED_TO_OTHER_ORDER",
        candidateProposalId: explicit.proposalId,
      });
    }
    return finish({ proposalId: explicit.proposalId, source: "NOMUS_REFERENCE", status: "CONFIRMED", reason: "EXPLICIT_REFERENCE" });
  }

  // 2. Vínculo existente: preservado.
  if (currentId) {
    if (currentIsConfirmed) return keep("CONFIRMED", "CURRENT_LINK_CONFIRMED");
    if (inference.kind === "SINGLE" && inference.proposalId !== currentId) {
      return keep("CONFLICT", "INFERENCE_DIVERGES_FROM_CURRENT", inference.proposalId);
    }
    if (inference.kind === "SINGLE") return keep("INFERRED", "CURRENT_LINK_CORROBORATED_BY_ITEMS");
    return keep("INFERRED", "CURRENT_LINK_PRESERVED_WITHOUT_CORROBORATION");
  }

  // Referência explícita presente mas não resolvida: não inferir outra proposta por cima dela.
  if (explicit.kind === "UNRESOLVED") {
    return finish({ proposalId: null, source: null, status: "NO_EVIDENCE", reason: "EXPLICIT_REFERENCE_PROPOSAL_NOT_IMPORTED" });
  }
  if (explicit.kind === "AMBIGUOUS") {
    return finish({ proposalId: null, source: null, status: "AMBIGUOUS", reason: "EXPLICIT_REFERENCE_AMBIGUOUS" });
  }

  // 3. Inferência pelos itens.
  if (inference.kind === "NONE") {
    return finish({ proposalId: null, source: null, status: "NO_EVIDENCE", reason: inference.reason });
  }
  if (inference.kind === "AMBIGUOUS") {
    return finish({ proposalId: null, source: null, status: "AMBIGUOUS", reason: inference.reason });
  }
  if (slotTakenByOther(input, inference.proposalId)) {
    return finish({
      proposalId: null,
      source: null,
      status: "CONFLICT",
      reason: "PROPOSAL_ALREADY_LINKED_TO_OTHER_ORDER",
      candidateProposalId: inference.proposalId,
    });
  }
  return finish({ proposalId: inference.proposalId, source: "INFERRED_ITEMS", status: "INFERRED", reason: "INFERRED_SINGLE_PROPOSAL" });
}
