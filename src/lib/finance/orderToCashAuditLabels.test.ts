import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatOrderItemStatus,
  formatNomusItemMatchConfidence,
  formatNomusItemStatusNormalized,
  formatOrderToCashCashStage,
  formatOrderToCashConfidence,
  formatOrderToCashEnum,
  formatOrderToCashEvidenceLevel,
  formatOrderToCashFinancialStage,
  formatOrderToCashLineBilledSource,
  formatOrderToCashLineType,
  formatOrderToCashOperationalStage,
  formatOrderToCashPaymentStatus,
  formatOrderToCashStage,
  formatOrderToCashTemperature,
  withRawTooltip,
} from "./orderToCashAuditLabels.js";

describe("orderToCashAuditLabels (PT-BR)", () => {
  it("traduz lineType canônicos", () => {
    assert.equal(formatOrderToCashLineType("ORDER_ITEM_PENDING"), "Pendente ativo");
    assert.equal(formatOrderToCashLineType("ORDER_ITEM_ALLOCATED"), "Atendido (alocado)");
    assert.equal(formatOrderToCashLineType("ORDER_ITEM_CANCELED"), "Cancelado");
    assert.equal(formatOrderToCashLineType("ORDER_ITEM_CUT"), "Atendido com corte");
    assert.equal(formatOrderToCashLineType("QUANTITY_SURPLUS"), "Excedente do documento");
    assert.equal(formatOrderToCashLineType("DOCUMENT_EXTRA_ITEM"), "Fora do pedido");
    assert.equal(formatOrderToCashLineType(""), "—");
    assert.equal(formatOrderToCashLineType(null), "—");
    // Valor desconhecido: devolve o bruto (nunca esconde por falta de tradução).
    assert.equal(formatOrderToCashLineType("FUTURE_ENUM_XX"), "FUTURE_ENUM_XX");
  });

  it("traduz paymentStatus / estágios", () => {
    assert.equal(formatOrderToCashPaymentStatus("PAID"), "Pago");
    assert.equal(formatOrderToCashPaymentStatus("PAID_LATE"), "Pago em atraso");
    assert.equal(formatOrderToCashPaymentStatus("AWAITING_CR"), "Aguardando CR");
    assert.equal(formatOrderToCashPaymentStatus("CANCELED"), "Cancelado");
    assert.equal(formatOrderToCashOperationalStage("FULLY_FULFILLED"), "Atendido totalmente");
    assert.equal(formatOrderToCashOperationalStage("NOT_FULFILLED"), "Sem atendimento");
    assert.equal(formatOrderToCashFinancialStage("CR_OPEN"), "CR em aberto");
    assert.equal(formatOrderToCashFinancialStage("INVOICED_WITHOUT_CR"), "Faturado sem CR");
    assert.equal(formatOrderToCashCashStage("CASH_EXPECTED"), "Caixa previsto");
    assert.equal(formatOrderToCashStage("RECEBIDO_COM_CANCELAMENTO"), "Recebido (com cancelamento)");
    assert.equal(formatOrderToCashStage("BLOQUEADO_REVISAO"), "Bloqueado (revisão)");
  });

  it("temperatura + confiança + evidência + fonte cobrado", () => {
    assert.equal(formatOrderToCashTemperature("QUENTE"), "Quente");
    assert.equal(formatOrderToCashTemperature("AMBAR"), "Morno");
    assert.equal(formatOrderToCashConfidence("HIGH"), "Alta");
    assert.equal(formatOrderToCashConfidence("Média"), "Média");
    assert.equal(formatOrderToCashEvidenceLevel("ITEM"), "Evidência de item");
    assert.equal(formatOrderToCashEvidenceLevel("ORDER_TITLE"), "Só título do pedido");
    assert.equal(
      formatOrderToCashLineBilledSource("STOCK_DOCUMENT_ITEM"),
      "Item de documento"
    );
    assert.equal(formatOrderToCashLineBilledSource("NOT_BILLED"), "Não faturado");
  });

  it("status de item Nomus + orderItemStatus + match confidence", () => {
    assert.equal(formatNomusItemStatusNormalized("FULFILLED"), "Atendido totalmente");
    assert.equal(formatNomusItemStatusNormalized("FULFILLED_WITH_CUT"), "Atendido com corte");
    assert.equal(formatNomusItemStatusNormalized("RELEASED"), "Liberado");
    assert.equal(formatNomusItemStatusNormalized("CANCELED"), "Cancelado");
    assert.equal(formatOrderItemStatus("CANCELADO"), "Cancelado");
    assert.equal(formatOrderItemStatus("ATENDIDO_COM_CORTE"), "Atendido com corte");
    assert.equal(formatOrderItemStatus("LIBERADO"), "Liberado");
    assert.equal(formatNomusItemMatchConfidence("AMBIGUOUS"), "Ambígua");
    assert.equal(formatNomusItemMatchConfidence("NONE"), "Sem casamento");
  });

  it("formatOrderToCashEnum agrega os traduçãos", () => {
    assert.equal(
      formatOrderToCashEnum("lineType", "QUANTITY_SURPLUS"),
      "Excedente do documento"
    );
    assert.equal(
      formatOrderToCashEnum("orderToCashStage", "COMPLETO_COM_CANCELAMENTO"),
      "Completo (com cancelamento)"
    );
  });

  it("withRawTooltip devolve tooltip com valor bruto se diferente do label", () => {
    const same = withRawTooltip("Cancelado", "Cancelado");
    assert.equal(same.title, "Cancelado");
    const diff = withRawTooltip("Atendido (alocado)", "ORDER_ITEM_ALLOCATED");
    assert.equal(diff.title, "Atendido (alocado) · ORDER_ITEM_ALLOCATED");
    const empty = withRawTooltip("—", null);
    assert.equal(empty.title, "—");
  });
});
