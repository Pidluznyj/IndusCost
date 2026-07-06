import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  agingBandLabel,
  emptyIntelligenceBlock,
  filterIntelligenceView,
  safeDisplayNumber,
} from "./materialDemandIntelligenceUi.js";

function readPanel(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialDemandPlannedRealizedPanel.tsx"),
    "utf8"
  );
}

function readDashboard(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/ProductMaterialDemandDashboard.tsx"),
    "utf8"
  );
}

function readSections(): string {
  return readFileSync(
    join(process.cwd(), "src/components/contextual/MaterialDemandIntelligenceSections.tsx"),
    "utf8"
  );
}

describe("materialDemandIntelligenceUi — helpers", () => {
  it("safeDisplayNumber retorna 0 para NaN/Infinity", () => {
    assert.equal(safeDisplayNumber(NaN), 0);
    assert.equal(safeDisplayNumber(Infinity), 0);
    assert.equal(safeDisplayNumber(undefined), 0);
    assert.equal(safeDisplayNumber(12.5), 12.5);
  });

  it("agingBandLabel cobre faixas esperadas", () => {
    assert.match(agingBandLabel(5), /0 a 14 dias/);
    assert.match(agingBandLabel(20), /15 a 30 dias/);
    assert.match(agingBandLabel(45), /31 a 60 dias/);
    assert.match(agingBandLabel(75), /61 a 90 dias/);
    assert.match(agingBandLabel(120), /90\+ dias/);
  });

  it("payload vazio não quebra filterIntelligenceView", () => {
    const empty = emptyIntelligenceBlock();
    const filtered = filterIntelligenceView(empty, {
      calculationMode: "recommended",
      estimationStatus: "ALL",
      criticalOnly: false,
      reviewOnly: false,
    });
    assert.equal(filtered.materials.length, 0);
    assert.equal(filtered.orders.length, 0);
  });
});

describe("materialDemandIntelligenceUi — estrutura da tela", () => {
  it("tela existe e integra painel de inteligência", () => {
    const dashboard = readDashboard();
    assert.match(dashboard, /MaterialDemandPlannedRealizedPanel/);
    assert.match(dashboard, /enableIntelligence=\{context === "sales-orders"\}/);
  });

  it("cards novos existem", () => {
    const panel = readPanel();
    assert.match(panel, /Necessidade recomendada/);
    assert.match(panel, /Necessidade conservadora/);
    assert.match(panel, /Diferença por incerteza/);
    assert.match(panel, /Itens em revisão/);
    assert.match(panel, /Saldo crítico > 30 dias/);
    assert.match(panel, /Potencial não realizado/);
    assert.match(panel, /Itens sem BOM/);
    assert.match(panel, /Confiabilidade/);
    assert.match(panel, /material-intelligence-kpi-grid/);
  });

  it("filtros de inteligência existem", () => {
    const panel = readPanel();
    assert.match(panel, /material-intelligence-filters/);
    assert.match(panel, /Modo de cálculo/);
    assert.match(panel, /Status da estimativa/);
    assert.match(panel, /Somente saldos críticos/);
    assert.match(panel, /Somente itens em revisão/);
  });

  it("tabelas e seções existem", () => {
    const sections = readSections();
    assert.match(sections, /material-intelligence-materials-table/);
    assert.match(sections, /material-intelligence-orders-table/);
    assert.match(sections, /material-intelligence-unserved-table/);
    assert.match(sections, /material-intelligence-review-table/);
    assert.match(sections, /material-intelligence-interpretation/);
  });

  it("auditoria explica regra de 14 dias", () => {
    const sections = readSections();
    const ui = readFileSync(
      join(process.cwd(), "src/lib/materialDemandIntelligenceUi.ts"),
      "utf8"
    );
    assert.match(sections, /material-intelligence-audit-14d/);
    assert.match(sections, /billingCycleDays/);
    assert.match(sections, /Janela de faturamento/);
    assert.match(ui, /janela padrão de 14 dias/);
    assert.match(sections, /material-intelligence-audit-30d/);
  });

  it("não importa Prisma no frontend", () => {
    const panel = readPanel();
    const sections = readSections();
    const dashboard = readDashboard();
    assert.doesNotMatch(panel, /@prisma\/client/);
    assert.doesNotMatch(sections, /@prisma\/client/);
    assert.doesNotMatch(dashboard, /@prisma\/client/);
  });

  it("estados loading/error/empty existem", () => {
    const panel = readPanel();
    assert.match(panel, /material-intelligence-loading/);
    assert.match(panel, /material-intelligence-error/);
    assert.match(panel, /material-intelligence-empty/);
  });

  it("enableIntelligence ativado para sales-orders", () => {
    const dashboard = readDashboard();
    assert.match(dashboard, /enableIntelligence=\{context === "sales-orders"\}/);
  });
});
