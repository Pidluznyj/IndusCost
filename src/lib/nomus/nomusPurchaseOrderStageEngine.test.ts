import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyNomusPurchaseOrderRawItemStatus,
  classifyNomusPurchaseOrderStage,
} from "./nomusPurchaseOrderStageEngine.js";

test("classifyNomusPurchaseOrderRawItemStatus — mapeia os 8 códigos documentados", () => {
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("1"), "AWAITING_RELEASE");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus(2), "RELEASED");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("3"), "PARTIALLY_FULFILLED");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("4"), "FULFILLED");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("5"), "FULFILLED_WITH_CUT");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("6"), "CANCELED");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("7"), "RETURNED_PARTIAL");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("8"), "RETURNED_TOTAL");
});

test("classifyNomusPurchaseOrderRawItemStatus — desconhecido/ausente nunca é adivinhado", () => {
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("99"), "UNKNOWN");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus(""), "UNKNOWN");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus(null), "UNKNOWN");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus(undefined), "UNKNOWN");
  assert.equal(classifyNomusPurchaseOrderRawItemStatus("Cancelado"), "UNKNOWN");
});

test("classifyNomusPurchaseOrderStage — sem itens → MISTO/NO_ITEMS", () => {
  const result = classifyNomusPurchaseOrderStage([]);
  assert.equal(result.stage, "MISTO");
  assert.equal(result.reason, "NO_ITEMS");
});

test("classifyNomusPurchaseOrderStage — status desconhecido presente → MISTO, nunca ignorado", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "2" },
    { rawStatusCode: "99" },
  ]);
  assert.equal(result.stage, "MISTO");
  assert.equal(result.reason, "UNKNOWN_STATUS_PRESENT");
});

test("classifyNomusPurchaseOrderStage — todos cancelados → CANCELADO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "6" },
    { rawStatusCode: "6" },
  ]);
  assert.equal(result.stage, "CANCELADO");
});

test("classifyNomusPurchaseOrderStage — todos devolvidos (parcial+total) → DEVOLUCAO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "7" },
    { rawStatusCode: "8" },
  ]);
  assert.equal(result.stage, "DEVOLUCAO");
});

test("classifyNomusPurchaseOrderStage — todos atendidos totalmente → CONCLUIDO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "4" },
    { rawStatusCode: "4" },
  ]);
  assert.equal(result.stage, "CONCLUIDO");
});

test("classifyNomusPurchaseOrderStage — atendido totalmente + atendido com corte, sem pendente → ATENDIDO_COM_CORTE", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "4" },
    { rawStatusCode: "5" },
  ]);
  assert.equal(result.stage, "ATENDIDO_COM_CORTE");
});

test("classifyNomusPurchaseOrderStage — item liberado + item atendido → PARCIALMENTE_ATENDIDO (nunca CONCLUIDO)", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "2" },
    { rawStatusCode: "4" },
  ]);
  assert.equal(result.stage, "PARCIALMENTE_ATENDIDO");
  assert.notEqual(result.stage, "CONCLUIDO");
});

test("classifyNomusPurchaseOrderStage — item liberado + item cancelado → PARCIALMENTE_ATENDIDO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "2" },
    { rawStatusCode: "6" },
  ]);
  assert.equal(result.stage, "PARCIALMENTE_ATENDIDO");
});

test("classifyNomusPurchaseOrderStage — todos liberados → LIBERADO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "2" },
    { rawStatusCode: "2" },
  ]);
  assert.equal(result.stage, "LIBERADO");
});

test("classifyNomusPurchaseOrderStage — todos aguardando liberação → AGUARDANDO_LIBERACAO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "1" },
    { rawStatusCode: "1" },
  ]);
  assert.equal(result.stage, "AGUARDANDO_LIBERACAO");
});

test("classifyNomusPurchaseOrderStage — só itens parcialmente atendidos (sem settled) → PARCIALMENTE_ATENDIDO", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "3" },
    { rawStatusCode: "3" },
  ]);
  assert.equal(result.stage, "PARCIALMENTE_ATENDIDO");
});

test("classifyNomusPurchaseOrderStage — aguardando liberação + liberado (mistura de pendentes, sem settled) → MISTO explícito", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "1" },
    { rawStatusCode: "2" },
  ]);
  // Nem "todos liberados" nem "todos aguardando" nem settled presente —
  // combinação não coberta explicitamente cai em MISTO (nunca adivinha).
  assert.equal(result.stage, "MISTO");
  assert.equal(result.reason, "UNMAPPED_COMBINATION");
});

test("classifyNomusPurchaseOrderStage — single item variantes (cada status isolado)", () => {
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "1" }]).stage, "AGUARDANDO_LIBERACAO");
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "2" }]).stage, "LIBERADO");
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "3" }]).stage, "PARCIALMENTE_ATENDIDO");
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "4" }]).stage, "CONCLUIDO");
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "6" }]).stage, "CANCELADO");
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "7" }]).stage, "DEVOLUCAO");
  assert.equal(classifyNomusPurchaseOrderStage([{ rawStatusCode: "8" }]).stage, "DEVOLUCAO");
});

test("classifyNomusPurchaseOrderStage — categoryCounts sempre reflete os itens de entrada", () => {
  const result = classifyNomusPurchaseOrderStage([
    { rawStatusCode: "4" },
    { rawStatusCode: "4" },
    { rawStatusCode: "3" },
  ]);
  assert.equal(result.categoryCounts.FULFILLED, 2);
  assert.equal(result.categoryCounts.PARTIALLY_FULFILLED, 1);
  assert.equal(result.stage, "PARCIALMENTE_ATENDIDO");
});
