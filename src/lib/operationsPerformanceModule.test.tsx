import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import {
  estimateTheoreticalPiecesPerHour,
  snapshotFromProduct,
} from "./componentPerformanceChange.js";
import {
  OPERATIONS_PERFORMANCE_FROZEN_COST_NOTICE,
  validatePerformanceEditForm,
} from "./componentPerformanceUi.js";
import { ComponentPerformanceEditDrawer } from "../components/operations/ComponentPerformanceEditDrawer.js";

describe("componentPerformanceUi", () => {
  it("validatePerformanceEditForm exige responsável", () => {
    const message = validatePerformanceEditForm({
      responsiblePersonName: "",
      cycleTimeSeconds: "40",
      cavities: "4",
      setupTimeMin: "0",
      efficiencyExpected: "100",
    });
    assert.match(message ?? "", /responsável/i);
  });

  it("validatePerformanceEditForm aceita dados válidos", () => {
    assert.equal(
      validatePerformanceEditForm({
        responsiblePersonName: "João da Produção",
        cycleTimeSeconds: "40",
        cavities: "4",
        setupTimeMin: "0",
        efficiencyExpected: "100",
      }),
      null
    );
  });

  it("validatePerformanceEditForm exige setup >= 0", () => {
    const message = validatePerformanceEditForm({
      responsiblePersonName: "João da Produção",
      cycleTimeSeconds: "40",
      cavities: "4",
      setupTimeMin: "",
      efficiencyExpected: "100",
    });
    assert.match(message ?? "", /setup/i);
  });

  it("estimateTheoreticalPiecesPerHour calcula produtividade", () => {
    const pph = estimateTheoreticalPiecesPerHour(
      snapshotFromProduct({
        cycleTimeSeconds: 45,
        cavities: 4,
        efficiencyExpected: 100,
      })
    );
    assert.ok(pph != null && pph > 0);
  });
});

describe("ComponentPerformanceEditDrawer", () => {
  const item = {
    id: "comp-1",
    sku: "80001",
    name: "Componente A",
    status: "ACTIVE",
    type: "COMPONENT",
    costingMode: "OWN_PROCESS",
    defaultLotSize: 1000,
    process: {
      cycleTimeSeconds: 45,
      cavities: 4,
      setupTimeMin: 10,
      efficiencyExpected: 95,
    },
    missingProcess: false,
    soldCount: 1,
    routingStepCount: 0,
    updatedAt: null,
    lastPerformanceChangeAt: null,
    estimatedPiecesPerHour: 320,
  };

  it("renderiza aviso de custo publicado congelado", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComponentPerformanceEditDrawer, {
        open: true,
        item,
        canEdit: true,
        saving: false,
        error: null,
        onClose: () => {},
        onSave: () => {},
      })
    );
    assert.match(html, /performance-frozen-cost-notice/);
    assert.match(html, new RegExp(OPERATIONS_PERFORMANCE_FROZEN_COST_NOTICE.replace(/\./g, "\\.")));
    assert.match(html, /Responsável pela alteração/);
    assert.match(html, /Novo setup \(min\)/);
    assert.match(html, /Nova eficiência \(%\)/);
  });

  it("bloqueia edição quando canEdit=false", () => {
    const html = renderToStaticMarkup(
      React.createElement(ComponentPerformanceEditDrawer, {
        open: true,
        item,
        canEdit: false,
        saving: false,
        error: null,
        onClose: () => {},
        onSave: () => {},
      })
    );
    assert.match(html, /não pode registrar alterações/i);
    assert.doesNotMatch(html, /Salvar alteração/);
  });
});
