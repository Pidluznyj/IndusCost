import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionMonthlyClosingHash,
  buildCommissionReceiptLedgerLineKey,
  COMMISSION_MONTHLY_CLOSING_STATUSES,
  COMMISSION_RECEIPT_LEDGER_LINE_STATUSES,
  isCommissionMonthlyClosingStatus,
  isCommissionReceiptLedgerLineStatus,
  normalizeCommissionLedgerMoney,
  parseCommissionRuleSnapshot,
  serializeCommissionRuleSnapshot,
} from "./commissionReceiptLedger.js";

describe("commissionReceiptLedger", () => {
  it("buildCommissionReceiptLedgerLineKey é determinístico e muda com parcela/record", () => {
    const base = {
      year: 2026,
      month: 6,
      nomusReceivableId: 9001,
      commissionRecordId: "aaaaaaaa-aaaa-4111-8111-aaaaaaaaaaaa",
      commissionPaymentScheduleId: "bbbbbbbb-bbbb-4111-8111-bbbbbbbbbbbb",
      installmentNumber: 1,
      nomusOrderItemId: 42,
      ruleId: "cccccccc-cccc-4111-8111-cccccccccccc",
    };
    const a = buildCommissionReceiptLedgerLineKey(base);
    const b = buildCommissionReceiptLedgerLineKey(base);
    assert.equal(a, b);
    assert.equal(a.length, 64);

    const otherInstallment = buildCommissionReceiptLedgerLineKey({
      ...base,
      installmentNumber: 2,
    });
    assert.notEqual(a, otherInstallment);
  });

  it("buildCommissionMonthlyClosingHash ignora ordem das line keys", () => {
    const input = {
      year: 2026,
      month: 6,
      source: "RECEIPT_BASED" as const,
      lineKeys: ["key-b", "key-a", "key-c"],
    };
    const hash1 = buildCommissionMonthlyClosingHash(input);
    const hash2 = buildCommissionMonthlyClosingHash({
      ...input,
      lineKeys: ["key-c", "key-a", "key-b"],
    });
    assert.equal(hash1, hash2);
    assert.notEqual(
      hash1,
      buildCommissionMonthlyClosingHash({ ...input, month: 7 })
    );
  });

  it("normalizeCommissionLedgerMoney arredonda para centavos", () => {
    assert.equal(normalizeCommissionLedgerMoney(10.005), 10.01);
    assert.equal(normalizeCommissionLedgerMoney(null), 0);
    assert.equal(normalizeCommissionLedgerMoney(Number.NaN), 0);
  });

  it("valida status de fechamento e linha do ledger", () => {
    for (const status of COMMISSION_MONTHLY_CLOSING_STATUSES) {
      assert.equal(isCommissionMonthlyClosingStatus(status), true);
    }
    assert.equal(isCommissionMonthlyClosingStatus("INVALID"), false);

    for (const status of COMMISSION_RECEIPT_LEDGER_LINE_STATUSES) {
      assert.equal(isCommissionReceiptLedgerLineStatus(status), true);
    }
    assert.equal(isCommissionReceiptLedgerLineStatus("PAID"), false);
  });

  it("serializa e parseia ruleSnapshotJson", () => {
    const snapshot = serializeCommissionRuleSnapshot({
      id: "rule-1",
      name: "Vendedor padrão",
      beneficiaryType: "SELLER",
      calculationType: "FIXED_PERCENT",
      baseType: "SALES_ORDER_ITEM_NET",
      releaseRule: "EACH_RECEIVABLE_PAID",
      ratePercent: 2.5895,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: null,
    });

    const json = JSON.parse(JSON.stringify(snapshot));
    const parsed = parseCommissionRuleSnapshot(json);

    assert.ok(parsed);
    assert.equal(parsed!.ruleId, "rule-1");
    assert.equal(parsed!.ruleName, "Vendedor padrão");
    assert.equal(parsed!.ratePercent, 2.59);
    assert.equal(parsed!.releaseRule, "EACH_RECEIVABLE_PAID");
    assert.equal(parseCommissionRuleSnapshot({ invalid: true }), null);
  });
});
