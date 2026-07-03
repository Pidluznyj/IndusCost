/**
 * Testes de caracterização — baseline da arquitetura custo/preço/margem.
 *
 * Documentam o comportamento ATUAL antes da sequência de implementação.
 * Não alteram regras de negócio; servem como trava de regressão.
 *
 * Ver: docs/architecture/versioned-cost-price-margin.md
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  PRODUCTION_COST_TABLE_ELIGIBLE_ITEM_TYPES,
  productionCostTableEligibleItemTypesFilter,
} from "./productEngineeringCostSnapshot.js";
import {
  assertProductionCostTableVersionEditable,
  isProductionCostTableVersionEditable,
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";
import {
  parseSalesOrderItemStoredUnitCost,
  resolveSalesOrderItemCost,
  resolveSalesOrderItemCostFromVersionedProduction,
} from "./salesOrderMarginResolver.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function d(iso: string): Date {
  return civilDateToLocalDate(iso);
}

function version(
  partial: Partial<ProductionCostTableVersionWithItems> &
    Pick<
      ProductionCostTableVersionWithItems,
      "id" | "code" | "name" | "effectiveDate" | "status" | "revision"
    >
): ProductionCostTableVersionWithItems {
  return {
    publishedAt: null,
    createdAt: d("2026-06-01"),
    items: [],
    ...partial,
  };
}

function item(productId: string, unitProductionCost: number, versionId: string) {
  return {
    id: `${versionId}-${productId}`,
    costTableVersionId: versionId,
    productId,
    productCodeSnapshot: productId.toUpperCase(),
    productNameSnapshot: `Item ${productId}`,
    unitProductionCost,
    currency: "BRL",
    calculationHash: "hash-baseline",
    calculationSnapshot: null,
    createdAt: d("2026-06-01"),
    breakdown: {
      materialCost: 0,
      processCost: 0,
      laborCost: 0,
      machineCost: 0,
      overheadCost: 0,
      otherCost: 0,
    },
  };
}

describe("versionedCostArchitectureBaseline — imutabilidade produção", () => {
  it("versão PUBLISHED não é editável (caracterização)", () => {
    assert.equal(isProductionCostTableVersionEditable("DRAFT"), true);
    assert.equal(isProductionCostTableVersionEditable("PUBLISHED"), false);
    assert.equal(isProductionCostTableVersionEditable("SUPERSEDED"), false);
    assert.throws(() => assertProductionCostTableVersionEditable("PUBLISHED", "publicar"));
  });

  it("servidor bloqueia edição de versão imutável via assertProductionCostTableVersionEditable", () => {
    const src = read("src/lib/productionCostTables.server.ts");
    assert.match(src, /assertProductionCostTableVersionEditable/);
    assert.match(src, /PRODUCTION_COST_TABLE_IMMUTABLE_STATUSES/);
  });

  it("publicação exige custo unitário positivo — não aceita zero silencioso", () => {
    const src = read("src/lib/productionCostTables.server.ts");
    assert.match(src, /classifyProductionCostItemForPublication/);
    assert.match(src, /isPublishableProductionUnitCost|productionCostDecimalToNumber/);
  });
});

describe("versionedCostArchitectureBaseline — margem e unitCost", () => {
  it("SalesOrderItem.unitCost comercial não substitui custo de produção na margem", () => {
    const stored = parseSalesOrderItemStoredUnitCost(99.99);
    assert.equal(stored, 99.99);

    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "line-1",
      productId: "prod-1",
      storedUnitCost: 99.99,
      analysis: null,
      costLog: null,
      costPolicy: { allowLiveCostFallback: false, useFrozenUnitCostFirst: false },
    });
    assert.equal(cost.unitCost, null);
    assert.equal(cost.costSource, "MISSING_COST");
    assert.match(cost.notes.join(" "), /Fallback de custo estimado desabilitado/i);
  });

  it("margem oficial usa buildSalesOrderMarginInputsFromVersionedProductionCosts", () => {
    const service = read("src/lib/salesOrderMarginService.server.ts");
    assert.match(service, /buildSalesOrderMarginInputsFromVersionedProductionCosts/);
    assert.doesNotMatch(
      service,
      /buildSalesOrderMarginInputs\(\s*\n\s*prisma,\s*\n\s*resolverItems,\s*\n\s*resolveAnalysis/
    );
  });

  it("resolveSalesOrderItemCostFromVersionedProduction usa VERSIONED_PRODUCTION_COST", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v1",
        code: "2026-06",
        name: "Jun/2026",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [item("comp-1", 12.5, "v1")],
      }),
    ];
    const issueDate = d("2026-06-15");
    const effective = resolveEffectiveProductProductionCostFromCatalog(catalog, "comp-1", issueDate);
    assert.equal(effective.status, "OK");

    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "so-line-1",
      productId: "comp-1",
      referenceDate: issueDate,
      effectiveCost: effective.status === "OK" ? effective : null,
    });
    assert.equal(cost.costSource, "VERSIONED_PRODUCTION_COST");
    assert.equal(cost.unitCost, 12.5);
    assert.equal(cost.marginCostMode, "HISTORICAL_FROZEN");
  });
});

describe("versionedCostArchitectureBaseline — vigência por issueDate", () => {
  it("custo vigente escolhe versão com effectiveDate <= issueDate e maior revision", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v-old",
        code: "2026-06",
        name: "Jun v1",
        effectiveDate: d("2026-06-01"),
        status: "SUPERSEDED",
        revision: 1,
        items: [item("prod-a", 10, "v-old")],
      }),
      version({
        id: "v-new",
        code: "2026-06",
        name: "Jun v2",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 2,
        items: [item("prod-a", 11.5, "v-new")],
      }),
    ];
    const ref = d("2026-06-10");
    const effective = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-a", ref);
    assert.equal(effective.status, "OK");
    if (effective.status === "OK") {
      assert.equal(effective.unitProductionCost, 11.5);
      assert.equal(effective.revision, 2);
    }
  });

  it("versão com effectiveDate posterior à issueDate não aplica", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v-future",
        code: "2026-07",
        name: "Jul/2026",
        effectiveDate: d("2026-07-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [item("prod-a", 20, "v-future")],
      }),
    ];
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      d("2026-06-15")
    );
    assert.equal(effective.status, "SEM_CUSTO");
  });
});

describe("versionedCostArchitectureBaseline — preço comercial (as-is)", () => {
  it("generate-draft de preço usa custo de produção publicado, não getProductCostAnalysis vivo", () => {
    const server = read("server.ts");
    const block = server.slice(
      server.indexOf('app.post("/api/price-tables/:priceTableId/versions/generate-draft"'),
      server.indexOf('app.get("/api/price-table-versions/:id/items"')
    );
    assert.match(block, /generatePriceTableVersionDraftFromProductionCosts/);
    assert.doesNotMatch(block, /getProductCostAnalysis/);
  });

  it("generate-draft de preço inclui produtos e componentes via resolveProductsForProductionCostDraft", () => {
    const pub = read("src/lib/priceTablePublication.server.ts");
    assert.match(pub, /resolveProductsForProductionCostDraft/);
    assert.match(pub, /DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE/);
    assert.doesNotMatch(pub, /getProductCostAnalysis/);
  });

  it("PriceTableVersion grava productionCostTableVersionId na geração", () => {
    const pub = read("src/lib/priceTablePublication.server.ts");
    assert.match(pub, /productionCostTableVersionId: productionCostVersion\.id/);
  });

  it("publicação de preço arquiva versão PUBLISHED anterior — preço congelado por versão", () => {
    const server = read("server.ts");
    const block = server.slice(
      server.indexOf('app.post("/api/price-table-versions/:id/publish"'),
      server.indexOf('app.get("/api/production-cost-tables/versions"')
    );
    assert.match(block, /status:\s*"ARCHIVED"/);
    assert.match(block, /effectiveTo/);
  });

  it("GET /api/price-tables/production-cost-source preview para geração comercial", () => {
    const server = read("server.ts");
    assert.match(server, /\/api\/price-tables\/production-cost-source/);
    assert.match(server, /previewProductionCostTableSourceForPriceDraft/);
  });

  it("published-price aceita referenceDate por query", () => {
    const server = read("server.ts");
    const block = server.slice(
      server.indexOf('app.get("/api/price-tables/:priceTableId/products/:productId/published-price"'),
      server.indexOf('app.post("/api/price-table-versions/:id/publish"')
    );
    assert.match(block, /resolvePublishedPriceTableVersionForDate/);
    assert.match(block, /referenceDate/);
  });
});

describe("versionedCostArchitectureBaseline — matéria-prima e componentes (as-is)", () => {
  it("motor industrial usa resolveMaterialLineCostForEngine com fallback vivo sem catálogo", () => {
    const engine = read("src/lib/productCostAnalysisEngine.server.ts");
    assert.match(engine, /resolveMaterialLineCostForEngine/);
    assert.match(engine, /materialCostCatalog/);
    const resolver = read("src/lib/materialCostEngineResolver.ts");
    assert.match(resolver, /LIVE_MATERIAL/);
    assert.match(resolver, /VERSIONED_MATERIAL_COST_TABLE/);
  });

  it("geração oficial de produção usa tabela de MP publicada", () => {
    const pub = read("src/lib/productionCostPublication.server.ts");
    assert.match(pub, /loadMaterialCostEngineCatalogForProductionDraft/);
    assert.match(pub, /materialCostTableVersionId/);
    assert.match(pub, /cache\.materialCostCatalog/);
  });

  it("geração de custo de produção elegível inclui PRODUCT e COMPONENT", () => {
    assert.deepEqual(PRODUCTION_COST_TABLE_ELIGIBLE_ITEM_TYPES, ["PRODUCT", "COMPONENT"]);
    assert.deepEqual(productionCostTableEligibleItemTypesFilter(), {
      in: ["PRODUCT", "COMPONENT"],
    });
    const pub = read("src/lib/productionCostPublication.server.ts");
    assert.match(pub, /PRODUCT_AND_COMPONENT/);
    assert.match(pub, /prismaProductTypeFilterForProductionCostDraftScope/);
    assert.match(pub, /componentsEvaluated/);
  });

  it("existe entidade MaterialCostTableVersion no schema (fase MP versionada)", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model MaterialCostTableVersion/);
    assert.match(schema, /model MaterialCostTableItem/);
    assert.match(schema, /materialCostTableVersionId/);
    assert.match(schema, /model MaterialPriceHistory/);
    assert.match(schema, /model ProductionCostTableVersion/);
    assert.match(schema, /model PriceTableVersion/);
  });
});

describe("versionedCostArchitectureBaseline — documentação", () => {
  it("doc de arquitetura existe com regras invioláveis", () => {
    const doc = read("docs/architecture/versioned-cost-price-margin.md");
    assert.match(doc, /BOM viva não altera custo publicado/);
    assert.match(doc, /SalesOrderItem\.unitCost não é custo industrial/);
    assert.match(doc, /componente vendido precisa de custo oficial/i);
  });
});
