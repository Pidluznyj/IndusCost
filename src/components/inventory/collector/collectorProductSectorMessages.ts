/**
 * Mensagens do tablet para os setores de produto (Componentes / Produto
 * acabado). Módulo puro para teste sem DOM. "Matéria-prima" nunca aparece
 * aqui — as mensagens do setor de MP continuam em CollectorSectorPage.
 */
const PRODUCT_SECTOR_ITEM_NOUN: Record<string, string> = {
  COMPONENT: "componentes",
  FINISHED_PRODUCT: "produtos acabados",
};

export function isProductCollectorSectorCode(code: string | null | undefined): boolean {
  return Boolean(code && PRODUCT_SECTOR_ITEM_NOUN[code]);
}

/**
 * Sem cold-start de cadastro nesses setores: só itens de estoque já vinculados
 * a produto, com saldo ou almoxarifado padrão. itemsEligible === 0 distingue
 * "não há item" de "há item, mas nenhum almoxarifado com presença".
 */
export function productSectorOperationalMessage(input: {
  sectorCode: string;
  operationalState: string | null | undefined;
  itemsEligible?: number | null;
}): string | null {
  const noun = PRODUCT_SECTOR_ITEM_NOUN[input.sectorCode];
  if (!noun) return null;
  const state = input.operationalState;
  if (state === "CONFIGURATION_REQUIRED" || state === "NO_ELIGIBLE_ITEMS") {
    return input.itemsEligible === 0
      ? `Não há ${noun} elegíveis para inventário. O Collector conta itens de estoque ativos, vinculados a produto e com controle de estoque.`
      : `Nenhum almoxarifado com ${noun} para contar: os itens elegíveis não têm saldo nem almoxarifado padrão. Verifique o estoque.`;
  }
  if (state === "NEEDS_WAREHOUSE_SELECTION") {
    return "Selecione o almoxarifado para iniciar a contagem.";
  }
  return null;
}
