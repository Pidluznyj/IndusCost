/**
 * OP-26 — Motor puro da avaliação de pedido / desempenho de fornecedor.
 * Fase A: fórmula, elegibilidade, validação, cobertura, período e CSV.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SUPPLIER_EVALUATION_CRITERIA,
  SUPPLIER_EVALUATION_ELIGIBLE_STATUSES,
  SUPPLIER_EVALUATION_HISTORY_ACTIONS,
  SUPPLIER_EVALUATION_METHODOLOGY_ID,
  SUPPLIER_EVALUATION_METHODOLOGY_VERSION,
  SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT,
  SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT,
  SUPPLIER_PERFORMANCE_PAGE_SIZE_MAX,
  SupplierEvaluationError,
  assertPurchaseOrderSupplierEvaluationEligible,
  averageScoreOrNull,
  buildSupplierPerformancePeriodFromPreset,
  buildSupplierPerformanceSummary,
  computeSupplierOrderEvaluation,
  describePurchaseOrderSupplierEvaluationEligibility,
  formatSupplierCoverage,
  formatSupplierScore,
  isPurchaseOrderSupplierEvaluationEligible,
  normalizeSupplierEvaluationExpectedRevision,
  normalizeSupplierEvaluationNotes,
  normalizeSupplierEvaluationRevisionReason,
  normalizeSupplierPerformancePage,
  normalizeSupplierPerformancePageSize,
  parseSupplierPerformanceCivilDateParam,
  parseSupplierPerformanceEvaluationStatusFilter,
  parseSupplierPerformanceReportSort,
  resolvePurchaseOrderEvaluationReferenceDate,
  resolveSupplierPerformanceDateRange,
  roundHalfUpToHundredths,
  sortSupplierPerformanceReportRows,
  type SupplierPerformanceReportRowDto,
} from "./supplierPerformance.js";
import {
  buildSupplierPerformanceCsvFilename,
  buildSupplierPerformanceDetailCsv,
  buildSupplierPerformanceSummaryCsv,
  escapeSupplierPerformanceCsvCell,
  neutralizeSupplierPerformanceCsvFormula,
} from "./supplierPerformanceCsv.js";

const scores = (q: unknown, d: unknown, c: unknown, s: unknown) => ({
  qualityScore: q,
  deliveryScore: d,
  conformityScore: c,
  serviceScore: s,
});

describe("metodologia — quatro critérios de peso igual", () => {
  it("declara V1 com 25% em cada critério e sem menção ao Inmetro", () => {
    assert.equal(SUPPLIER_EVALUATION_METHODOLOGY_VERSION, 1);
    assert.equal(SUPPLIER_EVALUATION_METHODOLOGY_ID, "SUPPLIER_ORDER_EVALUATION_V1");
    assert.equal(SUPPLIER_EVALUATION_CRITERIA.length, 4);
    assert.deepEqual(
      SUPPLIER_EVALUATION_CRITERIA.map((c) => c.key),
      ["quality", "delivery", "conformity", "service"]
    );
    for (const criterion of SUPPLIER_EVALUATION_CRITERIA) {
      assert.equal(criterion.weightPercent, 25);
    }
    const text = SUPPLIER_PERFORMANCE_METHODOLOGY_TEXT.join(" ");
    assert.match(text, /Metodologia interna de avaliação de fornecedores/);
    assert.doesNotMatch(text, /Inmetro/i);
    assert.doesNotMatch(text, /ISO 9001/i);
  });

  it("usa as ações de histórico do PurchaseOrderHistoryEvent", () => {
    assert.equal(
      SUPPLIER_EVALUATION_HISTORY_ACTIONS.created,
      "SUPPLIER_EVALUATION_CREATED"
    );
    assert.equal(
      SUPPLIER_EVALUATION_HISTORY_ACTIONS.revised,
      "SUPPLIER_EVALUATION_REVISED"
    );
  });
});

describe("nota do pedido — média aritmética determinística", () => {
  it("0/0/0/0 -> 0,00", () => {
    assert.equal(computeSupplierOrderEvaluation(scores(0, 0, 0, 0)).overallScore, 0);
  });

  it("10/10/10/10 -> 10,00", () => {
    assert.equal(computeSupplierOrderEvaluation(scores(10, 10, 10, 10)).overallScore, 10);
  });

  it("9/8/10/8 -> 8,75", () => {
    assert.equal(computeSupplierOrderEvaluation(scores(9, 8, 10, 8)).overallScore, 8.75);
  });

  it("9,1/9,1/9,1/9,2 -> 9,13 (HALF-UP sobre 9,125)", () => {
    const result = computeSupplierOrderEvaluation(scores(9.1, 9.1, 9.1, 9.2));
    assert.equal(result.overallScore, 9.13);
    assert.deepEqual(result.scores, {
      quality: 9.1,
      delivery: 9.1,
      conformity: 9.1,
      service: 9.2,
    });
  });

  it("9/8/10/9 -> 9,00 (exemplo da API)", () => {
    assert.equal(computeSupplierOrderEvaluation(scores(9, 8, 10, 9)).overallScore, 9);
  });

  it("0,1/0,1/0,1/0,2 -> 0,13 (mesmo arredondamento na faixa baixa)", () => {
    assert.equal(
      computeSupplierOrderEvaluation(scores(0.1, 0.1, 0.1, 0.2)).overallScore,
      0.13
    );
  });

  it("aceita string com vírgula pt-BR", () => {
    assert.equal(computeSupplierOrderEvaluation(scores("7,5", "7,5", "7,5", "7,5")).overallScore, 7.5);
  });

  it("não pondera por valor: aritmética pura dos critérios", () => {
    // Um critério altíssimo não domina — cada um vale exatamente 25%.
    assert.equal(computeSupplierOrderEvaluation(scores(10, 0, 0, 0)).overallScore, 2.5);
  });

  it("roundHalfUpToHundredths arredonda .5 para cima", () => {
    assert.equal(roundHalfUpToHundredths(9.125), 9.13);
    assert.equal(roundHalfUpToHundredths(8.744999), 8.74);
    assert.equal(roundHalfUpToHundredths(8.745), 8.75);
  });
});

describe("validação das notas", () => {
  const invalid: Array<[string, unknown]> = [
    ["negativo", -0.1],
    ["acima de 10", 10.1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["texto", "abc"],
    ["null", null],
    ["undefined", undefined],
    ["objeto", {}],
    ["array", []],
    ["booleano", true],
    ["duas casas decimais", 8.75],
    ["string com duas casas", "8.75"],
  ];

  for (const [label, value] of invalid) {
    it(`rejeita ${label}`, () => {
      assert.throws(
        () => computeSupplierOrderEvaluation(scores(value, 8, 8, 8)),
        (error: unknown) => {
          assert.ok(error instanceof SupplierEvaluationError);
          assert.equal(error.code, "INVALID_SUPPLIER_EVALUATION_SCORE");
          assert.equal(error.httpStatus, 400);
          return true;
        }
      );
    });
  }

  const valid = [0, 0.5, 7, 8.7, 10];
  for (const value of valid) {
    it(`aceita ${value}`, () => {
      assert.doesNotThrow(() => computeSupplierOrderEvaluation(scores(value, 0, 0, 0)));
    });
  }

  it("exige os quatro critérios", () => {
    assert.throws(
      () => computeSupplierOrderEvaluation(scores(9, 9, 9, undefined)),
      SupplierEvaluationError
    );
  });
});

describe("observações e motivo de revisão", () => {
  it("faz trim e converte vazio em null", () => {
    assert.equal(normalizeSupplierEvaluationNotes("   "), null);
    assert.equal(normalizeSupplierEvaluationNotes("  ok  "), "ok");
    assert.equal(normalizeSupplierEvaluationNotes(null), null);
    assert.equal(normalizeSupplierEvaluationNotes(undefined), null);
  });

  it("rejeita observação acima de 2000 caracteres", () => {
    assert.throws(
      () => normalizeSupplierEvaluationNotes("x".repeat(2001)),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "INVALID_SUPPLIER_EVALUATION_PAYLOAD");
        return true;
      }
    );
    assert.equal(normalizeSupplierEvaluationNotes("x".repeat(2000))?.length, 2000);
  });

  it("exige motivo na revisão", () => {
    assert.throws(
      () => normalizeSupplierEvaluationRevisionReason("  "),
      SupplierEvaluationError
    );
    assert.equal(
      normalizeSupplierEvaluationRevisionReason(" Correção após conferência. "),
      "Correção após conferência."
    );
  });

  it("normaliza expectedRevision", () => {
    assert.equal(normalizeSupplierEvaluationExpectedRevision(null), null);
    assert.equal(normalizeSupplierEvaluationExpectedRevision(""), null);
    assert.equal(normalizeSupplierEvaluationExpectedRevision(2), 2);
    assert.equal(normalizeSupplierEvaluationExpectedRevision("3"), 3);
    assert.throws(
      () => normalizeSupplierEvaluationExpectedRevision(0),
      SupplierEvaluationError
    );
    assert.throws(
      () => normalizeSupplierEvaluationExpectedRevision(1.5),
      SupplierEvaluationError
    );
  });
});

describe("elegibilidade — regra única", () => {
  const table: Array<[string, boolean]> = [
    ["RECEBIDO", true],
    ["ENCERRADO", true],
    ["RASCUNHO", false],
    ["APROVADO", false],
    ["ENVIADO", false],
    ["EMITIDO", false],
    ["CONFIRMADO", false],
    ["PARCIALMENTE_RECEBIDO", false],
    ["CANCELADO", false],
  ];

  for (const [status, expected] of table) {
    it(`${status} -> ${expected}`, () => {
      assert.equal(isPurchaseOrderSupplierEvaluationEligible(status), expected);
    });
  }

  it("status ausente não é elegível", () => {
    assert.equal(isPurchaseOrderSupplierEvaluationEligible(null), false);
    assert.equal(isPurchaseOrderSupplierEvaluationEligible(undefined), false);
    assert.equal(isPurchaseOrderSupplierEvaluationEligible(""), false);
  });

  it("apenas RECEBIDO e ENCERRADO estão na lista canônica", () => {
    assert.deepEqual([...SUPPLIER_EVALUATION_ELIGIBLE_STATUSES], ["RECEBIDO", "ENCERRADO"]);
  });

  it("explica o motivo em pt-BR", () => {
    assert.deepEqual(describePurchaseOrderSupplierEvaluationEligibility("RECEBIDO"), {
      eligible: true,
      eligibilityReason: null,
    });
    assert.match(
      describePurchaseOrderSupplierEvaluationEligibility("CANCELADO").eligibilityReason ?? "",
      /cancelado/i
    );
    assert.match(
      describePurchaseOrderSupplierEvaluationEligibility("PARCIALMENTE_RECEBIDO")
        .eligibilityReason ?? "",
      /recebido ou encerrado/i
    );
  });

  it("assert lança 409 para não elegível", () => {
    assert.doesNotThrow(() => assertPurchaseOrderSupplierEvaluationEligible("ENCERRADO"));
    assert.throws(
      () => assertPurchaseOrderSupplierEvaluationEligible("CANCELADO"),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION");
        assert.equal(error.httpStatus, 409);
        return true;
      }
    );
  });
});

describe("agregação do fornecedor", () => {
  it("média simples dos pedidos: 8 / 9 / 10 -> 9,00", () => {
    assert.equal(averageScoreOrNull([8, 9, 10]), 9);
  });

  it("valor financeiro do pedido não pondera: nota 5 (R$1.000.000) e 10 (R$1.000) -> 7,50", () => {
    assert.equal(averageScoreOrNull([5, 10]), 7.5);
  });

  it("lista vazia -> null (nunca 0)", () => {
    assert.equal(averageScoreOrNull([]), null);
  });

  it("cobertura 8/10 = 80% com notas consolidadas", () => {
    const summary = buildSupplierPerformanceSummary({
      eligibleOrders: 10,
      evaluatedOrders: 8,
      averages: { overall: 8.74, quality: 9.21, delivery: 7.83, conformity: 9.42, service: 8.5 },
    });
    assert.equal(summary.coverage, 0.8);
    assert.equal(summary.pendingOrders, 2);
    assert.equal(summary.overallScore, 8.74);
    assert.equal(summary.qualityScore, 9.21);
    assert.equal(summary.deliveryScore, 7.83);
    assert.equal(summary.conformityScore, 9.42);
    assert.equal(summary.serviceScore, 8.5);
  });

  it("37 de 42 -> 88,10%", () => {
    const summary = buildSupplierPerformanceSummary({
      eligibleOrders: 42,
      evaluatedOrders: 37,
      averages: { overall: 8.74, quality: null, delivery: null, conformity: null, service: null },
    });
    assert.equal(formatSupplierCoverage(summary.coverage), "88,10%");
  });

  it("zero elegíveis -> coverage null e notas null", () => {
    const summary = buildSupplierPerformanceSummary({
      eligibleOrders: 0,
      evaluatedOrders: 0,
      averages: { overall: null, quality: null, delivery: null, conformity: null, service: null },
    });
    assert.equal(summary.coverage, null);
    assert.equal(summary.overallScore, null);
    assert.equal(summary.pendingOrders, 0);
  });

  it("elegíveis sem avaliação -> coverage 0 e nota null (nunca 0)", () => {
    const summary = buildSupplierPerformanceSummary({
      eligibleOrders: 5,
      evaluatedOrders: 0,
      averages: { overall: 0, quality: 0, delivery: 0, conformity: 0, service: 0 },
    });
    assert.equal(summary.coverage, 0);
    assert.equal(summary.overallScore, null);
    assert.equal(summary.qualityScore, null);
    assert.equal(summary.pendingOrders, 5);
  });

  it("arredonda a média só na apresentação (9,125 -> 9,13)", () => {
    const summary = buildSupplierPerformanceSummary({
      eligibleOrders: 4,
      evaluatedOrders: 4,
      averages: { overall: 9.125, quality: null, delivery: null, conformity: null, service: null },
    });
    assert.equal(summary.overallScore, 9.13);
  });
});

describe("período — retroatividade pela data do pedido", () => {
  it("usa issuedAt e cai para createdAt quando nulo", () => {
    const issued = new Date(2026, 1, 15);
    const created = new Date(2026, 8, 2);
    assert.equal(
      resolvePurchaseOrderEvaluationReferenceDate({ issuedAt: issued, createdAt: created }).getTime(),
      issued.getTime()
    );
    assert.equal(
      resolvePurchaseOrderEvaluationReferenceDate({ issuedAt: null, createdAt: created }).getTime(),
      created.getTime()
    );
  });

  it("pedido de fevereiro avaliado em setembro continua em fevereiro", () => {
    const order = { issuedAt: new Date(2026, 1, 15), createdAt: new Date(2026, 1, 10) };
    const reference = resolvePurchaseOrderEvaluationReferenceDate(order);
    const february = resolveSupplierPerformanceDateRange({ from: "2026-02-01", to: "2026-02-28" });
    const september = resolveSupplierPerformanceDateRange({ from: "2026-09-01", to: "2026-09-30" });

    assert.ok(february.gte && reference >= february.gte);
    assert.ok(february.lt && reference < february.lt);
    assert.ok(september.gte && reference < september.gte);
  });

  it("fim do intervalo é exclusivo no dia seguinte (dia civil local)", () => {
    const range = resolveSupplierPerformanceDateRange({ from: "2026-02-01", to: "2026-02-28" });
    assert.equal(range.gte?.getFullYear(), 2026);
    assert.equal(range.gte?.getMonth(), 1);
    assert.equal(range.gte?.getDate(), 1);
    assert.equal(range.gte?.getHours(), 0);
    assert.equal(range.lt?.getMonth(), 2);
    assert.equal(range.lt?.getDate(), 1);
  });

  it("período aberto quando from/to ausentes", () => {
    assert.deepEqual(resolveSupplierPerformanceDateRange({ from: null, to: null }), {
      gte: null,
      lt: null,
    });
  });

  it("valida YYYY-MM-DD e rejeita data impossível", () => {
    assert.equal(parseSupplierPerformanceCivilDateParam("2026-02-28"), "2026-02-28");
    assert.equal(parseSupplierPerformanceCivilDateParam("2026-02-30"), null);
    assert.equal(parseSupplierPerformanceCivilDateParam("28/02/2026"), null);
    assert.equal(parseSupplierPerformanceCivilDateParam(""), null);
    assert.equal(parseSupplierPerformanceCivilDateParam(null), null);
  });

  it("preset de 12 meses default e 'todos' sem limites", () => {
    const today = new Date(2026, 8, 2);
    assert.deepEqual(buildSupplierPerformancePeriodFromPreset("last12m", today), {
      from: "2025-09-02",
      to: "2026-09-02",
    });
    assert.deepEqual(buildSupplierPerformancePeriodFromPreset("last6m", today), {
      from: "2026-03-02",
      to: "2026-09-02",
    });
    assert.deepEqual(buildSupplierPerformancePeriodFromPreset("all", today), {
      from: null,
      to: null,
    });
  });
});

describe("filtros e paginação", () => {
  it("filtro de avaliação cai para 'all' quando inválido", () => {
    assert.equal(parseSupplierPerformanceEvaluationStatusFilter("pending"), "pending");
    assert.equal(parseSupplierPerformanceEvaluationStatusFilter("evaluated"), "evaluated");
    assert.equal(parseSupplierPerformanceEvaluationStatusFilter("ineligible"), "ineligible");
    assert.equal(parseSupplierPerformanceEvaluationStatusFilter("hack"), "all");
    assert.equal(parseSupplierPerformanceEvaluationStatusFilter(undefined), "all");
  });

  it("pageSize tem default 50 e teto 200", () => {
    assert.equal(normalizeSupplierPerformancePageSize(undefined), SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT);
    assert.equal(normalizeSupplierPerformancePageSize("25"), 25);
    assert.equal(normalizeSupplierPerformancePageSize("100000"), SUPPLIER_PERFORMANCE_PAGE_SIZE_MAX);
    assert.equal(normalizeSupplierPerformancePageSize("-3"), SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT);
    assert.equal(normalizeSupplierPerformancePage("0"), 1);
    assert.equal(normalizeSupplierPerformancePage("4"), 4);
  });

  it("ordenação default do relatório é nome ASC", () => {
    assert.equal(parseSupplierPerformanceReportSort(undefined), "name");
    assert.equal(parseSupplierPerformanceReportSort("score"), "score");
    assert.equal(parseSupplierPerformanceReportSort("coverage"), "coverage");
    assert.equal(parseSupplierPerformanceReportSort("gamified"), "name");
  });

  it("ordena por nota com null no fim", () => {
    const row = (
      name: string,
      overallScore: number | null
    ): SupplierPerformanceReportRowDto => ({
      supplierId: name,
      supplierName: name,
      supplierDocument: null,
      supplierStatus: "ACTIVE",
      summary: {
        eligibleOrders: 1,
        evaluatedOrders: overallScore == null ? 0 : 1,
        pendingOrders: overallScore == null ? 1 : 0,
        coverage: overallScore == null ? 0 : 1,
        overallScore,
        qualityScore: null,
        deliveryScore: null,
        conformityScore: null,
        serviceScore: null,
      },
    });
    const rows = [row("Beta", 7), row("Alfa", null), row("Gama", 9)];
    assert.deepEqual(
      sortSupplierPerformanceReportRows(rows, "score").map((r) => r.supplierName),
      ["Gama", "Beta", "Alfa"]
    );
    assert.deepEqual(
      sortSupplierPerformanceReportRows(rows, "name").map((r) => r.supplierName),
      ["Alfa", "Beta", "Gama"]
    );
  });
});

describe("apresentação pt-BR", () => {
  it("formata nota e cobertura, com traço quando null", () => {
    assert.equal(formatSupplierScore(8.7), "8,70");
    assert.equal(formatSupplierScore(9, 1), "9,0");
    assert.equal(formatSupplierScore(null), "—");
    assert.equal(formatSupplierCoverage(0.880952), "88,10%");
    assert.equal(formatSupplierCoverage(0), "0,00%");
    assert.equal(formatSupplierCoverage(null), "—");
  });
});

describe("CSV canônico", () => {
  const detailRow = {
    supplierId: "sup-1",
    supplierName: "ABC Resinas",
    supplierDocument: "12345678000199",
    purchaseOrderId: "po-1",
    purchaseOrderCode: "PC-2026-0001",
    purchaseOrderDate: "2026-02-15T00:00:00.000Z",
    purchaseOrderStatus: "RECEBIDO",
    purchaseOrderAmount: 42000,
    qualityScore: 9,
    deliveryScore: 8,
    conformityScore: 10,
    serviceScore: 8,
    overallScore: 8.75,
    methodologyVersion: 1,
    evaluationRevision: 1,
    evaluatedBy: "Fulano",
    evaluatedAt: "2026-09-02T12:00:00.000Z",
    updatedBy: "Fulano",
    updatedAt: "2026-09-02T12:00:00.000Z",
    notes: "Fornecedor cumpriu o combinado.",
  };

  it("cabeçalho detalhado tem as colunas exigidas", () => {
    const csv = buildSupplierPerformanceDetailCsv([detailRow]);
    const [header, line] = csv.replace("﻿", "").split("\n");
    assert.equal(
      header,
      "supplier_id,supplier_name,supplier_document,purchase_order_id,purchase_order_code,purchase_order_date,purchase_order_status,purchase_order_amount,quality_score,delivery_score,conformity_score,service_score,overall_score,methodology_version,evaluation_revision,evaluated_by,evaluated_at,updated_by,updated_at,notes"
    );
    assert.match(line, /PC-2026-0001/);
    assert.match(line, /8\.75/);
  });

  it("pedido elegível sem avaliação sai com colunas de nota vazias (não zero)", () => {
    const csv = buildSupplierPerformanceDetailCsv([
      {
        ...detailRow,
        qualityScore: null,
        deliveryScore: null,
        conformityScore: null,
        serviceScore: null,
        overallScore: null,
        methodologyVersion: null,
        evaluationRevision: null,
        evaluatedBy: null,
        evaluatedAt: null,
        updatedBy: null,
        updatedAt: null,
        notes: null,
      },
    ]);
    const line = csv.replace("﻿", "").split("\n")[1];
    // 12 colunas de avaliação vazias após o valor — nenhuma vira 0.
    assert.match(line, /RECEBIDO,42000\.00,{12}$/);
  });

  it("neutraliza formula injection", () => {
    assert.equal(neutralizeSupplierPerformanceCsvFormula("=CMD()"), "'=CMD()");
    assert.equal(neutralizeSupplierPerformanceCsvFormula("+1"), "'+1");
    assert.equal(neutralizeSupplierPerformanceCsvFormula("-1"), "'-1");
    assert.equal(neutralizeSupplierPerformanceCsvFormula("@x"), "'@x");
    assert.equal(neutralizeSupplierPerformanceCsvFormula("ok"), "ok");
    assert.equal(escapeSupplierPerformanceCsvCell('a,"b'), '"a,""b"');
  });

  it("CSV consolidado mantém coverage nulo vazio", () => {
    const csv = buildSupplierPerformanceSummaryCsv([
      {
        supplierId: "s1",
        supplierName: "Sem pedidos",
        supplierDocument: null,
        supplierStatus: "ACTIVE",
        summary: {
          eligibleOrders: 0,
          evaluatedOrders: 0,
          pendingOrders: 0,
          coverage: null,
          overallScore: null,
          qualityScore: null,
          deliveryScore: null,
          conformityScore: null,
          serviceScore: null,
        },
      },
    ]);
    const line = csv.replace("﻿", "").split("\n")[1];
    assert.equal(line, "s1,Sem pedidos,,ACTIVE,0,0,0,,,,,,");
  });

  it("nome do arquivo é seguro", () => {
    assert.equal(
      buildSupplierPerformanceCsvFilename("detalhado", { from: "2025-09-01", to: "2026-08-31" }),
      "desempenho-fornecedores-detalhado-2025-09-01-2026-08-31.csv"
    );
    assert.equal(
      buildSupplierPerformanceCsvFilename("consolidado", { from: null, to: null }),
      "desempenho-fornecedores-consolidado-inicio-hoje.csv"
    );
  });
});
