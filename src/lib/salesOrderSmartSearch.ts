/**
 * Busca inteligente de Pedidos de Venda (helper puro, sem Prisma).
 *
 * Permite encontrar um pedido exibido como `PD 02682` digitando `02682`,
 * `2682`, `PD 02682` ou `PD02682`, além de pesquisar por cliente, vendedor,
 * empresa, NF e itens. A normalização gera tokens que o backend usa em um
 * `OR` com `contains` (case-insensitive) sobre campos reais do schema.
 *
 * Esta camada é pura para poder ser testada isoladamente e reutilizada tanto no
 * backend quanto em verificações, sem puxar `@prisma/client` para o bundle.
 */

/** Remove acentos/diacríticos (best-effort para cliente/vendedor). */
export function removeSearchAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Termo normalizado para busca textual (cliente, vendedor, empresa, itens):
 * - remove espaços nas pontas;
 * - colapsa espaços internos repetidos.
 * Mantém o texto original (a comparação no banco é case-insensitive).
 */
export function normalizeSalesOrderSearchTerm(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Tokens de código/numéricos para casar com `orderCode`, `externalSalesOrderCode`
 * e número de NF, tolerando prefixo `PD`, espaços e zeros à esquerda.
 *
 * Exemplos:
 * - "PD 02682" → ["pd 02682", "pd02682", "02682", "2682"]
 * - "PD02682"  → ["pd02682", "02682", "2682"]
 * - "02682"    → ["02682", "2682"]
 * - "Maria"    → ["maria"]  (sem dígitos; usado só em campos de código por contains)
 */
export function buildSalesOrderSearchCodeTokens(value: unknown): string[] {
  const term = normalizeSalesOrderSearchTerm(value);
  if (!term) return [];

  const tokens = new Set<string>();
  const lower = removeSearchAccents(term.toLowerCase());

  tokens.add(lower);

  const noSpaces = lower.replace(/\s+/g, "");
  if (noSpaces) tokens.add(noSpaces);

  const digits = lower.replace(/\D+/g, "");
  if (digits) {
    tokens.add(digits);
    const noLeadingZeros = digits.replace(/^0+/, "");
    if (noLeadingZeros && noLeadingZeros !== digits) tokens.add(noLeadingZeros);
  }

  return [...tokens].filter((token) => token.length > 0);
}

/** Há termo de busca utilizável? */
export function hasSalesOrderSearchTerm(value: unknown): boolean {
  return normalizeSalesOrderSearchTerm(value).length > 0;
}
