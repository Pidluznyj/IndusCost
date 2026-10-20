/**
 * Reprodução Tambasa, matriz comercial × motor oficial de Contas a Receber
 * e paridade de população de CRs vencidos. Não abre banco e não altera título.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeDaysOverdue,
  type FinanceArDashboardRow,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { filterOfficialArOverdueTitles } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import { buildNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import {
  analyzeCommercialDelinquency,
  applyCommercialDelinquencyCalendarTolerance,
  commercialDelinquencyTitleToDashboardRow,
  COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS,
  COMMERCIAL_OFFICIAL_AR_OVERDUE_FILTERS,
  selectOfficialArOverdueForCommercial,
  type AnalyzeCommercialDelinquencyInput,
  type CommercialDelinquencyTitleInput,
} from "./customerDelinquencyAnalysis.js";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import { buildCustomerSalesBlockStatus } from "./customerSalesBlock.js";

const CUSTOMER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const RELATED_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const TAMBASA_CNPJ = "11444777000161";
const PERSON_ID = 4242;
const REFERENCE = new Date(2026, 9, 20, 12, 0, 0);
const SYNCED = new Date(2026, 9, 20, 10, 0, 0);

function title(overrides: Partial<CommercialDelinquencyTitleInput> = {}): CommercialDelinquencyTitleInput {
  return {
    externalId: 1,
    personId: PERSON_ID,
    personName: "TAMBASA",
    personCnpj: TAMBASA_CNPJ,
    description: "Parcela NF",
    dueDate: new Date(2026, 9, 16),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    rawPayload: { id: 1 },
    ...overrides,
  };
}

function input(
  overrides: Partial<AnalyzeCommercialDelinquencyInput> = {}
): AnalyzeCommercialDelinquencyInput {
  return {
    customerId: CUSTOMER_ID,
    taxId: TAMBASA_CNPJ,
    nomusExternalPersonId: PERSON_ID,
    salesOrderExternalCustomerIds: [PERSON_ID],
    peerCustomerIdsWithSameCnpj: [],
    titles: [],
    syncCutoff: buildNomusArReportSyncCutoff(SYNCED),
    latestRunStatus: "SUCCESS",
    payloadComplete: true,
    referenceDate: REFERENCE,
    ...overrides,
  };
}

function dueDaysAgo(days: number): Date {
  return new Date(2026, 9, 20 - days);
}

function officialIds(titles: readonly CommercialDelinquencyTitleInput[]): number[] {
  return selectOfficialArOverdueForCommercial(
    titles.map(commercialDelinquencyTitleToDashboardRow),
    REFERENCE,
    buildNomusArReportSyncCutoff(SYNCED)
  )
    .map((row) => row.externalId)
    .sort((a, b) => a - b);
}

function tambasaTitles(): CommercialDelinquencyTitleInput[] {
  return [
    title({
      externalId: 13905,
      description: "Pedido PD 02224 - Parcela 1 de 1",
      dueDate: new Date(2026, 2, 5),
      amountReceivable: 7380,
      amountReceived: 0,
      balanceReceivable: 7380,
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      nomusStatus: false,
      rawPayload: { id: 13905, tipo: 2, status: false },
    }),
    title({
      externalId: 14367,
      description: "Documento 3689 - Parcela 1 de 1",
      dueDate: new Date(2026, 2, 19),
      settlementDate: new Date(2026, 2, 20),
      amountReceivable: 7380,
      amountReceived: 7380,
      balanceReceivable: 0,
      sourceInvoiceId: 6344,
      sourceInvoiceNumber: "6413",
      nomusStatus: true,
      rawPayload: { id: 14367, tipo: 1, status: true },
    }),
  ];
}

function salesBlockOf(titles: CommercialDelinquencyTitleInput[], paymentMethodId: number | null) {
  return buildCustomerSalesBlockStatus({
    identity: { kind: "RESOLVED", personId: PERSON_ID, salesOrderPersonIds: [PERSON_ID] },
    titles: titles.map((row) => ({
      ...commercialDelinquencyTitleToDashboardRow(row),
      paymentMethodId,
    })),
    today: REFERENCE,
    syncCutoff: buildNomusArReportSyncCutoff(SYNCED),
  });
}

describe("Tambasa PD 02224 — previsão sem NF não é inadimplência efetiva", () => {
  it("CR #13905 não gera OVERDUE de R$ 7.380 / 229 dias quando o CR #14367 está quitado", () => {
    const titles = tambasaTitles();
    assert.equal(computeDaysOverdue(titles[0]!.dueDate, REFERENCE), 229);
    assert.equal(titles[1]!.balanceReceivable, 0);
    assert.equal(titles[1]!.sourceInvoiceNumber, "6413");

    const result = analyzeCommercialDelinquency(input({ titles }));
    assert.equal(result.status, "REGULAR");
    assert.equal(result.unknownReason, null);
    assert.equal(result.overdueTitleCount, 0);
    assert.equal(result.overdueAmount, 0);
    assert.equal(result.maxDaysOverdue, 0);
    assert.ok(!result.evidence.overdueTitleIds.includes(13905));
    assert.ok(!result.evidence.overdueTitleIds.includes(14367));
    assert.deepEqual(result.evidence.officialOverdueTitleIds, []);
    assert.equal((result.overdueTitles ?? []).length, 0);
    assert.ok(result.evidence.exclusions.some((row) => row.externalId === 14367 && row.reason === "SETTLED"));
  });
});

describe("matriz — motor oficial de AR na inadimplência comercial", () => {
  it("1. previsão de pedido vencida, sem NF e sem CR real, não é OVERDUE", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 10,
            description: "Pedido PD 01000 - Parcela 1 de 1",
            dueDate: dueDaysAgo(20),
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
          }),
        ],
      })
    );
    assert.equal(result.status, "REGULAR");
    assert.equal(result.overdueAmount, 0);
    assert.equal(result.openAmount, 1000);
    assert.deepEqual(result.evidence.officialOverdueTitleIds, []);
  });

  it("2. previsão vencida com CR real quitado (Tambasa) permanece REGULAR", () => {
    const result = analyzeCommercialDelinquency(input({ titles: tambasaTitles() }));
    assert.equal(result.status, "REGULAR");
    assert.equal(result.overdueTitleCount, 0);
  });

  it("3. CR real com NF e saldo aberto há mais de três dias é OVERDUE", () => {
    const result = analyzeCommercialDelinquency(
      input({ titles: [title({ dueDate: dueDaysAgo(10), balanceReceivable: 2500, amountReceivable: 2500 })] })
    );
    assert.equal(result.status, "OVERDUE");
    assert.equal(result.overdueAmount, 2500);
    assert.equal(result.maxDaysOverdue, 10);
  });

  it("4-7. D+1, D+2 e D+3 com NF não bloqueiam; D+4 bloqueia", () => {
    for (const days of [1, 2, 3]) {
      const result = analyzeCommercialDelinquency(
        input({ titles: [title({ dueDate: dueDaysAgo(days) })] })
      );
      assert.equal(result.status, "REGULAR", `D+${days}`);
      assert.deepEqual(result.evidence.officialOverdueTitleIds, [1]);
      assert.deepEqual(result.evidence.overdueTitleIds, []);
    }
    const blocking = analyzeCommercialDelinquency(
      input({ titles: [title({ dueDate: dueDaysAgo(4) })] })
    );
    assert.equal(blocking.status, "OVERDUE");
    assert.equal(blocking.maxDaysOverdue, 4);
  });

  it("8. CR real parcialmente recebido usa o saldo", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            dueDate: dueDaysAgo(8),
            amountReceivable: 1000,
            amountReceived: 400,
            balanceReceivable: 600,
          }),
        ],
      })
    );
    assert.equal(result.status, "OVERDUE");
    assert.equal(result.overdueAmount, 600);
  });

  it("9. CR real integralmente quitado não permanece vencido", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            settlementDate: new Date(2026, 9, 10),
            amountReceived: 1000,
            balanceReceivable: 0,
          }),
        ],
      })
    );
    assert.equal(result.status, "REGULAR");
    assert.ok(result.evidence.exclusions.some((row) => row.reason === "SETTLED"));
  });

  it("10. faturamento parcial preserva a previsão residual e só cobra o CR real vencido", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 21,
            description: "Pedido PD 01000 - Parcela 1 de 2",
            dueDate: dueDaysAgo(20),
            amountReceivable: 6000,
            balanceReceivable: 6000,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
          }),
          title({
            externalId: 22,
            description: "Documento 900 - Parcela 2 de 2",
            dueDate: dueDaysAgo(8),
            amountReceivable: 4000,
            balanceReceivable: 4000,
            sourceInvoiceId: 900,
            sourceInvoiceNumber: "900",
          }),
        ],
      })
    );
    assert.equal(result.status, "OVERDUE");
    assert.deepEqual(result.evidence.overdueTitleIds, [22]);
    assert.equal(result.overdueAmount, 4000);
    assert.equal(result.openAmount, 10000);
    assert.ok(!result.evidence.overdueTitleIds.includes(21));
  });

  it("11-12. múltiplas parcelas: faturadas vencidas entram; previstas sem NF não", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 31,
            description: "Pedido PD 01100 - Parcela 1 de 3",
            dueDate: dueDaysAgo(12),
            sourceInvoiceId: 701,
            sourceInvoiceNumber: "701",
          }),
          title({
            externalId: 32,
            description: "Pedido PD 01100 - Parcela 2 de 3",
            dueDate: dueDaysAgo(5),
            sourceInvoiceId: 702,
            sourceInvoiceNumber: "702",
          }),
          title({
            externalId: 33,
            description: "Pedido PD 01100 - Parcela 3 de 3",
            dueDate: dueDaysAgo(20),
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
          }),
        ],
      })
    );
    assert.deepEqual(result.evidence.overdueTitleIds, [31, 32]);
    assert.ok(!result.evidence.overdueTitleIds.includes(33));
    assert.equal(result.overdueAmount, 2000);
  });

  it("13-14. reemissão e duas revisões da mesma parcela pré-NF não viram dívida fiscal", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 41,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            dueDate: dueDaysAgo(30),
            description: "Parcela 1 de 1 PD 02607",
          }),
          title({
            externalId: 42,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            dueDate: dueDaysAgo(10),
            description: "Parcela 1 de 1 PD 02607",
          }),
        ],
      })
    );
    assert.ok(result.evidence.exclusions.some((row) => row.externalId === 41 && row.reason === "SUPERSEDED_REISSUE"));
    assert.deepEqual(result.evidence.includedTitleIds, [42]);
    assert.equal(result.status, "REGULAR");
    assert.deepEqual(result.evidence.officialOverdueTitleIds, []);
  });

  it("15. renegociação financeira não soma o título de origem", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({ externalId: 51, dueDate: dueDaysAgo(40) }),
          title({
            externalId: 52,
            dueDate: dueDaysAgo(8),
            rawPayload: { idContaReceberOrigem: 51 },
          }),
        ],
      })
    );
    assert.deepEqual(result.evidence.overdueTitleIds, [52]);
    assert.ok(
      result.evidence.exclusions.some((row) => row.externalId === 51 && row.reason === "SUPERSEDED_RENEGOTIATION")
    );
  });

  it("16. título cancelado não cobra", () => {
    const result = analyzeCommercialDelinquency(
      input({ titles: [title({ rawPayload: { cancelado: true }, dueDate: dueDaysAgo(20) })] })
    );
    assert.equal(result.status, "REGULAR");
    assert.equal(result.evidence.exclusions[0]?.reason, "CANCELLED");
  });

  it("17. título confirmado como removido da origem não cobra", () => {
    const result = analyzeCommercialDelinquency(
      input({ titles: [title({ sourcePresenceStatus: "MISSING_CONFIRMED", dueDate: dueDaysAgo(20) })] })
    );
    assert.equal(result.status, "REGULAR");
    assert.equal(result.evidence.exclusions[0]?.reason, "REMOVED_FROM_SOURCE");
  });

  it("18. título sem sincronização confiável não declara REGULAR nem OVERDUE", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [title({ syncedAt: new Date(SYNCED.getTime() - 3 * 60 * 60 * 1000) })],
      })
    );
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.unknownReason, "SYNC_STALE");
  });

  it("19. falha de sincronização permanece UNKNOWN", () => {
    const result = analyzeCommercialDelinquency(input({ titles: [title()], latestRunStatus: "FAILED" }));
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.unknownReason, "SYNC_FAILED");
    assert.equal(result.overdueAmount, null);
  });

  it("20. identidade financeira não resolvida permanece UNKNOWN", () => {
    const missing = analyzeCommercialDelinquency(
      input({ titles: [title()], nomusExternalPersonId: null, salesOrderExternalCustomerIds: [] })
    );
    assert.equal(missing.unknownReason, "IDENTITY_MISSING_NOMUS_PERSON");
    const conflict = analyzeCommercialDelinquency(
      input({ titles: [title()], salesOrderExternalCustomerIds: [PERSON_ID, 61] })
    );
    assert.equal(conflict.unknownReason, "IDENTITY_CONFLICT_NOMUS_PERSON");
  });

  it("21. cliente com múltiplas restrições não é liberado só porque a previsão foi saneada", () => {
    const book = analyzeCommercialDelinquency(
      input({
        titles: [
          ...tambasaTitles(),
          title({
            externalId: 99,
            dueDate: dueDaysAgo(12),
            rawPayload: { protestado: true },
          }),
        ],
      })
    );
    assert.equal(book.status, "PROTESTED");
    const decision = decideCommercialCredit({
      customerId: CUSTOMER_ID,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: book,
      now: REFERENCE,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.customerStatus, "BLOQUEIO_CRITICO");
  });

  it("22-23. boleto real vencido trava venda; mesmo CR vencido em outra forma trava crédito, não a venda", () => {
    const overdueNf = [
      title({
        externalId: 80,
        dueDate: dueDaysAgo(9),
        paymentMethodName: "Pix",
      }),
    ];
    const credit = analyzeCommercialDelinquency(input({ titles: overdueNf }));
    assert.equal(credit.status, "OVERDUE");
    const pixBlock = salesBlockOf(overdueNf, 13);
    assert.equal(pixBlock.blocked, false);
    const boletoBlock = salesBlockOf(overdueNf, 10);
    assert.equal(boletoBlock.blocked, true);
    assert.equal(boletoBlock.reason, "OVERDUE_BOLETO");
  });

  it("24-25. protesto aberto bloqueia; protesto só no título já liquidado não volta ao saldo", () => {
    const openProtest = analyzeCommercialDelinquency(
      input({ titles: [title({ dueDate: dueDaysAgo(9), rawPayload: { protestado: true } })] })
    );
    assert.equal(openProtest.status, "PROTESTED");
    assert.equal(openProtest.overdueAmount, 1000);

    const settledProtest = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            settlementDate: new Date(2026, 9, 10),
            amountReceived: 1000,
            balanceReceivable: 0,
            rawPayload: { protestado: true },
          }),
        ],
      })
    );
    assert.equal(settledProtest.status, "REGULAR");
    assert.deepEqual(settledProtest.evidence.settledProtestedTitleIds, [1]);
    assert.equal(settledProtest.overdueAmount, 0);
  });

  it("26. diversos pedidos e recebíveis: só CRs reais efetivos entram no atraso comercial", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 101,
            description: "Pedido PD 100 - Parcela 1 de 1",
            dueDate: dueDaysAgo(40),
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
          }),
          title({
            externalId: 102,
            description: "Documento 200 - Parcela 1 de 1",
            dueDate: dueDaysAgo(11),
            sourceInvoiceId: 200,
            sourceInvoiceNumber: "200",
            amountReceivable: 1500,
            balanceReceivable: 1500,
          }),
          title({
            externalId: 103,
            description: "Documento 201 - Parcela 1 de 1",
            dueDate: new Date(2026, 10, 5),
            sourceInvoiceId: 201,
            sourceInvoiceNumber: "201",
            amountReceivable: 800,
            balanceReceivable: 800,
          }),
        ],
      })
    );
    assert.deepEqual(result.evidence.overdueTitleIds, [102]);
    assert.equal(result.overdueAmount, 1500);
    assert.equal(result.openAmount, 3300);
  });

  it("27. faturamento sem correspondência inequívoca não cobre previsão de outro pedido", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 201,
            description: "Pedido PD 02224 - Parcela 1 de 1",
            dueDate: dueDaysAgo(40),
            amountReceivable: 7380,
            balanceReceivable: 7380,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
          }),
          title({
            externalId: 202,
            description: "Documento 9999 - Parcela 1 de 1",
            dueDate: dueDaysAgo(12),
            amountReceivable: 7380,
            amountReceived: 7380,
            balanceReceivable: 0,
            settlementDate: new Date(2026, 9, 10),
            sourceInvoiceId: 9999,
            sourceInvoiceNumber: "9999",
          }),
        ],
      })
    );
    assert.equal(result.status, "REGULAR");
    assert.deepEqual(result.evidence.overdueTitleIds, []);
    assert.ok(!result.evidence.includedTitleIds.includes(201) || result.overdueAmount === 0);
  });

  it("28-29. dois pedidos do mesmo valor e dois títulos distintos não se confundem", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 301,
            description: "Documento 1 - Parcela 1 de 1 PD 100",
            dueDate: dueDaysAgo(8),
            amountReceivable: 5000,
            balanceReceivable: 5000,
            sourceInvoiceId: 501,
            sourceInvoiceNumber: "501",
          }),
          title({
            externalId: 302,
            description: "Documento 2 - Parcela 1 de 1 PD 200",
            dueDate: dueDaysAgo(8),
            amountReceivable: 5000,
            balanceReceivable: 5000,
            sourceInvoiceId: 502,
            sourceInvoiceNumber: "502",
          }),
        ],
      })
    );
    assert.deepEqual(result.evidence.overdueTitleIds, [301, 302]);
    assert.equal(result.overdueAmount, 10000);
  });

  it("CNPJ de grupo interno não entra na população oficial de atraso comercial", () => {
    const result = analyzeCommercialDelinquency(
      input({
        taxId: "14055501000180",
        titles: [
          title({
            personCnpj: "14055501000180",
            dueDate: dueDaysAgo(20),
            sourceInvoiceId: 88,
            sourceInvoiceNumber: "88",
          }),
        ],
      })
    );
    assert.equal(result.status, "REGULAR");
    assert.deepEqual(result.evidence.officialOverdueTitleIds, []);
    assert.deepEqual(result.evidence.overdueTitleIds, []);
  });

  it("CNPJ de outro cadastro no mesmo valor não cruza a carteira", () => {
    const result = analyzeCommercialDelinquency(
      input({
        peerCustomerIdsWithSameCnpj: [RELATED_ID],
        titles: [title({ dueDate: dueDaysAgo(20) })],
      })
    );
    assert.equal(result.unknownReason, "IDENTITY_AMBIGUOUS_CNPJ");
    assert.equal(result.overdueAmount, null);
  });
});

describe("paridade Financeiro × Comercial antes da tolerância", () => {
  it("30. os externalId oficiais coincidem, mesmo quando os totais são iguais", () => {
    const titles = [
      title({
        externalId: 401,
        dueDate: dueDaysAgo(1),
        amountReceivable: 3000,
        balanceReceivable: 3000,
        sourceInvoiceId: 401,
        sourceInvoiceNumber: "401",
      }),
      title({
        externalId: 402,
        dueDate: dueDaysAgo(9),
        amountReceivable: 3000,
        balanceReceivable: 3000,
        sourceInvoiceId: 402,
        sourceInvoiceNumber: "402",
      }),
      title({
        externalId: 403,
        description: "Pedido PD 300 - Parcela 1 de 1",
        dueDate: dueDaysAgo(40),
        amountReceivable: 3000,
        balanceReceivable: 3000,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
      }),
      title({
        externalId: 404,
        dueDate: dueDaysAgo(9),
        amountReceivable: 3000,
        amountReceived: 3000,
        balanceReceivable: 0,
        settlementDate: new Date(2026, 9, 12),
        sourceInvoiceId: 404,
        sourceInvoiceNumber: "404",
      }),
    ];
    const analysis = analyzeCommercialDelinquency(input({ titles }));
    const expectedOfficial = officialIds(titles);
    assert.deepEqual(analysis.evidence.officialOverdueTitleIds, expectedOfficial);
    assert.deepEqual(expectedOfficial, [401, 402]);
    assert.deepEqual(analysis.evidence.overdueTitleIds, [402]);
    assert.equal(COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS, 3);

    const commercialAfterTolerance = applyCommercialDelinquencyCalendarTolerance(
      selectOfficialArOverdueForCommercial(
        titles.map(commercialDelinquencyTitleToDashboardRow),
        REFERENCE,
        buildNomusArReportSyncCutoff(SYNCED)
      ),
      REFERENCE
    ).map((row) => row.externalId);
    assert.deepEqual(analysis.evidence.overdueTitleIds, commercialAfterTolerance);

    const rawOfficial = filterOfficialArOverdueTitles(
      titles.map(commercialDelinquencyTitleToDashboardRow),
      COMMERCIAL_OFFICIAL_AR_OVERDUE_FILTERS,
      REFERENCE,
      buildNomusArReportSyncCutoff(SYNCED)
    ).map((row: FinanceArDashboardRow) => row.externalId);
    assert.deepEqual(rawOfficial, expectedOfficial);
  });

  it("Tambasa: motor oficial e comercial concordam que não há CR efetivo vencido", () => {
    const titles = tambasaTitles();
    const analysis = analyzeCommercialDelinquency(input({ titles }));
    assert.deepEqual(analysis.evidence.officialOverdueTitleIds, officialIds(titles));
    assert.deepEqual(analysis.evidence.officialOverdueTitleIds, []);
  });
});
