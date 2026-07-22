import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSupplyChainIndicatorCards,
  estimateCoverageDays,
  isSupplierLate,
  offerInitialComparable,
  pickOnePerPipelineKey,
  sumMapValues,
} from "./supplyChainIndicatorsEngine.js";

describe("supplyChainIndicatorsEngine (OP-26)", () => {
  it("deduplica dinheiro por pipelineKey e não infla com múltiplos estágios", () => {
    const map = pickOnePerPipelineKey([
      { pipelineKey: "p1", value: 100 },
      { pipelineKey: "p1", value: 120 }, // mesmo fato — fica o de maior |v|
      { pipelineKey: "p2", value: 50 },
    ]);
    assert.equal(sumMapValues(map), 170);
  });

  it("calcula comparável de oferta e cobertura estimada", () => {
    assert.equal(
      offerInitialComparable({
        lines: [{ unitPrice: 10, quantity: 5 }],
        freight: 20,
        discounts: 5,
      }),
      65
    );
    assert.equal(
      estimateCoverageDays({ available: 90, futureDemand: 30, horizonDays: 30 }),
      90
    );
    assert.equal(estimateCoverageDays({ available: 10, futureDemand: 0, horizonDays: 30 }), null);
  });

  it("atraso exige data prevista passada e qty pendente", () => {
    assert.equal(
      isSupplierLate({
        expectedDeliveryDate: "2026-07-01",
        quantityPending: 5,
        todayYmd: "2026-07-17",
      }),
      true
    );
    assert.equal(
      isSupplierLate({
        expectedDeliveryDate: null,
        quantityPending: 5,
        todayYmd: "2026-07-17",
      }),
      false
    );
  });

  it("monta cards com bases declaradas e meta anti-soma", () => {
    const built = buildSupplyChainIndicatorCards({
      filters: { periodFrom: "2026-01-01" },
      todayYmd: "2026-07-17",
      pipelines: [
        {
          pipelineKey: "sc1",
          initialComparable: 1000,
          quotedBestComparable: 900,
          negotiatedComparable: 800,
          negotiatedGain: 200,
          realizedGain: 80,
          createdAt: "2026-06-01T00:00:00.000Z",
          supplierId: "s1",
          materialIds: ["m1"],
        },
        {
          pipelineKey: "sc1",
          initialComparable: 1000,
          quotedBestComparable: 950,
          negotiatedComparable: 800,
          negotiatedGain: 200,
          realizedGain: 80,
          createdAt: "2026-06-02T00:00:00.000Z",
          supplierId: "s1",
          materialIds: ["m1"],
        },
      ],
      openOrders: [
        {
          purchaseOrderId: "po1",
          pipelineKey: "sc1",
          status: "CONFIRMADO",
          expectedDeliveryDate: "2026-07-01",
          quantityPending: 10,
          supplierId: "s1",
          materialIds: ["m1"],
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      balances: [
        {
          itemId: "i1",
          materialId: "m1",
          warehouseId: "w1",
          physical: 100,
          reserved: 20,
          blocked: 5,
          quarantine: 0,
          available: 75,
          minimumStock: 80,
          futureDemand: 30,
          horizonDays: 30,
        },
      ],
      evidenceExceptions: [
        {
          awardId: "a1",
          pipelineKey: "sc1",
          usedEvidenceException: true,
          evidenceCountSnapshot: 0,
          status: "APROVADA",
          createdAt: "2026-06-01T00:00:00.000Z",
          supplierId: "s1",
          materialIds: ["m1"],
        },
      ],
      divergentReceipts: [
        {
          receiptId: "r1",
          status: "DIVERGENTE",
          purchaseOrderId: "po1",
          supplierId: "s1",
          materialIds: ["m1"],
          createdAt: "2026-06-10T00:00:00.000Z",
        },
      ],
    });

    assert.equal(built.meta.doNotSumMoneyAcrossStages, true);
    assert.equal(built.meta.stockLayersAreNotAdditiveTotal, true);
    assert.equal(built.meta.mutatesOfficialEngines, false);

    const byId = Object.fromEntries(built.cards.map((c) => [c.id, c]));
    // Dedupe pipeline: um único grain
    assert.equal(byId.valor_solicitado.value, 1000);
    assert.equal(byId.valor_cotado.value, 950); // maior |quoted| no pickOne — wait, pick takes max abs so 950
    assert.equal(byId.valor_negociado.value, 800);
    assert.equal(byId.ganho_negociado.value, 200);
    assert.equal(byId.ganho_realizado.value, 80);
    assert.equal(byId.pedidos_em_aberto.value, 1);
    assert.equal(byId.quantidade_pendente.value, 10);
    assert.equal(byId.atrasos_fornecedor.value, 1);
    assert.equal(byId.estoque_fisico.value, 100);
    assert.equal(byId.estoque_disponivel.value, 75);
    assert.equal(byId.materiais_abaixo_minimo.value, 1);
    assert.equal(byId.negociacoes_sem_evidencia.value, 1);
    assert.equal(byId.recebimentos_divergentes.value, 1);
    assert.ok(byId.valor_solicitado.base.length > 10);
    assert.ok(byId.cobertura_estimada.notes.some((n) => /Estimativa/i.test(n)));

    // Não tratar soma dos estágios como KPI
    const naiveSum =
      byId.valor_solicitado.value + byId.valor_cotado.value + byId.valor_negociado.value;
    assert.notEqual(
      naiveSum,
      byId.valor_negociado.value,
      "estágios são ortogonais — soma ingenua ≠ negociado"
    );
  });
});
