import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildUnitaryFormationProductSearchResponse,
  buildUnitaryFormationProductSearchUrl,
  buildUnitaryFormationProductSearchWhere,
  isUnitaryFormationProductSearchParseError,
  parseUnitaryFormationProductSearchQuery,
  rankUnitaryFormationProductSearchResults,
  resolveUnitaryFormationProductMatchKind,
  UNITARY_FORMATION_PRODUCT_SEARCH_DEFAULT_LIMIT,
  UNITARY_FORMATION_PRODUCT_SEARCH_ENDPOINT,
  UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT,
} from "./unitaryFormationProductSearch.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const catalog = [
  {
    id: "1",
    sku: "320.03AA",
    name: "Tampa Superior",
    type: "PRODUCT" as const,
    status: "ACTIVE",
  },
  {
    id: "2",
    sku: "320.03AA-KIT",
    name: "Kit Tampa",
    type: "COMPONENT" as const,
    status: "ACTIVE",
  },
  {
    id: "3",
    sku: "410.01",
    name: "Tampa Inferior 320",
    type: "PRODUCT" as const,
    status: "ACTIVE",
  },
  {
    id: "4",
    sku: "999.99",
    name: "Outro item",
    type: "PRODUCT" as const,
    status: "ACTIVE",
  },
];

describe("unitaryFormationProductSearch", () => {
  it("SKU exato tem prioridade máxima", () => {
    const ranked = rankUnitaryFormationProductSearchResults(catalog, "320.03AA", 20);
    assert.equal(ranked[0]?.sku, "320.03AA");
    assert.equal(ranked[0]?.matchKind, "SKU_EXACT");
    assert.equal(ranked[1]?.matchKind, "SKU_PREFIX");
  });

  it("prefixo de SKU ranqueia antes de match só por nome", () => {
    const ranked = rankUnitaryFormationProductSearchResults(catalog, "320", 20);
    assert.ok(ranked.length >= 2);
    assert.equal(ranked[0]?.matchKind, "SKU_PREFIX");
    assert.equal(ranked.every((r) => r.matchKind !== "SKU_EXACT"), true);
    const firstPrefix = ranked.findIndex((r) => r.matchKind === "SKU_PREFIX");
    const firstName = ranked.findIndex((r) => r.matchKind === "NAME_CONTAINS");
    assert.ok(firstPrefix >= 0);
    assert.ok(firstName >= 0);
    assert.ok(firstPrefix < firstName);
  });

  it("busca por nome encontra contém no nome", () => {
    const ranked = rankUnitaryFormationProductSearchResults(catalog, "Tampa", 20);
    assert.ok(ranked.some((r) => r.sku === "320.03AA"));
    assert.ok(ranked.some((r) => r.sku === "410.01"));
    assert.equal(
      ranked.every((r) => r.matchKind === "NAME_CONTAINS" || r.sku.toLowerCase().includes("tampa")),
      true
    );
    assert.equal(resolveUnitaryFormationProductMatchKind("410.01", "Tampa Inferior 320", "Tampa"), "NAME_CONTAINS");
  });

  it("nenhum resultado retorna lista vazia", () => {
    const ranked = rankUnitaryFormationProductSearchResults(catalog, "ZZZ-NO-MATCH", 20);
    assert.deepEqual(ranked, []);
    const response = buildUnitaryFormationProductSearchResponse("ZZZ-NO-MATCH", 20, ranked);
    assert.equal(response.count, 0);
    assert.equal(response.results.length, 0);
  });

  it("limite máximo de 20 resultados", () => {
    const many = Array.from({ length: 35 }, (_, i) => ({
      id: `id-${i}`,
      sku: `SKU-${String(i).padStart(3, "0")}`,
      name: `Item nome comum ${i}`,
      type: "PRODUCT" as const,
      status: "ACTIVE",
    }));
    const ranked = rankUnitaryFormationProductSearchResults(many, "nome", 20);
    assert.equal(ranked.length, 20);
    assert.equal(UNITARY_FORMATION_PRODUCT_SEARCH_MAX_LIMIT, 20);
    assert.equal(UNITARY_FORMATION_PRODUCT_SEARCH_DEFAULT_LIMIT, 20);

    const parsed = parseUnitaryFormationProductSearchQuery({ q: "nome", limit: "99" });
    assert.equal(isUnitaryFormationProductSearchParseError(parsed), false);
    if (!isUnitaryFormationProductSearchParseError(parsed)) {
      assert.equal(parsed.limit, 20);
    }
  });

  it("query curta é rejeitada no parse", () => {
    const parsed = parseUnitaryFormationProductSearchQuery({ q: "a" });
    assert.equal(isUnitaryFormationProductSearchParseError(parsed), true);
    if (isUnitaryFormationProductSearchParseError(parsed)) {
      assert.equal(parsed.code, "QUERY_TOO_SHORT");
    }
  });

  it("where Prisma cobre exact, prefixo e nome sem carregar tudo", () => {
    const where = buildUnitaryFormationProductSearchWhere("320.03AA");
    assert.deepEqual(where.AND[0], { type: { in: ["PRODUCT", "COMPONENT"] } });
    assert.ok(JSON.stringify(where).includes("startsWith"));
    assert.ok(JSON.stringify(where).includes("contains"));
    assert.ok(JSON.stringify(where).includes("equals"));
  });

  it("URL e endpoint estáveis", () => {
    assert.equal(
      buildUnitaryFormationProductSearchUrl("320.03AA"),
      `${UNITARY_FORMATION_PRODUCT_SEARCH_ENDPOINT}?q=320.03AA&limit=20`
    );
  });
});

describe("unitaryFormationProductSearch routes/wiring", () => {
  it("rota específica existe antes de /api/pricing/:productId e é read-only", () => {
    const server = read("server.ts");
    const searchIdx = server.indexOf('"/api/pricing/unitary-formation/product-search"');
    const paramIdx = server.indexOf('"/api/pricing/:productId/:taxRuleId/calculate"');
    assert.ok(searchIdx > 0, "endpoint product-search deve existir");
    assert.ok(paramIdx > searchIdx, "rota fixa deve vir antes da rota parametrizada");

    const routeBlock = server.slice(
      searchIdx,
      server.indexOf("app.post(\"/api/pricing\"", searchIdx)
    );
    assert.match(routeBlock, /requireAppAuth/);
    assert.match(routeBlock, /pricing\.view|commercial\.pricing/);
    assert.match(routeBlock, /Cache-Control["'],\s*["']no-store/);
    assert.match(routeBlock, /searchUnitaryFormationProducts/);
    assert.doesNotMatch(routeBlock, /getProductCostAnalysis/);
    assert.doesNotMatch(routeBlock, /\.create\(/);
    assert.doesNotMatch(routeBlock, /\.update\(/);
    assert.doesNotMatch(routeBlock, /\.delete\(/);
    assert.doesNotMatch(routeBlock, /\.upsert\(/);
  });

  it("PricingModule expõe a aba unitária e consome endpoints oficiais", () => {
    const module = read("src/components/PricingModule.tsx");
    const tab = read("src/components/pricing/UnitaryPriceFormationTab.tsx");
    assert.match(module, /Formação de Preço Unitária/);
    assert.match(module, /UnitaryPriceFormationTab/);
    assert.match(module, /canGenerateDraft=/);
    assert.match(module, /canPublishDraft=/);
    assert.match(tab, /unitary-formation\/product-search|buildUnitaryFormationProductSearchUrl/);
    assert.match(tab, /buildUnitaryFormationProductDetailUrl/);
    assert.match(tab, /UNITARY_FORMATION_PRODUCT_SEARCH_DEBOUNCE_MS/);
    assert.match(tab, /appendUnitaryFormationCacheBust|createUnitaryFormationRequestSequencer/);
    assert.match(tab, /Custo Atual \/ LIVE/);
    assert.match(tab, /Custo Oficial \/ PUBLISHED/);
    assert.match(tab, /buildUnitaryProductionCostDraftUrl|production-cost\/draft/);
    assert.doesNotMatch(tab, /simulate-unit|apply-batch/);
    assert.doesNotMatch(tab, /\/api\/price-table-versions\/.*publish|generateProductionCost|apply-batch/);
    assert.doesNotMatch(tab, /getProductCostAnalysis/);
    assert.doesNotMatch(module, /Gestão Unitária/);
  });
});
