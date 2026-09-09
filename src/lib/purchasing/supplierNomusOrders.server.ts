/**
 * Pedidos Nomus de UM fornecedor (aba Desempenho do cadastro) — servidor.
 *
 * População = OR(
 *   chave 1: `supplierExternalId IN aliases exclusivos do fornecedor`,
 *   chave 2: `supplierTaxId IN grafias do documento` quando o documento é único
 *            no cadastro, excluindo pedidos cujo `supplierExternalId` está
 *            aliasado a OUTRO fornecedor (o resolvedor oficial dá prioridade ao
 *            alias e devolve esse outro fornecedor, ou UNRESOLVED se ambíguo)
 * ) ∧ período (COALESCE(issuedAt, firstSeenAt), mesma janela da worklist).
 *
 * Todas as consultas são por chave (id do fornecedor, aliases, documento);
 * nenhuma varre a tabela de pedidos nem consulta pedido a pedido. A página é
 * verificada pelo resolvedor batch do 360 (mesma identidade da worklist e do
 * 360): linha que não resolva para ESTE fornecedor com identidade segura é
 * descartada e contada em `identity.excludedOnPage` (esperado 0).
 *
 * Sem writeback Nomus. Sem mistura com PurchaseOrder interno.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeSupplierDocument } from "@/src/lib/financeSupplierIdentity.js";
import {
  andNomusPurchaseOrderWhere,
  buildNomusSupplierEvaluationWorklistFromWhere,
  periodWhere,
  type NomusSupplierEvaluationWorklistDeps,
} from "./nomusPurchaseOrderEvaluation.server.js";
import {
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SupplierEvaluationError,
  buildSupplierPerformanceSummary,
  getSupplierEvaluationMethodology,
  type SupplierPerformanceEvaluationStatusFilter,
  type SupplierPerformancePeriod,
} from "./supplierPerformance.js";
import {
  buildSupplierDocumentTaxIdVariants,
  isNomusOrderRowAttributableToSupplier,
  type SupplierNomusOrdersDetailResponse,
  type SupplierNomusOrdersIdentityDto,
} from "./supplierNomusOrders.js";

export type SupplierNomusOrdersDb = Pick<
  PrismaClient,
  "financialSupplier" | "financialSupplierAlias" | "nomusPurchaseOrder"
>;

export type SupplierNomusOrdersDeps = NomusSupplierEvaluationWorklistDeps & {
  /** Núcleo da worklist — injetável em teste (sem banco). */
  buildWorklist?: typeof buildNomusSupplierEvaluationWorklistFromWhere;
};

export type SupplierNomusOrdersIdentity = Omit<SupplierNomusOrdersIdentityDto, "excludedOnPage"> & {
  /** WHERE da população do fornecedor (sem período); null quando não há chave segura. */
  where: Prisma.NomusPurchaseOrderWhereInput | null;
};

type SupplierHeader = { id: string; name: string; document: string | null; status: string };

function distinctIds(rows: Array<{ externalSupplierId: number | null }>): number[] {
  return [...new Set(rows.map((row) => row.externalSupplierId).filter((id): id is number => id != null))].sort(
    (a, b) => a - b
  );
}

/**
 * Chaves seguras do fornecedor (alias exclusivo, documento único) e o WHERE da
 * população. Consultas: cadastro, aliases próprios, aliases compartilhados,
 * donos do documento, ids Nomus vistos com o documento, aliases desses ids em
 * outros fornecedores — todas por chave.
 */
export async function resolveSupplierNomusOrdersIdentity(
  prisma: SupplierNomusOrdersDb,
  supplierId: string
): Promise<{ supplier: SupplierHeader; identity: SupplierNomusOrdersIdentity }> {
  const supplier = await prisma.financialSupplier.findUnique({
    where: { id: supplierId },
    select: { id: true, displayName: true, document: true, normalizedDocument: true, status: true },
  });
  if (!supplier) {
    throw new SupplierEvaluationError("SUPPLIER_NOT_FOUND", "Fornecedor não encontrado.");
  }

  // Chave 1 — aliases Nomus exclusivos deste fornecedor.
  const ownAliases = await prisma.financialSupplierAlias.findMany({
    where: { supplierId, externalSupplierId: { not: null } },
    select: { externalSupplierId: true },
  });
  const candidateIds = distinctIds(ownAliases);
  const sharedRows = candidateIds.length
    ? await prisma.financialSupplierAlias.findMany({
        where: { externalSupplierId: { in: candidateIds }, supplierId: { not: supplierId } },
        select: { externalSupplierId: true },
      })
    : [];
  const ambiguousExternalIds = distinctIds(sharedRows);
  const ambiguous = new Set(ambiguousExternalIds);
  const aliasExternalIds = candidateIds.filter((id) => !ambiguous.has(id));

  // Chave 2 — documento normalizado único no cadastro (mesma regra do resolvedor:
  // `FinancialSupplier.normalizedDocument`, qualquer status).
  const normalizedDocument =
    supplier.normalizedDocument ?? normalizeSupplierDocument(supplier.document);
  const documentOwners = normalizedDocument
    ? await prisma.financialSupplier.count({ where: { normalizedDocument } })
    : 0;
  const documentUnique = normalizedDocument != null && documentOwners === 1;

  const branches: Prisma.NomusPurchaseOrderWhereInput[] = [];
  if (aliasExternalIds.length > 0) {
    branches.push({ supplierExternalId: { in: aliasExternalIds } });
  }
  if (documentUnique && normalizedDocument) {
    const variants = buildSupplierDocumentTaxIdVariants(normalizedDocument);
    // Ids Nomus vistos com este documento; os aliasados a OUTRO fornecedor saem
    // (o resolvedor prioriza o alias). Os aliasados só a nós já estão na chave 1.
    const seenRows = await prisma.nomusPurchaseOrder.findMany({
      where: { supplierTaxId: { in: variants }, supplierExternalId: { not: null } },
      select: { supplierExternalId: true },
      distinct: ["supplierExternalId"],
    });
    const seenIds = distinctIds(
      seenRows.map((row) => ({ externalSupplierId: row.supplierExternalId }))
    );
    const excludedIds = seenIds.length
      ? distinctIds(
          await prisma.financialSupplierAlias.findMany({
            where: { externalSupplierId: { in: seenIds }, supplierId: { not: supplierId } },
            select: { externalSupplierId: true },
          })
        )
      : [];
    branches.push({
      supplierTaxId: { in: variants },
      ...(excludedIds.length
        ? { OR: [{ supplierExternalId: null }, { supplierExternalId: { notIn: excludedIds } }] }
        : {}),
    });
  }

  const where: Prisma.NomusPurchaseOrderWhereInput | null =
    branches.length === 0 ? null : branches.length === 1 ? branches[0]! : { OR: branches };

  return {
    supplier: {
      id: supplier.id,
      name: supplier.displayName,
      document: supplier.document,
      status: supplier.status,
    },
    identity: {
      aliasExternalIds,
      ambiguousExternalIds,
      normalizedDocument,
      documentUnique,
      documentOwners,
      matchable: where != null,
      where,
    },
  };
}

function emptyResponse(
  supplier: SupplierHeader,
  identity: SupplierNomusOrdersIdentity,
  params: { period: SupplierPerformancePeriod; page: number; pageSize: number }
): SupplierNomusOrdersDetailResponse {
  const methodology = getSupplierEvaluationMethodology(SUPPLIER_EVALUATION_METHODOLOGY_VERSION);
  const { where: _where, ...identityDto } = identity;
  return {
    supplier,
    period: params.period,
    identity: { ...identityDto, excludedOnPage: 0 },
    scaleMin: methodology.scaleMin,
    scaleMax: methodology.scaleMax,
    kpis: buildSupplierPerformanceSummary({
      eligibleOrders: 0,
      evaluatedOrders: 0,
      averages: { overall: null, quality: null, delivery: null, conformity: null, service: null },
    }),
    orders: { page: 1, pageSize: params.pageSize, total: 0, totalPages: 0, items: [] },
  };
}

/**
 * Pedidos Nomus de UM fornecedor no período, com KPIs próprios (só Nomus) e
 * paginação no servidor. Sem chave segura → resposta vazia sem consultar pedidos.
 */
export async function buildSupplierNomusOrdersDetail(
  prisma: SupplierNomusOrdersDb,
  supplierId: string,
  params: {
    period: SupplierPerformancePeriod;
    evaluationStatus: SupplierPerformanceEvaluationStatusFilter;
    page: number;
    pageSize: number;
  },
  deps: SupplierNomusOrdersDeps = {}
): Promise<SupplierNomusOrdersDetailResponse> {
  const { supplier, identity } = await resolveSupplierNomusOrdersIdentity(prisma, supplierId);
  if (!identity.where) return emptyResponse(supplier, identity, params);

  const base = andNomusPurchaseOrderWhere([identity.where, periodWhere(params.period)]);
  const buildWorklist = deps.buildWorklist ?? buildNomusSupplierEvaluationWorklistFromWhere;
  const worklistDeps: NomusSupplierEvaluationWorklistDeps = deps.resolveSuppliers
    ? { resolveSuppliers: deps.resolveSuppliers }
    : {};

  let worklist = await buildWorklist(
    prisma as PrismaClient,
    base,
    { evaluationStatus: params.evaluationStatus, page: params.page, pageSize: params.pageSize },
    worklistDeps
  );
  let totalPages = worklist.total === 0 ? 0 : Math.ceil(worklist.total / worklist.pageSize);
  // Página além do fim (ex.: filtro mudou): recua para a última página válida.
  if (worklist.total > 0 && worklist.items.length === 0 && params.page > totalPages) {
    worklist = await buildWorklist(
      prisma as PrismaClient,
      base,
      { evaluationStatus: params.evaluationStatus, page: totalPages, pageSize: params.pageSize },
      worklistDeps
    );
    totalPages = worklist.total === 0 ? 0 : Math.ceil(worklist.total / worklist.pageSize);
  }

  const items = worklist.items.filter((row) => isNomusOrderRowAttributableToSupplier(row, supplierId));
  const { where: _where, ...identityDto } = identity;

  return {
    supplier,
    period: params.period,
    identity: { ...identityDto, excludedOnPage: worklist.items.length - items.length },
    scaleMin: worklist.scaleMin,
    scaleMax: worklist.scaleMax,
    kpis: worklist.kpis,
    orders: {
      page: worklist.page,
      pageSize: worklist.pageSize,
      total: worklist.total,
      totalPages,
      items,
    },
  };
}
