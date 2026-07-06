/**
 * Semântica oficial: SalesOrderItem.unitCost = preço unitário de venda Nomus (valor comercial do pedido).
 * NÃO é custo de produção industrial. Margem usa getProductCostAnalysis / tabela vigente (futuro).
 *
 * Dívida técnica: coluna Prisma ainda se chama `unitCost` — renomear exige migration autorizada.
 */

export const SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE =
  "SalesOrderItem.unitCost espelha preço unitário comercial Nomus — não é custo de produção IndusCost." as const;

export const SALES_ORDER_PRODUCTION_COST_SOURCE_NOTE =
  "Custo de produção resolvido pela tabela oficial versionada IndusCost (productId + data do pedido)." as const;

export type SalesOrderCostSemanticsClassification =
  | "PRECO_VENDA"
  | "CUSTO_PRODUÇÃO"
  | "AMBIGUO";

export type SalesOrderCostSemanticsStatus = "OK" | "ALERTA" | "BLOQUEANTE";

export type SalesOrderCostSemanticsFinding = {
  file: string;
  line: number;
  snippet: string;
  usage: string;
  classification: SalesOrderCostSemanticsClassification;
  status: SalesOrderCostSemanticsStatus;
};

/** Padrões que indicam uso indevido de unitCost como custo de produção. */
export const BLOCKING_UNIT_COST_AS_PRODUCTION_PATTERNS: Array<{
  id: string;
  pattern: RegExp;
  usage: string;
}> = [
  {
    id: "margin-resolver-frozen-unit-cost",
    pattern: /useFrozenUnitCostFirst[\s\S]{0,120}storedUnitCost|storedSnapshot[\s\S]{0,80}SALES_ORDER_ITEM_SNAPSHOT/,
    usage: "Margem prioriza SalesOrderItem.unitCost como custo congelado",
  },
  {
    id: "sync-preserve-unit-cost-production",
    pattern: /buildPreservationMapFromExistingItems|resolveSalesOrderItemUnitCostSnapshot|costsPreserved/,
    usage: "Sync preserva unitCost como snapshot de custo industrial",
  },
  {
    id: "backfill-apply-unit-cost",
    pattern: /backfill-sales-order-unit-cost-snapshot[\s\S]{0,200}mode=apply|--mode=apply/,
    usage: "Backfill pode gravar custo de produção em unitCost",
  },
  {
    id: "ui-frozen-unit-cost-label",
    pattern: /Priorizar SalesOrderItem\.unitCost \(custo congelado\)/,
    usage: "UI chama unitCost de custo congelado",
  },
  {
    id: "tooltip-frozen-unit-cost",
    pattern: /Custo congelado da linha do pedido|SALES_ORDER_ITEM_SNAPSHOT.*congelado/i,
    usage: "Tooltip/label trata unitCost Nomus como custo congelado",
  },
];

/** Arquivos isentos de alerta bloqueante (legado deprecado, auditoria, testes). */
export const COST_SEMANTICS_AUDIT_ALLOWLIST = new Set([
  "src/lib/salesOrderCostSemantics.ts",
  "scripts/audit-sales-order-cost-semantics.ts",
  "src/lib/salesOrderCostSemantics.test.ts",
  "src/lib/salesOrderNomusSyncCost.server.ts",
  "src/lib/salesOrderNomusSyncCost.test.ts",
  "scripts/backfill-sales-order-unit-cost-snapshot.ts",
  "scripts/audit-sales-order-unit-cost-snapshot.ts",
]);

export function classifyUnitCostFieldUsage(context: string): SalesOrderCostSemanticsClassification {
  const lower = context.toLowerCase();
  if (
    /negotiatedprice|preço.*venda|preco.*venda|valor.*comercial|valorunitario|preço unitário/i.test(
      context
    )
  ) {
    return "PRECO_VENDA";
  }
  if (
    /getproductcostanalysis|motor.*custo|cust.*produ|production.*cost|totalindustrialcost|costcalculationlog/i.test(
      lower
    )
  ) {
    return "CUSTO_PRODUÇÃO";
  }
  if (/unitCost|unitcost/i.test(context)) {
    return "AMBIGUO";
  }
  return "AMBIGUO";
}
