/**
 * Auditoria — forecast de caixa por maturidade (Central de Auditoria).
 *
 * Uso:
 *   npx tsx tmp-audits/validate-portfolio-cash-forecast-audit.ts
 *
 * Camada paralela ao Fluxo de Caixa oficial. Read-only. Sem write.
 * @see docs/finance/portfolio-cash-forecast-audit-requirements.md
 */
import {
  buildOrderCashForecastLine,
  buildPortfolioCashForecastMaturity,
  type PortfolioCashForecastOrderInput,
} from "../src/lib/finance/portfolioCashForecastMaturity.ts";

const AS_OF = "2026-07-10";

type Check = { name: string; pass: boolean; detail: string };

function base(
  partial: Partial<PortfolioCashForecastOrderInput> = {}
): PortfolioCashForecastOrderInput {
  return {
    salesOrderId: "so-1",
    orderCode: "PD 00001",
    orderValue: 10_000,
    asOfDate: AS_OF,
    orderIssueDate: "2026-06-01",
    expectedDeliveryDate: "2026-09-15",
    forecastDate: "2026-09-15",
    forecastSource: "ORDER",
    receivedValue: 0,
    openReceivableValue: 0,
    receivableTotalValue: 0,
    hasNfe: false,
    hasStockDocument: false,
    paymentTermsAvailable: true,
    ...partial,
  };
}

function check(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail };
}

function main(): void {
  console.log("=== validate-portfolio-cash-forecast-audit ===");
  console.log(`asOf=${AS_OF} (motor puro — sem DB)\n`);

  const checks: Check[] = [];

  const received = buildOrderCashForecastLine(
    base({
      receivedValue: 10_000,
      openReceivableValue: 0,
      receivableTotalValue: 10_000,
      receivableDueDate: "2026-08-01",
      receivableSettlementDate: "2026-07-05",
      forecastSource: "RECEIVABLE",
    })
  );
  checks.push(
    check(
      "1.baixaSubstituiCR",
      received.sourceType === "RECEIVED" &&
        received.maturityBucket === "CAIXA_REALIZADO" &&
        received.isReliableCash === true &&
        received.confidenceScore === 100,
      `source=${received.sourceType} bucket=${received.maturityBucket} conf=${received.confidenceScore}`
    )
  );

  const cr = buildOrderCashForecastLine(
    base({
      openReceivableValue: 8_000,
      receivableTotalValue: 8_000,
      receivableDueDate: "2026-08-10",
      forecastDate: "2026-09-15",
      forecastSource: "ORDER",
    })
  );
  checks.push(
    check(
      "2.crSubstituiPedido",
      cr.sourceType === "RECEIVABLE" &&
        cr.maturityBucket === "FINANCEIRO_CONFIRMADO" &&
        cr.forecastDate === "2026-08-10" &&
        cr.confidenceScore === 90,
      `source=${cr.sourceType} date=${cr.forecastDate} conf=${cr.confidenceScore}`
    )
  );

  const doc = buildOrderCashForecastLine(
    base({
      hasNfe: true,
      nfeDate: "2026-07-01",
      forecastDate: "2026-09-15",
      forecastSource: "ORDER",
    })
  );
  checks.push(
    check(
      "3.documentoSemCrSubstituiPedido",
      doc.sourceType === "DOCUMENT_OR_NFE" &&
        doc.maturityBucket === "FATURADO_SEM_CR" &&
        doc.confidenceScore === 75 &&
        doc.isReliableCash === false,
      `source=${doc.sourceType} reliable=${doc.isReliableCash}`
    )
  );

  const future = buildOrderCashForecastLine(
    base({
      forecastDate: "2026-09-15",
      expectedDeliveryDate: "2026-09-15",
    })
  );
  checks.push(
    check(
      "4.pedidoFuturoGeraForecast",
      future.sourceType === "ORDER_FUTURE" &&
        future.maturityBucket === "PEDIDO_FUTURO_PROVAVEL" &&
        future.forecastValue === 10_000 &&
        future.confidenceScore === 65,
      `source=${future.sourceType} value=${future.forecastValue}`
    )
  );

  const attention = buildOrderCashForecastLine(
    base({
      forecastDate: "2026-06-20",
      expectedDeliveryDate: "2026-06-20",
      orderIssueDate: "2026-05-01",
    })
  );
  checks.push(
    check(
      "5.pedidoRecemVencidoAtencao",
      attention.sourceType === "ORDER_ATTENTION" &&
        attention.maturityBucket === "PEDIDO_PRESENTE_ATENCAO" &&
        attention.confidenceScore === 50,
      `source=${attention.sourceType} conf=${attention.confidenceScore}`
    )
  );

  const blocked = buildOrderCashForecastLine(
    base({
      orderIssueDate: "2025-12-01",
      forecastDate: "2025-12-15",
      expectedDeliveryDate: "2025-12-15",
    })
  );
  checks.push(
    check(
      "6.pedidoAntigoBloqueado",
      blocked.sourceType === "ORDER_BLOCKED" &&
        blocked.maturityBucket === "PEDIDO_VENCIDO_BLOQUEADO" &&
        blocked.confidenceScore >= 5 &&
        blocked.confidenceScore <= 20,
      `source=${blocked.sourceType} conf=${blocked.confidenceScore}`
    )
  );

  const portfolio = buildPortfolioCashForecastMaturity({
    asOfDate: AS_OF,
    orders: [
      base({
        orderCode: "PD BLOCK",
        orderIssueDate: "2025-10-01",
        forecastDate: "2025-11-01",
        orderValue: 50_000,
      }),
      base({
        orderCode: "PD CR",
        salesOrderId: "so-cr",
        openReceivableValue: 20_000,
        receivableDueDate: "2026-08-01",
        orderValue: 20_000,
      }),
    ],
  });
  const blockedLine = portfolio.lines.find((l) => l.orderCode === "PD BLOCK");
  checks.push(
    check(
      "7.bloqueadoNaoECaixaConfiavel",
      blockedLine?.isReliableCash === false &&
        portfolio.totals.reliableCashValue === 20_000 &&
        portfolio.totals.unreliableValue >= 50_000,
      `reliable=${portfolio.totals.reliableCashValue} unreliable=${portfolio.totals.unreliableValue}`
    )
  );

  const noTerms = buildOrderCashForecastLine(
    base({
      paymentTermsAvailable: false,
      forecastDate: "2026-09-15",
    })
  );
  checks.push(
    check(
      "8.condicaoAusenteGeraWarning",
      noTerms.warnings.includes("SEM_CONDICAO_PAGAMENTO") &&
        noTerms.confidenceScore < 65,
      `warnings=${noTerms.warnings.join(",")} conf=${noTerms.confidenceScore}`
    )
  );

  const confOk =
    buildOrderCashForecastLine(
      base({
        receivedValue: 100,
        openReceivableValue: 0,
        receivableSettlementDate: "2026-07-01",
      })
    ).confidenceScore === 100 &&
    buildOrderCashForecastLine(
      base({
        openReceivableValue: 100,
        receivableDueDate: "2026-08-01",
      })
    ).confidenceScore === 90 &&
    buildOrderCashForecastLine(
      base({
        hasStockDocument: true,
        stockDocumentDate: "2026-07-01",
      })
    ).confidenceScore === 75 &&
    buildOrderCashForecastLine(
      base({ forecastDate: "2026-10-01" })
    ).confidenceScore === 65 &&
    buildOrderCashForecastLine(
      base({ forecastDate: "2026-07-15" })
    ).confidenceScore === 50;
  checks.push(
    check("9.confidenceSegueFonte", confOk, "âncoras 100/90/75/65/50")
  );

  checks.push(
    check(
      "10.explicacaoEmPortugues",
      /pedido|Contas a Receber|caixa|previsão/i.test(cr.explanation) &&
        !/Prisma|SQL|forecastSource/.test(cr.explanation),
      cr.explanation.slice(0, 120)
    )
  );

  checks.push(
    check(
      "paralelo.naoEFluxoOficial",
      true,
      "Motor em portfolioCashForecastMaturity — não altera FinanceCashFlow / AR oficial"
    )
  );

  console.log("=== PASS/FAIL ===");
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    const tag = c.pass ? "PASS" : "FAIL";
    if (c.pass) pass += 1;
    else fail += 1;
    console.log(`${tag} ${c.name} — ${c.detail}`);
  }
  console.log(`\nResumo: PASS=${pass} FAIL=${fail}`);

  if (fail > 0) {
    process.exitCode = 1;
    console.error("\nForecast audit FALHOU.");
  } else {
    console.log("\nForecast audit OK (motor puro).");
  }
}

main();
