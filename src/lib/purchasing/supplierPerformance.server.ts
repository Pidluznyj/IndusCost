/**
 * OP-26 — Persistência e agregação do desempenho de fornecedores.
 *
 * Escritas permitidas nesta feature: `PurchaseOrderSupplierEvaluation` e
 * `PurchaseOrderHistoryEvent`. NADA mais — sem Material/Product/BOM/SalesOrder,
 * sem Nomus, sem AP/AR, sem estoque oficial, sem comissões, sem custo/preço.
 * `FinancialSupplier` é usado SOMENTE para leitura (cadastro canônico).
 *
 * Regra de população: o eixo do período é COALESCE(issuedAt, createdAt) do
 * Pedido de Compra — nunca a data da avaliação (avaliação retroativa preserva
 * a competência operacional do pedido).
 */

import type { PrismaClient, PurchaseOrderStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  SUPPLIER_EVALUATION_ELIGIBLE_STATUSES,
  SUPPLIER_EVALUATION_HISTORY_ACTIONS,
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SupplierEvaluationError,
  assertPurchaseOrderSupplierEvaluationEligible,
  averageScoreOrNull,
  buildSupplierPerformanceSummary,
  computeSupplierOrderEvaluation,
  describePurchaseOrderSupplierEvaluationEligibility,
  normalizeSupplierEvaluationExpectedRevision,
  normalizeSupplierEvaluationNotes,
  normalizeSupplierEvaluationRevisionReason,
  resolvePurchaseOrderEvaluationReferenceDate,
  resolveSupplierPerformanceDateRange,
  sortSupplierPerformanceReportRows,
  type PurchaseOrderSupplierEvaluationDto,
  type PurchaseOrderSupplierEvaluationResponse,
  type SupplierPerformanceDetailResponse,
  type SupplierPerformanceEvaluationStatusFilter,
  type SupplierPerformanceOrderRowDto,
  type SupplierPerformancePeriod,
  type SupplierPerformanceReportResponse,
  type SupplierPerformanceReportRowDto,
  type SupplierPerformanceReportSort,
} from "./supplierPerformance.js";
import type { SupplierPerformanceDetailCsvRow } from "./supplierPerformanceCsv.js";

export type SupplierEvaluationActor = {
  userId: string;
  userName?: string | null;
};

export type SupplierEvaluationWritePayload = {
  qualityScore: unknown;
  deliveryScore: unknown;
  conformityScore: unknown;
  serviceScore: unknown;
  notes?: unknown;
  expectedRevision?: unknown;
  revisionReason?: unknown;
};

/** Teto do export detalhado — evita CSV de memória ilimitada. */
export const SUPPLIER_PERFORMANCE_CSV_MAX_ROWS = 20000;

type Db = PrismaClient | Prisma.TransactionClient;

const EVALUATION_SELECT = {
  id: true,
  purchaseOrderId: true,
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
  purchaseOrderId: string;
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

function toEvaluationDto(row: EvaluationRow): PurchaseOrderSupplierEvaluationDto {
  return {
    id: row.id,
    purchaseOrderId: row.purchaseOrderId,
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

/* ------------------------------------------------------------------ *
 * Population / where canônico
 * ------------------------------------------------------------------ */

/**
 * Filtro de período sobre COALESCE(issuedAt, createdAt) expresso em Prisma:
 * emitido dentro da janela OU (sem emissão E criado dentro da janela).
 * Usa os índices existentes de `issuedAt` e `createdAt`.
 */
function buildReferenceDateWhere(
  period: SupplierPerformancePeriod
): Prisma.PurchaseOrderWhereInput | null {
  const { gte, lt } = resolveSupplierPerformanceDateRange(period);
  if (!gte && !lt) return null;
  const bounds = {
    ...(gte ? { gte } : {}),
    ...(lt ? { lt } : {}),
  };
  return {
    OR: [
      { issuedAt: bounds },
      { AND: [{ issuedAt: null }, { createdAt: bounds }] },
    ],
  };
}

/** Lista canônica de status elegíveis já tipada para o enum do Prisma. */
const ELIGIBLE_STATUSES = [
  ...SUPPLIER_EVALUATION_ELIGIBLE_STATUSES,
] as PurchaseOrderStatus[];

function buildPurchaseOrderPopulationWhere(input: {
  supplierId?: string;
  supplierIds?: string[];
  period: SupplierPerformancePeriod;
  onlyEligible: boolean;
}): Prisma.PurchaseOrderWhereInput {
  const referenceDate = buildReferenceDateWhere(input.period);
  return {
    ...(input.supplierId ? { supplierId: input.supplierId } : {}),
    ...(input.supplierIds ? { supplierId: { in: input.supplierIds } } : {}),
    ...(input.onlyEligible ? { status: { in: ELIGIBLE_STATUSES } } : {}),
    ...(referenceDate ? { AND: [referenceDate] } : {}),
  };
}

function applyEvaluationStatusFilter(
  base: Prisma.PurchaseOrderWhereInput,
  filter: SupplierPerformanceEvaluationStatusFilter
): Prisma.PurchaseOrderWhereInput {
  switch (filter) {
    case "pending":
      return {
        ...base,
        status: { in: ELIGIBLE_STATUSES },
        supplierEvaluation: { is: null },
      };
    case "evaluated":
      // `isNot: null` — NOT + is zera a população em relação to-one no Prisma.
      return { ...base, supplierEvaluation: { isNot: null } };
    case "ineligible":
      return { ...base, status: { notIn: ELIGIBLE_STATUSES } };
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ *
 * Leitura por Pedido de Compra
 * ------------------------------------------------------------------ */

export async function getPurchaseOrderSupplierEvaluation(
  prisma: PrismaClient,
  purchaseOrderId: string
): Promise<PurchaseOrderSupplierEvaluationResponse> {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    select: {
      id: true,
      status: true,
      supplierId: true,
      supplierDisplayNameSnapshot: true,
      supplierDocumentSnapshot: true,
      supplierEvaluation: { select: EVALUATION_SELECT },
    },
  });
  if (!order) {
    throw new SupplierEvaluationError(
      "PURCHASE_ORDER_NOT_FOUND",
      "Pedido de compra não encontrado."
    );
  }

  const eligibility = describePurchaseOrderSupplierEvaluationEligibility(order.status);
  return {
    purchaseOrderId: order.id,
    status: order.status,
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.eligibilityReason,
    supplier: {
      id: order.supplierId,
      name: order.supplierDisplayNameSnapshot,
      document: order.supplierDocumentSnapshot,
    },
    evaluation: order.supplierEvaluation
      ? toEvaluationDto(order.supplierEvaluation as EvaluationRow)
      : null,
  };
}

/* ------------------------------------------------------------------ *
 * Escrita — criação e revisão (transação única com auditoria)
 * ------------------------------------------------------------------ */

async function writeEvaluationHistory(
  tx: Db,
  input: {
    purchaseOrderId: string;
    action: string;
    reason?: string | null;
    actor: SupplierEvaluationActor;
    metaJson: Prisma.InputJsonValue;
  }
): Promise<void> {
  await tx.purchaseOrderHistoryEvent.create({
    data: {
      purchaseOrderId: input.purchaseOrderId,
      action: input.action,
      reason: input.reason ?? null,
      userId: input.actor.userId,
      userName: input.actor.userName ?? null,
      metaJson: input.metaJson,
    },
  });
}

/**
 * Cria (revision 1) ou revisa (CAS em `revision`) a avaliação do pedido.
 *
 * Tudo numa transação: avaliação + PurchaseOrderHistoryEvent. Se a auditoria
 * falhar, a avaliação NÃO é gravada — e vice-versa.
 */
export async function savePurchaseOrderSupplierEvaluation(
  prisma: PrismaClient,
  purchaseOrderId: string,
  actor: SupplierEvaluationActor,
  payload: SupplierEvaluationWritePayload
): Promise<PurchaseOrderSupplierEvaluationResponse> {
  const { scores, overallScore } = computeSupplierOrderEvaluation(payload);
  const notes = normalizeSupplierEvaluationNotes(payload.notes);
  const expectedRevision = normalizeSupplierEvaluationExpectedRevision(
    payload.expectedRevision
  );

  await prisma.$transaction(async (tx) => {
    const order = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        status: true,
        supplierId: true,
        supplierDisplayNameSnapshot: true,
        supplierEvaluation: { select: EVALUATION_SELECT },
      },
    });
    if (!order) {
      throw new SupplierEvaluationError(
        "PURCHASE_ORDER_NOT_FOUND",
        "Pedido de compra não encontrado."
      );
    }
    // Elegibilidade revalidada dentro da transação com o status corrente.
    assertPurchaseOrderSupplierEvaluationEligible(order.status);

    const current = order.supplierEvaluation as EvaluationRow | null;

    if (!current) {
      if (expectedRevision != null) {
        throw new SupplierEvaluationError(
          "SUPPLIER_EVALUATION_REVISION_CONFLICT",
          "A avaliação deste pedido não existe mais. Recarregue a tela antes de salvar."
        );
      }
      let created: EvaluationRow;
      try {
        created = (await tx.purchaseOrderSupplierEvaluation.create({
          data: {
            purchaseOrderId: order.id,
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
        // UNIQUE(purchaseOrderId): duas criações simultâneas — uma ganha.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          throw new SupplierEvaluationError(
            "SUPPLIER_EVALUATION_REVISION_CONFLICT",
            "Este pedido acabou de ser avaliado por outro usuário. Recarregue a tela."
          );
        }
        throw error;
      }

      await writeEvaluationHistory(tx, {
        purchaseOrderId: order.id,
        action: SUPPLIER_EVALUATION_HISTORY_ACTIONS.created,
        actor,
        metaJson: {
          evaluationId: created.id,
          revision: created.revision,
          methodologyVersion: created.methodologyVersion,
          scores: {
            quality: scores.quality,
            delivery: scores.delivery,
            conformity: scores.conformity,
            service: scores.service,
            overall: overallScore,
          },
          supplierId: order.supplierId,
          supplierName: order.supplierDisplayNameSnapshot,
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

    const revisionReason = normalizeSupplierEvaluationRevisionReason(
      payload.revisionReason
    );

    // Compare-and-swap: só atualiza se a revisão ainda for a esperada.
    const updated = await tx.purchaseOrderSupplierEvaluation.updateMany({
      where: { id: current.id, revision: expectedRevision },
      data: {
        qualityScore: dec(scores.quality),
        deliveryScore: dec(scores.delivery),
        conformityScore: dec(scores.conformity),
        serviceScore: dec(scores.service),
        overallScore: dec(overallScore),
        methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
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

    await writeEvaluationHistory(tx, {
      purchaseOrderId: order.id,
      action: SUPPLIER_EVALUATION_HISTORY_ACTIONS.revised,
      reason: revisionReason,
      actor,
      metaJson: {
        evaluationId: current.id,
        revision: expectedRevision + 1,
        methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
        before: {
          quality: decToNumber(current.qualityScore),
          delivery: decToNumber(current.deliveryScore),
          conformity: decToNumber(current.conformityScore),
          service: decToNumber(current.serviceScore),
          overall: decToNumber(current.overallScore),
          notes: current.notes,
        },
        after: {
          quality: scores.quality,
          delivery: scores.delivery,
          conformity: scores.conformity,
          service: scores.service,
          overall: overallScore,
          notes,
        },
      },
    });
  });

  return getPurchaseOrderSupplierEvaluation(prisma, purchaseOrderId);
}

/* ------------------------------------------------------------------ *
 * Consolidado do fornecedor
 * ------------------------------------------------------------------ */

const EVALUATED_ROW_SELECT = {
  supplierId: true,
  supplierEvaluation: {
    select: {
      overallScore: true,
      qualityScore: true,
      deliveryScore: true,
      conformityScore: true,
      serviceScore: true,
    },
  },
} as const;

/** Listagem só precisa do resumo da avaliação — nunca observações/payloads. */
const EVALUATION_LIST_SELECT = {
  id: true,
  qualityScore: true,
  deliveryScore: true,
  conformityScore: true,
  serviceScore: true,
  overallScore: true,
  revision: true,
  createdAt: true,
  createdByUserName: true,
  updatedByUserName: true,
} as const;

type EvaluationListRow = Pick<
  EvaluationRow,
  | "id"
  | "qualityScore"
  | "deliveryScore"
  | "conformityScore"
  | "serviceScore"
  | "overallScore"
  | "revision"
  | "createdAt"
  | "createdByUserName"
  | "updatedByUserName"
>;

type EvaluatedAggregationRow = {
  supplierId: string;
  supplierEvaluation: {
    overallScore: Prisma.Decimal;
    qualityScore: Prisma.Decimal;
    deliveryScore: Prisma.Decimal;
    conformityScore: Prisma.Decimal;
    serviceScore: Prisma.Decimal;
  } | null;
};

function averagesFromRows(rows: readonly EvaluatedAggregationRow[]) {
  const overall: number[] = [];
  const quality: number[] = [];
  const delivery: number[] = [];
  const conformity: number[] = [];
  const service: number[] = [];
  for (const row of rows) {
    const e = row.supplierEvaluation;
    if (!e) continue;
    overall.push(decToNumber(e.overallScore));
    quality.push(decToNumber(e.qualityScore));
    delivery.push(decToNumber(e.deliveryScore));
    conformity.push(decToNumber(e.conformityScore));
    service.push(decToNumber(e.serviceScore));
  }
  return {
    count: overall.length,
    averages: {
      overall: averageScoreOrNull(overall),
      quality: averageScoreOrNull(quality),
      delivery: averageScoreOrNull(delivery),
      conformity: averageScoreOrNull(conformity),
      service: averageScoreOrNull(service),
    },
  };
}

function toOrderRow(order: {
  id: string;
  code: string;
  status: string;
  issuedAt: Date | null;
  createdAt: Date;
  currency: string;
  totalAmountSnapshot: Prisma.Decimal | null;
  supplierEvaluation: EvaluationListRow | null;
}): SupplierPerformanceOrderRowDto {
  const eligibility = describePurchaseOrderSupplierEvaluationEligibility(order.status);
  const evaluation = order.supplierEvaluation;
  return {
    id: order.id,
    code: order.code,
    status: order.status,
    referenceDate: resolvePurchaseOrderEvaluationReferenceDate(order).toISOString(),
    issuedAt: order.issuedAt ? order.issuedAt.toISOString() : null,
    currency: order.currency,
    totalAmount:
      order.totalAmountSnapshot == null ? null : decToNumber(order.totalAmountSnapshot),
    eligible: eligibility.eligible,
    eligibilityReason: eligibility.eligibilityReason,
    evaluation: evaluation
      ? {
          id: evaluation.id,
          overallScore: decToNumber(evaluation.overallScore),
          quality: decToNumber(evaluation.qualityScore),
          delivery: decToNumber(evaluation.deliveryScore),
          conformity: decToNumber(evaluation.conformityScore),
          service: decToNumber(evaluation.serviceScore),
          revision: evaluation.revision,
          evaluatedAt: evaluation.createdAt.toISOString(),
          evaluatedBy: evaluation.updatedByUserName ?? evaluation.createdByUserName,
        }
      : null,
  };
}

/**
 * Desempenho de UM fornecedor: consolidado sobre TODO o período filtrado +
 * página de pedidos. O resumo nunca é calculado sobre a página visível.
 *
 * Consultas fixas (sem N+1): fornecedor, contagem elegível, avaliações do
 * período, contagem da lista e página da lista.
 */
export async function buildSupplierPerformanceDetail(
  prisma: PrismaClient,
  supplierId: string,
  params: {
    period: SupplierPerformancePeriod;
    evaluationStatus: SupplierPerformanceEvaluationStatusFilter;
    page: number;
    pageSize: number;
  }
): Promise<SupplierPerformanceDetailResponse> {
  const supplier = await prisma.financialSupplier.findUnique({
    where: { id: supplierId },
    select: { id: true, displayName: true, document: true, status: true },
  });
  if (!supplier) {
    throw new SupplierEvaluationError("SUPPLIER_NOT_FOUND", "Fornecedor não encontrado.");
  }

  const eligibleWhere = buildPurchaseOrderPopulationWhere({
    supplierId,
    period: params.period,
    onlyEligible: true,
  });
  const listWhere = applyEvaluationStatusFilter(
    buildPurchaseOrderPopulationWhere({
      supplierId,
      period: params.period,
      onlyEligible: false,
    }),
    params.evaluationStatus
  );

  const [eligibleOrders, evaluatedRows, total] = await Promise.all([
    prisma.purchaseOrder.count({ where: eligibleWhere }),
    prisma.purchaseOrder.findMany({
      where: { ...eligibleWhere, supplierEvaluation: { isNot: null } },
      select: EVALUATED_ROW_SELECT,
    }),
    prisma.purchaseOrder.count({ where: listWhere }),
  ]);

  const pageSize = params.pageSize;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(params.page, totalPages);

  const items = await prisma.purchaseOrder.findMany({
    where: listWhere,
    select: {
      id: true,
      code: true,
      status: true,
      issuedAt: true,
      createdAt: true,
      currency: true,
      totalAmountSnapshot: true,
      supplierEvaluation: { select: EVALUATION_LIST_SELECT },
    },
    // Emitidos primeiro pela emissão; sem emissão, pela criação (fallback do eixo).
    orderBy: [
      { issuedAt: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { code: "desc" },
    ],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const aggregated = averagesFromRows(evaluatedRows as EvaluatedAggregationRow[]);

  return {
    supplier: {
      id: supplier.id,
      name: supplier.displayName,
      document: supplier.document,
      status: supplier.status,
    },
    period: params.period,
    summary: buildSupplierPerformanceSummary({
      eligibleOrders,
      evaluatedOrders: aggregated.count,
      averages: aggregated.averages,
    }),
    orders: {
      page,
      pageSize,
      total,
      totalPages,
      items: items.map((order) =>
        toOrderRow(order as Parameters<typeof toOrderRow>[0])
      ),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Relatório geral — agregação em lote (sem query por fornecedor)
 * ------------------------------------------------------------------ */

export async function buildSupplierPerformanceReport(
  prisma: PrismaClient,
  params: {
    period: SupplierPerformancePeriod;
    supplierId?: string | null;
    supplierStatus?: string | null;
    sort: SupplierPerformanceReportSort;
  }
): Promise<SupplierPerformanceReportResponse> {
  const supplierFilter: Prisma.FinancialSupplierWhereInput = {
    ...(params.supplierId ? { id: params.supplierId } : {}),
    ...(params.supplierStatus ? { status: params.supplierStatus as never } : {}),
  };
  const hasSupplierFilter = Boolean(params.supplierId || params.supplierStatus);

  const supplierIds = hasSupplierFilter
    ? (
        await prisma.financialSupplier.findMany({
          where: supplierFilter,
          select: { id: true },
        })
      ).map((s) => s.id)
    : undefined;

  if (supplierIds && supplierIds.length === 0) {
    return emptyReport(params.period);
  }

  const eligibleWhere = buildPurchaseOrderPopulationWhere({
    ...(supplierIds ? { supplierIds } : {}),
    period: params.period,
    onlyEligible: true,
  });

  // 2 consultas para TODA a população: contagem por fornecedor + avaliações.
  const [eligibleBySupplier, evaluatedRows] = await Promise.all([
    prisma.purchaseOrder.groupBy({
      by: ["supplierId"],
      where: eligibleWhere,
      _count: { _all: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { ...eligibleWhere, supplierEvaluation: { isNot: null } },
      select: EVALUATED_ROW_SELECT,
    }),
  ]);

  if (eligibleBySupplier.length === 0) return emptyReport(params.period);

  const rowsBySupplier = new Map<string, EvaluatedAggregationRow[]>();
  for (const row of evaluatedRows as EvaluatedAggregationRow[]) {
    const bucket = rowsBySupplier.get(row.supplierId);
    if (bucket) bucket.push(row);
    else rowsBySupplier.set(row.supplierId, [row]);
  }

  const ids = eligibleBySupplier.map((g) => g.supplierId);
  const suppliers = await prisma.financialSupplier.findMany({
    where: { id: { in: ids } },
    select: { id: true, displayName: true, document: true, status: true },
  });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const rows: SupplierPerformanceReportRowDto[] = eligibleBySupplier.map((group) => {
    const supplier = supplierById.get(group.supplierId);
    const aggregated = averagesFromRows(rowsBySupplier.get(group.supplierId) ?? []);
    return {
      supplierId: group.supplierId,
      supplierName: supplier?.displayName ?? "Fornecedor não encontrado",
      supplierDocument: supplier?.document ?? null,
      supplierStatus: supplier?.status ?? "UNKNOWN",
      summary: buildSupplierPerformanceSummary({
        eligibleOrders: group._count._all,
        evaluatedOrders: aggregated.count,
        averages: aggregated.averages,
      }),
    };
  });

  const totalsAggregated = averagesFromRows(evaluatedRows as EvaluatedAggregationRow[]);
  const totalEligible = rows.reduce((acc, r) => acc + r.summary.eligibleOrders, 0);

  return {
    period: params.period,
    generatedAt: new Date().toISOString(),
    methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
    totals: buildSupplierPerformanceSummary({
      eligibleOrders: totalEligible,
      evaluatedOrders: totalsAggregated.count,
      averages: totalsAggregated.averages,
    }),
    rows: sortSupplierPerformanceReportRows(rows, params.sort),
  };
}

function emptyReport(period: SupplierPerformancePeriod): SupplierPerformanceReportResponse {
  return {
    period,
    generatedAt: new Date().toISOString(),
    methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
    totals: buildSupplierPerformanceSummary({
      eligibleOrders: 0,
      evaluatedOrders: 0,
      averages: {
        overall: null,
        quality: null,
        delivery: null,
        conformity: null,
        service: null,
      },
    }),
    rows: [],
  };
}

/* ------------------------------------------------------------------ *
 * CSV detalhado — mesma engine/período do relatório
 * ------------------------------------------------------------------ */

export async function buildSupplierPerformanceDetailCsvRows(
  prisma: PrismaClient,
  params: {
    period: SupplierPerformancePeriod;
    supplierId?: string | null;
    supplierStatus?: string | null;
  }
): Promise<SupplierPerformanceDetailCsvRow[]> {
  const hasSupplierFilter = Boolean(params.supplierId || params.supplierStatus);
  const supplierIds = hasSupplierFilter
    ? (
        await prisma.financialSupplier.findMany({
          where: {
            ...(params.supplierId ? { id: params.supplierId } : {}),
            ...(params.supplierStatus ? { status: params.supplierStatus as never } : {}),
          },
          select: { id: true },
        })
      ).map((s) => s.id)
    : undefined;

  if (supplierIds && supplierIds.length === 0) return [];

  const where = buildPurchaseOrderPopulationWhere({
    ...(supplierIds ? { supplierIds } : {}),
    period: params.period,
    onlyEligible: true,
  });

  const total = await prisma.purchaseOrder.count({ where });
  if (total > SUPPLIER_PERFORMANCE_CSV_MAX_ROWS) {
    throw new SupplierEvaluationError(
      "INVALID_SUPPLIER_EVALUATION_PAYLOAD",
      `Exportação com ${total} pedidos acima do limite de ${SUPPLIER_PERFORMANCE_CSV_MAX_ROWS}. Reduza o período ou filtre por fornecedor.`
    );
  }

  const orders = await prisma.purchaseOrder.findMany({
    where,
    select: {
      id: true,
      code: true,
      status: true,
      issuedAt: true,
      createdAt: true,
      currency: true,
      totalAmountSnapshot: true,
      supplierId: true,
      supplierDisplayNameSnapshot: true,
      supplierDocumentSnapshot: true,
      supplierEvaluation: { select: EVALUATION_SELECT },
    },
    orderBy: [
      { supplierDisplayNameSnapshot: "asc" },
      { issuedAt: { sort: "asc", nulls: "last" } },
      { code: "asc" },
    ],
  });

  return orders.map((order) => {
    const evaluation = order.supplierEvaluation as EvaluationRow | null;
    return {
      supplierId: order.supplierId,
      supplierName: order.supplierDisplayNameSnapshot,
      supplierDocument: order.supplierDocumentSnapshot,
      purchaseOrderId: order.id,
      purchaseOrderCode: order.code,
      purchaseOrderDate: resolvePurchaseOrderEvaluationReferenceDate(order).toISOString(),
      purchaseOrderStatus: order.status,
      purchaseOrderAmount:
        order.totalAmountSnapshot == null ? null : decToNumber(order.totalAmountSnapshot),
      // Valor e moeda saem como negociados — sem conversão cambial.
      purchaseOrderCurrency: order.currency ?? null,
      qualityScore: evaluation ? decToNumber(evaluation.qualityScore) : null,
      deliveryScore: evaluation ? decToNumber(evaluation.deliveryScore) : null,
      conformityScore: evaluation ? decToNumber(evaluation.conformityScore) : null,
      serviceScore: evaluation ? decToNumber(evaluation.serviceScore) : null,
      overallScore: evaluation ? decToNumber(evaluation.overallScore) : null,
      methodologyVersion: evaluation ? evaluation.methodologyVersion : null,
      evaluationRevision: evaluation ? evaluation.revision : null,
      evaluatedBy: evaluation ? evaluation.createdByUserName : null,
      evaluatedAt: evaluation ? evaluation.createdAt.toISOString() : null,
      updatedBy: evaluation ? evaluation.updatedByUserName : null,
      updatedAt: evaluation ? evaluation.updatedAt.toISOString() : null,
      notes: evaluation ? evaluation.notes : null,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Mapeamento de erro HTTP
 * ------------------------------------------------------------------ */

export function mapSupplierEvaluationError(error: unknown): {
  status: number;
  body: { error: string; code: string; field?: string };
} {
  if (error instanceof SupplierEvaluationError) {
    return {
      status: error.httpStatus,
      body: {
        error: error.message,
        code: error.code,
        ...(error.field ? { field: error.field } : {}),
      },
    };
  }
  console.error("supplier-performance error:", error);
  return {
    status: 500,
    body: {
      error: "Erro ao processar a avaliação de fornecedor.",
      code: "SUPPLIER_EVALUATION_UNEXPECTED_ERROR",
    },
  };
}
