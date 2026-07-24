/**
 * Helpers puros — validação de fontes oficiais (drill-down).
 */

export const FINANCE_DRE_SOURCE_CHECK_IDS = [
  "receita_nfe",
  "deducoes_fiscais",
  "cmv_nfe_custo",
  "fretes_cc",
  "embalagens_cc",
  "admin_cc",
  "pessoal_cc",
  "financeiro_ir",
] as const;

export type FinanceDreSourceCheckId = (typeof FINANCE_DRE_SOURCE_CHECK_IDS)[number];

export function isFinanceDreSourceCheckId(value: string): value is FinanceDreSourceCheckId {
  return (FINANCE_DRE_SOURCE_CHECK_IDS as readonly string[]).includes(value);
}

export function financeDreSourceCheckLabel(checkId: FinanceDreSourceCheckId): string {
  switch (checkId) {
    case "receita_nfe":
      return "Receita bruta (NF-e)";
    case "deducoes_fiscais":
      return "Deduções fiscais";
    case "cmv_nfe_custo":
      return "CMV — lacunas de item/produto/custo";
    case "fretes_cc":
      return "Fretes (CC Logística/Expedição)";
    case "embalagens_cc":
      return "Embalagens (CC Embalagens)";
    case "admin_cc":
      return "Despesas administrativas / AP sem CC";
    case "pessoal_cc":
      return "Pessoal (fora do resultado)";
    case "financeiro_ir":
      return "Resultado financeiro + IR/CSLL estimado";
    default:
      return checkId;
  }
}

export function cmvGapKindLabel(
  kind: "missing_items" | "missing_product" | "missing_cost"
): string {
  switch (kind) {
    case "missing_items":
      return "NF-e sem itens";
    case "missing_product":
      return "Produto não resolvido";
    case "missing_cost":
      return "Sem custo vigente";
    default:
      return kind;
  }
}
