/**
 * Planejamento de compra em modo sombra (OP-25) — agregação read-only.
 * Não muta BOM/OP/custo/Nomus/AP. Draft de SC só com ação humana explícita.
 */

import type { PrismaClient } from "@prisma/client";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";
import { computeQuantityPending } from "./purchaseReceiptWorkflow.js";
import {
  buildShadowMaterialPlan,
  classifyInboundPurchase,
  explodeMaterialDemand,
  type ShadowInboundPurchaseRef,
  type ShadowMaterialPlanResult,
  type ShadowPlanningHorizon,
} from "./shadowPurchasePlanningEngine.js";

export class ShadowPurchasePlanningError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "ShadowPurchasePlanningError";
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toYmd(d: Date | string | null | undefined): string | null {
  if (d == null) return null;
  if (typeof d === "string") return d.slice(0, 10);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayYmd(now = new Date()): string {
  return toYmd(now)!;
}

function addDaysYmd(fromYmd: string, days: number): string {
  const [y, m, d] = fromYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toYmd(dt)!;
}

const CLOSED_OP_STATUS_RE = /cancel|cancelad|encerr|fechad|conclu|finaliz|done|closed/i;

function isOpenProductionOrder(status: string | null | undefined, closedAt: Date | null): boolean {
  if (closedAt != null) return false;
  if (status && CLOSED_OP_STATUS_RE.test(status)) return false;
  return true;
}

type DemandAgg = {
  futureDemand: number;
  demandSources: ShadowMaterialPlanResult["explainability"]["demandSources"];
  materialCode: string;
  materialDescription: string;
  unit: string;
};

async function explodeBomToMaterials(
  reads: ReturnType<typeof createOfficialDataProviders>,
  productId: string,
  productQty: number,
  cache: Map<string, Awaited<ReturnType<typeof reads.productsBom.listBomByProductId>>>,
  depth = 0
): Promise<Array<{ materialId: string; bomQtyPerProduct: number }>> {
  if (depth > 12) return [];
  let bom = cache.get(productId);
  if (!bom) {
    bom = await reads.productsBom.listBomByProductId(productId);
    cache.set(productId, bom);
  }
  const out: Array<{ materialId: string; bomQtyPerProduct: number }> = [];
  for (const line of bom) {
    const qty = num(line.quantity);
    if (line.materialId) {
      out.push({ materialId: line.materialId, bomQtyPerProduct: qty });
    }
    if (line.childProductId) {
      const nested = await explodeBomToMaterials(
        reads,
        line.childProductId,
        1,
        cache,
        depth + 1
      );
      for (const n of nested) {
        out.push({
          materialId: n.materialId,
          bomQtyPerProduct: qty * n.bomQtyPerProduct,
        });
      }
    }
  }
  return out.map((r) => ({
    materialId: r.materialId,
    bomQtyPerProduct: r.bomQtyPerProduct * productQty,
  }));
}

export function resolveShadowPlanningHorizon(input?: {
  from?: string | null;
  to?: string | null;
  now?: Date;
}): ShadowPlanningHorizon {
  const now = input?.now ?? new Date();
  const from = (input?.from?.trim() || todayYmd(now)).slice(0, 10);
  const to = (input?.to?.trim() || addDaysYmd(from, 90)).slice(0, 10);
  if (to < from) {
    throw new ShadowPurchasePlanningError(
      "Horizonte inválido: data final anterior à inicial.",
      "INVALID_HORIZON"
    );
  }
  return { from, to };
}

export async function buildShadowPurchasePlan(
  prisma: PrismaClient,
  options: { from?: string | null; to?: string | null; now?: Date } = {}
): Promise<{
  horizon: ShadowPlanningHorizon;
  materials: ShadowMaterialPlanResult[];
  totals: {
    materialsWithNeed: number;
    totalNetNeedLines: number;
    openProductionOrdersConsidered: number;
    excludedInboundCount: number;
  };
  meta: {
    readOnly: true;
    mutatesBom: false;
    createsProductionOrder: false;
    createsPurchaseRequestAutomatically: false;
    updatesPublishedCost: false;
    writesOfficialEngines: false;
    featureFlag: "SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED";
  };
}> {
  const horizon = resolveShadowPlanningHorizon(options);
  const reads = createOfficialDataProviders(prisma);

  const ops = await prisma.nomusProductionOrder.findMany({
    where: { closedAt: null },
    select: {
      id: true,
      externalId: true,
      status: true,
      productCode: true,
      quantity: true,
      plannedAt: true,
      deliveryAt: true,
      closedAt: true,
    },
    orderBy: { lastSeenAt: "desc" },
    take: 500,
  });

  const demandByMaterial = new Map<string, DemandAgg>();
  const bomCache = new Map<
    string,
    Awaited<ReturnType<typeof reads.productsBom.listBomByProductId>>
  >();
  const productBySku = new Map<string, { id: string; sku: string } | null>();
  let openOpsConsidered = 0;

  for (const op of ops) {
    if (!isOpenProductionOrder(op.status, op.closedAt)) continue;
    const dateYmd = toYmd(op.plannedAt) ?? toYmd(op.deliveryAt);
    if (dateYmd != null && (dateYmd < horizon.from || dateYmd > horizon.to)) continue;
    // Sem data: inclui como demanda futura com fonte explícita (disponível oficialmente).
    const productQty = num(op.quantity);
    if (productQty <= 0) continue;
    const sku = op.productCode?.trim();
    if (!sku) continue;

    openOpsConsidered += 1;
    let product = productBySku.get(sku);
    if (product === undefined) {
      const found = await reads.productsBom.findProductBySku(sku);
      product = found ? { id: found.id, sku: found.sku } : null;
      productBySku.set(sku, product);
    }
    if (!product) continue;

    const exploded = await explodeBomToMaterials(reads, product.id, 1, bomCache);
    for (const line of exploded) {
      const materialDemand = explodeMaterialDemand({
        productQty,
        bomQuantityPerProduct: line.bomQtyPerProduct,
      });
      if (materialDemand <= 0) continue;
      const mat = await reads.materials.findById(line.materialId);
      if (!mat) continue;
      const prev = demandByMaterial.get(line.materialId) ?? {
        futureDemand: 0,
        demandSources: [],
        materialCode: mat.code,
        materialDescription: mat.description,
        unit: mat.unit,
      };
      prev.futureDemand += materialDemand;
      prev.demandSources.push({
        productionOrderId: op.id,
        productionOrderExternalId: op.externalId,
        productSku: sku,
        productQty,
        bomQtyPerProduct: line.bomQtyPerProduct,
        materialDemand,
      });
      demandByMaterial.set(line.materialId, prev);
    }
  }

  const materialIds = Array.from(demandByMaterial.keys());
  // Também incluir materiais com estoque de segurança / compras mesmo sem demanda OP? Escopo: foco em demanda.
  // Mantém só materiais com demanda futura neste horizonte.

  const stockByMaterial = new Map<string, { available: number; safety: number }>();
  if (materialIds.length > 0) {
    const items = await prisma.inventoryItem.findMany({
      where: {
        materialId: { in: materialIds },
        status: "ACTIVE",
        controlsStock: true,
      },
      select: {
        id: true,
        materialId: true,
        safetyStock: true,
        balances: { select: { availableQuantity: true } },
      },
    });
    for (const item of items) {
      if (!item.materialId) continue;
      const available = item.balances.reduce((s, b) => s + num(b.availableQuantity), 0);
      const safety = Math.max(0, num(item.safetyStock));
      const prev = stockByMaterial.get(item.materialId) ?? { available: 0, safety: 0 };
      prev.available += available;
      prev.safety = Math.max(prev.safety, safety);
      stockByMaterial.set(item.materialId, prev);
    }
  }

  const inboundByMaterial = new Map<
    string,
    {
      onTime: ShadowInboundPurchaseRef[];
      excluded: Array<ShadowInboundPurchaseRef & { exclusionReason: string }>;
    }
  >();

  if (materialIds.length > 0) {
    const poItems = await prisma.purchaseOrderItem.findMany({
      where: {
        materialId: { in: materialIds },
        purchaseOrder: {
          status: {
            in: [
              "RASCUNHO",
              "APROVADO",
              "EMITIDO",
              "ENVIADO",
              "CONFIRMADO",
              "PARCIALMENTE_RECEBIDO",
            ],
          },
        },
      },
      select: {
        id: true,
        materialId: true,
        quantityOrdered: true,
        purchaseOrder: {
          select: {
            id: true,
            code: true,
            status: true,
            expectedDeliveryDate: true,
          },
        },
        receiptItems: {
          where: { receipt: { status: "APROVADO" } },
          select: { quantityAccepted: true },
        },
      },
    });

    for (const item of poItems) {
      if (!item.materialId) continue;
      const accepted = item.receiptItems.reduce((s, r) => s + num(r.quantityAccepted), 0);
      const remaining = computeQuantityPending(num(item.quantityOrdered), accepted);
      if (remaining <= 0) continue;
      const ref: ShadowInboundPurchaseRef = {
        purchaseOrderId: item.purchaseOrder.id,
        purchaseOrderCode: item.purchaseOrder.code,
        purchaseOrderItemId: item.id,
        status: item.purchaseOrder.status,
        expectedDeliveryDate: toYmd(item.purchaseOrder.expectedDeliveryDate),
        quantityRemaining: remaining,
      };
      const classified = classifyInboundPurchase({
        status: ref.status,
        expectedDeliveryDate: ref.expectedDeliveryDate,
        quantityRemaining: ref.quantityRemaining,
        horizon,
      });
      const bucket = inboundByMaterial.get(item.materialId) ?? { onTime: [], excluded: [] };
      if (classified.safe) {
        bucket.onTime.push(ref);
      } else {
        bucket.excluded.push({
          ...ref,
          exclusionReason: classified.exclusionReason ?? "Excluída da disponibilidade segura.",
        });
      }
      inboundByMaterial.set(item.materialId, bucket);
    }
  }

  const materials: ShadowMaterialPlanResult[] = [];
  let excludedInboundCount = 0;

  for (const [materialId, demand] of Array.from(demandByMaterial.entries())) {
    const stock = stockByMaterial.get(materialId) ?? { available: 0, safety: 0 };
    const inbound = inboundByMaterial.get(materialId) ?? { onTime: [], excluded: [] };
    excludedInboundCount += inbound.excluded.length;
    materials.push(
      buildShadowMaterialPlan({
        materialId,
        materialCode: demand.materialCode,
        materialDescription: demand.materialDescription,
        unit: demand.unit,
        futureDemand: demand.futureDemand,
        safetyStock: stock.safety,
        availableStock: stock.available,
        onTimeConfirmedPurchases: inbound.onTime,
        excludedInbound: inbound.excluded,
        demandSources: demand.demandSources,
      })
    );
  }

  materials.sort((a, b) => b.netNeed - a.netNeed || a.materialCode.localeCompare(b.materialCode));

  return {
    horizon,
    materials,
    totals: {
      materialsWithNeed: materials.filter((m) => m.netNeed > 0).length,
      totalNetNeedLines: materials.length,
      openProductionOrdersConsidered: openOpsConsidered,
      excludedInboundCount,
    },
    meta: {
      readOnly: true,
      mutatesBom: false,
      createsProductionOrder: false,
      createsPurchaseRequestAutomatically: false,
      updatesPublishedCost: false,
      writesOfficialEngines: false,
      featureFlag: "SUPPLY_CHAIN_SHADOW_PLANNING_ENABLED",
    },
  };
}

export type CreateDraftFromShadowSuggestionInput = {
  /** Obrigatório e deve ser true — ação humana explícita. */
  confirmHumanAction: boolean;
  materialId: string;
  quantity: number;
  unit?: string;
  description?: string;
  requester: string;
  department: string;
  justification: string;
  defaultCostCenterId: string;
  desiredDate?: string | null;
  notes?: string | null;
  projectId?: string | null;
  actor?: { userId: string | null; userName: string | null };
};

/**
 * Cria rascunho de solicitação a partir de sugestão sombra.
 * Nunca é chamado automaticamente pelo motor de planejamento.
 */
export async function createDraftPurchaseRequestFromShadowSuggestion(
  prisma: PrismaClient,
  input: CreateDraftFromShadowSuggestionInput
) {
  if (input.confirmHumanAction !== true) {
    throw new ShadowPurchasePlanningError(
      "Criação de rascunho exige confirmação humana explícita (confirmHumanAction=true).",
      "HUMAN_CONFIRMATION_REQUIRED"
    );
  }
  const qty = num(input.quantity);
  if (qty <= 0) {
    throw new ShadowPurchasePlanningError("Quantidade sugerida inválida.", "INVALID_QTY");
  }
  if (!input.materialId?.trim()) {
    throw new ShadowPurchasePlanningError("materialId obrigatório.", "INVALID_MATERIAL");
  }
  if (!input.requester?.trim() || !input.department?.trim() || !input.justification?.trim()) {
    throw new ShadowPurchasePlanningError(
      "requester, department e justification são obrigatórios.",
      "INVALID_HEADER"
    );
  }
  if (!input.defaultCostCenterId?.trim()) {
    throw new ShadowPurchasePlanningError(
      "defaultCostCenterId obrigatório.",
      "INVALID_COST_CENTER"
    );
  }

  const reads = createOfficialDataProviders(prisma);
  const mat = await reads.materials.findById(input.materialId.trim());
  if (!mat) {
    throw new ShadowPurchasePlanningError("Matéria-prima oficial não encontrada.", "MATERIAL_NOT_FOUND");
  }
  const cc = await reads.opsCostCenters.findById(input.defaultCostCenterId.trim());
  if (!cc || !cc.isActive) {
    throw new ShadowPurchasePlanningError(
      "Centro de custo inválido ou inativo.",
      "INVALID_COST_CENTER"
    );
  }

  const { resolveOptionalProjectSnapshots } = await import("./purchaseRequestService.server.js");
  const projectSnap = await resolveOptionalProjectSnapshots(
    prisma,
    input.projectId?.trim() ? input.projectId.trim() : null
  );

  const description =
    input.description?.trim() || `${mat.code} — ${mat.description}`;
  const unit = input.unit?.trim() || mat.unit;
  const shadowNote =
    "Origem: planejamento de compra em modo sombra (sugestão). Sem alteração de BOM/OP/custo.";

  const created = await prisma.$transaction(async (tx) => {
    const header = await tx.purchaseRequest.create({
      data: {
        requester: input.requester.trim(),
        department: input.department.trim(),
        requestCategory: "MATERIA_PRIMA",
        priority: "NORMAL",
        status: "RASCUNHO",
        justification: input.justification.trim(),
        defaultCostCenterId: input.defaultCostCenterId.trim(),
        notes: [input.notes?.trim(), shadowNote].filter(Boolean).join("\n"),
        projectId: projectSnap.projectId,
        projectCodeSnapshot: projectSnap.projectCodeSnapshot,
        projectTitleSnapshot: projectSnap.projectTitleSnapshot,
        externalReference: null,
      },
    });

    await tx.purchaseRequestItem.create({
      data: {
        purchaseRequestId: header.id,
        lineType: "MATERIA_PRIMA",
        materialId: mat.id,
        description,
        quantity: qty,
        unit,
        costCenterId: input.defaultCostCenterId.trim(),
        desiredDate: input.desiredDate ? new Date(input.desiredDate) : null,
        notes: shadowNote,
        lineStatus: "ABERTA",
      },
    });

    await tx.purchaseRequestHistoryEvent.create({
      data: {
        purchaseRequestId: header.id,
        action: "CREATE",
        fromStatus: null,
        toStatus: "RASCUNHO",
        userId: input.actor?.userId ?? null,
        userName: input.actor?.userName ?? null,
        notes: "Rascunho criado a partir de sugestão do planejamento sombra (ação humana).",
      },
    });

    return tx.purchaseRequest.findUniqueOrThrow({
      where: { id: header.id },
      include: { items: true },
    });
  });

  return {
    purchaseRequest: created,
    meta: {
      createdFromShadowSuggestion: true,
      status: "RASCUNHO" as const,
      automaticCreation: false,
      mutatesBom: false,
      createsProductionOrder: false,
      updatesPublishedCost: false,
    },
  };
}

export function mapShadowPurchasePlanningError(e: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (e instanceof ShadowPurchasePlanningError) {
    const status =
      e.code === "HUMAN_CONFIRMATION_REQUIRED"
        ? 400
        : e.code === "MATERIAL_NOT_FOUND"
          ? 404
          : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  console.error("shadow purchase planning error:", e);
  return { status: 500, body: { error: "Erro no planejamento sombra." } };
}
