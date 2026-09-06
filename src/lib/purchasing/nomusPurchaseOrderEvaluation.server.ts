/**
 * Persistência da avaliação do Pedido Nomus.
 * Escritas: NomusPurchaseOrderSupplierEvaluation + History.
 * Sem writeback Nomus. Sem misturar PurchaseOrder interno.
 * Score calculado só via computeSupplierOrderEvaluation.
 */

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  expandPurchaseOrderSupplierSearchIds,
  resolveNomusOrderSuppliersBatch,
} from "@/src/lib/nomus/nomusPurchaseOrder360.server.js";
import {
  buildNomusPurchaseOrderWhere,
  parseNomusPurchaseOrderListFilters,
} from "@/src/lib/nomus/nomusPurchaseOrderQuery.js";
import {
  resolveSupplierEvaluationAggregation,
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SupplierEvaluationError,
  averageScoreOrNull,
  buildSupplierPerformanceSummary,
  computeSupplierOrderEvaluation,
  normalizeSupplierEvaluationExpectedRevision,
  normalizeSupplierEvaluationNotes,
  normalizeSupplierEvaluationRevisionReason,
  normalizeSupplierPerformancePage,
  normalizeSupplierPerformancePageSize,
  parseSupplierPerformanceApiEvaluationStatus,
  parseSupplierPerformanceApiPeriod,
  resolveSupplierPerformanceDateRange,
  type SupplierPerformanceEvaluationStatusFilter,
  type SupplierPerformancePeriod,
} from "./supplierPerformance.js";
import {
  NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS,
  NOMUS_SUPPLIER_EVALUATION_HISTORY_ACTIONS,
  describeNomusPurchaseOrderSupplierEvaluationEligibility,
  isSupplierIdentitySafeForEvaluation,
  nomusSupplierEvaluationStatus,
  suggestNomusPurchaseOrderEvaluationScores,
  type NomusEvaluationSupplierSuggestion,
  type NomusSupplierEvaluationBatchItemInput,
  type NomusSupplierEvaluationBatchItemResult,
  type NomusSupplierEvaluationDto,
  type NomusSupplierEvaluationWorklistResponse,
  type NomusSupplierEvaluationWorklistRow,
} from "./nomusPurchaseOrderEvaluation.js";
import type { SupplierEvaluationActor, SupplierEvaluationWritePayload } from "./supplierPerformance.server.js";

type Db = PrismaClient | Prisma.TransactionClient;

const EVALUATION_SELECT = {
  id: true,
  nomusPurchaseOrderId: true,
  financialSupplierId: true,
  supplierMatchMethod: true,
  supplierMatchConfidence: true,
  qualityScore: true,
  deliveryScore: true,
  conformityScore: true,
  serviceScore: true,
  overallScore: true,
  methodologyVersion: true,
  notes: true,
  revision: true,
  createdAt: true,
  createdByUserId: true,
  createdByUserName: true,
  updatedAt: true,
  updatedByUserId: true,
  updatedByUserName: true,
} as const;

type EvaluationRow = {
  id: string;
  nomusPurchaseOrderId: string;
  financialSupplierId: string | null;
  supplierMatchMethod: string;
  supplierMatchConfidence: string;
  qualityScore: Prisma.Decimal;
  deliveryScore: Prisma.Decimal;
  conformityScore: Prisma.Decimal;
  serviceScore: Prisma.Decimal;
  overallScore: Prisma.Decimal;
  methodologyVersion: number;
  notes: string | null;
  revision: number;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUserName: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
  updatedByUserName: string | null;
};

function dec(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function decToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return Number.NaN;
  return typeof value === "number" ? value : Number(value);
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toEvaluationDto(row: EvaluationRow): NomusSupplierEvaluationDto {
  const financialSupplierId = row.financialSupplierId;
  return {
    id: row.id,
    nomusPurchaseOrderId: row.nomusPurchaseOrderId,
    financialSupplierId,
    supplierMatchMethod: row.supplierMatchMethod,
    supplierMatchConfidence: row.supplierMatchConfidence,
    supplierIdentitySafe: isSupplierIdentitySafeForEvaluation({
      matchConfidence: row.supplierMatchConfidence,
      financialSupplierId,
    }),
    scores: {
      quality: decToNumber(row.qualityScore),
      delivery: decToNumber(row.deliveryScore),
      conformity: decToNumber(row.conformityScore),
      service: decToNumber(row.serviceScore),
      overall: decToNumber(row.overallScore),
    },
    methodologyVersion: row.methodologyVersion,
    notes: row.notes,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    createdBy: { id: row.createdByUserId, name: row.createdByUserName },
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: { id: row.updatedByUserId, name: row.updatedByUserName },
  };
}

function eligibleWhere(): Prisma.NomusPurchaseOrderWhereInput {
  return {};
}

function periodWhere(period: SupplierPerformancePeriod): Prisma.NomusPurchaseOrderWhereInput | null {
  const { gte, lt } = resolveSupplierPerformanceDateRange(period);
  if (!gte && !lt) return null;
  const bounds = {
    ...(gte ? { gte } : {}),
    ...(lt ? { lt } : {}),
  };
  return {
    OR: [{ issuedAt: bounds }, { AND: [{ issuedAt: null }, { firstSeenAt: bounds }] }],
  };
}

function andWhere(
  parts: Array<Prisma.NomusPurchaseOrderWhereInput | null | undefined>
): Prisma.NomusPurchaseOrderWhereInput {
  const AND = parts.filter((p): p is Prisma.NomusPurchaseOrderWhereInput => !!p && Object.keys(p).length > 0);
  return AND.length ? { AND } : {};
}

function applyEvaluationStatusFilter(
  base: Prisma.NomusPurchaseOrderWhereInput,
  filter: SupplierPerformanceEvaluationStatusFilter
): Prisma.NomusPurchaseOrderWhereInput {
  switch (filter) {
    case "pending":
      return andWhere([base, { supplierEvaluation: { is: null } }]);
    case "evaluated":
      return { ...base, supplierEvaluation: { isNot: null } };
    case "ineligible":
      return andWhere([base, { id: "__none__" }]);
    default:
      return base;
  }
}

async function writeHistory(
  tx: Db,
  input: {
    evaluationId: string;
    nomusPurchaseOrderId: string;
    action: string;
    revision: number;
    reason?: string | null;
    actor: SupplierEvaluationActor;
    beforeJson?: Prisma.InputJsonValue | null;
    afterJson: Prisma.InputJsonValue;
  }
): Promise<void> {
  await tx.nomusPurchaseOrderSupplierEvaluationHistory.create({
    data: {
      evaluationId: input.evaluationId,
      nomusPurchaseOrderId: input.nomusPurchaseOrderId,
      action: input.action,
      revision: input.revision,
      reason: input.reason ?? null,
      beforeJson: input.beforeJson ?? Prisma.JsonNull,
      afterJson: input.afterJson,
      userId: input.actor.userId,
      userName: input.actor.userName ?? null,
    },
  });
}

function snapshotScores(scores: {
  quality: number;
  delivery: number;
  conformity: number;
  service: number;
  overall: number;
}) {
  return scores;
}

export async function saveNomusPurchaseOrderSupplierEvaluation(
  prisma: PrismaClient,
  nomusPurchaseOrderId: string,
  actor: SupplierEvaluationActor,
  payload: SupplierEvaluationWritePayload
): Promise<NomusSupplierEvaluationDto> {
  const notes = normalizeSupplierEvaluationNotes(payload.notes);
  const expectedRevision = normalizeSupplierEvaluationExpectedRevision(payload.expectedRevision);

  await prisma.$transaction(async (tx) => {
    const order = await tx.nomusPurchaseOrder.findUnique({
      where: { id: nomusPurchaseOrderId },
      select: {
        id: true,
        stage: true,
        canceled: true,
        supplierExternalId: true,
        supplierName: true,
        supplierTaxId: true,
        supplierEvaluation: { select: EVALUATION_SELECT },
      },
    });
    if (!order) {
      throw new SupplierEvaluationError(
        "PURCHASE_ORDER_NOT_FOUND",
        "Pedido de compra Nomus não encontrado."
      );
    }

    const eligibility = describeNomusPurchaseOrderSupplierEvaluationEligibility(
      order.stage,
      order.canceled
    );
    if (!eligibility.eligible) {
      throw new SupplierEvaluationError(
        "PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION",
        eligibility.eligibilityReason ?? "Pedido Nomus não elegível para avaliação."
      );
    }

    const [resolved] = await resolveNomusOrderSuppliersBatch([order]);
    const identitySafe = isSupplierIdentitySafeForEvaluation({
      matchConfidence: resolved.matchConfidence,
      financialSupplierId: resolved.financialSupplierId,
    });
    const financialSupplierId = identitySafe ? resolved.financialSupplierId : null;
    const current = order.supplierEvaluation as EvaluationRow | null;
    const methodologyVersion =
      current?.methodologyVersion ?? SUPPLIER_EVALUATION_METHODOLOGY_VERSION;
    const { scores, overallScore } = computeSupplierOrderEvaluation(
      payload,
      methodologyVersion
    );
    const afterJson = snapshotScores({ ...scores, overall: overallScore });

    if (!current) {
      if (expectedRevision != null) {
        throw new SupplierEvaluationError(
          "SUPPLIER_EVALUATION_REVISION_CONFLICT",
          "A avaliação deste pedido não existe mais. Recarregue a tela antes de salvar."
        );
      }
      let created: EvaluationRow;
      try {
        created = (await tx.nomusPurchaseOrderSupplierEvaluation.create({
          data: {
            nomusPurchaseOrderId: order.id,
            financialSupplierId,
            supplierMatchMethod: resolved.matchMethod,
            supplierMatchConfidence: resolved.matchConfidence,
            qualityScore: dec(scores.quality),
            deliveryScore: dec(scores.delivery),
            conformityScore: dec(scores.conformity),
            serviceScore: dec(scores.service),
            overallScore: dec(overallScore),
            methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
            notes,
            revision: 1,
            createdByUserId: actor.userId,
            createdByUserName: actor.userName ?? null,
            updatedByUserId: actor.userId,
            updatedByUserName: actor.userName ?? null,
          },
          select: EVALUATION_SELECT,
        })) as EvaluationRow;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          throw new SupplierEvaluationError(
            "SUPPLIER_EVALUATION_REVISION_CONFLICT",
            "Este pedido acabou de ser avaliado por outro usuário. Recarregue a tela."
          );
        }
        throw error;
      }
      await writeHistory(tx, {
        evaluationId: created.id,
        nomusPurchaseOrderId: order.id,
        action: NOMUS_SUPPLIER_EVALUATION_HISTORY_ACTIONS.created,
        revision: created.revision,
        actor,
        afterJson: {
          ...afterJson,
          methodologyVersion: created.methodologyVersion,
          financialSupplierId,
          supplierMatchMethod: resolved.matchMethod,
          supplierMatchConfidence: resolved.matchConfidence,
        },
      });
      return;
    }

    if (expectedRevision == null || expectedRevision !== current.revision) {
      throw new SupplierEvaluationError(
        "SUPPLIER_EVALUATION_REVISION_CONFLICT",
        "Esta avaliação foi alterada por outro usuário. Recarregue a tela e revise novamente."
      );
    }

    const revisionReason = normalizeSupplierEvaluationRevisionReason(payload.revisionReason);
    const updated = await tx.nomusPurchaseOrderSupplierEvaluation.updateMany({
      where: { id: current.id, revision: expectedRevision },
      data: {
        financialSupplierId,
        supplierMatchMethod: resolved.matchMethod,
        supplierMatchConfidence: resolved.matchConfidence,
        qualityScore: dec(scores.quality),
        deliveryScore: dec(scores.delivery),
        conformityScore: dec(scores.conformity),
        serviceScore: dec(scores.service),
        overallScore: dec(overallScore),
        methodologyVersion: current.methodologyVersion,
        notes,
        revision: expectedRevision + 1,
        updatedByUserId: actor.userId,
        updatedByUserName: actor.userName ?? null,
      },
    });
    if (updated.count !== 1) {
      throw new SupplierEvaluationError(
        "SUPPLIER_EVALUATION_REVISION_CONFLICT",
        "Esta avaliação foi alterada por outro usuário. Recarregue a tela e revise novamente."
      );
    }

    await writeHistory(tx, {
      evaluationId: current.id,
      nomusPurchaseOrderId: order.id,
      action: NOMUS_SUPPLIER_EVALUATION_HISTORY_ACTIONS.revised,
      revision: expectedRevision + 1,
      reason: revisionReason,
      actor,
      beforeJson: {
        quality: decToNumber(current.qualityScore),
        delivery: decToNumber(current.deliveryScore),
        conformity: decToNumber(current.conformityScore),
        service: decToNumber(current.serviceScore),
        overall: decToNumber(current.overallScore),
        revision: current.revision,
        methodologyVersion: current.methodologyVersion,
      },
      afterJson: {
        ...afterJson,
        revision: expectedRevision + 1,
        methodologyVersion: current.methodologyVersion,
        financialSupplierId,
      },
    });
  });

  const saved = await prisma.nomusPurchaseOrderSupplierEvaluation.findUnique({
    where: { nomusPurchaseOrderId },
    select: EVALUATION_SELECT,
  });
  if (!saved) {
    throw new SupplierEvaluationError(
      "PURCHASE_ORDER_NOT_FOUND",
      "Avaliação do pedido Nomus não encontrada após gravar."
    );
  }
  return toEvaluationDto(saved as EvaluationRow);
}

export async function saveNomusPurchaseOrderSupplierEvaluationsBatch(
  prisma: PrismaClient,
  actor: SupplierEvaluationActor,
  items: NomusSupplierEvaluationBatchItemInput[]
): Promise<{ results: NomusSupplierEvaluationBatchItemResult[] }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      "Informe ao menos um pedido para avaliar.",
      "items"
    );
  }
  if (items.length > NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      `No máximo ${NOMUS_SUPPLIER_EVALUATION_BATCH_MAX_ITEMS} pedidos por lote.`,
      "items"
    );
  }

  const results: NomusSupplierEvaluationBatchItemResult[] = [];
  for (const item of items) {
    const nomusPurchaseOrderId =
      typeof item.nomusPurchaseOrderId === "string" ? item.nomusPurchaseOrderId.trim() : "";
    if (!nomusPurchaseOrderId) {
      results.push({
        nomusPurchaseOrderId: "",
        success: false,
        code: "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
        error: "Pedido Nomus inválido.",
      });
      continue;
    }
    try {
      const evaluation = await saveNomusPurchaseOrderSupplierEvaluation(
        prisma,
        nomusPurchaseOrderId,
        actor,
        {
          qualityScore: item.qualityScore,
          deliveryScore: item.deliveryScore,
          conformityScore: item.conformityScore,
          serviceScore: item.serviceScore,
          notes: item.notes,
          expectedRevision: item.expectedRevision,
          revisionReason: item.revisionReason,
        }
      );
      results.push({ nomusPurchaseOrderId, success: true, evaluation });
    } catch (error) {
      if (error instanceof SupplierEvaluationError) {
        results.push({
          nomusPurchaseOrderId,
          success: false,
          code: error.code,
          error: error.message,
        });
        continue;
      }
      throw error;
    }
  }
  return { results };
}

export async function searchNomusEvaluationSuppliers(
  prisma: PrismaClient,
  rawQuery: unknown,
  rawLimit?: unknown
): Promise<{ suppliers: NomusEvaluationSupplierSuggestion[] }> {
  const q = String(rawQuery ?? "").trim();
  if (q.length < 2) return { suppliers: [] };
  const limit = Math.min(30, Math.max(1, Number.parseInt(String(rawLimit ?? "20"), 10) || 20));
  const extraIds = await expandPurchaseOrderSupplierSearchIds(q);
  const where: Prisma.NomusPurchaseOrderWhereInput = {
    OR: [
      { supplierName: { contains: q, mode: "insensitive" } },
      { supplierTaxId: { contains: q, mode: "insensitive" } },
      ...(extraIds.length > 0 ? [{ supplierExternalId: { in: extraIds } }] : []),
    ],
  };

  const grouped = await prisma.nomusPurchaseOrder.groupBy({
    by: ["supplierExternalId", "supplierName"],
    where,
    _count: { _all: true },
  });
  grouped.sort((a, b) => {
    const byCount = b._count._all - a._count._all;
    if (byCount !== 0) return byCount;
    return String(a.supplierName ?? "").localeCompare(String(b.supplierName ?? ""), "pt-BR");
  });
  const top = grouped.slice(0, limit);
  if (top.length === 0) return { suppliers: [] };

  const samples = await prisma.nomusPurchaseOrder.findMany({
    where: {
      OR: top.map((row) => ({
        supplierExternalId: row.supplierExternalId,
        supplierName: row.supplierName,
      })),
    },
    select: { supplierExternalId: true, supplierName: true, supplierTaxId: true },
    distinct: ["supplierExternalId", "supplierName"],
  });
  const resolved = await resolveNomusOrderSuppliersBatch(samples);
  const sampleByKey = new Map<string, (typeof resolved)[number]>();
  samples.forEach((row, index) => {
    sampleByKey.set(`${row.supplierExternalId ?? "n"}::${row.supplierName ?? ""}`, resolved[index]!);
  });

  return {
    suppliers: top.map((row) => {
      const key = `${row.supplierExternalId ?? "n"}::${row.supplierName ?? ""}`;
      const supplier = sampleByKey.get(key);
      const financialSupplierId = supplier?.financialSupplierId ?? null;
      const matchConfidence = supplier?.matchConfidence ?? "UNRESOLVED";
      return {
        supplierExternalId: row.supplierExternalId,
        nomusName: row.supplierName,
        resolvedName: supplier?.resolvedName ?? row.supplierName,
        resolvedDocument: supplier?.resolvedDocument ?? null,
        financialSupplierId,
        matchConfidence,
        identitySafe: isSupplierIdentitySafeForEvaluation({
          matchConfidence,
          financialSupplierId,
        }),
        orderCount: row._count._all,
      };
    }),
  };
}

export async function buildNomusSupplierEvaluationWorklist(
  prisma: PrismaClient,
  query: Record<string, unknown>
): Promise<NomusSupplierEvaluationWorklistResponse> {
  const period = parseSupplierPerformanceApiPeriod({ from: query.from, to: query.to });
  const evaluationStatus = parseSupplierPerformanceApiEvaluationStatus(query.evaluationStatus);
  const page = normalizeSupplierPerformancePage(query.page);
  const pageSize = normalizeSupplierPerformancePageSize(query.pageSize);
  const listFilters = parseNomusPurchaseOrderListFilters(query);
  const supplierExternalIdRaw = String(query.supplierExternalId ?? "").trim();
  if (/^\d+$/.test(supplierExternalIdRaw)) {
    listFilters.extraSupplierExternalIds = [Number(supplierExternalIdRaw)];
    listFilters.supplier = null;
  } else if (query.supplier && !listFilters.supplier) {
    listFilters.supplier = String(query.supplier);
  }
  if (listFilters.supplier) {
    listFilters.extraSupplierExternalIds = await expandPurchaseOrderSupplierSearchIds(
      listFilters.supplier
    );
  }
  if (listFilters.q) {
    listFilters.extraSearchSupplierExternalIds = await expandPurchaseOrderSupplierSearchIds(
      listFilters.q
    );
  }

  const searchWhere = buildNomusPurchaseOrderWhere(listFilters);
  const base = andWhere([searchWhere, periodWhere(period)]);
  const listWhere = applyEvaluationStatusFilter(base, evaluationStatus);
  const kpiWhere = andWhere([base, eligibleWhere()]);

  const [total, eligibleCount, evaluatedRows, pageRows] = await Promise.all([
    prisma.nomusPurchaseOrder.count({ where: listWhere }),
    prisma.nomusPurchaseOrder.count({ where: kpiWhere }),
    prisma.nomusPurchaseOrder.findMany({
      where: { ...kpiWhere, supplierEvaluation: { isNot: null } },
      select: {
        supplierEvaluation: {
          select: {
            overallScore: true,
            qualityScore: true,
            deliveryScore: true,
            conformityScore: true,
            serviceScore: true,
            methodologyVersion: true,
          },
        },
      },
    }),
    prisma.nomusPurchaseOrder.findMany({
      where: listWhere,
      orderBy: [{ issuedAt: "desc" }, { firstSeenAt: "desc" }, { orderNumber: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        externalId: true,
        orderNumber: true,
        issuedAt: true,
        stage: true,
        canceled: true,
        supplierExternalId: true,
        supplierName: true,
        supplierTaxId: true,
        supplierEvaluation: { select: EVALUATION_SELECT },
      },
    }),
  ]);

  const aggregated = resolveSupplierEvaluationAggregation(
    evaluatedRows
      .map((row) => row.supplierEvaluation)
      .filter((evaluation): evaluation is NonNullable<typeof evaluation> => evaluation != null)
      .map((evaluation) => ({
        overallScore: decToNumber(evaluation.overallScore),
        qualityScore: decToNumber(evaluation.qualityScore),
        deliveryScore: decToNumber(evaluation.deliveryScore),
        conformityScore: decToNumber(evaluation.conformityScore),
        serviceScore: decToNumber(evaluation.serviceScore),
        methodologyVersion: evaluation.methodologyVersion,
      }))
  );

  const kpis = buildSupplierPerformanceSummary({
    eligibleOrders: eligibleCount,
    evaluatedOrders: aggregated.overall.length,
    averages: {
      overall: averageScoreOrNull(aggregated.overall),
      quality: averageScoreOrNull(aggregated.quality),
      delivery: averageScoreOrNull(aggregated.delivery),
      conformity: averageScoreOrNull(aggregated.conformity),
      service: averageScoreOrNull(aggregated.service),
    },
  });

  const resolved = await resolveNomusOrderSuppliersBatch(pageRows);
  const suggestions = suggestNomusPurchaseOrderEvaluationScores();
  const items: NomusSupplierEvaluationWorklistRow[] = pageRows.map((row, index) => {
    const supplier = resolved[index]!;
    const eligibility = describeNomusPurchaseOrderSupplierEvaluationEligibility(
      row.stage,
      row.canceled
    );
    const evaluation = row.supplierEvaluation
      ? toEvaluationDto(row.supplierEvaluation as EvaluationRow)
      : null;
    return {
      nomusPurchaseOrderId: row.id,
      externalId: row.externalId,
      orderNumber: row.orderNumber,
      issuedAt: iso(row.issuedAt),
      stage: row.stage,
      canceled: row.canceled,
      eligible: eligibility.eligible,
      eligibilityReason: eligibility.eligibilityReason,
      evaluationStatus: nomusSupplierEvaluationStatus({
        eligible: eligibility.eligible,
        hasEvaluation: evaluation != null,
      }),
      supplier: {
        nomusExternalId: supplier.nomusExternalId,
        nomusName: supplier.nomusName,
        resolvedName: supplier.resolvedName,
        resolvedDocument: supplier.resolvedDocument,
        financialSupplierId: supplier.financialSupplierId,
        matchMethod: supplier.matchMethod,
        matchConfidence: supplier.matchConfidence,
        identitySafe: isSupplierIdentitySafeForEvaluation({
          matchConfidence: supplier.matchConfidence,
          financialSupplierId: supplier.financialSupplierId,
        }),
      },
      evaluation,
      suggestions,
    };
  });

  return {
    page,
    pageSize,
    total,
    scaleMin: aggregated.methodology.scaleMin,
    scaleMax: aggregated.methodology.scaleMax,
    kpis,
    items,
  };
}

