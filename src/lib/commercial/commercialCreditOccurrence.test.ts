import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildNomusArReportSyncCutoff } from "@/src/lib/financeNomusArReportFreshness.js";
import { decideCommercialCredit } from "./commercialCreditDecision.js";
import {
  analyzeCommercialDelinquency,
  type AnalyzeCommercialDelinquencyInput,
  type CommercialDelinquencyTitleInput,
} from "./customerDelinquencyAnalysis.js";
import {
  occurrenceBlocksCredit,
  resolveConfirmedPendingProtest,
  validateOccurrenceDraft,
} from "./commercialCreditOccurrence.js";

const CUSTOMER = "11111111-1111-4111-8111-111111111111";
const CNPJ = "11444777000161";
const TODAY = new Date(2026, 9, 19, 12, 0, 0);
const SYNCED = new Date(2026, 9, 19, 9, 0, 0);

function settledTitle(protest: boolean): CommercialDelinquencyTitleInput {
  return {
    externalId: 9,
    personId: 100,
    personName: "Cliente",
    personCnpj: CNPJ,
    description: "Parcela",
    dueDate: new Date(2026, 8, 1),
    settlementDate: new Date(2026, 9, 10),
    amountReceivable: 1000,
    amountReceived: 1000,
    balanceReceivable: 0,
    sourceInvoiceId: 50,
    sourceInvoiceNumber: "100",
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: SYNCED,
    sourcePresenceStatus: "PRESENT",
    rawPayload: protest ? { protestado: true } : { id: 9 },
  };
}

function input(title: CommercialDelinquencyTitleInput): AnalyzeCommercialDelinquencyInput {
  return {
    customerId: CUSTOMER,
    taxId: CNPJ,
    nomusExternalPersonId: 100,
    salesOrderExternalCustomerIds: [100],
    peerCustomerIdsWithSameCnpj: [],
    titles: [title],
    syncCutoff: buildNomusArReportSyncCutoff(SYNCED),
    latestRunStatus: "SUCCESS",
    payloadComplete: true,
    referenceDate: TODAY,
  };
}

describe("ocorrência de crédito — regras", () => {
  it("encaminhamento não é protesto confirmado", () => {
    assert.equal(
      occurrenceBlocksCredit({ kind: "PROTEST_FORWARDED", status: "OPEN", closedAt: null }),
      false
    );
    const resolved = resolveConfirmedPendingProtest({
      occurrences: [
        { kind: "PROTEST_FORWARDED", status: "OPEN", titleExternalId: 9, closedAt: null },
      ],
      openProtestedTitleIds: [],
      settledProtestedTitleIds: [],
    });
    assert.equal(resolved.confirmedPending, false);
  });

  it("protesto confirmado pendente bloqueia mesmo depois da baixa", () => {
    const book = analyzeCommercialDelinquency(input(settledTitle(false)));
    assert.equal(book.status, "REGULAR");
    const decision = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: book,
      confirmedPendingProtest: true,
      now: TODAY,
    });
    assert.equal(decision.customerStatus, "BLOQUEIO_CRITICO");
    assert.equal(decision.reason, "INTERNAL_PROTEST");
    assert.equal(decision.allowed, false);
  });

  it("baixa com protesto explícito no Nomus continua crítica até a regularização", () => {
    const book = analyzeCommercialDelinquency(input(settledTitle(true)));
    assert.equal(book.status, "REGULAR");
    assert.deepEqual(book.evidence.settledProtestedTitleIds, [9]);
    const pending = resolveConfirmedPendingProtest({
      occurrences: [],
      openProtestedTitleIds: book.evidence.protestedTitleIds,
      settledProtestedTitleIds: book.evidence.settledProtestedTitleIds ?? [],
    });
    assert.equal(pending.confirmedPending, true);
    const blocked = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: book,
      confirmedPendingProtest: pending.confirmedPending,
      suppressedProtestTitleIds: pending.suppressedTitleIds,
      now: TODAY,
    });
    assert.equal(blocked.customerStatus, "BLOQUEIO_CRITICO");

    const cleared = resolveConfirmedPendingProtest({
      occurrences: [
        {
          kind: "REGULARIZATION",
          status: "CLOSED",
          titleExternalId: 9,
          closedAt: TODAY,
        },
      ],
      openProtestedTitleIds: [],
      settledProtestedTitleIds: [9],
    });
    const released = decideCommercialCredit({
      customerId: CUSTOMER,
      enforcement: "CREDIT_GRANT",
      paymentTerms: "30",
      delinquency: book,
      confirmedPendingProtest: cleared.confirmedPending,
      suppressedProtestTitleIds: cleared.suppressedTitleIds,
      now: TODAY,
    });
    assert.equal(released.customerStatus, "LIBERADO");
  });

  it("regularização sem comprovante é recusada", () => {
    const draft = validateOccurrenceDraft({
      kind: "REGULARIZATION",
      justification: "Regularização formal com autorização da diretoria.",
      titleExternalId: 9,
      evidenceCount: 0,
      occurredAt: TODAY,
      now: TODAY,
    });
    assert.equal(draft.ok, false);
    if (draft.ok === false) assert.equal(draft.code, "OCCURRENCE_EVIDENCE");
  });
});
