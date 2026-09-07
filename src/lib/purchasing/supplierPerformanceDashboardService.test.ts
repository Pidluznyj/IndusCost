/**
 * Compras → Performance — serviço: carga em lote com Prisma substituído por um
 * duplo em memória. Prova nº CONSTANTE de consultas (sem N+1), where canônico,
 * flag da avaliação fail-closed e paridade com o motor puro.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ResolvedPurchaseOrderSupplier } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import {
  buildDashboardOrderWhere,
  buildSupplierMaterialMatrixResponse,
  buildSupplierPerformanceDashboardResponse,
  buildSupplierPerformanceMaterialDetailResponse,
  buildSupplierPerformanceSupplierDetailResponse,
  loadSupplierPerformanceDashboardInput,
  searchSupplierPerformanceMaterials,
  type SupplierPerformanceDashboardDb,
} from "./supplierPerformanceDashboard.server.js";
import { buildSupplierPerformanceDashboard } from "./supplierPerformanceDashboard.js";
import {
  FIXTURE_CATALOG,
  FIXTURE_EVALUATIONS,
  FIXTURE_FILTERS_2026,
  FIXTURE_IDENTITIES,
  FIXTURE_LINES,
  FIXTURE_NOW,
  FIXTURE_ORDERS,
  S1,
  buildFixtureInput,
} from "./supplierPerformanceDashboardFixture.test-helper.js";

class Dec {
  constructor(private readonly v: number) {}
  toString(): string {
    return String(this.v);
  }
}

function dec(v: number | null): Dec | null {
  return v == null ? null : new Dec(v);
}

type QueryLog = string[];

/** Duplo Prisma: registra cada consulta; não interpreta o where (o motor puro reaplica os filtros). */
function createFakePrisma(options: { supplierCount?: number } = {}): { prisma: SupplierPerformanceDashboardDb; log: QueryLog } {
  const log: QueryLog = [];
  const extraSuppliers = options.supplierCount ?? 0;
  const orders = [...FIXTURE_ORDERS];
  const lines = [...FIXTURE_LINES];
  for (let i = 0; i < extraSuppliers; i += 1) {
    const id = 1000 + i;
    orders.push({
      id: `x${i}`,
      externalId: 500 + i,
      orderNumber: `PC-X${i}`,
      supplierExternalId: id,
      supplierName: `Fornecedor ${id}`,
      supplierTaxId: null,
      stage: "RECEIVED",
      canceled: false,
      issuedAt: new Date("2026-06-15T12:00:00"),
      firstSeenAt: new Date("2026-06-15T12:00:00"),
      expectedAt: null,
      currency: null,
      totalAmount: 10,
      paymentTerms: null,
    });
    lines.push({ purchaseOrderId: `x${i}`, lineIndex: 0, lineExternalId: null, productExternalId: 1, productCode: "MP-001", description: "Aço 1020", unit: "KG", orderedQuantity: 1, receivedQuantity: null, unitPrice: 10, totalAmount: 10 });
  }
  const prisma = {
    nomusPurchaseOrder: {
      findMany: async (args: unknown) => {
        log.push("nomusPurchaseOrder.findMany");
        void args;
        return orders.map((o) => ({ ...o, totalAmount: dec(o.totalAmount) }));
      },
      findFirst: async () => {
        log.push("nomusPurchaseOrder.findFirst");
        return { syncedAt: new Date("2026-09-06T03:00:00Z") };
      },
      aggregate: async () => {
        log.push("nomusPurchaseOrder.aggregate");
        return {
          _min: { issuedAt: new Date("2025-12-01T12:00:00"), firstSeenAt: new Date("2026-01-01T12:00:00") },
          _max: { issuedAt: new Date("2026-06-15T12:00:00"), firstSeenAt: new Date("2026-06-01T12:00:00") },
        };
      },
    },
    nomusPurchaseOrderItem: {
      findMany: async (args: { where?: { OR?: unknown } }) => {
        log.push("nomusPurchaseOrderItem.findMany");
        const rows = lines.map((l) => ({
          ...l,
          orderedQuantity: dec(l.orderedQuantity),
          receivedQuantity: dec(l.receivedQuantity),
          unitPrice: dec(l.unitPrice),
          totalAmount: dec(l.totalAmount),
        }));
        if (args?.where?.OR) return rows.filter((r) => /res/i.test(`${r.productCode} ${r.description}`));
        return rows;
      },
    },
    nomusPurchaseOrderSupplierEvaluation: {
      findMany: async () => {
        log.push("nomusPurchaseOrderSupplierEvaluation.findMany");
        return FIXTURE_EVALUATIONS.map((e) => ({
          ...e,
          overallScore: new Dec(e.overallScore),
          qualityScore: new Dec(e.qualityScore),
          deliveryScore: new Dec(e.deliveryScore),
          conformityScore: new Dec(e.conformityScore),
          serviceScore: new Dec(e.serviceScore),
        }));
      },
    },
    nomusProductCatalog: {
      findMany: async () => {
        log.push("nomusProductCatalog.findMany");
        return FIXTURE_CATALOG;
      },
    },
    financialSupplier: {
      findMany: async (args: { where: { id: { in: string[] } } }) => {
        log.push("financialSupplier.findMany");
        return args.where.id.in.map((id) => ({ id, status: "ACTIVE" }));
      },
    },
  } as unknown as SupplierPerformanceDashboardDb;
  return { prisma, log };
}

const resolveSuppliers = async (
  samples: Array<{ supplierExternalId: number | null; supplierName: string | null; supplierTaxId: string | null }>
): Promise<ResolvedPurchaseOrderSupplier[]> =>
  samples.map((sample) => {
    const known = FIXTURE_IDENTITIES.find((row) => row.supplierExternalId === sample.supplierExternalId);
    return {
      nomusExternalId: sample.supplierExternalId,
      nomusName: sample.supplierName,
      nomusDocument: sample.supplierTaxId,
      resolvedName: known?.resolvedName ?? sample.supplierName,
      resolvedDocument: known?.resolvedDocument ?? sample.supplierTaxId,
      financialSupplierId: known?.financialSupplierId ?? null,
      matchMethod: (known?.matchMethod ?? "UNRESOLVED") as ResolvedPurchaseOrderSupplier["matchMethod"],
      matchConfidence: (known?.matchConfidence ?? "UNRESOLVED") as ResolvedPurchaseOrderSupplier["matchConfidence"],
      matched: known != null,
      ambiguous: false,
      source: "test",
    };
  });

const QUERY = { from: "2026-01-01", to: "2026-12-31" };

describe("where canônico", () => {
  it("período reutiliza periodWhere da Avaliação (COALESCE issuedAt/firstSeenAt) e nega o predicado de cancelado", () => {
    const where = buildDashboardOrderWhere({ period: { from: "2026-01-01", to: "2026-01-31" }, includeCanceled: false });
    const json = JSON.stringify(where);
    assert.match(json, /"issuedAt":\{"gte"/);
    assert.match(json, /"firstSeenAt"/);
    assert.match(json, /"stage":\{"not":"CANCELED"\}/);
    assert.match(json, /"canceled":false/);
    const all = buildDashboardOrderWhere({ period: { from: null, to: null }, includeCanceled: true });
    assert.deepEqual(all, {});
  });
});

describe("carga em lote — sem N+1", () => {
  it("número de consultas é constante independente do nº de fornecedores/materiais", async () => {
    const small = createFakePrisma({ supplierCount: 0 });
    await loadSupplierPerformanceDashboardInput(small.prisma, { ...FIXTURE_FILTERS_2026 }, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    const large = createFakePrisma({ supplierCount: 250 });
    await loadSupplierPerformanceDashboardInput(large.prisma, { ...FIXTURE_FILTERS_2026 }, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    assert.deepEqual(large.log, small.log);
    assert.deepEqual(small.log.sort(), [
      "financialSupplier.findMany",
      "nomusProductCatalog.findMany",
      "nomusPurchaseOrder.aggregate",
      "nomusPurchaseOrder.findFirst",
      "nomusPurchaseOrder.findMany",
      "nomusPurchaseOrderItem.findMany",
      "nomusPurchaseOrderSupplierEvaluation.findMany",
    ]);
  });

  it("flag da avaliação OFF: não consulta avaliações e marca seção indisponível (fail closed)", async () => {
    const fake = createFakePrisma();
    const model = await buildSupplierPerformanceDashboardResponse(fake.prisma, QUERY, { resolveSuppliers, evaluationFeatureEnabled: false, now: FIXTURE_NOW });
    assert.ok(!fake.log.includes("nomusPurchaseOrderSupplierEvaluation.findMany"));
    assert.equal(model.evaluation.available, false);
    assert.equal(model.kpis.evaluationScore, null);
  });

  it("nenhuma escrita: o serviço só expõe leituras (create/update/delete ausentes)", async () => {
    const fs = await import("node:fs");
    const source = fs.readFileSync("src/lib/purchasing/supplierPerformanceDashboard.server.ts", "utf8");
    assert.doesNotMatch(source, /\.(create|update|updateMany|delete|deleteMany|upsert)\(/);
    assert.doesNotMatch(source, /\$transaction|\$executeRaw|fetchNomus/);
  });
});

describe("paridade serviço × motor puro", () => {
  it("read model do serviço é idêntico ao motor puro alimentado com a mesma fixture", async () => {
    const fake = createFakePrisma();
    const viaService = await buildSupplierPerformanceDashboardResponse(fake.prisma, QUERY, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    const direct = buildSupplierPerformanceDashboard(
      buildFixtureInput({ lastSyncedAt: new Date("2026-09-06T03:00:00Z"), availableYears: [2026, 2025] }),
      FIXTURE_FILTERS_2026
    );
    assert.deepEqual(viaService.kpis, direct.kpis);
    assert.deepEqual(viaService.suppliers, direct.suppliers);
    assert.deepEqual(viaService.rankings, direct.rankings);
    assert.deepEqual(viaService.concentration, direct.concentration);
    assert.deepEqual(viaService.pricing, direct.pricing);
    assert.deepEqual(viaService.metadata.availableYears, [2026, 2025]);
    assert.equal(viaService.metadata.lastSyncedAt, "2026-09-06T03:00:00.000Z");
  });

  it("identidade EXACT/HIGH liga cadastro (status) e FALLBACK nunca grava financialSupplierId", async () => {
    const fake = createFakePrisma();
    const input = await loadSupplierPerformanceDashboardInput(fake.prisma, FIXTURE_FILTERS_2026, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    const s1 = input.supplierIdentities.find((row) => row.supplierExternalId === S1)!;
    assert.equal(s1.financialSupplierId, "fs-1");
    assert.equal(s1.registryStatus, "ACTIVE");
    const s2 = input.supplierIdentities.find((row) => row.supplierExternalId === 102)!;
    assert.equal(s2.financialSupplierId, null);
    assert.equal(s2.registryStatus, null);
  });

  it("detalhe do fornecedor, detalhe da MP, matriz e busca de MP passam pelo mesmo carregador", async () => {
    const fake = createFakePrisma();
    const supplier = await buildSupplierPerformanceSupplierDetailResponse(fake.prisma, QUERY, S1, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    assert.equal(supplier?.purchases.spend, 1800);
    const missing = await buildSupplierPerformanceSupplierDetailResponse(fake.prisma, QUERY, 999, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    assert.equal(missing, null);
    const material = await buildSupplierPerformanceMaterialDetailResponse(fake.prisma, QUERY, "nomus:2", { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    assert.equal(material?.totals.spend, 1700);
    const matrix = await buildSupplierMaterialMatrixResponse(fake.prisma, { ...QUERY, pageSize: "3", page: "2" }, { resolveSuppliers, evaluationFeatureEnabled: true, now: FIXTURE_NOW });
    assert.equal(matrix.rows.length, 3);
    assert.equal(matrix.total, 6);
    const search = await searchSupplierPerformanceMaterials(fake.prisma, { ...QUERY, q: "res" });
    assert.deepEqual(search.materials.map((m) => m.materialKey), ["nomus:2"]);
    const short = await searchSupplierPerformanceMaterials(fake.prisma, { ...QUERY, q: "r" });
    assert.deepEqual(short.materials, []);
  });
});
