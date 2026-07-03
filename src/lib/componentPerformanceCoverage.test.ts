import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildComponentPerformanceCoverageReport,
  classifyComponentPerformanceCoverage,
  isMissingPerformanceCavities,
  isMissingPerformanceCycle,
  parseComponentPerformanceCoverageOptions,
  rankSoldComponentsByCommercialImpact,
  serializeCoverageRowForAudit,
} from "./componentPerformanceCoverage.js";
import { serializeCoverageReportForAuditJson } from "./componentPerformanceCoverage.server.js";

function row(overrides: Partial<Parameters<typeof classifyComponentPerformanceCoverage>[0]> = {}) {
  return classifyComponentPerformanceCoverage({
    productId: "comp-1",
    sku: "309.86AA",
    name: "Mangote",
    status: "ACTIVE",
    cycleTimeSeconds: 64,
    cavities: 24,
    setupTimeMin: 0,
    efficiencyExpected: 100,
    soldInPeriod: false,
    orderCountInPeriod: 0,
    periodSoldValue: 0,
    changeLogCount: 1,
    lastPerformanceChangeAt: "2026-07-01T10:00:00.000Z",
    lastChangedByUserName: "Operador A",
    lastResponsiblePersonName: "João Molde",
    ...overrides,
  });
}

describe("componentPerformanceCoverage — classificação", () => {
  it("classifica componente sem ciclo", () => {
    const classified = row({ cycleTimeSeconds: null });
    assert.equal(classified.missingCycle, true);
    assert.equal(classified.severity, "INCOMPLETE");
  });

  it("classifica componente sem cavidades", () => {
    const classified = row({ cavities: null });
    assert.equal(classified.missingCavities, true);
    assert.equal(classified.severity, "INCOMPLETE");
  });

  it("vendido sem performance aparece como crítico", () => {
    const classified = row({
      cycleTimeSeconds: null,
      cavities: null,
      soldInPeriod: true,
      orderCountInPeriod: 3,
      periodSoldValue: 15000,
    });
    assert.equal(classified.severity, "CRITICAL");
    assert.equal(classified.soldInPeriod, true);
    assert.equal(classified.missingCycle, true);
    assert.equal(classified.missingCavities, true);
  });

  it("histórico recente aparece no relatório", () => {
    const recent = row({
      lastPerformanceChangeAt: new Date().toISOString(),
      lastChangedByUserName: "Maria",
      lastResponsiblePersonName: "Carlos",
    });
    const report = buildComponentPerformanceCoverageReport({
      rows: [recent],
      periodLabel: "07/2026",
      periodFrom: "2026-07-01",
      periodTo: "2026-07-31",
      top: 5,
      recentDays: 30,
    });
    assert.equal(report.recentlyChanged.length, 1);
    assert.equal(report.recentlyChanged[0]?.lastChangedByUserName, "Maria");
    assert.equal(report.recentlyChanged[0]?.lastResponsiblePersonName, "Carlos");
  });

  it("rankSoldComponentsByCommercialImpact ordena por valor vendido", () => {
    const rows = [
      row({
        productId: "a",
        sku: "A",
        cycleTimeSeconds: null,
        soldInPeriod: true,
        periodSoldValue: 1000,
      }),
      row({
        productId: "b",
        sku: "B",
        cycleTimeSeconds: null,
        soldInPeriod: true,
        periodSoldValue: 9000,
      }),
    ];
    const top = rankSoldComponentsByCommercialImpact(rows, 5);
    assert.equal(top[0]?.sku, "B");
    assert.equal(top[1]?.sku, "A");
  });

  it("neverReviewed quando não há histórico", () => {
    const classified = row({ changeLogCount: 0, lastPerformanceChangeAt: null });
    assert.equal(classified.neverReviewed, true);
  });
});

describe("componentPerformanceCoverage — helpers", () => {
  it("isMissingPerformanceCycle e isMissingPerformanceCavities", () => {
    assert.equal(isMissingPerformanceCycle({ cycleTimeSeconds: null, cavities: 1, setupTimeMin: 0, efficiencyExpected: 100 }), true);
    assert.equal(isMissingPerformanceCavities({ cycleTimeSeconds: 10, cavities: null, setupTimeMin: 0, efficiencyExpected: 100 }), true);
  });

  it("parseComponentPerformanceCoverageOptions interpreta flags", () => {
    const parsed = parseComponentPerformanceCoverageOptions({
      year: "2026",
      month: "7",
      top: "20",
      soldOnly: "true",
      missingOnly: "1",
    });
    assert.equal(parsed.year, 2026);
    assert.equal(parsed.month, 7);
    assert.equal(parsed.top, 20);
    assert.equal(parsed.soldOnly, true);
    assert.equal(parsed.missingOnly, true);
  });
});

describe("componentPerformanceCoverage — JSON audit payload", () => {
  it("serializeCoverageReportForAuditJson produz estrutura estável", () => {
    const report = buildComponentPerformanceCoverageReport({
      rows: [
        row({
          cycleTimeSeconds: null,
          soldInPeriod: true,
          periodSoldValue: 5000,
        }),
      ],
      periodLabel: "07/2026",
      periodFrom: "2026-07-01",
      periodTo: "2026-07-31",
      activeComponents: 120,
    });
    const json = serializeCoverageReportForAuditJson(report);
    assert.equal(json.readOnly, true);
    assert.equal(json.totals.activeComponents, 120);
    assert.equal(json.topSoldWithoutCompletePerformance[0]?.severity, "CRITICAL");
    assert.equal(typeof serializeCoverageRowForAudit(report.topSoldWithoutCompletePerformance[0]!).sku, "string");
  });
});

describe("componentPerformanceCoverage — script wiring", () => {
  it("script audit-component-performance-coverage.ts existe e usa service read-only", () => {
    const script = readFileSync(
      join(process.cwd(), "scripts/audit-component-performance-coverage.ts"),
      "utf8"
    );
    assert.match(script, /buildComponentPerformanceCoverageReportFromDb/);
    assert.match(script, /serializeCoverageReportForAuditJson/);
    assert.match(script, /--json/);
    assert.doesNotMatch(script, /\.update\(/);
    assert.doesNotMatch(script, /\.create\(/);
  });
});
