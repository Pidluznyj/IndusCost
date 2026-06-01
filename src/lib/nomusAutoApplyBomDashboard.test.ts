import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  bucketBlockingReasons,
  buildNomusAutoApplyBomDashboard,
  classifyAutoApplyProduct,
} from "./nomusAutoApplyBomDashboard";
import { buildEngineeringValidationChecklistMarkdown } from "./nomusEngineeringValidationChecklist";
import {
  enrichDashboardProductRow,
  filterDashboardProducts,
  matchesDashboardSearch,
} from "./nomusAutoApplyBomDashboardShared";
import {
  extractProductListFromReportJson,
  parseAutoApplyReportJson,
} from "./nomusAutoApplyBomReportParser";
import type { NomusBomAutoApplyProductResult } from "./nomusBomAutoApplyAfterSyncTypes";
import type { AutoApplyBomDashboardProductRow } from "./nomusAutoApplyBomDashboardTypes";

const SAMPLE_TOTALS = {
  parentsInNomusStage: 876,
  parentsEvaluated: 876,
  parentsApplied: 0,
  parentsNoChanges: 479,
  parentsBlocked: 389,
  parentsSkipped: 8,
  parentsErrored: 0,
  linesCreated: 0,
  linesUpdated: 0,
  linesRemoved: 0,
  linesKept: 0,
};

const SAMPLE_308: NomusBomAutoApplyProductResult = {
  parentCode: "308.05AB",
  productId: "p-308",
  status: "BLOCKED",
  canApply: false,
  blockingReasons: ["Existem itens locais (somente IndusCost) pendentes de decisão."],
  actionsPreview: [
    {
      actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
      componentCode: "115.01--",
      currentQuantity: 0.0048,
      effectiveQuantity: 0.002185,
    },
    {
      actionType: "UPDATE_PRODUCT_BOM_QUANTITY",
      componentCode: "121.25--",
      currentQuantity: 0.0001,
      effectiveQuantity: 0.000046,
    },
    {
      actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
      componentCode: "132.01--",
      currentQuantity: 1,
      effectiveQuantity: 1,
    },
    {
      actionType: "UPDATE_PRODUCT_BOM_NOMUS_METADATA",
      componentCode: "132.02--",
      currentQuantity: 1,
      effectiveQuantity: 1,
    },
    {
      actionType: "KEEP_PRODUCT_BOM_LINE",
      componentCode: "115.08--",
      currentQuantity: 0.001,
      effectiveQuantity: 0.001,
    },
  ],
};

function sample308Row(): AutoApplyBomDashboardProductRow {
  const classified = classifyAutoApplyProduct(SAMPLE_308);
  return enrichDashboardProductRow({
    parentCode: SAMPLE_308.parentCode,
    productId: SAMPLE_308.productId,
    status: SAMPLE_308.status,
    canApply: SAMPLE_308.canApply,
    ...classified,
    pendingTypeLabel: "",
    recommendedAction: "",
    recommendedTab: "overview",
    severity: 0,
    actionsCount: 0,
    actionsSummaryLines: [],
  });
}

function writeTempReport(name: string, body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "nomus-report-"));
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return path;
}

describe("nomusAutoApplyBomReportParser", () => {
  it("lê relatório com items", () => {
    const parsed = parseAutoApplyReportJson(
      JSON.stringify({
        generatedAt: "2026-05-26T10:00:00.000Z",
        mode: "APPLY",
        summary: SAMPLE_TOTALS,
        items: [SAMPLE_308],
      })
    );
    assert.ok(parsed);
    assert.equal(parsed!.productListSource, "items");
    assert.equal(parsed!.products.length, 1);
    assert.equal(parsed!.products[0].parentCode, "308.05AB");
    assert.equal(parsed!.totals.parentsBlocked, 389);
  });

  it("lê relatório com products", () => {
    const parsed = parseAutoApplyReportJson(
      JSON.stringify({
        totals: SAMPLE_TOTALS,
        products: [SAMPLE_308],
      })
    );
    assert.ok(parsed);
    assert.equal(parsed!.productListSource, "products");
    assert.equal(parsed!.products[0].parentCode, "308.05AB");
  });

  it("lê relatório com result.products", () => {
    const list = extractProductListFromReportJson({
      summary: SAMPLE_TOTALS,
      result: { products: [SAMPLE_308] },
    });
    assert.equal(list.source, "result.products");
    assert.equal(list.products[0].parentCode, "308.05AB");
  });

  it("se summary tem blocked=389 e items tem produto, parser retorna lista", () => {
    const parsed = parseAutoApplyReportJson(
      JSON.stringify({
        summary: { ...SAMPLE_TOTALS, blocked: 389 },
        items: Array.from({ length: 389 }, (_, i) => ({
          ...SAMPLE_308,
          parentCode: i === 0 ? "308.05AB" : `P${i}`,
        })),
      })
    );
    assert.ok(parsed);
    assert.equal(parsed!.totals.parentsBlocked, 389);
    assert.equal(parsed!.products.length, 389);
    assert.equal(parsed!.hasProductList, true);
  });

  it("summary sem lista retorna hasProductList=false", () => {
    const parsed = parseAutoApplyReportJson(
      JSON.stringify({
        totals: SAMPLE_TOTALS,
        summary: SAMPLE_TOTALS,
      })
    );
    assert.ok(parsed);
    assert.equal(parsed!.hasProductList, false);
    assert.equal(parsed!.products.length, 0);
  });
});

describe("nomusAutoApplyBomDashboard — classificação", () => {
  it("308.05AB bloqueado com divergência e item local aparece nos filtros certos", () => {
    const row = classifyAutoApplyProduct(SAMPLE_308);
    assert.equal(row.quantityDiffCount, 2);
    assert.equal(row.metadataOnlyCount, 2);
    assert.ok(row.filterBuckets.includes("BLOCKED"));
    assert.ok(row.filterBuckets.includes("DIVERGENT"));
    assert.ok(row.filterBuckets.includes("LOCAL_PENDING"));
  });

  it("agrega buckets de bloqueio para relatório real-like", () => {
    const products: NomusBomAutoApplyProductResult[] = [
      {
        parentCode: "A",
        productId: "1",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["Opcionais de precificação ainda não estão resolvidos."],
      },
      {
        parentCode: "B",
        productId: "2",
        status: "BLOCKED",
        canApply: false,
        blockingReasons: ["Existem itens locais (somente IndusCost) pendentes de decisão."],
      },
      {
        parentCode: "C",
        productId: null,
        status: "SKIPPED",
        canApply: false,
        blockingReasons: ["Produto não cadastrado no IndusCost para este código pai."],
      },
    ];
    const buckets = bucketBlockingReasons(products);
    assert.ok(buckets.some((b) => b.key === "OPTIONAL_PENDING" && b.count >= 1));
    assert.ok(buckets.some((b) => b.key === "LOCAL_ITEM_PENDING" && b.count >= 1));
    assert.ok(buckets.some((b) => b.key === "NOT_IN_INDUS" && b.count >= 1));
  });
});

describe("nomusAutoApplyBomDashboardShared — busca e filtro", () => {
  it("filtro BLOCKED + busca 308.05 encontra 308.05AB", () => {
    const row = sample308Row();
    const others: AutoApplyBomDashboardProductRow[] = [
      enrichDashboardProductRow({
        parentCode: "100.01AA",
        productId: "x",
        status: "NO_CHANGES",
        canApply: true,
        primaryReason: "Alinhado",
        blockingReasons: [],
        categories: [],
        filterBuckets: ["NO_CHANGES"],
        quantityDiffCount: 0,
        metadataOnlyCount: 0,
        localOnlyLineCodes: [],
        actionsPreview: [],
        pendingTypeLabel: "",
        recommendedAction: "",
        recommendedTab: "overview",
        severity: 0,
        actionsCount: 0,
        actionsSummaryLines: [],
      }),
    ];
    const all = [row, ...others];

    assert.ok(matchesDashboardSearch(row, "308.05"));
    assert.ok(matchesDashboardSearch(row, "115.01--"));
    assert.ok(matchesDashboardSearch(row, "UPDATE_PRODUCT_BOM_QUANTITY"));
    assert.ok(matchesDashboardSearch(row, "itens locais"));

    const filtered = filterDashboardProducts(all, { filter: "BLOCKED", search: "308.05" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].parentCode, "308.05AB");
    assert.equal(filtered[0].pendingTypeLabel, "Item local pendente");
    assert.equal(filtered[0].recommendedTab, "effective-pricing-bom");
    assert.equal(filtered[0].actionsCount, 5);
  });
});

describe("buildNomusAutoApplyBomDashboard — leitura de arquivo", () => {
  it("endpoint retorna lista quando JSON usa items", async () => {
    const path = writeTempReport("nomus-auto-sync-bom-apply-report.json", {
      generatedAt: "2026-05-26T10:00:00.000Z",
      mode: "APPLY",
      startedAt: "2026-05-26T09:00:00.000Z",
      finishedAt: "2026-05-26T10:00:00.000Z",
      approvedBy: "nomus-auto-sync",
      summary: SAMPLE_TOTALS,
      items: [SAMPLE_308],
    });

    const result = await buildNomusAutoApplyBomDashboard({
      reportPath: path,
      revalidateBlocked: false,
    });
    assert.equal(result.hasProductList, true);
    assert.equal(result.needsReportRegeneration, false);
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].parentCode, "308.05AB");
    assert.equal(result.totals?.parentsBlocked, 1);
    assert.equal(result.totals?.parentsEvaluated, 1);
    assert.equal(result.batchTotals, null);
    assert.equal(result.productListSource, "items");
  });

  it("summary sem lista retorna warning e needsReportRegeneration", async () => {
    const path = writeTempReport("nomus-auto-sync-bom-apply-report.json", {
      totals: SAMPLE_TOTALS,
      summary: SAMPLE_TOTALS,
    });

    const result = await buildNomusAutoApplyBomDashboard({
      reportPath: path,
      revalidateBlocked: false,
    });
    assert.equal(result.hasReport, true);
    assert.equal(result.hasProductList, false);
    assert.equal(result.needsReportRegeneration, true);
    assert.ok(result.partialReportWarning?.includes("389 bloqueados"));
    assert.equal(result.regenerateReportCommand, "npm run sync:nomus:all:apply");
    assert.equal(result.products.length, 0);
  });

  it("reportPath explícito não mistura com docs/generated do servidor", async () => {
    const path = writeTempReport("nomus-auto-sync-bom-apply-report.json", {
      generatedAt: "2026-05-26T10:00:00.000Z",
      summary: { ...SAMPLE_TOTALS, parentsEvaluated: 1, parentsBlocked: 0 },
      items: [SAMPLE_308],
    });

    const result = await buildNomusAutoApplyBomDashboard({
      reportPath: path,
      revalidateBlocked: false,
    });
    assert.equal(result.products.length, 1);
    assert.equal(result.totals?.parentsEvaluated, 1);
    assert.notEqual(result.products.length, SAMPLE_TOTALS.parentsEvaluated);
  });
});

describe("nomusEngineeringValidationChecklist", () => {
  it("gera checklist com 308.05AB e ações previstas", () => {
    const md = buildEngineeringValidationChecklistMarkdown({
      generatedAt: "2026-05-26T10:00:00.000Z",
      totals: SAMPLE_TOTALS,
      products: [SAMPLE_308],
    });
    assert.ok(md.includes("308.05AB"));
    assert.ok(md.includes("UPDATE_PRODUCT_BOM_QUANTITY"));
    assert.ok(md.includes("115.01--"));
    assert.ok(md.includes("115.08--"));
    assert.ok(md.includes("BOM efetiva"));
  });
});
