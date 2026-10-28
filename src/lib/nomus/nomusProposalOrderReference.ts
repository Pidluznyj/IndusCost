/**
 * Referência explícita entre Pedido de Venda e Proposta no payload do Nomus.
 *
 * ESTADO ATUAL (2026-10-28): nenhum campo confirmado. A API REST do Nomus não tem documentação pública da
 * relação proposta × pedido, e os campos lidos hoje pelos syncs (scripts/nomusSalesOrdersSyncV1.ts e
 * scripts/nomusProposalsSyncV1.ts) não incluem referência à proposta. Por isso a lista abaixo é VAZIA e o vínculo
 * explícito nunca é usado em produção até que a auditoria (docs/sales/proposal-sales-order-link.md, consulta
 * "chaves candidatas nos payloads") mostre, com dados reais, qual chave carrega a referência.
 *
 * Para habilitar: acrescente o campo comprovado aqui, com teste de contrato usando um payload real anonimizado.
 * Não acrescente nomes presumidos.
 */

/**
 * Chave no payload do PEDIDO que identifica a proposta de origem. (Se a auditoria mostrar a referência no payload
 * da proposta apontando para o pedido, o leitor reverso precisa ser implementado junto com o campo.)
 */
export type NomusProposalReferenceField = {
  /** Caminho no JSON do pedido (pontos para objetos aninhados). */
  path: string;
  /** O valor identifica a proposta pelo id numérico (Proposal.externalProposalId) ou pelo código. */
  identifies: "EXTERNAL_ID" | "CODE";
};

export const NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS: readonly NomusProposalReferenceField[] = Object.freeze([]);

export type NomusProposalReferenceValue = {
  field: string;
  identifies: "EXTERNAL_ID" | "CODE";
  value: string;
};

function readPath(payload: unknown, path: string): unknown {
  let cursor: unknown = payload;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function referenceValue(raw: unknown, identifies: "EXTERNAL_ID" | "CODE"): string | null {
  if (raw == null) return null;
  if (identifies === "EXTERNAL_ID") {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+\s*$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(n) && n > 0 ? String(n) : null;
  }
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

/**
 * Lê as referências explícitas do payload do pedido. Valores em campos diferentes são todos devolvidos: quem
 * resolve decide (e trata propostas diferentes como ambiguidade).
 */
export function extractNomusProposalReferences(
  pedido: unknown,
  fields: readonly NomusProposalReferenceField[] = NOMUS_CONFIRMED_PROPOSAL_REFERENCE_FIELDS
): NomusProposalReferenceValue[] {
  const out: NomusProposalReferenceValue[] = [];
  for (const field of fields) {
    const value = referenceValue(readPath(pedido, field.path), field.identifies);
    if (value != null) out.push({ field: field.path, identifies: field.identifies, value });
  }
  return out;
}

const CANDIDATE_KEY_PATTERN = /propost|orcament|cotac|quotation|proposal/i;

/**
 * Somente diagnóstico (relatório de reconciliação/auditoria): chaves de primeiro e segundo nível cujo nome sugere
 * referência à proposta. Nunca usado para decidir vínculo.
 */
export function listCandidateProposalReferenceKeys(payload: unknown): string[] {
  const keys = new Set<string>();
  const visit = (node: unknown, prefix: string, depth: number) => {
    if (!node || typeof node !== "object" || depth > 2) return;
    if (Array.isArray(node)) {
      for (const child of node.slice(0, 50)) visit(child, `${prefix}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (CANDIDATE_KEY_PATTERN.test(key)) keys.add(path);
      visit(child, path, depth + 1);
    }
  };
  visit(payload, "", 0);
  return [...keys].sort();
}
