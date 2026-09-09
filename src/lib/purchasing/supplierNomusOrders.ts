/**
 * Pedidos Nomus de UM fornecedor na aba Desempenho — contrato browser-safe.
 *
 * Identidade (mesma ordem do resolvedor oficial `resolvePurchaseOrderSupplier`):
 *   1. alias `FinancialSupplierAlias.externalSupplierId` exclusivo do fornecedor;
 *   2. documento normalizado exato quando só UM `FinancialSupplier` o possui;
 *   3. nunca por nome; nunca com confiança FALLBACK/UNRESOLVED; conflito
 *      (externalSupplierId aliasado também a outro fornecedor, documento
 *      duplicado) → o pedido NÃO é mostrado como deste fornecedor.
 *
 * `PurchaseOrder` (IndusCost) e `NomusPurchaseOrder` não têm chave
 * determinística entre si: as duas origens ficam distinguíveis pelo selo
 * "Origem" e NÃO se somam — não existe nota consolidada única.
 */

import type { NomusSupplierEvaluationWorklistRow } from "./nomusPurchaseOrderEvaluation";
import type { SupplierPerformancePeriod, SupplierPerformanceSummaryDto } from "./supplierPerformance";

export const SUPPLIER_ORDER_ORIGINS = {
  INTERNAL: "INTERNAL",
  NOMUS: "NOMUS",
} as const;

export type SupplierOrderOrigin = (typeof SUPPLIER_ORDER_ORIGINS)[keyof typeof SUPPLIER_ORDER_ORIGINS];

export const SUPPLIER_ORDER_ORIGIN_LABELS: Record<SupplierOrderOrigin, string> = {
  INTERNAL: "IndusCost",
  NOMUS: "Nomus",
};

export const SUPPLIER_ORDERS_NO_CONSOLIDATED_SCORE_NOTE =
  "Pedidos IndusCost e Pedidos Nomus são origens distintas, sem chave entre si: cada uma tem a sua nota e elas não se somam em uma nota consolidada única.";

export const SUPPLIER_NOMUS_ORDERS_UNMATCHABLE_LABEL =
  "Sem chave segura para atribuir Pedidos Nomus a este fornecedor (nenhum alias Nomus exclusivo e nenhum CNPJ único no cadastro).";

export type SupplierNomusOrdersIdentityDto = {
  /** externalSupplierId aliasados EXCLUSIVAMENTE a este fornecedor (chave 1). */
  aliasExternalIds: number[];
  /** externalSupplierId aliasados também a outro fornecedor — conflito, excluídos. */
  ambiguousExternalIds: number[];
  /** Documento normalizado do cadastro (chave 2), quando existe. */
  normalizedDocument: string | null;
  /** true quando exatamente UM FinancialSupplier possui o documento. */
  documentUnique: boolean;
  /** Quantos FinancialSupplier possuem o documento (>1 = duplicado → chave 2 desligada). */
  documentOwners: number;
  /** Alguma chave segura existe (alias exclusivo ou documento único). */
  matchable: boolean;
  /** Linhas da página descartadas porque o resolvedor oficial não as atribuiu a este fornecedor (esperado 0). */
  excludedOnPage: number;
};

export type SupplierNomusOrdersDetailResponse = {
  supplier: { id: string; name: string; document: string | null; status: string };
  period: SupplierPerformancePeriod;
  identity: SupplierNomusOrdersIdentityDto;
  scaleMin: number;
  scaleMax: number;
  /** KPIs SÓ dos Pedidos Nomus deste fornecedor no período (não consolida com PurchaseOrder). */
  kpis: SupplierPerformanceSummaryDto;
  orders: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    items: NomusSupplierEvaluationWorklistRow[];
  };
};

/**
 * Grafias do documento aceitas no `supplierTaxId` do espelho Nomus: dígitos e a
 * máscara padrão (CNPJ 00.000.000/0000-00, CPF 000.000.000-00). Igualdade
 * exata usa o índice de `supplierTaxId`; outras grafias ficam para a chave 1.
 */
export function buildSupplierDocumentTaxIdVariants(normalizedDocument: string | null): string[] {
  const digits = (normalizedDocument ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const variants = new Set<string>([digits]);
  if (digits.length === 14) {
    variants.add(
      `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
    );
  } else if (digits.length === 11) {
    variants.add(
      `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    );
  }
  return [...variants];
}

/** Só linhas atribuídas a ESTE fornecedor com identidade segura (EXACT/HIGH + id) entram na aba. */
export function isNomusOrderRowAttributableToSupplier(
  row: Pick<NomusSupplierEvaluationWorklistRow, "supplier">,
  supplierId: string
): boolean {
  return row.supplier.identitySafe && row.supplier.financialSupplierId === supplierId;
}

/** Rótulo curto do método de identidade para o selo da linha. */
export function describeNomusOrderIdentityMethod(matchMethod: string): string {
  switch (matchMethod) {
    case "SUPPLIER_ALIAS":
      return "Alias Nomus";
    case "SUPPLIER_DOCUMENT":
      return "CNPJ exato";
    case "SUPPLIER_AP_IDENTITY":
      return "Identidade AP";
    case "NAME_FALLBACK":
      return "Nome (inseguro)";
    default:
      return "Não resolvido";
  }
}
