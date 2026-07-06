/**
 * Helper puro e compartilhado para montar a query dos endpoints financeiros Nomus
 * (`contasPagar` e `contasReceber`), alinhado à chamada que funciona no Power BI.
 *
 * Parâmetros da chamada funcional do BI:
 *   pagina, tamanhoPagina=1000, dataInicio=01/01/2020, dataFim=31/12/2030,
 *   apenasPendentes=false, ordenacao=dataVencimento
 *
 * Sem dependência de Prisma/rede — seguro para importar em scripts e testes.
 */

export const NOMUS_FINANCIAL_DEFAULT_PAGE_SIZE = 1000;
export const NOMUS_FINANCIAL_DEFAULT_START_DATE = "01/01/2020";
export const NOMUS_FINANCIAL_DEFAULT_END_DATE = "31/12/2030";
export const NOMUS_FINANCIAL_DEFAULT_ONLY_PENDING = "false";
export const NOMUS_FINANCIAL_DEFAULT_ORDER_BY = "dataVencimento";

export type NomusFinancialQueryEnv = {
  NOMUS_PAGE_SIZE?: string;
  NOMUS_FINANCIAL_PAGE_SIZE?: string;
  NOMUS_FINANCIAL_START_DATE?: string;
  NOMUS_FINANCIAL_END_DATE?: string;
  NOMUS_FINANCIAL_ONLY_PENDING?: string;
  NOMUS_FINANCIAL_ORDER_BY?: string;
};

function parsePositiveInt(value: string | undefined): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * Prioridade do tamanho de página financeiro:
 * 1. NOMUS_FINANCIAL_PAGE_SIZE
 * 2. NOMUS_PAGE_SIZE
 * 3. NOMUS_FINANCIAL_DEFAULT_PAGE_SIZE (1000)
 */
export function resolveNomusFinancialPageSize(
  env: NomusFinancialQueryEnv = process.env
): number {
  return (
    parsePositiveInt(env.NOMUS_FINANCIAL_PAGE_SIZE) ??
    parsePositiveInt(env.NOMUS_PAGE_SIZE) ??
    NOMUS_FINANCIAL_DEFAULT_PAGE_SIZE
  );
}

/** Valida data no formato dd/MM/yyyy (com checagem de calendário). */
export function isValidNomusBrDate(value: string | undefined | null): boolean {
  if (!value) return false;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return false;
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function resolveDate(value: string | undefined, fallback: string, label: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  if (!isValidNomusBrDate(trimmed)) {
    throw new Error(
      `${label} inválida: "${trimmed}". Use o formato dd/MM/yyyy (ex.: ${fallback}).`
    );
  }
  return trimmed;
}

/**
 * Monta os parâmetros de página da API financeira Nomus.
 * Lança erro claro se as datas vierem em formato inválido (antes da chamada HTTP).
 */
export function buildNomusFinancialPageParams(
  page: number,
  pageSize: number,
  env: NomusFinancialQueryEnv = process.env
): Record<string, string> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.trunc(page) : 1;
  const safePageSize =
    Number.isFinite(pageSize) && pageSize >= 1
      ? Math.trunc(pageSize)
      : NOMUS_FINANCIAL_DEFAULT_PAGE_SIZE;

  return {
    pagina: String(safePage),
    tamanhoPagina: String(safePageSize),
    dataInicio: resolveDate(
      env.NOMUS_FINANCIAL_START_DATE,
      NOMUS_FINANCIAL_DEFAULT_START_DATE,
      "NOMUS_FINANCIAL_START_DATE"
    ),
    dataFim: resolveDate(
      env.NOMUS_FINANCIAL_END_DATE,
      NOMUS_FINANCIAL_DEFAULT_END_DATE,
      "NOMUS_FINANCIAL_END_DATE"
    ),
    apenasPendentes: (env.NOMUS_FINANCIAL_ONLY_PENDING || NOMUS_FINANCIAL_DEFAULT_ONLY_PENDING).trim(),
    ordenacao: (env.NOMUS_FINANCIAL_ORDER_BY || NOMUS_FINANCIAL_DEFAULT_ORDER_BY).trim(),
  };
}
