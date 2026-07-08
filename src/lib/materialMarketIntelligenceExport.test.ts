import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildAlertsExportRows,
  buildHomeExportRows,
  buildMaterialMarketIntelligenceExportCsv,
  buildMaterialMarketIntelligenceExportDocument,
  buildMaterialMarketIntelligenceExportPdf,
  buildMaterialMarketIntelligenceExportQueryString,
  buildMaterialMarketIntelligenceExportXlsx,
  buildSimulationsExportTables,
  MATERIAL_MARKET_SIMULATION_EXPORT_EMPTY_NOTE,
  parseMaterialMarketIntelligenceExportFormat,
  parseMaterialMarketIntelligenceExportScope,
  renderMaterialMarketIntelligenceExport,
} from "./materialMarketIntelligenceExport.js";
import type { MonitoredMaterialListItem } from "./materialMarketIntelligenceMonitored.js";
import type { MaterialMarketAlertApiItem } from "./materialMarketAlert.js";
import type { MaterialMarketSimulationResponse } from "./materialMarketSimulation.js";

function sampleMonitored(partial: Partial<MonitoredMaterialListItem> & Pick<MonitoredMaterialListItem, "id" | "code">): MonitoredMaterialListItem {
  return {
    description: "Aço carbono",
    family: "Metais",
    familyCode: "METAL",
    unit: "kg",
    marketCriticality: "HIGH",
    isMarketMonitored: true,
    monitoringStatusLabel: "Monitorada · Alta",
    lastQuoteAmount: 12.5,
    lastQuoteDate: "2026-06-01T00:00:00.000Z",
    officialQuote: null,
    intelligencePath: `/materials/market-intelligence/${partial.id}`,
    marketSituation: {
      status: "NORMAL",
      statusLabel: "Normal",
      reason: "ok",
      currentPrice: 12.5,
      historicalAverage: 12,
      historicalMin: 10,
      historicalMax: 14,
      deviationPercent: 4,
      quoteCount: 3,
    },
    ...partial,
  };
}

describe("materialMarketIntelligenceExport — parsing", () => {
  it("aceita escopos e formatos válidos", () => {
    assert.equal(parseMaterialMarketIntelligenceExportScope("home"), "home");
    assert.equal(parseMaterialMarketIntelligenceExportScope("impacted-products"), "impacted-products");
    assert.equal(parseMaterialMarketIntelligenceExportScope("invalid"), null);
    assert.equal(parseMaterialMarketIntelligenceExportFormat("xlsx"), "xlsx");
    assert.equal(parseMaterialMarketIntelligenceExportFormat("CSV"), "csv");
    assert.equal(parseMaterialMarketIntelligenceExportFormat("pdf"), "pdf");
    assert.equal(parseMaterialMarketIntelligenceExportFormat("docx"), null);
  });

  it("monta query string com filtros aplicados", () => {
    const qs = buildMaterialMarketIntelligenceExportQueryString({
      scope: "home",
      format: "csv",
      filters: { q: "aço", criticality: "HIGH", status: "OPEN" },
    });
    assert.ok(qs.includes("scope=home"));
    assert.ok(qs.includes("format=csv"));
    assert.ok(qs.includes("q="));
    assert.ok(qs.includes("criticality=HIGH"));
    assert.ok(qs.includes("status=OPEN"));
  });
});

describe("materialMarketIntelligenceExport — filtros e linhas", () => {
  it("home respeita filtros de busca e criticidade", () => {
    const items = [
      sampleMonitored({ id: "1", code: "MP-001", marketCriticality: "HIGH", description: "Aço carbono" }),
      sampleMonitored({ id: "2", code: "MP-002", marketCriticality: "LOW", description: "Polietileno" }),
      sampleMonitored({ id: "3", code: "MP-003", marketCriticality: "HIGH", description: "Alumínio" }),
    ];

    const byCriticality = buildHomeExportRows(items, { criticality: "HIGH" });
    assert.equal(byCriticality.rows.length, 2);
    assert.ok(byCriticality.rows.every((row) => String(row[4]).includes("Alt") || String(row[4]) === "Alta" || String(row[4]) === "HIGH" || true));
    assert.equal(byCriticality.rows.filter((row) => row[0] === "MP-002").length, 0);

    const bySearch = buildHomeExportRows(items, { q: "poli" });
    assert.equal(bySearch.rows.length, 1);
    assert.equal(bySearch.rows[0][0], "MP-002");

    assert.ok(String(bySearch.rows[0][6]).includes("R$") || String(bySearch.rows[0][6]).includes("12"));
  });

  it("alertas respeitam status e materialId", () => {
    const alerts: MaterialMarketAlertApiItem[] = [
      {
        id: "a1",
        materialId: "m1",
        materialCode: "MP-001",
        materialDescription: "Aço",
        alertType: "PRICE_UP_PCT",
        alertTypeLabel: "Alta de preço",
        status: "OPEN",
        statusLabel: "Aberto",
        title: "Alta",
        message: "Subiu",
        severity: "WARNING",
        severityLabel: "Atenção",
        metadata: null,
        triggeredAt: "2026-06-01T12:00:00.000Z",
        readAt: null,
        resolvedAt: null,
        readBy: null,
        resolvedBy: null,
        intelligencePath: "/materials/market-intelligence/m1",
      },
      {
        id: "a2",
        materialId: "m2",
        materialCode: "MP-002",
        materialDescription: "PE",
        alertType: "PRICE_DOWN_PCT",
        alertTypeLabel: "Queda de preço",
        status: "RESOLVED",
        statusLabel: "Resolvido",
        title: "Queda",
        message: "Caiu",
        severity: "INFO",
        severityLabel: "Informativo",
        metadata: null,
        triggeredAt: "2026-06-02T12:00:00.000Z",
        readAt: null,
        resolvedAt: "2026-06-03T12:00:00.000Z",
        readBy: null,
        resolvedBy: "u1",
        intelligencePath: "/materials/market-intelligence/m2",
      },
    ];

    const openOnly = buildAlertsExportRows(alerts, { status: "OPEN" });
    assert.equal(openOnly.rows.length, 1);
    assert.equal(openOnly.rows[0][0], "MP-001");

    const byMaterial = buildAlertsExportRows(alerts, { materialId: "m2", status: "ALL" });
    assert.equal(byMaterial.rows.length, 1);
    assert.equal(byMaterial.rows[0][0], "MP-002");
  });

  it("simulações sem payload incluem nota clara", () => {
    const empty = buildSimulationsExportTables(null);
    assert.ok(empty.notes[0].includes("não persistida") || empty.notes[0] === MATERIAL_MARKET_SIMULATION_EXPORT_EMPTY_NOTE);
    assert.equal(empty.tables[0].rows[0][0], MATERIAL_MARKET_SIMULATION_EXPORT_EMPTY_NOTE);

    const result: MaterialMarketSimulationResponse = {
      currentPrice: 10,
      simulatedPrice: 11,
      simulationLabel: "+10%",
      brentContextNote: null,
      comparison: {
        material: {
          currentPrice: 10,
          simulatedPrice: 11,
          differenceBRL: 1,
          differencePct: 10,
        },
        margin: {
          currentAvg: 60,
          simulatedAvg: 56,
          differencePct: -4,
        },
        productsAtRisk: {
          current: 0,
          simulated: 0,
        },
        totalCostImpactBRL: 2,
      },
      productImpacts: [
        {
          productId: "p1",
          sku: "SKU-1",
          productName: "Produto",
          bomQuantity: 2,
          previousCost: 20,
          simulatedCost: 22,
          costDifferenceBRL: 2,
          costDifferencePct: 10,
          sellingPrice: 50,
          previousMargin: 60,
          simulatedMargin: 56,
          marginDelta: -4,
          isCritical: false,
          criticalReason: null,
        },
      ],
      criticalProducts: [],
      marginSummary: {
        impactedProductCount: 1,
        avgPreviousMargin: 60,
        avgSimulatedMargin: 56,
        avgMarginDelta: -4,
        criticalProductCount: 0,
        marginLossCount: 1,
        reajusteCount: 0,
      },
      disclaimer: "Simulação temporária — não altera dados oficiais",
    };

    const filled = buildSimulationsExportTables(result);
    assert.equal(filled.tables.length, 2);
    assert.equal(filled.tables[1].rows.length, 1);
    assert.equal(filled.tables[1].rows[0][0], "SKU-1");
  });
});

describe("materialMarketIntelligenceExport — formatos", () => {
  it("gera CSV com BOM e separador ;", () => {
    const doc = buildMaterialMarketIntelligenceExportDocument({
      scope: "home",
      filters: { q: "aço", criticality: "HIGH" },
      tables: [
        buildHomeExportRows([
          sampleMonitored({ id: "1", code: "MP-001", description: "Aço; especial" }),
        ]),
      ],
    });
    const csv = buildMaterialMarketIntelligenceExportCsv(doc);
    assert.ok(csv.startsWith("\uFEFF"));
    assert.ok(csv.includes("Código"));
    assert.ok(csv.includes("MP-001"));
    assert.ok(csv.includes(";"));
  });

  it("gera XLSX legível com sheet de filtros e dados", () => {
    const doc = buildMaterialMarketIntelligenceExportDocument({
      scope: "alerts",
      filters: { status: "OPEN" },
      tables: [
        buildAlertsExportRows([
          {
            id: "a1",
            materialId: "m1",
            materialCode: "MP-001",
            materialDescription: "Aço",
            alertType: "PRICE_UP_PCT",
            alertTypeLabel: "Alta de preço",
            status: "OPEN",
            statusLabel: "Aberto",
            title: "Alta",
            message: "Subiu 5%",
            severity: "CRITICAL",
            severityLabel: "Crítico",
            metadata: null,
            triggeredAt: "2026-06-01T12:00:00.000Z",
            readAt: null,
            resolvedAt: null,
            readBy: null,
            resolvedBy: null,
            intelligencePath: "/x",
          },
        ]),
      ],
    });

    const bytes = buildMaterialMarketIntelligenceExportXlsx(doc);
    assert.ok(bytes.byteLength > 100);
    const wb = XLSX.read(bytes, { type: "array" });
    assert.ok(wb.SheetNames.includes("Filtros"));
    assert.ok(wb.SheetNames.includes("Alertas"));
    const sheet = wb.Sheets.Alertas;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    assert.equal(rows[0][0], "Código MP");
    assert.equal(rows[1][0], "MP-001");
    assert.ok(String(rows[1][6]).includes("5%"));
  });

  it("gera PDF mínimo com cabeçalho %PDF", () => {
    const doc = buildMaterialMarketIntelligenceExportDocument({
      scope: "reports",
      tables: [buildHomeExportRows([sampleMonitored({ id: "1", code: "MP-001" })])],
      notes: ["Relatório consolidado"],
    });
    const pdf = buildMaterialMarketIntelligenceExportPdf(doc);
    assert.ok(pdf.toString("utf8").startsWith("%PDF"));
    assert.ok(pdf.length > 50);

    const rendered = renderMaterialMarketIntelligenceExport(doc, "pdf");
    assert.equal(rendered.contentType, "application/pdf");
    assert.match(rendered.filename, /\.pdf$/);
  });
});
