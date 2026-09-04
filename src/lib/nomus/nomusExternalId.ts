/**
 * PURCH-MIRROR-01 — normalização canônica de IDs externos Nomus.
 *
 * Função única e reutilizável (pedido de compra, item, fornecedor, produto).
 * Regras duras:
 *  - nunca perde valor (não arredonda, não trunca dígitos);
 *  - nunca transforma um id inválido em 0;
 *  - nunca remove zeros à esquerda de um código alfanumérico (só normaliza
 *    números puros — "007" numérico vira 7, mas isso é o valor real do
 *    Nomus, não um código de exibição);
 *  - nunca transforma null/undefined em a string "null"/"undefined".
 */

export type NormalizedNomusExternalId = {
  /** Forma canônica string (comparável entre Prisma/JSON/Number). */
  key: string;
  /** Forma numérica quando o valor é um inteiro válido; null caso contrário. */
  numeric: number | null;
  /** false quando o valor original era ausente/vazio/não numérico e não pôde ser normalizado. */
  valid: boolean;
};

const INVALID: NormalizedNomusExternalId = { key: "", numeric: null, valid: false };

/**
 * Normaliza um id externo Nomus (pode chegar como number, string numérica,
 * string com espaços, null ou undefined). Retorna sempre um objeto — nunca
 * lança. `valid: false` sinaliza ausência/id não numérico; o chamador decide
 * a política (nunca tratamos isso como "casar com 0" ou "casar com o primeiro").
 */
export function normalizeNomusExternalId(
  value: unknown
): NormalizedNomusExternalId {
  if (value === null || value === undefined) return { ...INVALID };

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { ...INVALID };
    // Preserva o valor exato mesmo se não for inteiro (não deveria ocorrer
    // para um id, mas não descartamos silenciosamente).
    if (!Number.isInteger(value)) {
      return { key: String(value), numeric: null, valid: true };
    }
    return { key: String(value), numeric: value, valid: true };
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return { ...INVALID };
    // Número puro (permite sinal, sem casas decimais) — normaliza zeros à
    // esquerda porque aqui representam o mesmo id numérico do Nomus.
    if (/^-?\d+$/.test(trimmed)) {
      const numeric = Number.parseInt(trimmed, 10);
      if (!Number.isFinite(numeric)) return { key: trimmed, numeric: null, valid: true };
      return { key: String(numeric), numeric, valid: true };
    }
    // Não numérico: preserva literalmente (código alfanumérico) — nunca
    // remove zeros nem tenta "parsear parcialmente".
    return { key: trimmed, numeric: null, valid: true };
  }

  return { ...INVALID };
}

/** Atalho: só a chave string comparável, ou null se inválido. */
export function normalizeNomusExternalIdKey(value: unknown): string | null {
  const normalized = normalizeNomusExternalId(value);
  return normalized.valid ? normalized.key : null;
}
