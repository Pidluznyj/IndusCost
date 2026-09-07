/**
 * Compras → Performance — carga em lote (Prisma) e montagem do read model.
 *
 * Número CONSTANTE de consultas por requisição, independente do nº de
 * fornecedores/materiais (sem N+1): pedidos, linhas, avaliações, saúde do sync,
 * anos disponíveis, catálogo Nomus e identidades de fornecedor (batch já
 * existente do 360). Toda a agregação acontece no motor puro
 * (`supplierPerformanceDashboard.ts`).
 *
 * 100% leitura. Sem writeback Nomus. Sem schema novo.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { resolveNomusOrderSuppliersBatch } from "@/src/lib/nomus/nomusPurchaseOrder360.server.js";
import type { ResolvedPurchaseOrderSupplier } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import { isSupplyChainSupplierPerformanceEnabled } from "@/src/lib/supply-chain/supplyChainFeatureFlags.js";
import { isSupplierIdentitySafeForEvaluation } from "./nomusPurchaseOrderEvaluation.js";
import { periodWhere } from "./nomusPurchaseOrderEvaluation.server.js";
import {
  buildDashboardMaterialOptions,
  buildSupplierMaterialMatrix,
  buildSupplierPerformanceDashboard,
  buildSupplierPerformanceMaterialDetail,
  buildSupplierPerformanceSupplierDetail,
  normalizeDashboardRankingLimit,
  parseSupplierMaterialMatrixQuery,
  parseSupplierPerformanceDashboardFilters,
  type DashboardCatalogInput,
  type DashboardEvaluationInput,
  type DashboardLineInput,
  type DashboardMaterialDetail,
  type DashboardMaterialOption,
  type DashboardOrderInput,
  type DashboardSupplierDetail,
  type DashboardSupplierIdentityInput,
  type SupplierMaterialMatrixResult,
  type SupplierPerformanceDashboardFilters,
  type SupplierPerformanceDashboardInput,
  type SupplierPerformanceDashboardReadModel,
} from "./supplierPerformanceDashboard.js";

type DecimalLike = { toString(): string } | number | null | undefined;

function num(value: DecimalLike): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? n : null;
}

export type SupplierPerformanceDashboardDb = Pick<
  PrismaClient,
  | "nomusPurchaseOrder"
  | "nomusPurchaseOrderItem"
  | "nomusPurchaseOrderSupplierEvaluation"
  | "nomusProductCatalog"
  | "financialSupplier"
>;

export type SupplierPerformanceDashboardDeps = {
  /** Identidade batch do 360 (nome/documento/cadastro). Injetável em teste. */
  resolveSuppliers?: (
    orders: Array<{ supplierExternalId: number | null; supplierName: string | null; supplierTaxId: string | null }>
  ) => Promise<ResolvedPurchaseOrderSupplier[]>;
  evaluationFeatureEnabled?: boolean;
  now?: Date;
};

const ORDER_SELECT = {
  id: true,
  externalId: true,
  orderNumber: true,
  supplierExternalId: true,
  supplierName: true,
  supplierTaxId: true,
  stage: true,
  canceled: true,
  issuedAt: true,
  firstSeenAt: true,
  expectedAt: true,
  currency: true,
  totalAmount: true,
  paymentTerms: true,
} as const;

const LINE_SELECT = {
  purchaseOrderId: true,
  lineIndex: true,
  lineExternalId: true,
  productExternalId: true,
  productCode: true,
  description: true,
  unit: true,
  orderedQuantity: true,
  receivedQuantity: true,
  unitPrice: true,
  totalAmount: true,
} as const;

const EVALUATION_SELECT = {
  nomusPurchaseOrderId: true,
  overallScore: true,
  qualityScore: true,
  deliveryScore: true,
  conformityScore: true,
  serviceScore: true,
  methodologyVersion: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  updatedByUserName: true,
} as const;

/** Predicado oficial de cancelamento (canceledOnly de Pedidos Nomus) negado — reduz a carga; o motor puro reaplica. */
function notCanceledWhere(): Prisma.NomusPurchaseOrderWhereInput {
  return {
    AND: [{ OR: [{ canceled: null }, { canceled: false }] }, { stage: { not: "CANCELED" } }],
  };
}

/** Where canônico da população — período (autoridade da Avaliação Fornecedor) + cancelamento. */
export function buildDashboardOrderWhere(
  filters: Pick<SupplierPerformanceDashboardFilters, "period" | "includeCanceled">
): Prisma.NomusPurchaseOrderWhereInput {
  const parts: Prisma.NomusPurchaseOrderWhereInput[] = [];
  const period = periodWhere(filters.period);
  if (period) parts.push(period);
  if (!filters.includeCanceled) parts.push(notCanceledWhere());
  return parts.length ? { AND: parts } : {};
}

function yearsBetween(min: Date | null, max: Date | null): number[] {
  if (!min || !max) return [];
  const from = min.getFullYear();
  const to = max.getFullYear();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const years: number[] = [];
  for (let y = to; y >= from && years.length < 15; y -= 1) years.push(y);
  return years;
}

function earliest(...values: Array<Date | null | undefined>): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!result || value.getTime() < result.getTime()) result = value;
  }
  return result;
}

function latest(...values: Array<Date | null | undefined>): Date | null {
  let result: Date | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!result || value.getTime() > result.getTime()) result = value;
  }
  return result;
}

/**
 * Carrega a população oficial em lote. Consultas (constantes):
 *   1 pedidos · 1 linhas · 1 avaliações (só com flag ON) · 1 saúde do sync ·
 *   1 anos · 1 catálogo · resolveNomusOrderSuppliersBatch (batch fixo) · 1 status cadastral.
 */
export async function loadSupplierPerformanceDashboardInput(
  prisma: SupplierPerformanceDashboardDb,
  filters: SupplierPerformanceDashboardFilters,
  deps: SupplierPerformanceDashboardDeps = {}
): Promise<SupplierPerformanceDashboardInput> {
  const evaluationFeatureEnabled =
    deps.evaluationFeatureEnabled ?? isSupplyChainSupplierPerformanceEnabled();
  const where = buildDashboardOrderWhere(filters);

  const [orderRows, lineRows, evaluationRows, health, bounds] = await Promise.all([
    prisma.nomusPurchaseOrder.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: [{ issuedAt: "asc" }, { externalId: "asc" }],
    }),
    prisma.nomusPurchaseOrderItem.findMany({
      where: { purchaseOrder: where },
      select: LINE_SELECT,
      orderBy: [{ purchaseOrderId: "asc" }, { lineIndex: "asc" }],
    }),
    evaluationFeatureEnabled
      ? prisma.nomusPurchaseOrderSupplierEvaluation.findMany({
          where: { nomusPurchaseOrder: where },
          select: EVALUATION_SELECT,
        })
      : Promise.resolve([]),
    prisma.nomusPurchaseOrder.findFirst({
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
    prisma.nomusPurchaseOrder.aggregate({
      _min: { issuedAt: true, firstSeenAt: true },
      _max: { issuedAt: true, firstSeenAt: true },
    }),
  ]);

  const orders: DashboardOrderInput[] = orderRows.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    orderNumber: row.orderNumber,
    supplierExternalId: row.supplierExternalId,
    supplierName: row.supplierName,
    supplierTaxId: row.supplierTaxId,
    stage: row.stage,
    canceled: row.canceled,
    issuedAt: row.issuedAt,
    firstSeenAt: row.firstSeenAt,
    expectedAt: row.expectedAt,
    currency: row.currency,
    totalAmount: num(row.totalAmount),
    paymentTerms: row.paymentTerms,
  }));

  const lines: DashboardLineInput[] = lineRows.map((row) => ({
    purchaseOrderId: row.purchaseOrderId,
    lineIndex: row.lineIndex,
    lineExternalId: row.lineExternalId,
    productExternalId: row.productExternalId,
    productCode: row.productCode,
    description: row.description,
    unit: row.unit,
    orderedQuantity: num(row.orderedQuantity),
    receivedQuantity: num(row.receivedQuantity),
    unitPrice: num(row.unitPrice),
    totalAmount: num(row.totalAmount),
  }));

  const evaluations: DashboardEvaluationInput[] = evaluationRows.map((row) => ({
    nomusPurchaseOrderId: row.nomusPurchaseOrderId,
    overallScore: num(row.overallScore) ?? Number.NaN,
    qualityScore: num(row.qualityScore) ?? Number.NaN,
    deliveryScore: num(row.deliveryScore) ?? Number.NaN,
    conformityScore: num(row.conformityScore) ?? Number.NaN,
    serviceScore: num(row.serviceScore) ?? Number.NaN,
    methodologyVersion: row.methodologyVersion,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedByUserName: row.updatedByUserName,
  }));

  const productIds = [
    ...new Set(
      lines
        .map((line) => line.productExternalId)
        .filter((id): id is number => id != null)
        .map(String)
    ),
  ];

  const supplierSamples = new Map<number, { supplierExternalId: number; supplierName: string | null; supplierTaxId: string | null }>();
  for (const order of orders) {
    if (order.supplierExternalId == null || supplierSamples.has(order.supplierExternalId)) continue;
    supplierSamples.set(order.supplierExternalId, {
      supplierExternalId: order.supplierExternalId,
      supplierName: order.supplierName,
      supplierTaxId: order.supplierTaxId,
    });
  }
  const samples = [...supplierSamples.values()];
  const resolveSuppliers = deps.resolveSuppliers ?? resolveNomusOrderSuppliersBatch;

  const [catalogRows, resolved] = await Promise.all([
    productIds.length
      ? prisma.nomusProductCatalog.findMany({
          where: { externalProductId: { in: productIds } },
          select: { externalProductId: true, code: true, description: true, groupName: true, familyName: true },
        })
      : Promise.resolve([]),
    samples.length ? resolveSuppliers(samples) : Promise.resolve([]),
  ]);

  const safeSupplierIds = [
    ...new Set(
      resolved
        .filter((row) =>
          isSupplierIdentitySafeForEvaluation({
            matchConfidence: row.matchConfidence,
            financialSupplierId: row.financialSupplierId,
          })
        )
        .map((row) => row.financialSupplierId as string)
    ),
  ];
  const registryRows = safeSupplierIds.length
    ? await prisma.financialSupplier.findMany({
        where: { id: { in: safeSupplierIds } },
        select: { id: true, status: true },
      })
    : [];
  const registryById = new Map(registryRows.map((row) => [row.id, String(row.status)]));

  const supplierIdentities: DashboardSupplierIdentityInput[] = samples.map((sample, index) => {
    const row = resolved[index];
    const safe =
      row != null &&
      isSupplierIdentitySafeForEvaluation({
        matchConfidence: row.matchConfidence,
        financialSupplierId: row.financialSupplierId,
      });
    return {
      supplierExternalId: sample.supplierExternalId,
      resolvedName: row?.resolvedName ?? sample.supplierName,
      resolvedDocument: row?.resolvedDocument ?? sample.supplierTaxId,
      financialSupplierId: safe ? row!.financialSupplierId : null,
      matchMethod: row?.matchMethod ?? "UNRESOLVED",
      matchConfidence: row?.matchConfidence ?? "UNRESOLVED",
      registryStatus: safe && row!.financialSupplierId ? registryById.get(row!.financialSupplierId) ?? null : null,
    };
  });

  const catalog: DashboardCatalogInput[] = catalogRows
    .filter((row) => row.externalProductId)
    .map((row) => ({
      externalProductId: row.externalProductId as string,
      code: row.code,
      description: row.description,
      groupName: row.groupName,
      familyName: row.familyName,
    }));

  return {
    orders,
    lines,
    evaluations,
    catalog,
    supplierIdentities,
    evaluationFeatureEnabled,
    lastSyncedAt: health?.syncedAt ?? null,
    availableYears: yearsBetween(
      earliest(bounds._min.issuedAt, bounds._min.firstSeenAt),
      latest(bounds._max.issuedAt, bounds._max.firstSeenAt)
    ),
    now: deps.now,
  };
}

export async function buildSupplierPerformanceDashboardResponse(
  prisma: SupplierPerformanceDashboardDb,
  query: Record<string, unknown>,
  deps: SupplierPerformanceDashboardDeps = {}
): Promise<SupplierPerformanceDashboardReadModel> {
  const filters = parseSupplierPerformanceDashboardFilters(query);
  const input = await loadSupplierPerformanceDashboardInput(prisma, filters, deps);
  return buildSupplierPerformanceDashboard(input, filters, {
    rankingLimit: normalizeDashboardRankingLimit(query.limit),
    paretoLimit: normalizeDashboardRankingLimit(query.paretoLimit, 500),
  });
}

export async function buildSupplierPerformanceSupplierDetailResponse(
  prisma: SupplierPerformanceDashboardDb,
  query: Record<string, unknown>,
  supplierExternalId: number,
  deps: SupplierPerformanceDashboardDeps = {}
): Promise<DashboardSupplierDetail | null> {
  const filters = parseSupplierPerformanceDashboardFilters(query);
  const input = await loadSupplierPerformanceDashboardInput(prisma, filters, deps);
  return buildSupplierPerformanceSupplierDetail(input, filters, supplierExternalId);
}

export async function buildSupplierPerformanceMaterialDetailResponse(
  prisma: SupplierPerformanceDashboardDb,
  query: Record<string, unknown>,
  materialKey: string,
  deps: SupplierPerformanceDashboardDeps = {}
): Promise<DashboardMaterialDetail | null> {
  const filters = parseSupplierPerformanceDashboardFilters(query);
  const input = await loadSupplierPerformanceDashboardInput(prisma, filters, deps);
  return buildSupplierPerformanceMaterialDetail(input, filters, materialKey);
}

export async function buildSupplierMaterialMatrixResponse(
  prisma: SupplierPerformanceDashboardDb,
  query: Record<string, unknown>,
  deps: SupplierPerformanceDashboardDeps = {}
): Promise<SupplierMaterialMatrixResult> {
  const filters = parseSupplierPerformanceDashboardFilters(query);
  const matrixQuery = parseSupplierMaterialMatrixQuery(query);
  const input = await loadSupplierPerformanceDashboardInput(prisma, filters, deps);
  return buildSupplierMaterialMatrix(input, filters, matrixQuery);
}

/** Opções de matéria-prima para o filtro — busca por código/descrição oficial, identidade por ID. */
export async function searchSupplierPerformanceMaterials(
  prisma: SupplierPerformanceDashboardDb,
  query: Record<string, unknown>
): Promise<{ materials: DashboardMaterialOption[] }> {
  const filters = parseSupplierPerformanceDashboardFilters(query);
  const term = String(Array.isArray(query.q) ? query.q[0] : (query.q ?? query.search ?? "")).trim();
  if (term.length < 2) return { materials: [] };
  const rows = await prisma.nomusPurchaseOrderItem.findMany({
    where: {
      purchaseOrder: buildDashboardOrderWhere(filters),
      OR: [
        { productCode: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
      ],
    },
    select: { productExternalId: true, productCode: true, description: true },
    take: 1000,
  });
  return { materials: buildDashboardMaterialOptions(rows, 20) };
}
