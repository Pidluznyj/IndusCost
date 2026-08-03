import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMISSION_REPORT_OFFICIAL_SNAPSHOT_ALERT,
  COMMISSION_SOURCE_MISMATCH_STATUS,
  reconcileReportLineWithOfficialSnapshot,
  reportLineMisclassifiedAgainstSnapshot,
  resolveOfficialReconciledRatePercent,
  type OfficialCommissionSnapshotRef,
  type ReportLineOfficialFields,
} from "./commissionReportOfficialReconcile.js";
import { mapSourceLineToReportRecord } from "./commissionReports.shared.js";

/** Item único — percentual do snapshot inequívoco (4,0633% ≈ 12,19 / 300 × 100). */
const SNAP: OfficialCommissionSnapshotRef = {
  salesOrderId: "o1",
  orderCode: "PD 02523",
  totalFinalCommissionAmount: 12.19,
  totalSoldAmount: 300,
  canonicalSellerId: "s1",
  canonicalSellerName: "Rodrigo Da Silva Ramos",
  rawSellerId: 1,
  rawSellerName: "RODRIGO",
  scheduledCommissionSum: 12.19,
  itemStatuses: ["COMMISSIONABLE"],
  itemRatePercents: [4.0633],
  activeScheduleCount: 1,
};

/** Pedido com dois itens em percentuais diferentes — granularidade da linha é ambígua. */
const SNAP_MULTI_RATE: OfficialCommissionSnapshotRef = {
  ...SNAP,
  orderCode: "PD 90001",
  totalFinalCommissionAmount: 20,
  totalSoldAmount: 500,
  scheduledCommissionSum: 20,
  itemStatuses: ["COMMISSIONABLE", "COMMISSIONABLE"],
  itemRatePercents: [3, 5],
};

/** Base zero — comissão positiva sem forma de derivar percentual (caso degenerado). */
const SNAP_ZERO_BASE: OfficialCommissionSnapshotRef = {
  ...SNAP,
  orderCode: "PD 90002",
  totalSoldAmount: 0,
  scheduledCommissionSum: 0,
  totalFinalCommissionAmount: 12.19,
  itemRatePercents: [],
};

/**
 * Pedido com 2 parcelas ativas E itens em percentuais diferentes — totalFinalCommissionAmount/
 * totalSoldAmount são do PEDIDO inteiro, não desta parcela isolada.
 */
const SNAP_MULTI_PARCELA: OfficialCommissionSnapshotRef = {
  ...SNAP_MULTI_RATE,
  orderCode: "PD 90003",
  activeScheduleCount: 2,
};

const BASE_LINE: ReportLineOfficialFields = {
  status: "NO_MARGIN",
  statusReason: "Sem margem",
  expectedCommissionAmount: 0,
  releasedCommissionAmount: 0,
  grossCommissionAmount: 0,
  commissionableBaseAmount: 0,
  ratePercent: 0,
  canonicalSellerId: null,
  canonicalSellerName: null,
  rawSellerId: null,
  rawSellerName: null,
  source: "EXCEPTION",
};

describe("resolveOfficialReconciledRatePercent", () => {
  it("item único com percentual inequívoco — usa direto (não recalcula)", () => {
    assert.equal(
      resolveOfficialReconciledRatePercent({
        officialAmount: 12.19,
        officialBase: 300,
        itemRatePercents: [4.0633],
      }),
      4.0633
    );
  });

  it("itens com percentuais diferentes — deriva do total, não escolhe nenhum item", () => {
    const result = resolveOfficialReconciledRatePercent({
      officialAmount: 20,
      officialBase: 500,
      itemRatePercents: [3, 5],
    });
    assert.notEqual(result, 3);
    assert.notEqual(result, 5);
    assert.equal(result, 4);
  });

  it("percentual único não depende de granularidade — vale mesmo com ambiguousGranularity=true", () => {
    // É uma fração do preço unitário, não do total do pedido — seguro mesmo por parcela.
    assert.equal(
      resolveOfficialReconciledRatePercent({
        officialAmount: 12.19,
        officialBase: 300,
        itemRatePercents: [4.0633],
        ambiguousGranularity: true,
      }),
      4.0633
    );
  });

  it("granularidade ambígua (parcela de pedido multi-parcela) + percentuais diferentes — null, não deriva do total do pedido", () => {
    assert.equal(
      resolveOfficialReconciledRatePercent({
        officialAmount: 20,
        officialBase: 500,
        itemRatePercents: [3, 5],
        ambiguousGranularity: true,
      }),
      null
    );
  });

  it("base zero — retorna null, nunca 0% artificial", () => {
    assert.equal(
      resolveOfficialReconciledRatePercent({
        officialAmount: 12.19,
        officialBase: 0,
        itemRatePercents: [],
      }),
      null
    );
  });

  it("sem itens e sem base — null", () => {
    assert.equal(
      resolveOfficialReconciledRatePercent({
        officialAmount: 0,
        officialBase: 0,
        itemRatePercents: [],
      }),
      null
    );
  });
});

describe("commissionReportOfficialReconcile", () => {
  it("NO_MARGIN com ratePercent=0 e snapshot oficial positivo vira COMMISSION_SOURCE_MISMATCH — reconcilia valor E percentual juntos", () => {
    // Caso real: motor de ledger não achou margem/regra → tudo zerado, incluindo o
    // percentual. ratePercent=0 aqui NÃO é artificial — é o que o motor quebrado produz.
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        { status: "NO_MARGIN", expectedCommissionAmount: 0, releasedCommissionAmount: 0 },
        SNAP
      ),
      true
    );

    const out = reconcileReportLineWithOfficialSnapshot(BASE_LINE, SNAP);

    assert.equal(out.status, COMMISSION_SOURCE_MISMATCH_STATUS);
    assert.equal(out.statusReason, COMMISSION_REPORT_OFFICIAL_SNAPSHOT_ALERT);
    assert.equal(out.expectedCommissionAmount, 12.19);
    assert.equal(out.grossCommissionAmount, 12.19);
    assert.equal(out.commissionableBaseAmount, 300);
    // A correção desta fase: percentual reconciliado junto com o valor, não mais 0.
    assert.equal(out.ratePercent, 4.0633);
    // Nunca altera o que já foi liberado/pago.
    assert.equal(out.releasedCommissionAmount, 0);

    const record = mapSourceLineToReportRecord({
      lineKey: "k",
      nomusReceivableId: 16428,
      receivableNumber: "16428",
      installmentNumber: 1,
      settlementDate: null,
      dueDate: null,
      customerId: null,
      customerExternalId: null,
      customerName: "C",
      orderCode: "PD 02523",
      localOrderId: "o1",
      linkResolutionSource: null,
      linkResolutionStatus: null,
      nomusNfeId: null,
      nfeNumber: null,
      localItemId: null,
      nomusOrderItemId: null,
      productCode: null,
      productName: null,
      rawSellerId: 1,
      rawSellerName: "RODRIGO",
      canonicalSellerId: out.canonicalSellerId,
      canonicalSellerName: out.canonicalSellerName,
      sellerResolutionStatus: "OK",
      receivedAmount: 300,
      uniqueReceivedAmount: 300,
      commissionableBaseAmount: out.commissionableBaseAmount,
      ratePercent: out.ratePercent,
      expectedCommissionAmount: out.expectedCommissionAmount,
      releasedCommissionAmount: out.releasedCommissionAmount,
      grossCommissionAmount: 12.19,
      scheduledCommissionAmount: 12.19,
      commissionReceivableScheduleId: null,
      ruleId: null,
      ruleName: null,
      exclusionReason: null,
      status: out.status,
      statusReason: out.statusReason,
      source: out.source,
      year: 2026,
      month: 5,
      periodStatus: "CLOSED",
      closingId: "c1",
    });
    assert.equal(record.finalCommissionAmount, 12.19);
    // mapSourceLineToReportRecord arredonda ratePercent para exibição (2 casas,
    // mesma convenção de toFixed(2) na tela) — o reconciliado (out.ratePercent)
    // guarda 4 casas para precisão auditável.
    assert.equal(record.ratePercent, 4.06);
    assert.notEqual(record.lineStatus, "NO_MARGIN");
    // Não existe paidAmount no DTO de relatório (CommissionReportRecord) — o campo
    // monetário "pago" mais próximo é releasedCommissionAmount, coberto acima.
  });

  it("pedido com itens em percentuais diferentes — reconcilia valor sem inventar percentual de um item específico", () => {
    const out = reconcileReportLineWithOfficialSnapshot(
      { ...BASE_LINE, commissionableBaseAmount: 500 },
      SNAP_MULTI_RATE
    );
    assert.equal(out.status, COMMISSION_SOURCE_MISMATCH_STATUS);
    assert.equal(out.expectedCommissionAmount, 20);
    assert.equal(out.ratePercent, 4); // derivado de 20/500*100, não 3 nem 5
  });

  it("linha de parcela (installmentNumber) em pedido com >1 parcela ativa e itens em percentuais diferentes — percentual fica null, não deriva do total do PEDIDO para a parcela", () => {
    const out = reconcileReportLineWithOfficialSnapshot(
      { ...BASE_LINE, commissionableBaseAmount: 500, installmentNumber: 2 },
      SNAP_MULTI_PARCELA
    );
    assert.equal(out.status, COMMISSION_SOURCE_MISMATCH_STATUS);
    // Valor ainda vem do pedido (comportamento pré-existente, fora do escopo deste fix) —
    // mas o percentual NÃO é inventado a partir de um total que não é desta parcela.
    assert.equal(out.expectedCommissionAmount, 20);
    assert.equal(out.ratePercent, null);
  });

  it("linha de parcela em pedido com >1 parcela ativa, mas com percentual único nos itens — ainda reconcilia (fração de preço independe de parcela)", () => {
    const out = reconcileReportLineWithOfficialSnapshot(
      { ...BASE_LINE, installmentNumber: 2 },
      { ...SNAP, activeScheduleCount: 2 }
    );
    assert.equal(out.ratePercent, 4.0633);
  });

  it("base oficial zero — percentual reconciliado fica null, não 0,00%", () => {
    const out = reconcileReportLineWithOfficialSnapshot(BASE_LINE, SNAP_ZERO_BASE);
    assert.equal(out.status, COMMISSION_SOURCE_MISMATCH_STATUS);
    assert.equal(out.expectedCommissionAmount, 12.19);
    assert.equal(out.ratePercent, null);
  });

  it("não força snapshot sobre cliente excluído — ratePercent permanece como estava", () => {
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        {
          status: "CUSTOMER_EXCLUDED",
          expectedCommissionAmount: 0,
          releasedCommissionAmount: 0,
        },
        SNAP
      ),
      false
    );
    const out = reconcileReportLineWithOfficialSnapshot(
      { ...BASE_LINE, status: "CUSTOMER_EXCLUDED", ratePercent: 0 },
      SNAP
    );
    assert.equal(out.status, "CUSTOMER_EXCLUDED");
    assert.equal(out.ratePercent, 0);
  });

  it("pedido sem comissão no snapshot pode continuar NO_MARGIN", () => {
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        { status: "NO_MARGIN", expectedCommissionAmount: 0, releasedCommissionAmount: 0 },
        { totalFinalCommissionAmount: 0, scheduledCommissionSum: 0 }
      ),
      false
    );
    const out = reconcileReportLineWithOfficialSnapshot(BASE_LINE, {
      ...SNAP,
      totalFinalCommissionAmount: 0,
      scheduledCommissionSum: 0,
    });
    // Sem comissão oficial → linha não reconciliada, ratePercent intacto (0, do motor).
    assert.equal(out.ratePercent, 0);
    assert.equal(out.status, "NO_MARGIN");
  });

  it("linha já COMMISSIONABLE e alinhada ao snapshot não muda (inclui ratePercent)", () => {
    const line: ReportLineOfficialFields = {
      status: "COMMISSIONABLE",
      statusReason: null,
      expectedCommissionAmount: 12.19,
      releasedCommissionAmount: 12.19,
      grossCommissionAmount: 12.19,
      commissionableBaseAmount: 300,
      ratePercent: 4.0633,
      canonicalSellerId: "s1",
      canonicalSellerName: "Rodrigo Da Silva Ramos",
      rawSellerId: 1,
      rawSellerName: "RODRIGO",
      source: "PERSISTED_LEDGER",
    };
    const out = reconcileReportLineWithOfficialSnapshot(line, SNAP);
    assert.deepEqual(out, line);
  });

  it("diferença só de arredondamento (poucos centavos) não é tratada como divergência de regra", () => {
    // Já comissionável, dentro da tolerância de MATCH usada por classifyReportVsSnapshotDivergence —
    // reportLineMisclassifiedAgainstSnapshot não deve considerar isso um mismatch.
    assert.equal(
      reportLineMisclassifiedAgainstSnapshot(
        {
          status: "COMMISSIONABLE",
          expectedCommissionAmount: 12.19,
          releasedCommissionAmount: 12.18,
        },
        SNAP
      ),
      false
    );
  });

  it("releasedCommissionAmount liberado é preservado mesmo quando expected é reconciliado", () => {
    const line: ReportLineOfficialFields = {
      ...BASE_LINE,
      status: "COMMISSIONABLE",
      expectedCommissionAmount: 0,
      releasedCommissionAmount: 5,
    };
    // COMMISSIONABLE com released > 0.009 não é misclassified (linha já mostra > 0).
    assert.equal(reportLineMisclassifiedAgainstSnapshot(line, SNAP), false);
    const out = reconcileReportLineWithOfficialSnapshot(line, SNAP);
    assert.equal(out.releasedCommissionAmount, 5);
  });
});
