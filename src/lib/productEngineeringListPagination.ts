/**
 * Paginação da grade Engenharia > Produtos e Componentes.
 *
 * REGRA CENTRAL: a paginação é a ÚLTIMA etapa. Busca e filtros rodam sobre a
 * lista inteira (o backend devolve todos os itens do segmento) e só o
 * resultado JÁ filtrado é fatiado em páginas. É por isso que procurar um item
 * encontra ele mesmo que esteja "na página 7" — não existe busca por página.
 */

export const PRODUCT_ENGINEERING_PAGE_SIZE = 20;

export type ProductEngineeringPagination = {
  page: number;
  pageSize: number;
  /** Total de itens APÓS busca/filtros — nunca o total bruto da base. */
  total: number;
  totalPages: number;
};

export function buildProductEngineeringPagination(
  total: number,
  page: number,
  pageSize: number = PRODUCT_ENGINEERING_PAGE_SIZE
): ProductEngineeringPagination {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.trunc(total) : 0;
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.trunc(pageSize) : PRODUCT_ENGINEERING_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(safeTotal / safeSize));
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  // Página fora do intervalo é grampeada: filtrar até sobrar 3 itens enquanto
  // se está na página 5 não pode devolver tela vazia.
  const safePage = Math.min(Math.max(1, requested), totalPages);
  return { page: safePage, pageSize: safeSize, total: safeTotal, totalPages };
}

export function paginateProductEngineeringItems<T>(
  items: readonly T[],
  pagination: ProductEngineeringPagination
): T[] {
  const start = (pagination.page - 1) * pagination.pageSize;
  return items.slice(start, start + pagination.pageSize);
}

/** Rodapé: "Exibindo 1–20 de 137 item(ns) · Página 1 de 7". */
export function formatProductEngineeringDisplayRange(
  pagination: ProductEngineeringPagination,
  totalUnfiltered: number
): string {
  if (pagination.total === 0) {
    return `Exibindo 0 de ${totalUnfiltered} item(ns).`;
  }
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const range = pagination.total <= pagination.pageSize ? `${pagination.total}` : `${from}–${to} de ${pagination.total}`;
  const filteredPart =
    pagination.total === totalUnfiltered ? "" : ` (filtrado de ${totalUnfiltered})`;
  const pagePart =
    pagination.totalPages > 1 ? ` · Página ${pagination.page} de ${pagination.totalPages}` : "";
  return `Exibindo ${range} item(ns)${filteredPart}${pagePart}.`;
}

export function shouldShowProductEngineeringPagination(totalPages: number): boolean {
  return totalPages > 1;
}
