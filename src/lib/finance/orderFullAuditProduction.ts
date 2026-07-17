/**
 * Composição read-only de Ordens de Produção para a Auditoria 360º.
 * Reutiliza o evidence pack canônico do Fluxo — sem novo master.
 */

import type { SalesOrderFlowEvidencePack } from "@/src/lib/sales/salesOrderFlowEvidence.js";

export type OrderFullAuditProductionInconsistency = {
  code: string;
  detail: string;
};

export type OrderFullAuditProductionOrder = {
  id: string;
  externalId: number;
  status: string | null;
  plannedQuantity: number | null;
  /** Sempre null até contrato Nomus de produzido (OP-45). */
  producedQuantity: null;
  productCode: string | null;
  openedAt: string | null;
  closedAt: string | null;
  linkedQuantity: number | null;
  linkCount: number;
  isCurrentLink: boolean;
  inconsistencies: OrderFullAuditProductionInconsistency[];
  href: string;
};

export type OrderFullAuditProductionLink = {
  id: string;
  productionOrderId: string;
  productionOrderExternalId: number;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  externalSalesOrderId: number;
  externalSalesOrderItemId: number;
  linkedQuantity: number | null;
  isCurrent: boolean;
  linkKey: string;
};

export type OrderFullAuditProductionBlock = {
  productionOrders: OrderFullAuditProductionOrder[];
  productionLinks: OrderFullAuditProductionLink[];
  totals: {
    productionOrderCount: number;
    currentLinkCount: number;
    plannedQuantitySum: number | null;
    linkedQuantitySum: number | null;
  };
};

/**
 * Mapeia o pack de evidência do Fluxo para o DTO da Auditoria 360º.
 * Espelha a forma de `mapEvidenceProduction` do detalhe do Fluxo.
 */
export function mapOrderFullAuditProduction(
  pack: Pick<
    SalesOrderFlowEvidencePack,
    "productionOrders" | "productionLinks" | "linkConflicts"
  >
): OrderFullAuditProductionBlock {
  const conflicts = pack.linkConflicts.filter(
    (conflict) => conflict.code === "PRODUCTION_LINK_ITEM_MISMATCH"
  );

  const productionOrders: OrderFullAuditProductionOrder[] =
    pack.productionOrders.map((op) => {
      const links = pack.productionLinks.filter(
        (link) => link.productionOrderExternalId === op.externalId
      );
      const linkedQuantity = links.reduce(
        (sum, link) => sum + (link.linkedQuantity ?? 0),
        0
      );
      const opConflicts = conflicts.filter(
        (conflict) =>
          conflict.detail.includes(String(op.externalId)) ||
          links.some((link) => conflict.entityIds.includes(`oplink:${link.id}`))
      );
      return {
        id: op.id,
        externalId: op.externalId,
        status: op.status,
        plannedQuantity: op.plannedQuantity,
        producedQuantity: null,
        productCode: op.productCode,
        openedAt: op.openedAt,
        closedAt: op.closedAt,
        linkedQuantity: links.some((link) => link.linkedQuantity != null)
          ? linkedQuantity
          : null,
        linkCount: links.length,
        isCurrentLink: links.some((link) => link.isCurrent),
        inconsistencies: opConflicts.map((conflict) => ({
          code: conflict.code,
          detail: conflict.detail,
        })),
        href: `/production-orders?search=${encodeURIComponent(String(op.externalId))}`,
      };
    });

  const productionLinks: OrderFullAuditProductionLink[] =
    pack.productionLinks.map((link) => ({
      id: link.id,
      productionOrderId: link.productionOrderId,
      productionOrderExternalId: link.productionOrderExternalId,
      salesOrderId: link.salesOrderId,
      salesOrderItemId: link.salesOrderItemId,
      externalSalesOrderId: link.externalSalesOrderId,
      externalSalesOrderItemId: link.externalSalesOrderItemId,
      linkedQuantity: link.linkedQuantity,
      isCurrent: link.isCurrent,
      linkKey: link.linkKey,
    }));

  const plannedValues = productionOrders
    .map((op) => op.plannedQuantity)
    .filter((value): value is number => value != null && Number.isFinite(value));
  const linkedValues = productionOrders
    .map((op) => op.linkedQuantity)
    .filter((value): value is number => value != null && Number.isFinite(value));

  return {
    productionOrders,
    productionLinks,
    totals: {
      productionOrderCount: productionOrders.length,
      currentLinkCount: productionLinks.filter((link) => link.isCurrent).length,
      plannedQuantitySum:
        plannedValues.length > 0
          ? plannedValues.reduce((sum, value) => sum + value, 0)
          : null,
      linkedQuantitySum:
        linkedValues.length > 0
          ? linkedValues.reduce((sum, value) => sum + value, 0)
          : null,
    },
  };
}

export type OrderFullAuditProductionAlert = {
  code: string;
  severity: "medium" | "warning" | "info";
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
  category: "DELIVERY";
  entityType: string | null;
  entityId: string | null;
  reference: string | null;
  quantityImpact: number | null;
  alertDate: string | null;
  status: "OPEN";
  linkedTab: "productionOrders";
};

export function buildOrderFullAuditProductionAlerts(input: {
  salesOrderId: string;
  orderCode: string | null;
  activeItemIds: string[];
  production: OrderFullAuditProductionBlock;
}): OrderFullAuditProductionAlert[] {
  const alerts: OrderFullAuditProductionAlert[] = [];
  const linkedItemIds = new Set(
    input.production.productionLinks
      .map((link) => link.salesOrderItemId)
      .filter((id): id is string => Boolean(id))
  );
  const uncoveredActiveItems = input.activeItemIds.filter(
    (id) => !linkedItemIds.has(id)
  );

  if (
    input.activeItemIds.length > 0 &&
    input.production.productionOrders.length === 0
  ) {
    alerts.push({
      code: "ORDER_WITHOUT_PRODUCTION_ORDER",
      severity: "warning",
      title: "Pedido sem Ordem de Produção",
      description:
        "Há itens ativos no pedido sem Ordem de Produção vinculada no stage Nomus.",
      origin: "NomusProductionOrderSalesLink",
      action: "Revisar vínculos de OP no Nomus ou sincronizar produção.",
      financialImpact: null,
      category: "DELIVERY",
      entityType: "SalesOrder",
      entityId: input.salesOrderId,
      reference: input.orderCode,
      quantityImpact: null,
      alertDate: null,
      status: "OPEN",
      linkedTab: "productionOrders",
    });
  } else if (uncoveredActiveItems.length > 0) {
    alerts.push({
      code: "ACTIVE_ITEMS_WITHOUT_PRODUCTION_LINK",
      severity: "medium",
      title: "Itens ativos sem vínculo de OP",
      description: `${uncoveredActiveItems.length} item(ns) ativo(s) do pedido não possuem vínculo atual com Ordem de Produção.`,
      origin: "NomusProductionOrderSalesLink",
      action: "Conferir itens sem OP na aba Ordens de Produção.",
      financialImpact: null,
      category: "DELIVERY",
      entityType: "SalesOrderItem",
      entityId: uncoveredActiveItems[0] ?? null,
      reference: input.orderCode,
      quantityImpact: uncoveredActiveItems.length,
      alertDate: null,
      status: "OPEN",
      linkedTab: "productionOrders",
    });
  }

  for (const op of input.production.productionOrders) {
    if (op.inconsistencies.length === 0) continue;
    alerts.push({
      code: "PRODUCTION_LINK_ITEM_MISMATCH",
      severity: "warning",
      title: `Conflito de vínculo na OP ${op.externalId}`,
      description: op.inconsistencies.map((entry) => entry.detail).join(" · "),
      origin: "SalesOrderFlowEvidence.linkConflicts",
      action: "Auditar o vínculo item × OP no stage Nomus.",
      financialImpact: null,
      category: "DELIVERY",
      entityType: "NomusProductionOrder",
      entityId: op.id,
      reference: String(op.externalId),
      quantityImpact: null,
      alertDate: null,
      status: "OPEN",
      linkedTab: "productionOrders",
    });
  }

  return alerts;
}
