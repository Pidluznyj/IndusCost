import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { classifyReceivableReceiptCoverage } from "./nomusReceivableReceiptCoverage.ts";
import { buildReceiptCompetenceByReceivable } from "../commissions/commissionReceiptCompetence.ts";
import { filterReceivablesByReceiptCompetence } from "../commissions/commissionReceiptEngine.ts";

const ar = {
  amountReceivable: 11880,
  amountReceived: 11880,
  balanceReceivable: 0,
  settlementDate: "2026-09-24",
};

test("AR recebido sem evento não fabrica recebimento", () => {
  const result = classifyReceivableReceiptCoverage({
    receivableExternalId: 19135,
    ar,
    receipts: [],
    scheduleCount: 1,
    expectedCompetenceMonth: "2026-09",
  });
  assert.equal(result.classification, "AR_RECEIVED_WITHOUT_RECEIPT");
});

test("CR 19135 sintético com receipt em setembro entra na competência", () => {
  const events = [
    {
      receiptExternalId: 90001,
      receivableExternalId: 19135,
      receiptDate: "2026-09-24",
      receivedAmount: 11880,
    },
  ];
  const september = buildReceiptCompetenceByReceivable(events, 2026, 9);
  assert.equal(september.get(19135)?.periodReceivedAmount, 11880);
  assert.equal(buildReceiptCompetenceByReceivable(events, 2026, 8).has(19135), false);

  const coverage = classifyReceivableReceiptCoverage({
    receivableExternalId: 19135,
    ar,
    receipts: [{ externalId: 90001, receiptDate: "2026-09-24", receivedAmount: 11880 }],
    scheduleCount: 1,
    expectedCompetenceMonth: "2026-09",
  });
  assert.equal(coverage.classification, "OK");
});

test("receipt de agosto não entra na competência de setembro", () => {
  const result = classifyReceivableReceiptCoverage({
    receivableExternalId: 19135,
    ar: { ...ar, settlementDate: "2026-09-01" },
    receipts: [{ externalId: 1, receiptDate: "2026-08-31", receivedAmount: 11880 }],
    scheduleCount: 1,
    expectedCompetenceMonth: "2026-09",
  });
  assert.equal(result.classification, "RECEIPT_OUTSIDE_EXPECTED_COMPETENCE");
});

test("dois recebimentos do mesmo CR permanecem distintos", () => {
  const result = classifyReceivableReceiptCoverage({
    receivableExternalId: 10,
    ar: { amountReceivable: 10000, amountReceived: 10000, balanceReceivable: 0, settlementDate: "2026-08-05" },
    receipts: [
      { externalId: 1, receiptDate: "2026-07-31", receivedAmount: 4000 },
      { externalId: 2, receiptDate: "2026-08-05", receivedAmount: 6000 },
    ],
    scheduleCount: 1,
  });
  assert.equal(result.classification, "MULTIPLE_RECEIPTS_OK");
  assert.equal(result.receiptCount, 2);
});

test("schedule ausente e valor divergente são observáveis", () => {
  assert.equal(
    classifyReceivableReceiptCoverage({
      receivableExternalId: 1,
      ar,
      receipts: [{ externalId: 1, receiptDate: "2026-09-01", receivedAmount: 11880 }],
      scheduleCount: 0,
    }).classification,
    "SCHEDULE_MISSING"
  );
  assert.equal(
    classifyReceivableReceiptCoverage({
      receivableExternalId: 1,
      ar,
      receipts: [{ externalId: 1, receiptDate: "2026-09-01", receivedAmount: 1000 }],
      scheduleCount: 1,
    }).classification,
    "RECEIPT_AMOUNT_MISMATCH"
  );
});

test("título em aberto sem receipt não vira recebimento de comissão", () => {
  const open = classifyReceivableReceiptCoverage({
    receivableExternalId: 19136,
    ar: { amountReceivable: 12240, amountReceived: 0, balanceReceivable: 12240, settlementDate: null },
    receipts: [],
    scheduleCount: 1,
    expectedCompetenceMonth: "2026-09",
  });
  assert.equal(open.classification, "OK");
  const population = filterReceivablesByReceiptCompetence(
    [
      {
        id: "local",
        externalId: 19136,
        cancelled: false,
        suspended: false,
        amountReceivable: 12240,
        amountReceived: 0,
        balanceReceivable: 12240,
        settlementDate: null,
        receiptCompetence: null,
      } as never,
    ],
    2026,
    9
  );
  assert.equal(population.length, 0);
});

test("o sync não apaga recebimento nem para a página por --since", () => {
  const source = readFileSync(new URL("../../../scripts/nomusReceivableReceiptsSync.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /pageIsFullyBeforeSince/);
  assert.doesNotMatch(source, /nomusReceivableReceipt\.delete/);
  assert.doesNotMatch(source, /CommissionMonthlyClosing/);
});
