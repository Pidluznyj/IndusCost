/**
 * Agrega a estação operacional de Compras (OP-21).
 * Cards no backend; filtros aplicados antes da paginação.
 */
import type { PrismaClient } from "@prisma/client";
import {
  assertCardsDoNotDoubleCountPipeline,
  buildWorkstationCards,
  classifyPipelineStage,
  paginateRows,
  resolveExclusivePipelineStages,
  rowMatchesFilters,
  type PurchasingPipelineStage,
  type PurchasingWorkstationEntityKind,
  type PurchasingWorkstationFilters,
  type PurchasingWorkstationRowInput,
} from "./purchasingWorkstationEngine.js";

export type WorkstationQuery = PurchasingWorkstationFilters & {
  page?: number;
  pageSize?: number;
};

function dateIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function buildPurchasingWorkstation(
  prisma: PrismaClient,
  query: WorkstationQuery
) {
  const [requests, quotations, awards, orders, pendingApprovals, evidences] = await Promise.all([
    prisma.purchaseRequest.findMany({
      include: {
        items: { take: 3 },
        quotations: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.purchaseQuotation.findMany({
      include: {
        suppliers: { take: 1, orderBy: { invitedAt: "asc" } },
        items: { take: 1, orderBy: { lineNumber: "asc" } },
        rounds: { select: { id: true, status: true, roundNumber: true }, orderBy: { roundNumber: "desc" } },
        awards: { select: { id: true, status: true, totalGain: true }, orderBy: { submittedAt: "desc" } },
        purchaseOrders: { select: { id: true, status: true }, orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.purchaseQuotationAward.findMany({
      include: {
        quotation: { select: { id: true, code: true, purchaseRequestId: true } },
        allocations: { take: 1 },
      },
      orderBy: { submittedAt: "desc" },
      take: 300,
    }),
    prisma.purchaseOrder.findMany({
      include: {
        items: { take: 1, orderBy: { lineNumber: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
    prisma.purchaseApproval.findMany({
      where: { status: "PENDENTE" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.purchaseEvidence.findMany({
      where: { deletedAt: null },
      orderBy: { uploadedAt: "desc" },
      take: 200,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        originalFileName: true,
        uploadedByName: true,
        uploadedAt: true,
      },
    }),
  ]);

  const rows: PurchasingWorkstationRowInput[] = [];

  for (const req of requests) {
    const hasQuotation = req.quotations.length > 0 || req.status === "EM_COTACAO";
    const firstItem = req.items[0];
    rows.push({
      id: req.id,
      kind: "REQUEST",
      pipelineKey: req.id,
      status: req.status,
      title: `SC #${req.number} — ${req.justification.slice(0, 80)}`,
      responsible: req.requester,
      supplierId: null,
      supplierName: firstItem?.suggestedSupplier ?? null,
      materialId: firstItem?.materialId ?? null,
      materialCode: null,
      priority: req.priority,
      neededByDate: dateIso(firstItem?.desiredDate),
      createdAt: req.createdAt.toISOString(),
      href: `/purchases?requestId=${req.id}`,
      negotiatedGain: null,
      isPendingApproval: req.status === "AGUARDANDO_APROVACAO",
      signals: {
        hasQuotation,
        hasClosedRound: false,
        hasApprovedAward: false,
        purchaseOrderStatus: null,
      },
    });
  }

  // Enrich request signals from quotations/orders
  const requestSignalBoost = new Map<
    string,
    { hasClosedRound: boolean; hasApprovedAward: boolean; purchaseOrderStatus: string | null }
  >();

  for (const q of quotations) {
    const closed = q.rounds.some((r) => r.status === "FECHADA");
    const approvedAward = q.awards.some((a) => a.status === "APROVADA");
    const topPo = q.purchaseOrders[0]?.status ?? null;
    if (q.purchaseRequestId) {
      const prev = requestSignalBoost.get(q.purchaseRequestId) ?? {
        hasClosedRound: false,
        hasApprovedAward: false,
        purchaseOrderStatus: null,
      };
      requestSignalBoost.set(q.purchaseRequestId, {
        hasClosedRound: prev.hasClosedRound || closed,
        hasApprovedAward: prev.hasApprovedAward || approvedAward,
        purchaseOrderStatus: topPo || prev.purchaseOrderStatus,
      });
    }

    const supplier = q.suppliers[0];
    const item = q.items[0];
    const pipelineKey = q.purchaseRequestId || q.id;
    rows.push({
      id: q.id,
      kind: "QUOTATION",
      pipelineKey,
      status: q.status,
      title: `Cotação ${q.code}${q.title ? ` — ${q.title}` : ""}`,
      responsible: null,
      supplierId: supplier?.supplierId ?? null,
      supplierName: supplier?.supplierDisplayNameSnapshot ?? null,
      materialId: item?.materialId ?? null,
      materialCode: item?.materialCodeSnapshot ?? null,
      priority: null,
      neededByDate: dateIso(q.neededByDate),
      createdAt: q.createdAt.toISOString(),
      href: `/purchases/quotations/${q.id}`,
      negotiatedGain: null,
      isPendingApproval: false,
      signals: {
        hasQuotation: true,
        hasClosedRound: closed,
        hasApprovedAward: approvedAward,
        purchaseOrderStatus: topPo,
      },
    });

    for (const round of q.rounds.filter((r) => r.status === "FECHADA" || r.status === "ABERTA")) {
      rows.push({
        id: round.id,
        kind: "NEGOTIATION",
        pipelineKey,
        status: round.status,
        title: `Rodada #${round.roundNumber} — ${q.code}`,
        responsible: null,
        supplierId: supplier?.supplierId ?? null,
        supplierName: supplier?.supplierDisplayNameSnapshot ?? null,
        materialId: item?.materialId ?? null,
        materialCode: item?.materialCodeSnapshot ?? null,
        priority: null,
        neededByDate: dateIso(q.neededByDate),
        createdAt: q.createdAt.toISOString(),
        href: `/purchases/quotations/${q.id}/compare`,
        negotiatedGain: null,
        isPendingApproval: false,
        signals: {
          hasQuotation: true,
          hasClosedRound: round.status === "FECHADA",
          hasApprovedAward: approvedAward,
          purchaseOrderStatus: topPo,
        },
      });
    }
  }

  for (const award of awards) {
    const pipelineKey = award.quotation.purchaseRequestId || award.quotationId;
    const gain = num(award.totalGain);
    rows.push({
      id: award.id,
      kind: "APPROVAL",
      pipelineKey,
      status: award.status,
      title: `Adjudicação ${award.quotation.code}`,
      responsible: award.responsibleUserName,
      supplierId: award.allocations[0]?.supplierId ?? null,
      supplierName: award.allocations[0]?.supplierNameSnapshot ?? null,
      materialId: null,
      materialCode: null,
      priority: null,
      neededByDate: null,
      createdAt: award.submittedAt.toISOString(),
      href: `/purchases/quotations/${award.quotationId}/compare`,
      negotiatedGain: award.status === "APROVADA" ? gain : null,
      isPendingApproval: award.status === "PENDENTE_APROVACAO",
      signals: {
        hasQuotation: true,
        hasClosedRound: Boolean(award.finalRoundId),
        hasApprovedAward: award.status === "APROVADA",
        purchaseOrderStatus: null,
      },
    });
  }

  for (const po of orders) {
    const pipelineKey = po.purchaseRequestId || po.quotationId || po.id;
    const item = po.items[0];
    rows.push({
      id: po.id,
      kind: "PURCHASE_ORDER",
      pipelineKey,
      status: po.status,
      title: `Pedido ${po.code} — ${po.supplierDisplayNameSnapshot}`,
      responsible: po.createdByUserName || po.approvedByUserName,
      supplierId: po.supplierId,
      supplierName: po.supplierDisplayNameSnapshot,
      materialId: item?.materialId ?? null,
      materialCode: item?.materialCodeSnapshot ?? null,
      priority: null,
      neededByDate: dateIso(po.expectedDeliveryDate),
      createdAt: po.createdAt.toISOString(),
      href: `/purchases/orders/${po.id}`,
      negotiatedGain: num(po.totalGainSnapshot),
      isPendingApproval: po.status === "RASCUNHO",
      signals: {
        hasQuotation: Boolean(po.quotationId),
        hasClosedRound: Boolean(po.finalRoundId),
        hasApprovedAward: Boolean(po.awardId),
        purchaseOrderStatus: po.status,
      },
    });
  }

  for (const ap of pendingApprovals) {
    const pipelineKey =
      ap.purchaseRequestId || ap.quotationId || ap.purchaseOrderId || ap.id;
    rows.push({
      id: ap.id,
      kind: "APPROVAL",
      pipelineKey,
      status: ap.status,
      title: `Aprovação pendente (${ap.targetType})`,
      responsible: null,
      supplierId: null,
      supplierName: null,
      materialId: null,
      materialCode: null,
      priority: null,
      neededByDate: null,
      createdAt: ap.createdAt.toISOString(),
      href: ap.purchaseOrderId
        ? `/purchases/orders/${ap.purchaseOrderId}`
        : ap.quotationId
          ? `/purchases/quotations/${ap.quotationId}/compare`
          : "/purchases",
      negotiatedGain: null,
      isPendingApproval: true,
      signals: {
        hasQuotation: Boolean(ap.quotationId),
        hasClosedRound: false,
        hasApprovedAward: false,
        purchaseOrderStatus: null,
      },
    });
  }

  for (const ev of evidences) {
    rows.push({
      id: ev.id,
      kind: "EVIDENCE",
      pipelineKey: ev.entityId,
      status: ev.entityType,
      title: `Evidência — ${ev.originalFileName}`,
      responsible: ev.uploadedByName,
      supplierId: null,
      supplierName: null,
      materialId: null,
      materialCode: null,
      priority: null,
      neededByDate: null,
      createdAt: ev.uploadedAt.toISOString(),
      href: "/purchases",
      negotiatedGain: null,
      isPendingApproval: false,
      // Evidência não avança funil — sinais neutros.
      signals: {
        hasQuotation: false,
        hasClosedRound: false,
        hasApprovedAward: false,
        purchaseOrderStatus: null,
      },
    });
  }

  // Boost request rows with quotation/PO progress
  for (const row of rows) {
    if (row.kind !== "REQUEST") continue;
    const boost = requestSignalBoost.get(row.id);
    if (!boost) continue;
    row.signals = {
      hasQuotation: row.signals.hasQuotation || boost.hasClosedRound || boost.hasApprovedAward,
      hasClosedRound: boost.hasClosedRound,
      hasApprovedAward: boost.hasApprovedAward,
      purchaseOrderStatus: boost.purchaseOrderStatus,
    };
    if (boost.hasClosedRound || boost.hasApprovedAward || boost.purchaseOrderStatus) {
      row.signals.hasQuotation = true;
    }
  }

  const exclusive = resolveExclusivePipelineStages(rows);
  const filters: PurchasingWorkstationFilters = {
    q: query.q,
    stage: query.stage as PurchasingPipelineStage | "PENDENTE" | "" | undefined,
    status: query.status,
    responsible: query.responsible,
    supplierId: query.supplierId,
    materialId: query.materialId,
    priority: query.priority,
    periodFrom: query.periodFrom,
    periodTo: query.periodTo,
    neededByFrom: query.neededByFrom,
    neededByTo: query.neededByTo,
    kind: query.kind as PurchasingWorkstationEntityKind | "" | undefined,
  };

  // Cards sempre no universo filtrado (exceto filtro de stage, que filtra linhas mas cards usam o mesmo set filtrado base)
  const baseFiltered = rows.filter((r) => {
    const { stage: _stage, ...rest } = filters;
    return rowMatchesFilters(r, exclusive, rest);
  });
  const exclusiveForCards = resolveExclusivePipelineStages(baseFiltered);
  const cards = buildWorkstationCards(baseFiltered, exclusiveForCards);
  assertCardsDoNotDoubleCountPipeline(cards);

  const filtered = rows.filter((r) => rowMatchesFilters(r, exclusive, filters));
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const page = paginateRows(filtered, query.page ?? 1, query.pageSize ?? 20);

  return {
    cards,
    stages: exclusiveForCards.size,
    pagination: {
      page: page.page,
      pageSize: page.pageSize,
      total: page.total,
      totalPages: page.totalPages,
    },
    rows: page.rows.map((r) => ({
      ...r,
      pipelineStage: exclusive.get(r.pipelineKey) ?? classifyPipelineStage(r.signals),
    })),
    filtersApplied: filters,
    meta: {
      featureFlag: "SUPPLY_CHAIN_PURCHASES_MODULE_ENABLED",
      pipelineExclusive: true,
      pendingOrthogonal: true,
      gainOrthogonal: true,
    },
  };
}
