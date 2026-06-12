import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceArDeduplicationKey,
  classifyFinanceArReceivableOrigin,
  deduplicateFinanceArRows,
} from "./financeAccountsReceivableDeduplication.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";

function arRow(overrides: Partial<FinanceArDashboardRow> = {}): FinanceArDashboardRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

describe("financeAccountsReceivableDeduplication", () => {
  it("classifica origem Com NF e Sem NF", () => {
    assert.equal(
      classifyFinanceArReceivableOrigin({ sourceInvoiceId: 10, sourceInvoiceNumber: null }),
      "WITH_NFE"
    );
    assert.equal(
      classifyFinanceArReceivableOrigin({ sourceInvoiceId: null, sourceInvoiceNumber: null }),
      "WITHOUT_NFE"
    );
  });

  it("filtro Tudo não duplica sem NF quando existe Com NF equivalente", () => {
    const withoutNf = arRow({
      externalId: 1,
      sourceInvoiceId: null,
      balanceReceivable: 5000,
      dueDate: new Date(2026, 3, 10),
    });
    const withNf = arRow({
      externalId: 2,
      sourceInvoiceId: 99,
      sourceInvoiceNumber: "NF-99",
      balanceReceivable: 5000,
      dueDate: new Date(2026, 3, 10),
    });
    const result = deduplicateFinanceArRows([withoutNf, withNf]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]!.externalId, 2);
    assert.equal(result.supersededPreInvoiceCount, 1);
    assert.equal(result.supersededPreInvoiceAmount, 5000);
  });

  it("mantém ambos quando não há par Com NF", () => {
    const a = arRow({ externalId: 1, balanceReceivable: 100 });
    const b = arRow({
      externalId: 2,
      personCnpj: "22222222000122",
      balanceReceivable: 100,
      dueDate: new Date(2026, 3, 10),
    });
    const result = deduplicateFinanceArRows([a, b]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.supersededPreInvoiceCount, 0);
  });

  it("chave de deduplicação usa cliente, vencimento e saldo", () => {
    const keyA = buildFinanceArDeduplicationKey(arRow({ balanceReceivable: 750 }));
    const keyB = buildFinanceArDeduplicationKey(
      arRow({ externalId: 9, sourceInvoiceId: 1, balanceReceivable: 750 })
    );
    assert.equal(keyA, keyB);
  });
});
