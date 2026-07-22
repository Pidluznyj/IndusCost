/**
 * Planejamento de compra em modo sombra (OP-25) — motor puro.
 * Apenas sugere necessidade líquida; não muta BOM/OP/custo/motores oficiais.
 *
 * necessidadeLiquida = max(0,
 *   demandaFutura + estoqueSeguranca - estoqueDisponivel - comprasConfirmadasNoPrazo)
 *
 * Compras atrasadas ou sem confirmação/data NÃO entram como disponibilidade segura.
 */

export type ShadowInboundPurchaseRef = {
  purchaseOrderId: string;
  purchaseOrderCode: string;
  purchaseOrderItemId: string;
  status: string;
  expectedDeliveryDate: string | null; // YYYY-MM-DD
  quantityRemaining: number;
};

export type ShadowMaterialPlanInput = {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  unit: string;
  /** Demanda futura agregada (explosão BOM × OPs no horizonte). */
  futureDemand: number;
  /** Estoque de segurança (alvo). */
  safetyStock: number;
  /** Saldo disponível no ledger SC. */
  availableStock: number;
  /** Compras confirmadas com data prevista dentro do horizonte e não atrasadas. */
  onTimeConfirmedPurchases: ShadowInboundPurchaseRef[];
  /** Excluídas da disponibilidade segura (atrasadas / sem data / não confirmadas). */
  excludedInbound: Array<ShadowInboundPurchaseRef & { exclusionReason: string }>;
  /** Fontes de demanda para explicabilidade. */
  demandSources: Array<{
    productionOrderId: string;
    productionOrderExternalId: number | null;
    productSku: string | null;
    productQty: number;
    bomQtyPerProduct: number;
    materialDemand: number;
  }>;
};

export type ShadowMaterialPlanResult = {
  materialId: string;
  materialCode: string;
  materialDescription: string;
  unit: string;
  futureDemand: number;
  safetyStock: number;
  availableStock: number;
  onTimeConfirmedQty: number;
  netNeed: number;
  suggestedOrderQty: number;
  formula: {
    expression: string;
    futureDemand: number;
    safetyStock: number;
    availableStock: number;
    onTimeConfirmedPurchases: number;
    netNeed: number;
  };
  explainability: {
    demandSources: ShadowMaterialPlanInput["demandSources"];
    onTimeConfirmedPurchases: ShadowInboundPurchaseRef[];
    excludedInbound: ShadowMaterialPlanInput["excludedInbound"];
    notes: string[];
  };
};

export type ShadowPlanningHorizon = {
  /** YYYY-MM-DD inclusive start (typically today). */
  from: string;
  /** YYYY-MM-DD inclusive end. */
  to: string;
};

function n(v: number | null | undefined): number {
  if (v == null) return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export function isPurchaseStatusConfirmedForInbound(status: string): boolean {
  return status === "CONFIRMADO" || status === "PARCIALMENTE_RECEBIDO";
}

/** Data prevista conta como "no prazo" se estiver no horizonte e não for anterior a `from`. */
export function isExpectedDeliveryOnTime(
  expectedDeliveryDate: string | null | undefined,
  horizon: ShadowPlanningHorizon
): boolean {
  if (!expectedDeliveryDate) return false;
  const d = expectedDeliveryDate.slice(0, 10);
  if (d < horizon.from) return false; // atrasada
  if (d > horizon.to) return false; // fora do horizonte
  return true;
}

export function classifyInboundPurchase(input: {
  status: string;
  expectedDeliveryDate: string | null;
  quantityRemaining: number;
  horizon: ShadowPlanningHorizon;
}): { safe: boolean; exclusionReason: string | null } {
  if (input.quantityRemaining <= 1e-9) {
    return { safe: false, exclusionReason: "Sem quantidade residual." };
  }
  if (!isPurchaseStatusConfirmedForInbound(input.status)) {
    return {
      safe: false,
      exclusionReason: "Pedido não confirmado — não é disponibilidade segura.",
    };
  }
  if (!input.expectedDeliveryDate) {
    return {
      safe: false,
      exclusionReason: "Sem data prevista de recebimento — não é disponibilidade segura.",
    };
  }
  const d = input.expectedDeliveryDate.slice(0, 10);
  if (d < input.horizon.from) {
    return {
      safe: false,
      exclusionReason: "Compra atrasada (data prevista anterior ao início do horizonte).",
    };
  }
  if (d > input.horizon.to) {
    return {
      safe: false,
      exclusionReason: "Recebimento previsto fora do horizonte de planejamento.",
    };
  }
  return { safe: true, exclusionReason: null };
}

export function computeShadowNetNeed(input: {
  futureDemand: number;
  safetyStock: number;
  availableStock: number;
  onTimeConfirmedQty: number;
}): { netNeed: number; expression: string } {
  const futureDemand = Math.max(0, n(input.futureDemand));
  const safetyStock = Math.max(0, n(input.safetyStock));
  const availableStock = Math.max(0, n(input.availableStock));
  const onTimeConfirmedQty = Math.max(0, n(input.onTimeConfirmedQty));
  const raw = futureDemand + safetyStock - availableStock - onTimeConfirmedQty;
  const netNeed = round6(Math.max(0, raw));
  return {
    netNeed,
    expression:
      "max(0, demandaFutura + estoqueSeguranca - estoqueDisponivel - comprasConfirmadasNoPrazo)",
  };
}

export function buildShadowMaterialPlan(input: ShadowMaterialPlanInput): ShadowMaterialPlanResult {
  const onTimeConfirmedQty = round6(
    input.onTimeConfirmedPurchases.reduce((s, p) => s + Math.max(0, n(p.quantityRemaining)), 0)
  );
  const futureDemand = round6(Math.max(0, n(input.futureDemand)));
  const safetyStock = round6(Math.max(0, n(input.safetyStock)));
  const availableStock = round6(Math.max(0, n(input.availableStock)));
  const { netNeed, expression } = computeShadowNetNeed({
    futureDemand,
    safetyStock,
    availableStock,
    onTimeConfirmedQty,
  });

  const notes: string[] = [
    "Modo sombra: apenas sugestão — não altera BOM, OP, custo ou motores oficiais.",
    "Compras atrasadas ou sem confirmação/data não reduzem a necessidade líquida.",
  ];
  if (input.excludedInbound.length > 0) {
    notes.push(
      `${input.excludedInbound.length} compra(s) excluída(s) da disponibilidade segura (atraso/sem confirmação/sem data/fora do horizonte).`
    );
  }
  if (netNeed <= 0) {
    notes.push("Necessidade líquida zero — sem sugestão de compra neste horizonte.");
  }

  return {
    materialId: input.materialId,
    materialCode: input.materialCode,
    materialDescription: input.materialDescription,
    unit: input.unit,
    futureDemand,
    safetyStock,
    availableStock,
    onTimeConfirmedQty,
    netNeed,
    suggestedOrderQty: netNeed,
    formula: {
      expression,
      futureDemand,
      safetyStock,
      availableStock,
      onTimeConfirmedPurchases: onTimeConfirmedQty,
      netNeed,
    },
    explainability: {
      demandSources: input.demandSources,
      onTimeConfirmedPurchases: input.onTimeConfirmedPurchases,
      excludedInbound: input.excludedInbound,
      notes,
    },
  };
}

/** Explosão BOM nível material: qtyProduto × qtyBOM (sem perda — loss fica para evolução). */
export function explodeMaterialDemand(input: {
  productQty: number;
  bomQuantityPerProduct: number;
}): number {
  return round6(Math.max(0, n(input.productQty)) * Math.max(0, n(input.bomQuantityPerProduct)));
}
