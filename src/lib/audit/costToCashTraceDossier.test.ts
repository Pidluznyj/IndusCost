import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assertExportableDossier,
  buildCostToCashTraceDossierCsv,
  buildCostToCashTraceDossierJson,
  CostToCashTraceDossierError,
  formatDiagnosticsForClipboard,
  resolveDossierFilenamePrefix,
} from "./costToCashTraceDossier.js";
import type { CostToCashTraceApiPayloadInput } from "./costToCashTraceDossierMapper.js";
import { TRACE_PAGE_UNAVAILABLE } from "./costToCashTracePageView.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function skuPayload(): CostToCashTraceApiPayloadInput {
  return {
    status: "PASS",
    summary: {
      title: "Cost-to-Cash Trace",
      message: null,
      auditedAt: "2026-07-06T18:00:00.000Z",
      calculationMode: "PUBLISHED",
    },
    sections: {
      product: {
        status: "PASS",
        auditedAt: "2026-07-06T18:00:00.000Z",
        referenceDate: "2026-07-06",
        product: {
          productId: "p1",
          sku: "618.08AA",
          name: "Produto teste",
          type: "FINISHED",
          status: "ACTIVE",
        },
        currentCost: {
          engineeringCost: 0.91,
          engineeringSource: "engine",
          officialPublishedCost: 0.95,
          officialSource: "official",
          difference: 0.04,
          warning: null,
        },
        officialVersion: {
          versionId: "v1",
          versionCode: "CUSTO-1",
          versionName: "Custo",
          revision: 1,
          status: "PUBLISHED",
          effectiveDate: "2026-01-01",
          publishedAt: "2026-01-02",
          materialCostTableVersionId: null,
          materialCostTableVersionCode: null,
        },
        costBreakdown: {
          materialCost: 0.5,
          laborCost: 0.2,
          machineCost: 0.15,
          overheadCost: 0.05,
          otherCost: 0.05,
          totalCost: 0.95,
          source: "ProductionCostTableVersion",
        },
        bom: {
          included: true,
          componentCount: 1,
          components: [
            {
              sku: "420.01",
              name: "Comp",
              lineType: "COMPONENT",
              quantity: 1,
              unitCost: 0.1,
              totalCost: 0.1,
              sharePercent: 10,
              rank: 1,
            },
          ],
          source: "BOM",
        },
        materials: {
          included: true,
          materialCount: 1,
          materials: [],
          topCostRanking: [],
          source: "BOM",
        },
        process: {
          included: true,
          cycleTimeSeconds: 30,
          cavities: 1,
          laborCost: 0.2,
          machineCost: 0.15,
          efficiencyExpectedPercent: 85,
          setupTimeMin: null,
          netPiecesPerHour: null,
          processSource: null,
          dataSource: null,
          source: "process",
        },
        commercialPrices: [],
        alerts: [],
        dataSources: [],
        checklist: {},
      },
      publishedPrice: null,
      salesOrder: null,
      commission: null,
      chain: [
        {
          stage: "PRODUCT_COST",
          label: "618.08AA",
          status: "PASS",
          summary: "Custo oficial: 0.95",
          calculationMode: "PUBLISHED",
        },
      ],
    },
    diagnostics: [],
    warnings: [],
    errors: [],
  };
}

describe("costToCashTraceDossier export", () => {
  it("export SKU gera JSON completo", () => {
    const payload = skuPayload();
    const dossier = buildCostToCashTraceDossierJson(payload, { sku: "618.08AA" });
    assert.equal(dossier.dossierVersion, "1");
    assert.equal(dossier.product?.product?.sku, "618.08AA");
    assert.ok(dossier.bom);
    assert.ok(dossier.cost);
    assert.ok(dossier.process);
  });

  it("export SKU gera CSV por seção", () => {
    const csv = buildCostToCashTraceDossierCsv(skuPayload());
    assert.match(csv, /^section,field,value/);
    assert.match(csv, /618\.08AA/);
    assert.match(csv, /bom/);
  });

  it("seções ausentes aparecem como Não disponível no CSV", () => {
    const csv = buildCostToCashTraceDossierCsv(skuPayload());
    assert.match(csv, /publishedPrice/);
    assert.match(csv, new RegExp(TRACE_PAGE_UNAVAILABLE));
  });

  it("export sem dados retorna erro amigável", () => {
    assert.throws(
      () => assertExportableDossier(null),
      (error: unknown) => {
        assert.ok(error instanceof CostToCashTraceDossierError);
        assert.match(error.message, /consulta antes de exportar/i);
        return true;
      }
    );
  });

  it("filename prefix usa SKU 618.08AA", () => {
    const prefix = resolveDossierFilenamePrefix(skuPayload(), { sku: "618.08AA" });
    assert.match(prefix, /618/);
  });

  it("módulo de export não grava arquivos no repo", () => {
    const dossierSrc = read("src/lib/audit/costToCashTraceDossier.ts");
    const exportSrc = read("src/lib/audit/costToCashTraceExport.ts");
    assert.doesNotMatch(dossierSrc, /writeFileSync|createWriteStream/);
    assert.doesNotMatch(exportSrc, /writeFileSync|createWriteStream/);
  });

  it("página usa export de dossiê", () => {
    const page = read("src/components/audit/CostToCashTracePage.tsx");
    assert.match(page, /exportCostToCashDossierJson/);
    assert.match(page, /Exportar dossiê/);
  });
});
