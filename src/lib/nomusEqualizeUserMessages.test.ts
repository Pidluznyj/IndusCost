import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEqualizeModalViewModel,
  buildEqualizeTechnicalReport,
  classifyEqualizeHttpError,
  EQUALIZE_STATUS_LABEL,
  formatCount,
} from "./nomusEqualizeUserMessages";
import type { EqualizeApplyResult } from "./nomusMasterDataEqualizeTypes";
import { EQUALIZE_CONFIRMATION_TEXT } from "./nomusMasterDataEqualizeTypes";

function sampleResult(overrides: Partial<EqualizeApplyResult> = {}): EqualizeApplyResult {
  return {
    mode: "APPLY_SAFE",
    generatedAt: "2026-05-25T12:00:00.000Z",
    status: "APPLIED",
    message: "Bases igualadas com sucesso.",
    userMessage: "",
    runId: "da06651c-d237-42bd-a814-2af634247da7",
    createdProducts: 0,
    createdMaterials: 0,
    updatedProducts: 26,
    updatedMaterials: 0,
    deactivatedProducts: 0,
    deactivatedMaterials: 0,
    preservedLocal: 0,
    blocked: 0,
    errors: 0,
    historyEntriesCreated: 26,
    totalRequested: 26,
    report: [],
    safety: {
      productBomChanged: false,
      costsChanged: false,
      pricesChanged: false,
      proposalsChanged: false,
      ordersChanged: false,
      routingChanged: false,
    },
    applyErrors: [],
    technicalDetails: {
      planHash: "abc123",
      generatedAt: "2026-05-25T12:00:00.000Z",
      confirmationRequiredText: EQUALIZE_CONFIRMATION_TEXT,
    },
    ...overrides,
  };
}

describe("nomusEqualizeUserMessages", () => {
  it("formatCount trata undefined como 0", () => {
    assert.equal(formatCount(undefined), 0);
    assert.equal(formatCount(26), 26);
  });

  it("classifica erro de confirmação", () => {
    assert.equal(
      classifyEqualizeHttpError('Confirmação inválida — envie "IGUALAR BASES NOMUS"'),
      "CONFIRMATION"
    );
  });

  it("modal de sucesso com 26 produtos atualizados", () => {
    const vm = buildEqualizeModalViewModel(sampleResult(), {
      ambiguous: 12,
      blocked: 0,
      createProducts: 0,
      createMaterials: 0,
      updateProducts: 0,
      updateMaterials: 0,
      deactivateProducts: 0,
      deactivateMaterials: 0,
      preserveLocalProducts: 859,
      preserveLocalMaterials: 61,
      preserveNomusControlled: 58,
      noChanges: 0,
      totalRowsConsidered: 1000,
    });
    assert.equal(vm.variant, "success");
    assert.equal(vm.title, "Bases igualadas com sucesso");
    assert.equal(vm.counts.updatedProducts, 26);
    assert.equal(vm.counts.ambiguous, 12);
    assert.match(vm.executiveSummary, /26 produto\(s\) atualizado\(s\)/);
    assert.match(vm.executiveSummary, /12 código\(s\) continuam como ambíguos/);
    assert.equal(vm.statusLabel, EQUALIZE_STATUS_LABEL.APPLIED);
  });

  it("modal NO_CHANGES", () => {
    const vm = buildEqualizeModalViewModel(
      sampleResult({ status: "NO_CHANGES", updatedProducts: 0, message: "Nenhuma alteração" })
    );
    assert.equal(vm.variant, "info");
    assert.equal(vm.title, "Bases já estavam alinhadas");
  });

  it("relatório técnico inclui runId e BOM não alterada", () => {
    const vm = buildEqualizeModalViewModel(sampleResult());
    const report = buildEqualizeTechnicalReport(vm);
    assert.match(report, /RunId: da06651c/);
    assert.match(report, /BOM alterada: Não/);
    assert.match(report, /Produtos atualizados: 26/);
  });
});
