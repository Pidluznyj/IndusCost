import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { isValidCnpj } from "@/src/lib/companyCnpjFormat.js";
import { buildNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import { FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS } from "@/src/lib/finance/financeSettlementReconciliation.js";
import { TREASURY_CAIXA_RECENT_OVERDUE_VISIBILITY_DAYS } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import {
  COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS,
  analyzeCommercialDelinquency,
  readNomusArProtest,
  type AnalyzeCommercialDelinquencyInput,
  type CommercialDelinquencyTitleInput,
} from "./customerDelinquencyAnalysis.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11444777000161";
const OTHER_CNPJ = "14055501000180";
const TODAY = new Date(2026, 9, 19, 10, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

function title(overrides: Partial<CommercialDelinquencyTitleInput> = {}): CommercialDelinquencyTitleInput {
  return {
    externalId: 1,
    personId: 100,
    personName: "Cliente",
    personCnpj: CNPJ,
    description: "Parcela NF",
    dueDate: new Date(2026, 9, 15),
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
    taxId: CNPJ,
    nomusExternalPersonId: 100,
    salesOrderExternalCustomerIds: [100],
    peerCustomerIdsWithSameCnpj: [],
    titles: [title()],
    syncCutoff: buildNomusArReportSyncCutoff(SYNCED),
    latestRunStatus: "SUCCESS",
    payloadComplete: true,
    referenceDate: TODAY,
    ...overrides,
  };
}

describe("inadimplência comercial — tolerância de 3 dias corridos", () => {
  it("não herda a folga de 3 dias úteis da conciliação nem a janela visual da tesouraria", () => {
    assert.equal(COMMERCIAL_DELINQUENCY_TOLERANCE_DAYS, 3);
    assert.equal(FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS.toleranceDays, 3);
    assert.equal(TREASURY_CAIXA_RECENT_OVERDUE_VISIBILITY_DAYS, 3);
    const source = readFileSync(
      new URL("./customerDelinquencyAnalysis.ts", import.meta.url),
      "utf8"
    );
    const imports = source
      .split(/\r?\n/)
      .filter((line) => line.startsWith("import"))
      .join("\n");
    assert.doesNotMatch(imports, /financeSettlementReconciliation|treasuryCaixaRules/);
    assert.match(source, /filterOfficialArOverdueTitles/);
  });

  it("D+1 a D+3 com NF vencem no Financeiro, mas não bloqueiam; D+4 bloqueia", () => {
    assert.ok(isValidCnpj(CNPJ));
    assert.ok(isValidCnpj(OTHER_CNPJ));
    for (const days of [1, 2, 3]) {
      const withinGrace = analyzeCommercialDelinquency(
        input({ titles: [title({ dueDate: new Date(2026, 9, 19 - days) })] })
      );
      assert.equal(withinGrace.status, "REGULAR");
      assert.equal(withinGrace.overdueTitleCount, 0);
      assert.deepEqual(withinGrace.evidence.officialOverdueTitleIds, [1]);
      assert.equal(withinGrace.openAmount, 1000);
    }

    const overdue = analyzeCommercialDelinquency(input());
    assert.equal(overdue.status, "OVERDUE");
    assert.equal(overdue.overdueTitleCount, 1);
    assert.equal(overdue.overdueAmount, 1000);
    assert.equal(overdue.maxDaysOverdue, 4);
    assert.deepEqual(overdue.evidence.overdueTitleIds, [1]);
    assert.equal(overdue.overdueTitles?.length, 1);
    assert.equal(overdue.overdueTitles?.[0]?.externalId, 1);
    assert.equal(overdue.overdueTitles?.[0]?.sourceInvoiceNumber, "100");
    assert.equal(overdue.overdueTitles?.[0]?.dueDate, "2026-10-15");
    assert.equal(overdue.overdueTitles?.[0]?.daysOverdue, 4);
    assert.equal(overdue.overdueTitles?.[0]?.balanceReceivable, 1000);

    const dueToday = analyzeCommercialDelinquency(
      input({ titles: [title({ dueDate: new Date(2026, 9, 19, 23, 59, 0) })] })
    );
    assert.equal(dueToday.status, "REGULAR");
    assert.equal(dueToday.overdueTitleCount, 0);
    assert.equal(dueToday.openAmount, 1000);
    assert.equal(dueToday.maxDaysOverdue, 0);
    assert.deepEqual(dueToday.evidence.officialOverdueTitleIds, []);

    const upcoming = analyzeCommercialDelinquency(
      input({ titles: [title({ dueDate: new Date(2026, 9, 20) })] })
    );
    assert.equal(upcoming.status, "REGULAR");
    assert.equal(upcoming.overdueAmount, 0);
  });

  it("D+3 corrido, inclusive fim de semana, permanece na tolerância comercial", () => {
    const friday = new Date(2026, 9, 16);
    const result = analyzeCommercialDelinquency(
      input({ titles: [title({ dueDate: friday, externalId: 7 })] })
    );
    assert.equal(result.status, "REGULAR");
    assert.equal(result.maxDaysOverdue, 0);
    assert.equal(result.overdueAmount, 0);
    assert.deepEqual(result.evidence.officialOverdueTitleIds, [7]);
  });

  it("vira o dia civil: no vencimento ainda não venceu; no quarto dia corrido seguinte bloqueia", () => {
    // "Hoje" em São Paulo explícito (-03:00): a virada é a meia-noite de São Paulo, com o
    // processo em UTC ou em São Paulo. O vencimento é a data gravada pelo processo.
    const stillDue = analyzeCommercialDelinquency(
      input({
        referenceDate: new Date("2026-10-18T23:30:00-03:00"),
        titles: [title({ dueDate: new Date(2026, 9, 18, 8, 0, 0) })],
      })
    );
    assert.equal(stillDue.status, "REGULAR");

    const nextMorning = analyzeCommercialDelinquency(
      input({
        referenceDate: new Date("2026-10-19T00:30:00-03:00"),
        titles: [title({ dueDate: new Date(2026, 9, 18, 23, 30, 0) })],
      })
    );
    assert.equal(nextMorning.status, "REGULAR");
    assert.equal(nextMorning.maxDaysOverdue, 0);
    assert.deepEqual(nextMorning.evidence.officialOverdueTitleIds, [1]);

    const fourthDay = analyzeCommercialDelinquency(
      input({
        referenceDate: new Date("2026-10-19T00:30:00-03:00"),
        titles: [title({ dueDate: new Date(2026, 9, 15, 23, 30, 0) })],
      })
    );
    assert.equal(fourthDay.status, "OVERDUE");
    assert.equal(fourthDay.maxDaysOverdue, 4);
  });
});

describe("inadimplência comercial — saldo, baixa, cancelamento e substituição", () => {
  it("pagamento parcial usa o saldo em aberto, não o valor original", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            amountReceivable: 1000,
            amountReceived: 400,
            balanceReceivable: 600,
          }),
          title({
            externalId: 2,
            dueDate: new Date(2026, 9, 30),
            amountReceivable: 500,
            amountReceived: 100,
            balanceReceivable: 400,
          }),
        ],
      })
    );
    assert.equal(result.status, "OVERDUE");
    assert.equal(result.overdueTitleCount, 1);
    assert.equal(result.overdueAmount, 600);
    assert.equal(result.openAmount, 1000);
    assert.equal(result.maxDaysOverdue, 4);
  });

  it("quitação por baixa ou saldo zerado não permanece vencida", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            settlementDate: new Date(2026, 9, 18),
            amountReceived: 1000,
            balanceReceivable: 0,
          }),
        ],
      })
    );
    assert.equal(result.status, "REGULAR");
    assert.equal(result.overdueTitleCount, 0);
    assert.equal(result.openAmount, 0);
    assert.equal(result.evidence.exclusions[0]?.reason, "SETTLED");
  });

  it("cancelamento explícito e ausência confirmada no Nomus não cobram", () => {
    const cancelled = analyzeCommercialDelinquency(
      input({
        titles: [title({ rawPayload: { cancelado: true }, balanceReceivable: 800 })],
      })
    );
    assert.equal(cancelled.status, "REGULAR");
    assert.equal(cancelled.evidence.exclusions[0]?.reason, "CANCELLED");

    const removed = analyzeCommercialDelinquency(
      input({
        titles: [title({ sourcePresenceStatus: "MISSING_CONFIRMED" })],
      })
    );
    assert.equal(removed.status, "REGULAR");
    assert.equal(removed.evidence.exclusions[0]?.reason, "REMOVED_FROM_SOURCE");
  });

  it("pré-NF duplicada da mesma parcela cai; fica o título com NF", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 10,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            description: "PD 010 Parcela 1 de 1",
          }),
          title({
            externalId: 11,
            sourceInvoiceId: 90,
            sourceInvoiceNumber: "90",
            description: "PD 010 Parcela 1 de 1",
          }),
        ],
      })
    );
    assert.equal(result.overdueTitleCount, 1);
    assert.equal(result.overdueAmount, 1000);
    assert.deepEqual(result.evidence.overdueTitleIds, [11]);
    assert.ok(result.evidence.exclusions.some((row) => row.externalId === 10 && row.reason === "SUPERSEDED_PRE_INVOICE"));
  });

  it("reemissão da mesma parcela pré-NF mantém só o título mais recente", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            externalId: 10,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            dueDate: new Date(2026, 8, 30),
            description: "Parcela 1 de 1 PD 02607",
          }),
          title({
            externalId: 20,
            sourceInvoiceId: null,
            sourceInvoiceNumber: null,
            dueDate: new Date(2026, 9, 10),
            description: "Parcela 1 de 1 PD 02607",
          }),
        ],
      })
    );
    assert.deepEqual(result.evidence.includedTitleIds, [20]);
    assert.deepEqual(result.evidence.overdueTitleIds, []);
    assert.equal(result.status, "REGULAR");
    assert.equal(result.openAmount, 1000);
    assert.ok(
      result.evidence.exclusions.some((row) => row.externalId === 10 && row.reason === "SUPERSEDED_REISSUE")
    );
  });

  it("renegociação com id de origem no payload não soma o título substituído", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({ externalId: 10, dueDate: new Date(2026, 8, 1), balanceReceivable: 1000 }),
          title({
            externalId: 11,
            dueDate: new Date(2026, 9, 10),
            balanceReceivable: 1000,
            rawPayload: { idContaReceberOrigem: 10 },
          }),
        ],
      })
    );
    assert.deepEqual(result.evidence.overdueTitleIds, [11]);
    assert.equal(result.overdueAmount, 1000);
    assert.ok(
      result.evidence.exclusions.some(
        (row) => row.externalId === 10 && row.reason === "SUPERSEDED_RENEGOTIATION"
      )
    );
  });

  it("o mesmo externalId repetido conta uma vez", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({ syncedAt: new Date(2026, 9, 19, 8, 0, 0), balanceReceivable: 1000 }),
          title({ syncedAt: SYNCED, balanceReceivable: 1000 }),
        ],
      })
    );
    assert.equal(result.overdueTitleCount, 1);
    assert.equal(result.overdueAmount, 1000);
    assert.equal(result.evidence.exclusions.filter((row) => row.reason === "DUPLICATE_EXTERNAL_ID").length, 1);
  });
});

describe("inadimplência comercial — protesto sem invenção", () => {
  it("comentário com a palavra protesto não protesta o cliente", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({
            dueDate: new Date(2026, 9, 30),
            comments: "Cliente protestado em cartório",
            rawPayload: { comentarios: "protestado" },
          }),
        ],
      })
    );
    assert.equal(result.status, "REGULAR");
    assert.equal(result.evidence.protestReading, "NOT_IN_SOURCE");
    assert.equal(readNomusArProtest({ comentarios: "protestado em cartório" }), "NOT_PRESENT");
  });

  it("campo explícito protestado=true marca PROTESTED e conserva o saldo", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [title({ rawPayload: { protestado: true } })],
      })
    );
    assert.equal(result.status, "PROTESTED");
    assert.equal(result.overdueTitleCount, 1);
    assert.equal(result.overdueAmount, 1000);
    assert.deepEqual(result.evidence.protestedTitleIds, [1]);
  });

  it("campo explícito false não protesta; valor ilegível não declara REGULAR", () => {
    const clear = analyzeCommercialDelinquency(
      input({
        titles: [title({ dueDate: new Date(2026, 9, 30), rawPayload: { situacaoProtesto: "sem protesto" } })],
      })
    );
    assert.equal(clear.status, "REGULAR");
    assert.equal(clear.evidence.protestReading, "CLEAR");

    const unreadable = analyzeCommercialDelinquency(
      input({
        titles: [title({ dueDate: new Date(2026, 9, 30), rawPayload: { statusProtesto: "verificar" } })],
      })
    );
    assert.equal(unreadable.status, "UNKNOWN");
    assert.equal(unreadable.unknownReason, "PROTEST_UNREADABLE");
    assert.equal(unreadable.overdueAmount, null);
  });
});

describe("inadimplência comercial — identidade e sincronização", () => {
  it("CNPJ inválido, pessoa Nomus ausente ou conflito não declara REGULAR", () => {
    const invalid = analyzeCommercialDelinquency(input({ taxId: "123" }));
    assert.equal(invalid.status, "UNKNOWN");
    assert.equal(invalid.unknownReason, "IDENTITY_CNPJ_INVALID");
    assert.equal(invalid.openAmount, null);

    const missing = analyzeCommercialDelinquency(
      input({ nomusExternalPersonId: null, salesOrderExternalCustomerIds: [] })
    );
    assert.equal(missing.unknownReason, "IDENTITY_MISSING_NOMUS_PERSON");

    const conflict = analyzeCommercialDelinquency(
      input({ salesOrderExternalCustomerIds: [100, 61] })
    );
    assert.equal(conflict.unknownReason, "IDENTITY_CONFLICT_NOMUS_PERSON");
    assert.equal(conflict.overdueTitleCount, null);
  });

  it("CNPJ do título diferente do cadastro é ambíguo", () => {
    const result = analyzeCommercialDelinquency(
      input({ titles: [title({ personCnpj: OTHER_CNPJ })] })
    );
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.unknownReason, "IDENTITY_CNPJ_PERSON_MISMATCH");
  });

  it("dois cadastros com o mesmo CNPJ não escolhem um lado", () => {
    const result = analyzeCommercialDelinquency(
      input({ peerCustomerIdsWithSameCnpj: ["22222222-2222-4222-8222-222222222222"] })
    );
    assert.equal(result.unknownReason, "IDENTITY_AMBIGUOUS_CNPJ");
  });

  it("sync ausente, falha ou retrato velho não declara REGULAR nem OVERDUE", () => {
    const unavailable = analyzeCommercialDelinquency(input({ syncCutoff: null, latestRunStatus: null }));
    assert.equal(unavailable.unknownReason, "SYNC_UNAVAILABLE");

    const failed = analyzeCommercialDelinquency(input({ latestRunStatus: "FAILED" }));
    assert.equal(failed.status, "UNKNOWN");
    assert.equal(failed.unknownReason, "SYNC_FAILED");
    assert.equal(failed.overdueAmount, null);

    const incomplete = analyzeCommercialDelinquency(
      input({ latestRunStatus: "SUCCESS", payloadComplete: false })
    );
    assert.equal(incomplete.unknownReason, "SYNC_INCOMPLETE");

    const stale = analyzeCommercialDelinquency(
      input({
        syncCutoff: buildNomusArReportSyncCutoff(SYNCED),
        titles: [title({ syncedAt: new Date(SYNCED.getTime() - 3 * 60 * 60 * 1000) })],
      })
    );
    assert.equal(stale.unknownReason, "SYNC_STALE");
    assert.equal(stale.status, "UNKNOWN");
  });

  it("sync completa sem títulos do cliente é REGULAR", () => {
    const result = analyzeCommercialDelinquency(input({ titles: [] }));
    assert.equal(result.status, "REGULAR");
    assert.equal(result.overdueTitleCount, 0);
    assert.equal(result.openAmount, 0);
    assert.equal(result.evidence.source, "NomusAccountsReceivable");
    assert.equal(result.evidence.toleranceDays, 3);
    assert.ok(result.lastSyncedAt);
  });

  it("maior atraso é o mais antigo entre os títulos ainda em aberto", () => {
    const result = analyzeCommercialDelinquency(
      input({
        titles: [
          title({ externalId: 1, dueDate: new Date(2026, 9, 15), balanceReceivable: 100 }),
          title({ externalId: 2, dueDate: new Date(2026, 9, 1), balanceReceivable: 50 }),
        ],
      })
    );
    assert.equal(result.maxDaysOverdue, 18);
    assert.equal(result.overdueAmount, 150);
    assert.equal(result.overdueTitleCount, 2);
  });
});
