/**
 * Folga comercial D+4 compartilhada pela inadimplência, pela trava de venda
 * e pela decisão de prazo. Não altera o vencimento do título.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import {
  commercialCalendarDaysOverdue,
  commercialSaoPauloCivilDate,
} from "./commercialDelinquencyTolerance.js";
import {
  analyzeCommercialDelinquency,
  commercialDelinquencyTitleToDashboardRow,
  type CommercialDelinquencyTitleInput,
} from "./customerDelinquencyAnalysis.js";
import { buildCustomerSalesBlockStatus } from "./customerSalesBlock.js";
import { parseNomusBrDate } from "@/src/lib/nomusAccountsReceivableParser.js";
import {
  officialCreditDeniesTermSale,
  operationBlockedByOfficialCredit,
} from "./portfolioCredit.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11444777000161";
const PERSON_ID = 100;
const REFERENCE = new Date("2026-10-24T15:00:00.000Z");

function dueOn(isoDate: string): Date {
  return new Date(`${isoDate}T15:00:00.000Z`);
}

function title(overrides: Partial<CommercialDelinquencyTitleInput> = {}): CommercialDelinquencyTitleInput {
  return {
    externalId: 1,
    personId: PERSON_ID,
    personName: "CLIENTE TOLERANCIA",
    personCnpj: CNPJ,
    description: "Boleto NF",
    dueDate: dueOn("2026-10-20"),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    paymentMethodName: "Boleto Bancário",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: REFERENCE,
    sourcePresenceStatus: "PRESENT",
    rawPayload: { id: 1 },
    ...overrides,
  };
}

function readPair(
  row: CommercialDelinquencyTitleInput,
  options: {
    now?: Date;
    nomusExternalPersonId?: number | null;
    salesOrderExternalCustomerIds?: Array<number | null>;
    externalProtest?: "ABSENT" | "CONFIRMED_CURRENT";
  } = {}
) {
  const now = options.now ?? REFERENCE;
  const originalDue = row.dueDate?.getTime() ?? null;
  const delinquency = analyzeCommercialDelinquency({
    customerId: CUSTOMER_ID,
    taxId: CNPJ,
    nomusExternalPersonId: options.nomusExternalPersonId === undefined ? PERSON_ID : options.nomusExternalPersonId,
    salesOrderExternalCustomerIds: options.salesOrderExternalCustomerIds ?? [PERSON_ID],
    peerCustomerIdsWithSameCnpj: [],
    titles: [row],
    syncCutoff: buildNomusArReportSyncCutoff(row.syncedAt),
    latestRunStatus: "SUCCESS",
    payloadComplete: true,
    referenceDate: now,
  });
  const sales = buildCustomerSalesBlockStatus({
    identity:
      options.nomusExternalPersonId === null
        ? { kind: "MISSING", salesOrderPersonIds: [] }
        : options.salesOrderExternalCustomerIds &&
            options.salesOrderExternalCustomerIds.some((id) => id != null && id !== PERSON_ID)
          ? {
              kind: "CONFLICT",
              customerPersonId: PERSON_ID,
              salesOrderPersonIds: options.salesOrderExternalCustomerIds.filter((id): id is number => id != null),
            }
          : { kind: "RESOLVED", personId: PERSON_ID, salesOrderPersonIds: [PERSON_ID] },
    titles: [
      {
        ...commercialDelinquencyTitleToDashboardRow(row),
        paymentMethodId: 10,
      },
    ],
    today: now,
    evaluatedAt: now,
    syncCutoff: buildNomusArReportSyncCutoff(row.syncedAt),
  });
  const credit = decideCommercialCredit({
    customerId: CUSTOMER_ID,
    enforcement: "CREDIT_GRANT",
    paymentTerms: "30",
    delinquency,
    externalProtest: options.externalProtest ?? "ABSENT",
    now,
  });
  return { delinquency, sales, credit, originalDue, dueAfter: row.dueDate?.getTime() ?? null };
}

describe("folga comercial de boleto em America/Sao_Paulo", () => {
  it("D+0 a D+3 não bloqueiam só por atraso; D+4 bloqueia título elegível com saldo", () => {
    const cases = [
      { days: 0, due: "2026-10-24", blocks: false },
      { days: 1, due: "2026-10-23", blocks: false },
      { days: 2, due: "2026-10-22", blocks: false },
      { days: 3, due: "2026-10-21", blocks: false },
      { days: 4, due: "2026-10-20", blocks: true },
    ] as const;
    for (const item of cases) {
      const row = title({ dueDate: dueOn(item.due) });
      const { delinquency, sales, credit, originalDue, dueAfter } = readPair(row);
      assert.equal(commercialCalendarDaysOverdue(row.dueDate, REFERENCE), item.days, `D+${item.days}`);
      assert.equal(dueAfter, originalDue, `vencimento original D+${item.days}`);
      assert.equal(sales.blocked, item.blocks, `trava D+${item.days}`);
      assert.equal(sales.reason, item.blocks ? "OVERDUE_BOLETO" : null, `motivo D+${item.days}`);
      assert.equal(delinquency.status, item.blocks ? "OVERDUE" : "REGULAR", `inadimplência D+${item.days}`);
      assert.equal(credit.customerStatus, item.blocks ? "BLOQUEADO" : "LIBERADO", `crédito D+${item.days}`);
      const listedSaleBlocked = sales.blocked || officialCreditDeniesTermSale(credit);
      assert.equal(listedSaleBlocked, item.blocks, `lista D+${item.days}`);
      assert.equal(
        operationBlockedByOfficialCredit({ paymentTerms: "30", customerStatus: credit.customerStatus }),
        item.blocks,
        `efetivação a prazo D+${item.days}`
      );
      if (item.days >= 1) {
        assert.deepEqual(delinquency.evidence.officialOverdueTitleIds, [1], `financeiro ainda vencido D+${item.days}`);
      }
      assert.deepEqual(delinquency.evidence.overdueTitleIds, item.blocks ? [1] : [], `elegibilidade D+${item.days}`);
    }
  });

  it("boleto quitado fora da folga não bloqueia lista, ficha nem venda", () => {
    const row = title({
      dueDate: dueOn("2026-10-01"),
      balanceReceivable: 0,
      amountReceived: 1000,
      settlementDate: new Date("2026-10-22T15:00:00.000Z"),
    });
    const { delinquency, sales, credit } = readPair(row);
    assert.equal(sales.blocked, false);
    assert.equal(delinquency.status, "REGULAR");
    assert.equal(credit.customerStatus, "LIBERADO");
    assert.equal(officialCreditDeniesTermSale(credit), false);
  });

  it("a virada do dia comercial é meia-noite em America/Sao_Paulo", () => {
    const due = dueOn("2026-10-20");
    const before = new Date("2026-10-24T02:30:00.000Z");
    const after = new Date("2026-10-24T03:30:00.000Z");
    assert.equal(commercialSaoPauloCivilDate(before), "2026-10-23");
    assert.equal(commercialSaoPauloCivilDate(after), "2026-10-24");
    assert.equal(commercialCalendarDaysOverdue(due, before), 3);
    assert.equal(commercialCalendarDaysOverdue(due, after), 4);

    const stillInside = readPair(title({ dueDate: due, syncedAt: before }), { now: before });
    assert.equal(stillInside.sales.blocked, false);
    assert.equal(stillInside.delinquency.status, "REGULAR");
    assert.equal(stillInside.credit.customerStatus, "LIBERADO");

    const blockingDay = readPair(title({ dueDate: due, syncedAt: after }), { now: after });
    assert.equal(blockingDay.sales.blocked, true);
    assert.equal(blockingDay.sales.reason, "OVERDUE_BOLETO");
    assert.equal(blockingDay.delinquency.status, "OVERDUE");
    assert.equal(blockingDay.credit.customerStatus, "BLOQUEADO");
    assert.equal(blockingDay.sales.maxDaysOverdue, blockingDay.delinquency.maxDaysOverdue);
  });

  it("identidade não validada continua bloqueando dentro e fora da folga", () => {
    const { sales, delinquency, credit } = readPair(title({ dueDate: dueOn("2026-10-23") }), {
      nomusExternalPersonId: null,
      salesOrderExternalCustomerIds: [],
    });
    assert.equal(sales.blocked, true);
    assert.equal(sales.reason, "FINANCIAL_IDENTITY_UNRESOLVED");
    assert.equal(sales.overdueBoletoCount, 0);
    assert.equal(delinquency.status, "UNKNOWN");
    assert.equal(credit.customerStatus, "BLOQUEADO");
    assert.equal(officialCreditDeniesTermSale(credit), true);
  });

  it("protesto confirmado em D+2 bloqueia o crédito sem tratar o atraso como boleto vencido bloqueante", () => {
    const { sales, delinquency, credit } = readPair(
      title({
        dueDate: dueOn("2026-10-22"),
        rawPayload: { protestado: true },
      })
    );
    assert.equal(sales.blocked, false);
    assert.equal(sales.reason, null);
    assert.equal(delinquency.status, "PROTESTED");
    assert.equal(credit.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(
      operationBlockedByOfficialCredit({ paymentTerms: "30", customerStatus: credit.customerStatus }),
      true
    );
  });

  it("protesto externo vigente bloqueia o prazo mesmo com boleto ainda na folga", () => {
    const { sales, credit } = readPair(title({ dueDate: dueOn("2026-10-23") }), {
      externalProtest: "CONFIRMED_CURRENT",
    });
    assert.equal(sales.blocked, false);
    assert.equal(credit.customerStatus, "BLOQUEADO");
    assert.equal(credit.reason, "EXTERNAL_PROTEST");
    assert.equal(officialCreditDeniesTermSale(credit), true);
  });
});

describe("vencimento como a sincronização grava (meia-noite do processo)", () => {
  // parseNomusBrDate grava 00:00Z com o servidor em UTC e 03:00Z em São Paulo. Lido no fuso
  // de São Paulo, 00:00Z do dia 20 virava o dia 19 e o bloqueio saía em D+3.
  const due = parseNomusBrDate("20/10/2026");
  it("D+3 ainda não bloqueia e D+4 bloqueia, com o processo em UTC ou em São Paulo", () => {
    assert.equal(commercialCalendarDaysOverdue(due, new Date("2026-10-20T23:59:00-03:00")), 0);
    assert.equal(commercialCalendarDaysOverdue(due, new Date("2026-10-23T12:00:00-03:00")), 3);
    assert.equal(commercialCalendarDaysOverdue(due, new Date("2026-10-23T23:59:00-03:00")), 3, "21:00 em diante já é o dia seguinte em UTC, ainda D+3 em São Paulo");
    assert.equal(commercialCalendarDaysOverdue(due, new Date("2026-10-24T00:01:00-03:00")), 4);
  });
});
