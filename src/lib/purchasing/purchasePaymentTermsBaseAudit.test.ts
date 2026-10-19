import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditPaymentTermsBase, type BaseAuditOrder } from "./purchasePaymentTermsBaseAudit.js";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const addDays = (iso: string, n: number) => new Date(d(iso).getTime() + n * 86_400_000);

/** Condição 7 = 30/60 contada da ENTREGA; emissões e entregas com distâncias diferentes. */
function order(n: number, issued: string, deliveryGap: number, base: "ISSUE" | "DELIVERY"): BaseAuditOrder {
  const expected = addDays(issued, deliveryGap);
  const ref = base === "ISSUE" ? d(issued) : expected;
  return {
    orderNumber: `PC${n}`,
    issuedAt: d(issued),
    expectedAt: expected,
    conditionId: 7,
    conditionText: "30/60",
    installments: [
      { index: 0, dueDate: new Date(ref.getTime() + 30 * 86_400_000), amount: 100 },
      { index: 1, dueDate: new Date(ref.getTime() + 60 * 86_400_000), amount: 100 },
    ],
  };
}

describe("diagnóstico da data-base (somente leitura)", () => {
  it("aponta a entrega prevista quando os prazos só são constantes a partir dela", () => {
    const r = auditPaymentTermsBase([order(1, "2026-01-05", 9, "DELIVERY"), order(2, "2026-02-10", 20, "DELIVERY"), order(3, "2026-03-01", 3, "DELIVERY")]);
    const delivery = r.candidates.find((c) => c.base === "EXPECTED_DELIVERY_DATE")!;
    const issue = r.candidates.find((c) => c.base === "ORDER_ISSUE_DATE")!;
    assert.equal(delivery.conditionsConsistent, 1);
    assert.equal(issue.conditionsConsistent, 0);
    assert.equal(r.suggestedBase, "EXPECTED_DELIVERY_DATE");
    assert.equal(delivery.topPatterns[0].pattern, "30/60");
  });

  it("aponta a emissão quando é ela a referência", () => {
    const r = auditPaymentTermsBase([order(1, "2026-01-05", 9, "ISSUE"), order(2, "2026-02-10", 20, "ISSUE")]);
    assert.equal(r.suggestedBase, "ORDER_ISSUE_DATE");
  });

  it("sem condições comparáveis é inconclusivo; pedidos sem parcelas contam na qualidade", () => {
    const r = auditPaymentTermsBase([
      { orderNumber: "X", issuedAt: d("2026-01-01"), expectedAt: null, conditionId: null, conditionText: ".", installments: [] },
    ]);
    assert.equal(r.suggestedBase, null);
    assert.equal(r.withInstallments, 0);
    assert.deepEqual(r.conditionTexts, [{ text: ".", orders: 1 }]);
  });
});
