import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NFE_NAO_PROCESSADA_LABEL,
  buildSalesOrderDeliveryAssessment,
  computeSalesOrderDeliveryDaysOriginal,
  computeSalesOrderDeliveryDaysTotal,
  computeSalesOrderDeliveryDelayDays,
  formatNfeProcessamentoDisplay,
  resolveSalesOrderPrazoLabel,
} from "./salesOrderDeliveryDelay.js";

const HOJE = new Date(2026, 5, 24); // 24/06/2026

describe("salesOrderDeliveryDelay — dias de atraso", () => {
  it("1. NF no mesmo dia do prazo → atraso 0", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-06-16",
      realInvoiceDate: "2026-06-16",
      referenceDate: HOJE,
    });
    assert.equal(delay, 0);
  });

  it("2. NF um dia após o prazo → atraso 1", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-06-16",
      realInvoiceDate: "2026-06-17",
      referenceDate: HOJE,
    });
    assert.equal(delay, 1);
  });

  it("exemplo de negócio: vendi 01, prometi 16, faturei 17 → 1 dia de atraso", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-06-16",
      realInvoiceDate: "2026-06-17",
      referenceDate: HOJE,
    });
    assert.equal(delay, 1);
    assert.equal(computeSalesOrderDeliveryDaysOriginal("2026-06-01", "2026-06-16"), 15);
    assert.equal(
      computeSalesOrderDeliveryDaysTotal({
        issueDate: "2026-06-01",
        realInvoiceDate: "2026-06-17",
        referenceDate: HOJE,
      }),
      16
    );
  });

  it("3. NF antes do prazo → atraso 0", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-06-16",
      realInvoiceDate: "2026-06-10",
      referenceDate: HOJE,
    });
    assert.equal(delay, 0);
  });

  it("4. Pedido sem NF e prazo vencido → atraso até hoje", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-06-20",
      realInvoiceDate: null,
      referenceDate: HOJE,
    });
    assert.equal(delay, 4);
  });

  it("5. Pedido sem NF e prazo futuro → atraso 0", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-06-30",
      realInvoiceDate: null,
      referenceDate: HOJE,
    });
    assert.equal(delay, 0);
  });

  it("6. Cancelado → atraso 0 mesmo com prazo vencido", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "2026-01-01",
      realInvoiceDate: null,
      referenceDate: HOJE,
      isCancelled: true,
    });
    assert.equal(delay, 0);
  });

  it("sem data planejada → atraso 0 (Revisar prazo)", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: null,
      realInvoiceDate: "2026-06-17",
      referenceDate: HOJE,
    });
    assert.equal(delay, 0);
  });

  it("não sofre drift de timezone (DD/MM/YYYY)", () => {
    const delay = computeSalesOrderDeliveryDelayDays({
      plannedDeliveryDate: "23/06/2026",
      realInvoiceDate: "23/06/2026",
      referenceDate: HOJE,
    });
    assert.equal(delay, 0);
  });
});

describe("salesOrderDeliveryDelay — prazo", () => {
  it("sem data planejada → Revisar prazo", () => {
    assert.equal(
      resolveSalesOrderPrazoLabel({ plannedDeliveryDate: null, realInvoiceDate: "2026-06-16" }),
      "Revisar prazo"
    );
  });

  it("NF <= planejada → NF no prazo", () => {
    assert.equal(
      resolveSalesOrderPrazoLabel({
        plannedDeliveryDate: "2026-06-16",
        realInvoiceDate: "2026-06-16",
      }),
      "NF no prazo"
    );
  });

  it("NF > planejada → NF após prazo", () => {
    assert.equal(
      resolveSalesOrderPrazoLabel({
        plannedDeliveryDate: "2026-06-16",
        realInvoiceDate: "2026-06-17",
      }),
      "NF após prazo"
    );
  });

  it("sem NF e hoje <= planejada → Pendente no prazo", () => {
    assert.equal(
      resolveSalesOrderPrazoLabel({
        plannedDeliveryDate: "2026-06-30",
        realInvoiceDate: null,
        referenceDate: HOJE,
      }),
      "Pendente no prazo"
    );
  });

  it("sem NF e hoje > planejada → Pendente atrasado", () => {
    assert.equal(
      resolveSalesOrderPrazoLabel({
        plannedDeliveryDate: "2026-06-10",
        realInvoiceDate: null,
        referenceDate: HOJE,
      }),
      "Pendente atrasado"
    );
  });
});

describe("salesOrderDeliveryDelay — Data NF (dataProcessamento)", () => {
  it("7. NF com dataProcessamento vazia → Não Processada", () => {
    assert.equal(formatNfeProcessamentoDisplay(null, true), NFE_NAO_PROCESSADA_LABEL);
    assert.equal(formatNfeProcessamentoDisplay("", true), NFE_NAO_PROCESSADA_LABEL);
  });

  it("8. NF com dataProcessamento preenchida → dd/mm/yyyy", () => {
    assert.equal(formatNfeProcessamentoDisplay("2026-06-23", true), "23/06/2026");
    assert.equal(formatNfeProcessamentoDisplay("2026-06-09", true), "09/06/2026");
  });

  it("sem NF vinculada → —", () => {
    assert.equal(formatNfeProcessamentoDisplay(null, false), "—");
  });
});

describe("salesOrderDeliveryDelay — casos reais obrigatórios", () => {
  it("PD 02682: emissão 22/06, planejada 23/06, NF 23/06 → atraso 0, NF no prazo", () => {
    const a = buildSalesOrderDeliveryAssessment({
      issueDate: "2026-06-22",
      plannedDeliveryDate: "2026-06-23",
      realInvoiceDate: "2026-06-23",
      hasLinkedNfe: true,
      referenceDate: HOJE,
    });
    assert.equal(a.delayDays, 0);
    assert.equal(a.prazoLabel, "NF no prazo");
    assert.equal(a.nfeProcessingDisplay, "23/06/2026");
  });

  it("PD 02683: idêntico ao 02682 → atraso 0, NF no prazo", () => {
    const a = buildSalesOrderDeliveryAssessment({
      issueDate: "2026-06-22",
      plannedDeliveryDate: "2026-06-23",
      realInvoiceDate: "2026-06-23",
      hasLinkedNfe: true,
      referenceDate: HOJE,
    });
    assert.equal(a.delayDays, 0);
    assert.equal(a.prazoLabel, "NF no prazo");
  });

  it("PD 02614: emissão 08/06, planejada 09/06, NF 09/06 (valor 0) → atraso 0, NF no prazo", () => {
    const a = buildSalesOrderDeliveryAssessment({
      issueDate: "2026-06-08",
      plannedDeliveryDate: "2026-06-09",
      realInvoiceDate: "2026-06-09",
      hasLinkedNfe: true,
      referenceDate: HOJE,
    });
    assert.equal(a.delayDays, 0);
    assert.equal(a.prazoLabel, "NF no prazo");
    assert.equal(a.nfeProcessingDisplay, "09/06/2026");
  });

  it("PD 02612: emissão 08/06, planejada 10/06, NF 11/06 → atraso 1, NF após prazo", () => {
    const a = buildSalesOrderDeliveryAssessment({
      issueDate: "2026-06-08",
      plannedDeliveryDate: "2026-06-10",
      realInvoiceDate: "2026-06-11",
      hasLinkedNfe: true,
      referenceDate: HOJE,
    });
    assert.equal(a.delayDays, 1);
    assert.equal(a.prazoLabel, "NF após prazo");
    assert.equal(a.nfeProcessingDisplay, "11/06/2026");
  });

  it("NF sem processamento: vinculada mas sem dataProcessamento → Não Processada, segue pendente", () => {
    const a = buildSalesOrderDeliveryAssessment({
      issueDate: "2026-06-08",
      plannedDeliveryDate: "2026-06-30",
      realInvoiceDate: null,
      hasLinkedNfe: true,
      referenceDate: HOJE,
    });
    assert.equal(a.nfeProcessingDisplay, NFE_NAO_PROCESSADA_LABEL);
    assert.equal(a.hasRealInvoiceDate, false);
    assert.equal(a.delayDays, 0); // prazo futuro
    assert.equal(a.prazoLabel, "Pendente no prazo");
  });

  it("nenhum pedido com Data NF igual à Entrega planejada aparece como atrasado", () => {
    for (let day = 1; day <= 28; day += 1) {
      const planned = `2026-06-${String(day).padStart(2, "0")}`;
      const a = buildSalesOrderDeliveryAssessment({
        issueDate: "2026-06-01",
        plannedDeliveryDate: planned,
        realInvoiceDate: planned,
        hasLinkedNfe: true,
        referenceDate: HOJE,
      });
      assert.equal(a.delayDays, 0, `Data NF == planejada (${planned}) deve ter atraso 0`);
      assert.equal(a.prazoLabel, "NF no prazo");
    }
  });
});
