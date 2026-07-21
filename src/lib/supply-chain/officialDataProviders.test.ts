/**
 * OP-04 — Provedores read-only dos motores oficiais.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { OfficialEngineWriteForbiddenError } from "./officialEngineBoundary.js";
import { scanSourceForProtectedModelWrites } from "./officialEngineBoundaryScan.js";
import { createOfficialDataProviders } from "./officialDataProviders.server.js";

const REPO_ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function emptyFindMany() {
  return async () => [];
}

function emptyFindUnique() {
  return async () => null;
}

function emptyFindFirst() {
  return async () => null;
}

describe("createOfficialDataProviders — superfície e contratos", () => {
  it("expõe todos os provedores do OP-04 sem métodos mutáveis", () => {
    const providers = createOfficialDataProviders({
      material: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      product: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      productBOM: { findMany: emptyFindMany() },
      financialSupplier: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      costCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      financialCostCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      salesOrder: { findUnique: emptyFindUnique() },
      nomusProductionOrder: {
        findUnique: emptyFindUnique(),
        findMany: emptyFindMany(),
      },
      project: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      materialCostTableItem: { findFirst: emptyFindFirst() },
      productionCostTableItem: { findFirst: emptyFindFirst() },
      materialMarketQuote: { findFirst: emptyFindFirst() },
      nomusStockDocument: { findUnique: emptyFindUnique() },
      nomusNfe: { findUnique: emptyFindUnique() },
    } as never);

    assert.ok(providers.materials);
    assert.ok(providers.productsBom);
    assert.ok(providers.suppliers);
    assert.ok(providers.opsCostCenters);
    assert.ok(providers.financialCostCenters);
    assert.ok(providers.salesOrders);
    assert.ok(providers.productionOrders);
    assert.ok(providers.projects);
    assert.ok(providers.publishedCosts);
    assert.ok(providers.nomusCrossRefs);

    for (const key of Object.keys(providers) as Array<keyof typeof providers>) {
      const surface = providers[key] as Record<string, unknown>;
      assert.equal("create" in surface, false, `${key} não deve expor create`);
      assert.equal("update" in surface, false, `${key} não deve expor update`);
      assert.equal("delete" in surface, false, `${key} não deve expor delete`);
      assert.equal("upsert" in surface, false, `${key} não deve expor upsert`);
    }
  });

  it("catálogo de matérias-primas retorna id/código/descrição/unidade", async () => {
    const providers = createOfficialDataProviders({
      material: {
        findUnique: async ({ where }: { where: { id?: string; code?: string } }) => {
          if (where.id === "m1" || where.code === "MP-01") {
            return {
              id: "m1",
              code: "MP-01",
              description: "Aço SAE",
              unit: "KG",
              status: "ACTIVE",
              category: "METAL",
            };
          }
          return null;
        },
        findMany: async () => [
          {
            id: "m1",
            code: "MP-01",
            description: "Aço SAE",
            unit: "KG",
            status: "ACTIVE",
            category: "METAL",
          },
        ],
      },
      product: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      productBOM: { findMany: emptyFindMany() },
      financialSupplier: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      costCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      financialCostCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      salesOrder: { findUnique: emptyFindUnique() },
      nomusProductionOrder: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      project: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      materialCostTableItem: { findFirst: emptyFindFirst() },
      productionCostTableItem: { findFirst: emptyFindFirst() },
      materialMarketQuote: { findFirst: emptyFindFirst() },
      nomusStockDocument: { findUnique: emptyFindUnique() },
      nomusNfe: { findUnique: emptyFindUnique() },
    } as never);

    const byId = await providers.materials.findById("m1");
    assert.equal(byId?.code, "MP-01");
    assert.equal(byId?.description, "Aço SAE");
    assert.equal(byId?.unit, "KG");
    const byCode = await providers.materials.findByCode("MP-01");
    assert.equal(byCode?.id, "m1");
    const list = await providers.materials.list({ q: "Aço" });
    assert.equal(list.length, 1);
  });

  it("produtos/BOM, fornecedores, CCs, projetos e OPs retornam refs tipadas", async () => {
    const providers = createOfficialDataProviders({
      material: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      product: {
        findUnique: async () => ({
          id: "p1",
          sku: "SKU-1",
          name: "Produto A",
          description: "Desc",
          status: "ACTIVE",
          type: "PRODUCT",
        }),
        findMany: async () => [
          {
            id: "p1",
            sku: "SKU-1",
            name: "Produto A",
            description: "Desc",
            status: "ACTIVE",
            type: "PRODUCT",
          },
        ],
      },
      productBOM: {
        findMany: async () => [
          {
            id: "b1",
            productId: "p1",
            childProductId: null,
            materialId: "m1",
            quantity: 2.5,
            notes: null,
          },
        ],
      },
      financialSupplier: {
        findUnique: async () => ({
          id: "s1",
          displayName: "Fornecedor X",
          document: "123",
          status: "ACTIVE",
          legalName: "X LTDA",
          tradeName: "X",
        }),
        findMany: async () => [],
      },
      costCenter: {
        findUnique: async () => ({
          id: "cc1",
          code: "CC-01",
          name: "Produção",
          description: null,
          isActive: true,
        }),
        findMany: async () => [],
      },
      financialCostCenter: {
        findUnique: async () => ({
          id: "fcc1",
          code: "FCC-01",
          name: "AP Geral",
          description: null,
          status: "ACTIVE",
        }),
        findMany: async () => [],
      },
      salesOrder: {
        findUnique: async () => ({
          id: "so1",
          orderCode: "PD 0001",
          status: "CONFIRMED",
          customerId: "c1",
        }),
      },
      nomusProductionOrder: {
        findUnique: async () => ({
          id: "op1",
          externalId: 99,
          name: "OP 99",
          status: "OPEN",
          productCode: "SKU-1",
          productDescription: "Produto A",
          quantity: 10,
          unit: "UN",
        }),
        findMany: async () => [],
      },
      project: {
        findUnique: async () => ({
          id: "pr1",
          code: "PRJ-1",
          title: "Projeto Alfa",
          description: null,
          status: "DRAFT",
          customerName: "Cliente",
          projectType: "NEW_PRODUCT",
        }),
        findMany: async () => [],
      },
      materialCostTableItem: { findFirst: emptyFindFirst() },
      productionCostTableItem: { findFirst: emptyFindFirst() },
      materialMarketQuote: { findFirst: emptyFindFirst() },
      nomusStockDocument: {
        findUnique: async () => ({
          id: "sd1",
          externalId: 1,
          documentNumber: "DOC-1",
          tipoDocumentoEstoque: "DocumentoSaida",
          statusRaw: "OK",
          personName: "Cliente",
          movementDate: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
      nomusNfe: {
        findUnique: async () => ({
          id: "nfe1",
          externalId: 2,
          numero: "100",
          serie: "1",
          chave: "NFe...",
          cnpjEmitente: "00",
          isFornecedor: 1,
        }),
      },
    } as never);

    const product = await providers.productsBom.findProductBySku("SKU-1");
    assert.equal(product?.name, "Produto A");
    const bom = await providers.productsBom.listBomByProductId("p1");
    assert.equal(bom[0]?.quantity, 2.5);
    assert.equal(bom[0]?.materialId, "m1");

    const supplier = await providers.suppliers.findById("s1");
    assert.equal(supplier?.displayName, "Fornecedor X");

    const opsCc = await providers.opsCostCenters.findById("cc1");
    assert.equal(opsCc?.code, "CC-01");
    const finCc = await providers.financialCostCenters.findById("fcc1");
    assert.equal(finCc?.code, "FCC-01");

    const so = await providers.salesOrders.findByOrderCode("PD 0001");
    assert.equal(so?.id, "so1");

    const op = await providers.productionOrders.findByExternalId(99);
    assert.equal(op?.productCode, "SKU-1");
    assert.equal(op?.quantity, 10);

    const project = await providers.projects.findByCode("PRJ-1");
    assert.equal(project?.title, "Projeto Alfa");

    const stock = await providers.nomusCrossRefs.findStockDocumentById("sd1");
    assert.equal(stock?.tipoDocumentoEstoque, "DocumentoSaida");
    const nfe = await providers.nomusCrossRefs.findNfeById("nfe1");
    assert.equal(nfe?.numero, "100");
  });

  it("custos publicados e cotação oficial de mercado (referência)", async () => {
    const providers = createOfficialDataProviders({
      material: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      product: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      productBOM: { findMany: emptyFindMany() },
      financialSupplier: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      costCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      financialCostCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      salesOrder: { findUnique: emptyFindUnique() },
      nomusProductionOrder: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      project: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      materialCostTableItem: {
        findFirst: async () => ({
          materialId: "m1",
          materialCodeSnapshot: "MP-01",
          materialDescriptionSnapshot: "Aço",
          unitSnapshot: "KG",
          landedCostSnapshot: 12.5,
          currentCostSnapshot: 11,
          materialCostTableVersion: {
            id: "v1",
            code: "MAT-COST",
            revision: 3,
            publishedAt: new Date("2026-06-01T00:00:00.000Z"),
            effectiveDate: new Date("2026-06-01T00:00:00.000Z"),
          },
        }),
      },
      productionCostTableItem: {
        findFirst: async () => ({
          productId: "p1",
          productCodeSnapshot: "SKU-1",
          productNameSnapshot: "Produto A",
          unitProductionCost: 40,
          materialCost: 20,
          currency: "BRL",
          costTableVersion: {
            id: "pv1",
            code: "PROD-COST",
            revision: 2,
            publishedAt: new Date("2026-06-02T00:00:00.000Z"),
            effectiveDate: new Date("2026-06-02T00:00:00.000Z"),
          },
        }),
      },
      materialMarketQuote: {
        findFirst: async () => ({
          id: "q1",
          materialId: "m1",
          unit: "KG",
          netPrice: 13.1,
          currency: "BRL",
          quoteDate: new Date("2026-05-01T00:00:00.000Z"),
          supplierName: "Fornecedor",
          isOfficialReference: true,
        }),
      },
      nomusStockDocument: { findUnique: emptyFindUnique() },
      nomusNfe: { findUnique: emptyFindUnique() },
    } as never);

    const matCost = await providers.publishedCosts.findPublishedMaterialCost("m1");
    assert.equal(matCost?.landedCost, 12.5);
    assert.equal(matCost?.unit, "KG");
    assert.equal(matCost?.versionRevision, 3);

    const prodCost = await providers.publishedCosts.findPublishedProductCost("p1");
    assert.equal(prodCost?.unitProductionCost, 40);
    assert.equal(prodCost?.productCode, "SKU-1");

    const quote = await providers.publishedCosts.findOfficialMarketQuote("m1");
    assert.equal(quote?.isOfficialReference, true);
    assert.equal(quote?.netPrice, 13.1);
  });

  it("superfície pública não expõe create e não chama create no delegate", async () => {
    let created = false;
    const materialDelegate = {
      findUnique: emptyFindUnique(),
      findMany: emptyFindMany(),
      create: async () => {
        created = true;
        return {};
      },
    };
    const providers = createOfficialDataProviders({
      material: materialDelegate,
      product: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      productBOM: { findMany: emptyFindMany() },
      financialSupplier: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      costCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      financialCostCenter: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      salesOrder: { findUnique: emptyFindUnique() },
      nomusProductionOrder: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      project: { findUnique: emptyFindUnique(), findMany: emptyFindMany() },
      materialCostTableItem: { findFirst: emptyFindFirst() },
      productionCostTableItem: { findFirst: emptyFindFirst() },
      materialMarketQuote: { findFirst: emptyFindFirst() },
      nomusStockDocument: { findUnique: emptyFindUnique() },
      nomusNfe: { findUnique: emptyFindUnique() },
    } as never);

    await providers.materials.findById("x");
    assert.equal(created, false);
    assert.equal("create" in providers.materials, false);
    assert.equal("update" in providers.publishedCosts, false);
  });
});

describe("fonte providers — proteção estática e consumo SC", () => {
  it("officialDataProviders.server.ts não contém writes em oficiais", () => {
    const src = read("src/lib/supply-chain/officialDataProviders.server.ts");
    assert.deepEqual(scanSourceForProtectedModelWrites("providers.ts", src), []);
    assert.doesNotMatch(src, /\.create\s*\(/);
    assert.doesNotMatch(src, /\.update\s*\(/);
    assert.doesNotMatch(src, /\.upsert\s*\(/);
    assert.doesNotMatch(src, /\.delete\s*\(/);
    assert.doesNotMatch(src, /forecast|InventoryDemand|computeProjectedAvailable/i);
  });

  it("contratos não importam Prisma", () => {
    const src = read("src/lib/supply-chain/officialEngineReadOnlyContracts.ts");
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /PrismaClient/);
  });

  it("solicitações de compra usam createOfficialDataProviders (não prisma.material direto)", () => {
    const server = read("server.ts");
    assert.match(server, /createOfficialDataProviders/);
    // Trecho de purchase-requests: material via provider
    assert.match(server, /txReads\.materials\.findById/);
    assert.match(server, /officialReads\.opsCostCenters\.findById/);
    // Não deve restar findUnique de material dentro do bloco purchase-request create/update
    const createIdx = server.indexOf('app.post("/api/purchase-requests"');
    const putIdx = server.indexOf('app.put("/api/purchase-requests/:id"');
    const bomIdx = server.indexOf("// --- Helper Functions for Recursive BOM ---");
    assert.ok(createIdx > 0 && putIdx > createIdx && bomIdx > putIdx);
    const purchaseBlock = server.slice(createIdx, bomIdx);
    assert.doesNotMatch(purchaseBlock, /(?:prisma|tx)\.material\.findUnique/);
    assert.doesNotMatch(purchaseBlock, /(?:prisma|tx)\.costCenter\.findUnique/);
  });

  it("proxy rejeita write se alguém acessar create no delegate protegido", async () => {
    const { createOfficialEngineReadOnlyDelegateProxy } = await import(
      "./officialEngineWriteGuard.js"
    );
    const proxy = createOfficialEngineReadOnlyDelegateProxy("project", {
      findUnique: async () => null,
      create: async () => ({ id: "x" }),
    });
    await assert.rejects(
      async () => (proxy as { create: () => Promise<unknown> }).create(),
      (err: unknown) => err instanceof OfficialEngineWriteForbiddenError
    );
  });
});
