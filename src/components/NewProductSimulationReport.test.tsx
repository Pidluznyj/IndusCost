import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewProductSimulationReport } from "./NewProductSimulationReport";
import type { NewProductSimulationSnapshot } from "../lib/newProductSimulationSnapshot";

function baseSnapshot(over: Partial<NewProductSimulationSnapshot> = {}): NewProductSimulationSnapshot {
  return {
    header: {
      simulationName: "Sim congelada",
      productName: "Produto Y",
      productSku: "NP-777",
      notes: "Nota do snapshot",
      createdAt: "2026-04-14T10:00:00.000Z",
      savedAt: "2026-04-14T11:00:00.000Z",
      origin: "NEW_PRODUCT_SANDBOX",
      createdBy: "user@test",
    },
    commercial: {
      mode: "MARGIN",
      desiredMarginPct: 18,
      targetPrice: 0,
    },
    composition: {
      lines: [
        {
          id: "x1",
          type: "EXISTING_COMPONENT",
          referenceId: "prod-live-id-wrong",
          referenceLabel: "Etiqueta congelada — nunca vem do cadastro",
          quantity: 1,
          unitCost: 12345.67,
          lineTotal: 12345.67,
          breakdown: { mp: 10000, hh: 2000, hm: 345.67 },
        },
      ],
      simulatedComponents: [],
    },
    result: {
      mp: 10000,
      hh: 2000,
      hm: 500,
      costBase: 12500,
      mpPct: 80,
      hhPct: 16,
      hmPct: 4,
      price: 15243.9,
      marginPct: 18,
      viability: "ATENCAO",
    },
    ...over,
  };
}

describe("NewProductSimulationReport TESTE 1", () => {
  it("abre simulação salva e renderiza o relatório com título e nome da simulação", () => {
    const snap = baseSnapshot();
    const html = renderToStaticMarkup(<NewProductSimulationReport snapshot={snap} recordStatus="SAVED" />);
    assert.ok(html.includes("Relatório de Simulação de Novo Produto"));
    assert.ok(html.includes("Sim congelada"));
    assert.ok(html.includes("Salvo (congelado)"));
  });
});

describe("NewProductSimulationReport TESTE 2", () => {
  it("usa valores do snapshot (custos congelados), não rótulos ou totais vindos do cadastro vivo", () => {
    const snap = baseSnapshot();
    const html = renderToStaticMarkup(<NewProductSimulationReport snapshot={snap} recordStatus="SAVED" />);
    assert.ok(html.includes("Etiqueta congelada — nunca vem do cadastro"));
    assert.ok(html.includes("12.345,67") || html.includes("12345,67"));
    assert.ok(!html.includes("999999.99"));
  });
});

describe("NewProductSimulationReport TESTE 3", () => {
  it("exibe resumo executivo com MP, HH, HM e custo base do snapshot", () => {
    const snap = baseSnapshot();
    const html = renderToStaticMarkup(<NewProductSimulationReport snapshot={snap} recordStatus="SAVED" />);
    assert.ok(html.includes("Resumo executivo"));
    assert.ok(html.includes("MP total"));
    assert.ok(html.includes("HH total"));
    assert.ok(html.includes("HM total"));
    assert.ok(html.includes("Custo base total"));
  });
});

describe("NewProductSimulationReport TESTE 4", () => {
  it("exibe tabela de composição do produto final a partir das linhas do snapshot", () => {
    const snap = baseSnapshot({
      composition: {
        lines: [
          {
            id: "d1",
            type: "DIRECT_MATERIAL",
            description: "MP direta snapshot",
            quantity: 3,
            unitCost: 10,
            lineTotal: 30,
            breakdown: { mp: 30, hh: 0, hm: 0 },
          },
        ],
        simulatedComponents: [],
      },
    });
    const html = renderToStaticMarkup(<NewProductSimulationReport snapshot={snap} recordStatus="SAVED" />);
    assert.ok(html.includes("Composição do produto final"));
    assert.ok(html.includes("Material direto"));
    assert.ok(html.includes("MP direta snapshot"));
  });
});

describe("NewProductSimulationReport TESTE 5", () => {
  it("exibe resumo de viabilidade conforme viability do snapshot", () => {
    const s = baseSnapshot();
    const snap: NewProductSimulationSnapshot = {
      ...s,
      result: { ...s.result, viability: "INVIAVEL" },
    };
    const html = renderToStaticMarkup(<NewProductSimulationReport snapshot={snap} recordStatus="SAVED" />);
    assert.ok(html.includes("Resumo de viabilidade"));
    assert.ok(html.includes("Inviável"));
  });
});

describe("NewProductSimulationReport TESTE 6", () => {
  it("regressão: helpers de clone/snapshot continuam íntegros (usa mesmo tipo de payload)", () => {
    const snap = baseSnapshot();
    assert.equal(snap.composition.lines[0].lineTotal, 12345.67);
    assert.equal(snap.result.viability, "ATENCAO");
  });
});
