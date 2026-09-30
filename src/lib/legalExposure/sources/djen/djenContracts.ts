export type DjenSearchQuery = {
  nomeParte?: string;
  numeroProcesso?: string;
  pagina?: number;
  itensPorPagina?: number;
};

export const DJEN_EMPTY_QUERY_MESSAGE = "DJEN exige nomeParte ou numeroProcesso.";

export function hasDjenSearchFilter(query: {
  nomeParte?: string;
  numeroProcesso?: string;
}): boolean {
  return Boolean(query.nomeParte?.trim() || query.numeroProcesso?.trim());
}
