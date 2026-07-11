import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PortfolioIntelligenceOrderRow } from "@/src/lib/financePortfolioReconciliationClient";
import {
  cardKeyToAccordionKey,
  findDuplicateOrderCodesAcrossPrincipalGroups,
  INTELLIGENCE_ACCORDION_KEYS,
  rowsForIntelligenceAccordion,
  sumPrincipalGroupValues,
} from "./portfolioIntelligenceDrilldown";

function row(
  partial: Partial<PortfolioIntelligenceOrderRow> &
    Pick<PortfolioIntelligenceOrderRow, "orderCode" | "statusPrincipal" | "orderValue">
): PortfolioIntelligenceOrderRow {
  return {
    salesOrderId: partial.salesOrderId ?? partial.orderCode,
    orderCode: partial.orderCode,
    externalSalesOrderId: partial.externalSalesOrderId ?? null,
    customerName: partial.customerName ?? "Cliente",
    customerExternalId: partial.customerExternalId ?? null,
    sellerName: partial.sellerName ?? null,
    sellerExternalId: partial.sellerExternalId ?? null,
    issueDate: partial.issueDate ?? null,
    expectedDeliveryDate: partial.expectedDeliveryDate ?? null,
    forecastDate: partial.forecastDate ?? null,
    updatedAt: partial.updatedAt ?? null,
    orderValue: partial.orderValue,
    receivableTotalValue: partial.receivableTotalValue ?? 0,
    receivedValue: partial.receivedValue ?? 0,
    openReceivableValue: partial.openReceivableValue ?? 0,
    statusPrincipal: partial.statusPrincipal,
    tagsAlerta: partial.tagsAlerta ?? [],
    confidenceScore: partial.confidenceScore ?? 70,
    confidenceLabel: partial.confidenceLabel ?? "MEDIA",
    confidenceReasons: partial.confidenceReasons ?? [],
    recommendedAction: partial.recommendedAction ?? "",
    mainReason: partial.mainReason ?? "",
    daysSinceIssue: partial.daysSinceIssue ?? null,
    daysSinceExpected: partial.daysSinceExpected ?? null,
    nextRelevantDate: partial.nextRelevantDate ?? null,
    evidenceFlags: partial.evidenceFlags ?? {
      hasNfe: false,
      hasStockDocument: false,
      hasAllocatedStockDocument: false,
      hasReceivable: false,
      hasReceived: false,
      hasOpenReceivable: false,
    },
    productExternalIds: partial.productExternalIds ?? [],
  };
}

describe("portfolioIntelligenceDrilldown", () => {
  it("mapeia cards de status e risco para sanfonas", () => {
    assert.equal(cardKeyToAccordionKey("RECEBIDO"), "RECEBIDO");
    assert.equal(cardKeyToAccordionKey("CARTEIRA_VENCIDA_BLOQUEADA"), "CARTEIRA_VENCIDA_BLOQUEADA");
    assert.equal(cardKeyToAccordionKey("RISCO_SUPERESTIMACAO"), "CARTEIRA_VENCIDA_BLOQUEADA");
    assert.equal(cardKeyToAccordionKey("DIVERGENCIA_TECNICA"), "DIVERGENCIA_TECNICA");
    assert.equal(cardKeyToAccordionKey("CARTEIRA_TOTAL_ANALISADA"), null);
    assert.equal(cardKeyToAccordionKey("CONFIANCA_MEDIA_CARTEIRA"), null);
  });

  it("lista as sanfonas na ordem financeiro → operacional → alertas", () => {
    assert.deepEqual([...INTELLIGENCE_ACCORDION_KEYS], [
      "RECEBIDO",
      "CR_ABERTO",
      "FATURADO_SEM_CR",
      "CARTEIRA_FUTURA_PROVAVEL",
      "CARTEIRA_PRESENTE_ATENCAO",
      "CARTEIRA_VENCIDA_BLOQUEADA",
      "SEM_EVIDENCIA",
      "DIVERGENCIA_TECNICA",
      "NF_CABECALHO_MAIOR_PEDIDO",
    ]);
  });

  it("pedido aparece em um único status principal; divergência só por tag", () => {
    const rows = [
      row({
        orderCode: "PD 02339",
        statusPrincipal: "CR_ABERTO",
        orderValue: 158_000,
        tagsAlerta: ["DIVERGENCIA_TECNICA"],
      }),
      row({
        orderCode: "PD 02607",
        statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL",
        orderValue: 100_000,
      }),
      row({
        orderCode: "PD 02159",
        statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA",
        orderValue: 50_000,
      }),
    ];

    const byPrincipal = INTELLIGENCE_ACCORDION_KEYS.filter(
      (k) => k !== "DIVERGENCIA_TECNICA" && k !== "NF_CABECALHO_MAIOR_PEDIDO"
    )
      .flatMap((k) => rowsForIntelligenceAccordion(k, rows).map((r) => r.orderCode));
    assert.equal(byPrincipal.length, 3);
    assert.equal(new Set(byPrincipal).size, 3);

    const div = rowsForIntelligenceAccordion("DIVERGENCIA_TECNICA", rows);
    assert.equal(div.length, 1);
    assert.equal(div[0]!.orderCode, "PD 02339");
    assert.equal(div[0]!.statusPrincipal, "CR_ABERTO");
  });

  it("Britânia: futura/presente e vencida não misturam pedidos", () => {
    const rows = [
      row({ orderCode: "PD 02607", statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL", orderValue: 200_000 }),
      row({ orderCode: "PD 02740", statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL", orderValue: 150_000 }),
      row({ orderCode: "PD 02739", statusPrincipal: "CARTEIRA_PRESENTE_ATENCAO", orderValue: 145_460 }),
      row({ orderCode: "PD 02159", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 100_000 }),
      row({ orderCode: "PD 01604", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 80_000 }),
      row({ orderCode: "PD 01953", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 70_000 }),
      row({ orderCode: "PD 02092", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 90_000 }),
      row({ orderCode: "PD 01954", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 60_000 }),
      row({ orderCode: "PD 01955", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 55_000 }),
      row({ orderCode: "PD 02080", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 85_000 }),
      row({ orderCode: "PD 01603", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 95_000 }),
      row({ orderCode: "PD 02158", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 75_000 }),
      row({ orderCode: "PD 01562", statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA", orderValue: 174_836 }),
    ];

    const futura = rowsForIntelligenceAccordion("CARTEIRA_FUTURA_PROVAVEL", rows);
    const presente = rowsForIntelligenceAccordion("CARTEIRA_PRESENTE_ATENCAO", rows);
    const vencida = rowsForIntelligenceAccordion("CARTEIRA_VENCIDA_BLOQUEADA", rows);

    assert.deepEqual(
      futura.map((r) => r.orderCode).sort(),
      ["PD 02607", "PD 02740"]
    );
    assert.deepEqual(
      presente.map((r) => r.orderCode),
      ["PD 02739"]
    );
    assert.equal(vencida.length, 10);

    const futuraPresente =
      futura.reduce((s, r) => s + r.orderValue, 0) +
      presente.reduce((s, r) => s + r.orderValue, 0);
    const vencidaTotal = vencida.reduce((s, r) => s + r.orderValue, 0);
    assert.equal(futuraPresente, 495_460);
    assert.equal(vencidaTotal, 884_836);
  });

  it("soma dos grupos principais e detecção de duplicidade", () => {
    const groups = [
      {
        statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL",
        title: "Futura",
        ordersCount: 2,
        orderValue: 350_000,
        averageConfidence: 60,
        orderCodes: ["PD 02607", "PD 02740"],
      },
      {
        statusPrincipal: "CARTEIRA_PRESENTE_ATENCAO",
        title: "Presente",
        ordersCount: 1,
        orderValue: 145_460,
        averageConfidence: 55,
        orderCodes: ["PD 02739"],
      },
      {
        statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA",
        title: "Vencida",
        ordersCount: 10,
        orderValue: 884_836,
        averageConfidence: 40,
        orderCodes: ["PD 02159"],
      },
    ];
    assert.equal(sumPrincipalGroupValues(groups), 1_380_296);
    assert.deepEqual(findDuplicateOrderCodesAcrossPrincipalGroups(groups), []);

    const withDupe = [
      ...groups,
      {
        statusPrincipal: "SEM_EVIDENCIA",
        title: "Sem",
        ordersCount: 1,
        orderValue: 1,
        averageConfidence: 10,
        orderCodes: ["PD 02607"],
      },
    ];
    assert.deepEqual(findDuplicateOrderCodesAcrossPrincipalGroups(withDupe), ["PD 02607"]);
  });
});
