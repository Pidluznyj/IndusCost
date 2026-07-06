import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ProductCostTraceAuditReport } from "../productCostTraceAudit.js";
import { PRODUCT_ENGINEERING_COST_TOLERANCE } from "../productEngineeringCostWarning.js";
import {
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticFinding,
} from "./chatgptDiagnosticTypes.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  buildProductEngineeringBusinessRulesMarkdown,
  buildProductEngineeringCalculationTrace,
  buildProductEngineeringDatabaseEvidence,
  buildProductEngineeringExecutiveSummaryMarkdown,
  buildProductEngineeringFindings,
  evaluateProductEngineeringAutoDiagnostics,
  parseProductEngineeringDiagnosticRequest,
} from "./productEngineeringDiagnostic.server.js";

function sampleTrace618(): ProductCostTraceAuditReport {
  return {
    status: "PASS",
    auditedAt: "2026-07-06T12:00:00.000Z",
    referenceDate: "2026-07-06",
    product: {
      productId: "prod-618",
      sku: "618.08AA",
      name: "Produto exemplo 618.08AA",
      type: "PRODUCT",
      status: "ACTIVE",
    },
    currentCost: {
      engineeringCost: 0.912785,
      engineeringSource: "PRODUCT_ENGINEERING_FINAL_COST",
      officialPublishedCost: 0.912785,
      officialSource: "getEffectiveProductProductionCost",
      difference: 0,
      warning: {
        officialCost: 0.912785,
        calculatedCost: 0.912785,
        difference: 0,
        hasCostImpact: false,
        hasTechnicalSnapshotPending: true,
        warningStatus: "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT",
        warningSeverity: "info",
        message: "Snapshot técnico pendente sem impacto de custo",
      },
    },
    officialVersion: {
      versionId: "ver-1",
      versionCode: "CUSTO_PROD_2026",
      versionName: "Custo Produção 2026",
      revision: 3,
      status: "PUBLISHED",
      effectiveDate: "2026-01-01",
      publishedAt: "2026-01-15T10:00:00.000Z",
      materialCostTableVersionId: "mp-ver-1",
      materialCostTableVersionCode: "MP_2026",
    },
    costBreakdown: {
      materialCost: 0.5,
      laborCost: 0.2,
      machineCost: 0.15,
      overheadCost: 0.062785,
      otherCost: null,
      totalCost: 0.912785,
      source: "ProductionCostTableItem (publicado)",
    },
    bom: {
      included: true,
      componentCount: 1,
      components: [
        {
          sku: "420.01A",
          name: "Componente filho",
          lineType: "COMPONENT",
          quantity: 1,
          unitCost: 0.3,
          totalCost: 0.3,
          sharePercent: 32.87,
          rank: 1,
        },
      ],
      source: "ProductCostAnalysisEngine (vivo)",
    },
    materials: {
      included: true,
      materialCount: 2,
      materials: [
        {
          sku: "MP-001",
          name: "Resina principal",
          lineType: "MATERIAL",
          quantity: 0.05,
          unitCost: 4,
          totalCost: 0.5,
          sharePercent: 54.78,
          rank: 1,
        },
      ],
      topCostRanking: [
        {
          sku: "MP-001",
          name: "Resina principal",
          lineType: "MATERIAL",
          quantity: 0.05,
          unitCost: 4,
          totalCost: 0.5,
          sharePercent: 54.78,
          rank: 1,
        },
      ],
      source: "ProductCostAnalysisEngine (vivo)",
    },
    process: {
      included: true,
      cycleTimeSeconds: 30,
      cavities: 4,
      laborCost: 0.2,
      machineCost: 0.15,
      efficiencyExpectedPercent: 95,
      setupTimeMin: 10,
      netPiecesPerHour: 456,
      processSource: "STANDARD_PROCESS",
      dataSource: "Product",
      source: "ProductCostAnalysisEngine (vivo)",
    },
    commercialPrices: [],
    alerts: [],
    dataSources: [],
    checklist: {
      hasBomTree: true,
      hasProcessData: true,
      hasPublishedProductionCostTable: true,
      materialsHaveVigentCost: true,
      bomComponentsHaveOfficialCost: true,
    },
  };
}

describe("productEngineeringDiagnostic", () => {
  it("parseia request PRODUCT_ENGINEERING com sku", () => {
    const parsed = parseProductEngineeringDiagnosticRequest({
      scope: "PRODUCT_ENGINEERING",
      context: { sku: "618.08AA" },
    });
    assert.equal(parsed.scope, "PRODUCT_ENGINEERING");
    assert.equal(parsed.context.sku, "618.08AA");
  });

  it("rejeita request sem sku/productId", () => {
    assert.throws(
      () =>
        parseProductEngineeringDiagnosticRequest({
          scope: "PRODUCT_ENGINEERING",
          context: {},
        }),
      /sku ou context.productId/
    );
  });

  it("618.08AA — detecta TECHNICAL_SNAPSHOT_PENDING sem diferença numérica", () => {
    const trace = sampleTrace618();
    const diagnostics = evaluateProductEngineeringAutoDiagnostics(trace);
    assert.ok(
      diagnostics.some((d) => d.code === "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT")
    );
    assert.equal(trace.currentCost.difference, 0);
    assert.ok(!diagnostics.some((d) => d.code === "COST_DIFF_PENDING_PUBLICATION"));
  });

  it("gera findings com sourceRefs", () => {
    const trace = sampleTrace618();
    const findings = buildProductEngineeringFindings(
      trace,
      evaluateProductEngineeringAutoDiagnostics(trace)
    );
    assert.ok(findings.length >= 1);
    for (const finding of findings) {
      assert.ok(finding.sourceRefs.length >= 1);
      assert.ok(finding.evidenceRefs.includes("evidence/product-cost-trace.json"));
    }
  });

  it("executive summary inclui seções obrigatórias em português", () => {
    const trace = sampleTrace618();
    const md = buildProductEngineeringExecutiveSummaryMarkdown(
      trace,
      evaluateProductEngineeringAutoDiagnostics(trace)
    );
    assert.match(md, /## 1\. Contexto/);
    assert.match(md, /## 3\. Custo oficial vs custo calculado/);
    assert.match(md, /618\.08AA/);
    assert.match(md, /0\.912785/);
    assert.match(md, /## 7\. Hipótese principal de causa/);
  });

  it("database evidence inclui sourceRefs", () => {
    const evidence = buildProductEngineeringDatabaseEvidence(sampleTrace618(), {
      sourceSystem: "NOMUS",
      sourceExternalId: "12345",
    });
    const product = evidence.product as Record<string, unknown>;
    const sku = product.sku as { value: string; source: unknown };
    assert.equal(sku.value, "618.08AA");
    assert.ok(sku.source);
  });

  it("calculation trace inclui custos e warning", () => {
    const trace = sampleTrace618();
    const calc = buildProductEngineeringCalculationTrace(trace, {
      publishedHash: "hash-pub",
      calculatedHash: "hash-live",
      hasDraft: true,
    });
    const comparison = calc.costComparison as Record<string, unknown>;
    assert.equal(comparison.engineeringCost, 0.912785);
    assert.equal(comparison.officialPublishedCost, 0.912785);
    assert.equal(calc.tolerance, PRODUCT_ENGINEERING_COST_TOLERANCE);
  });

  it("monta bundle PRODUCT_ENGINEERING completo sem segredos", () => {
    const trace = sampleTrace618();
    const autoDiagnostics = evaluateProductEngineeringAutoDiagnostics(trace);
    const bundle = buildChatGptDiagnosticBundle({
      scope: "PRODUCT_ENGINEERING",
      context: {
        scope: "PRODUCT_ENGINEERING",
        screenTitle: "Engenharia de Produto",
        screenRoute: "/products/engineering",
        filters: { sku: "618.08AA" },
      },
      findings: buildProductEngineeringFindings(trace, autoDiagnostics),
      executiveSummaryMarkdown: buildProductEngineeringExecutiveSummaryMarkdown(
        trace,
        autoDiagnostics
      ),
      businessRulesMarkdown: buildProductEngineeringBusinessRulesMarkdown(trace),
      databaseEvidence: buildProductEngineeringDatabaseEvidence(trace, {
        sourceSystem: null,
        sourceExternalId: null,
      }),
      calculationTrace: buildProductEngineeringCalculationTrace(trace, {
        publishedHash: "a",
        calculatedHash: "b",
        hasDraft: true,
      }),
      evidence: [
        {
          id: "evidence_product_cost_trace",
          scope: "PRODUCT_ENGINEERING",
          label: "Product cost trace",
          bundlePath: "evidence/product-cost-trace.json",
          payload: { trace, cost: trace.currentCost },
        },
      ],
      rawLimitedEvidence: {
        sku: "618.08AA",
        warningStatus: "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT",
      },
    });

    assertRequiredBundleStructure(bundle);
    for (const path of REQUIRED_BUNDLE_ROOT_FILES) {
      assert.ok(bundle.entries[path], `ausente: ${path}`);
    }

    const evidence = JSON.parse(bundle.entries["evidence/product-cost-trace.json"]);
    assert.equal(evidence.trace.currentCost.engineeringCost, 0.912785);
    assert.equal(evidence.trace.currentCost.officialPublishedCost, 0.912785);

    const diagnostics = JSON.parse(bundle.entries["04_DIAGNOSTICS.json"]) as {
      findings: DiagnosticFinding[];
    };
    assert.ok(diagnostics.findings.length >= 1);

    const summary = bundle.entries["01_EXECUTIVE_SUMMARY.md"];
    assert.match(summary, /618\.08AA/);
    assert.match(summary, /TECHNICAL_SNAPSHOT|Snapshot técnico/i);

    const combined = Object.values(bundle.entries).join("\n");
    assert.doesNotMatch(combined, /Bearer /);
    assert.doesNotMatch(combined, /DATABASE_URL=/);
    assert.doesNotMatch(combined, /postgresql:\/\//);

    assert.ok(bundle.entries["evidence/raw-limited/product-engineering-summary.json"]);
  });

  it("módulo de rotas registra POST /api/diagnostics/chatgpt-bundle", () => {
    const src = readFileSync("src/lib/diagnostics/diagnosticBundleRoutes.server.ts", "utf8");
    assert.match(src, /\/api\/diagnostics\/chatgpt-bundle/);
    assert.match(src, /PRODUCT_ENGINEERING/);
  });
});
