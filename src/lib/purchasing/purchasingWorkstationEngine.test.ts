import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCardsDoNotDoubleCountPipeline,
  buildWorkstationCards,
  classifyPipelineStage,
  paginateRows,
  resolveExclusivePipelineStages,
  rowMatchesFilters,
  type PurchasingWorkstationRowInput,
} from "./purchasingWorkstationEngine.js";

function row(
  overrides: Partial<PurchasingWorkstationRowInput> & Pick<PurchasingWorkstationRowInput, "id" | "pipelineKey">
): PurchasingWorkstationRowInput {
  return {
    kind: "REQUEST",
    status: "RASCUNHO",
    title: "SC",
    responsible: "Ana",
    supplierId: null,
    supplierName: null,
    materialId: null,
    materialCode: null,
    priority: "NORMAL",
    neededByDate: "2026-08-01",
    createdAt: "2026-07-01T12:00:00.000Z",
    href: "/purchases",
    negotiatedGain: null,
    isPendingApproval: false,
    signals: {
      hasQuotation: false,
      hasClosedRound: false,
      hasApprovedAward: false,
      purchaseOrderStatus: null,
    },
    ...overrides,
  };
}

describe("purchasingWorkstationEngine (OP-21)", () => {
  it("classifica estágio pelo sinal mais avançado", () => {
    assert.equal(classifyPipelineStage({
      hasQuotation: false,
      hasClosedRound: false,
      hasApprovedAward: false,
      purchaseOrderStatus: null,
    }), "SOLICITADO");
    assert.equal(classifyPipelineStage({
      hasQuotation: true,
      hasClosedRound: false,
      hasApprovedAward: false,
      purchaseOrderStatus: null,
    }), "EM_COTACAO");
    assert.equal(classifyPipelineStage({
      hasQuotation: true,
      hasClosedRound: true,
      hasApprovedAward: false,
      purchaseOrderStatus: null,
    }), "NEGOCIADO");
    assert.equal(classifyPipelineStage({
      hasQuotation: true,
      hasClosedRound: true,
      hasApprovedAward: true,
      purchaseOrderStatus: "APROVADO",
    }), "PEDIDO");
    assert.equal(classifyPipelineStage({
      hasQuotation: true,
      hasClosedRound: true,
      hasApprovedAward: true,
      purchaseOrderStatus: "CONFIRMADO",
    }), "CONFIRMADO");
    assert.equal(classifyPipelineStage({
      hasQuotation: true,
      hasClosedRound: true,
      hasApprovedAward: true,
      purchaseOrderStatus: "RECEBIDO",
    }), "RECEBIDO");
  });

  it("cards de funil são exclusivos por pipelineKey (sem duplicar etapas)", () => {
    const rows = [
      row({
        id: "req-1",
        pipelineKey: "sc-1",
        kind: "REQUEST",
        signals: { hasQuotation: true, hasClosedRound: false, hasApprovedAward: false, purchaseOrderStatus: null },
      }),
      row({
        id: "q-1",
        pipelineKey: "sc-1",
        kind: "QUOTATION",
        signals: { hasQuotation: true, hasClosedRound: true, hasApprovedAward: false, purchaseOrderStatus: null },
      }),
      row({
        id: "po-1",
        pipelineKey: "sc-1",
        kind: "PURCHASE_ORDER",
        negotiatedGain: 100,
        signals: { hasQuotation: true, hasClosedRound: true, hasApprovedAward: true, purchaseOrderStatus: "APROVADO" },
      }),
      row({
        id: "req-2",
        pipelineKey: "sc-2",
        kind: "REQUEST",
        isPendingApproval: true,
        signals: { hasQuotation: false, hasClosedRound: false, hasApprovedAward: false, purchaseOrderStatus: null },
      }),
      row({
        id: "ev-1",
        pipelineKey: "orphan-ev",
        kind: "EVIDENCE",
        signals: { hasQuotation: true, hasClosedRound: true, hasApprovedAward: true, purchaseOrderStatus: "RECEBIDO" },
      }),
    ];
    const exclusive = resolveExclusivePipelineStages(rows);
    assert.equal(exclusive.get("sc-1"), "PEDIDO");
    assert.equal(exclusive.get("sc-2"), "SOLICITADO");
    assert.equal(exclusive.has("orphan-ev"), false);

    const cards = buildWorkstationCards(rows, exclusive);
    assertCardsDoNotDoubleCountPipeline(cards);
    assert.equal(cards.pedido, 1);
    assert.equal(cards.solicitado, 1);
    assert.equal(cards.emCotacao, 0);
    assert.equal(cards.negociado, 0);
    assert.equal(cards.pipelineTotal, 2);
    assert.equal(cards.pendente, 1);
    assert.equal(cards.ganhoNegociado, 100);
    // pendente não entra no funil
    assert.equal(
      cards.solicitado + cards.emCotacao + cards.negociado + cards.pedido + cards.confirmado + cards.recebido,
      cards.pipelineTotal
    );
  });

  it("ganho negociado deduplica por pipelineKey e é ortogonal", () => {
    const rows = [
      row({
        id: "a1",
        pipelineKey: "sc-1",
        kind: "APPROVAL",
        negotiatedGain: 50,
        signals: { hasQuotation: true, hasClosedRound: true, hasApprovedAward: true, purchaseOrderStatus: null },
      }),
      row({
        id: "po1",
        pipelineKey: "sc-1",
        kind: "PURCHASE_ORDER",
        negotiatedGain: 80,
        signals: { hasQuotation: true, hasClosedRound: true, hasApprovedAward: true, purchaseOrderStatus: "ENVIADO" },
      }),
    ];
    const exclusive = resolveExclusivePipelineStages(rows);
    const cards = buildWorkstationCards(rows, exclusive);
    assert.equal(cards.ganhoNegociado, 80);
    assert.equal(cards.pedido, 1);
    assert.equal(cards.pipelineTotal, 1);
  });

  it("filtros cobrem status, responsável, fornecedor, MP, período, prioridade e data necessária", () => {
    const rows = [
      row({
        id: "1",
        pipelineKey: "sc-1",
        status: "EM_COTACAO",
        responsible: "Bruno Silva",
        supplierId: "sup-1",
        materialId: "mat-1",
        priority: "ALTA",
        neededByDate: "2026-08-10",
        createdAt: "2026-07-05T10:00:00.000Z",
        signals: { hasQuotation: true, hasClosedRound: false, hasApprovedAward: false, purchaseOrderStatus: null },
      }),
      row({
        id: "2",
        pipelineKey: "sc-2",
        status: "RASCUNHO",
        responsible: "Ana",
        priority: "BAIXA",
        neededByDate: "2026-09-01",
        createdAt: "2026-07-20T10:00:00.000Z",
      }),
    ];
    const exclusive = resolveExclusivePipelineStages(rows);
    assert.equal(
      rowMatchesFilters(rows[0]!, exclusive, {
        responsible: "bruno",
        supplierId: "sup-1",
        materialId: "mat-1",
        priority: "alta",
        periodFrom: "2026-07-01",
        periodTo: "2026-07-10",
        neededByFrom: "2026-08-01",
        neededByTo: "2026-08-15",
        stage: "EM_COTACAO",
      }),
      true
    );
    assert.equal(
      rowMatchesFilters(rows[1]!, exclusive, { stage: "EM_COTACAO" }),
      false
    );
    assert.equal(
      rowMatchesFilters(rows[1]!, exclusive, { priority: "BAIXA", neededByFrom: "2026-09-01" }),
      true
    );
  });

  it("paginação limita pageSize e respeita página", () => {
    const items = Array.from({ length: 25 }, (_, i) => i);
    const page1 = paginateRows(items, 1, 20);
    assert.equal(page1.rows.length, 20);
    assert.equal(page1.total, 25);
    assert.equal(page1.totalPages, 2);
    const page2 = paginateRows(items, 2, 20);
    assert.equal(page2.rows.length, 5);
    const capped = paginateRows(items, 1, 500);
    assert.equal(capped.pageSize, 100);
  });
});
