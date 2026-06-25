import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  financeCustomerNameMatches,
  isNomusPersonIdCustomerParam,
  normalizeFinanceCustomerNameForMatch,
  parseFinanceCustomerNameParam,
  parseNomusPersonIdCustomerParam,
} from "./financeAccountsReceivableCustomerMatch.js";
import {
  buildFinanceArAnalyticalTitlesExportQuery,
  buildFinanceArAnalyticalTitlesQuery,
  createDefaultFinanceArAnalyticalUiFilters,
  normalizeFinanceArAnalyticalUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import {
  buildFinanceArTitlesPayload,
  financeArTitlesPrismaFilters,
  parseFinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId" | "dueDate">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa",
    personId: partial.personId ?? partial.externalId,
    personName: partial.personName ?? "Cliente",
    personCnpj: partial.personCnpj ?? null,
    description: "Título",
    competenceDate: partial.competenceDate ?? new Date(2026, 0, 1),
    settlementDate: null,
    amountReceivable: partial.balanceReceivable ?? 100,
    amountReceived: 0,
    balanceReceivable: partial.balanceReceivable ?? 100,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: partial.sourceInvoiceId ?? 100,
    sourceInvoiceNumber: partial.sourceInvoiceNumber ?? "NF-100",
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: new Date("2026-06-18T10:00:00.000Z"),
    ...partial,
  };
}

describe("financeAccountsReceivableCustomerMatch", () => {
  it("normaliza S/A, S.A. e SA para mesma base", () => {
    assert.equal(normalizeFinanceCustomerNameForMatch("Esmaltec S/A"), "esmaltec sa");
    assert.equal(normalizeFinanceCustomerNameForMatch("ESMALTEC S.A."), "esmaltec sa");
    assert.equal(normalizeFinanceCustomerNameForMatch("ESMALTEC SA"), "esmaltec sa");
  });

  it("financeCustomerNameMatches aceita variações da Esmaltec", () => {
    assert.ok(financeCustomerNameMatches("ESMALTEC S/A", "Esmaltec S/A"));
    assert.ok(financeCustomerNameMatches("Esmaltec S.A.", "ESMALTEC SA"));
    assert.ok(financeCustomerNameMatches("ESMALTEC S/A", "Esmaltec"));
    assert.ok(financeCustomerNameMatches("ESMALTEC S.A.", "Esmaltec S/A"));
  });

  it("parseNomusPersonIdCustomerParam rejeita UUID e texto", () => {
    assert.equal(parseNomusPersonIdCustomerParam("10"), 10);
    assert.equal(parseNomusPersonIdCustomerParam("abc-def-123"), undefined);
    assert.equal(parseNomusPersonIdCustomerParam("Esmaltec S/A"), undefined);
    assert.equal(parseNomusPersonIdCustomerParam("123e4567-e89b-12d3-a456-426614174000"), undefined);
  });

  it("isNomusPersonIdCustomerParam distingue ID Nomus de UUID IndusCost", () => {
    assert.equal(isNomusPersonIdCustomerParam("42"), true);
    assert.equal(isNomusPersonIdCustomerParam("f47ac10b-58cc-4372-a567-0e02b2c3d479"), false);
  });

  it("parseFinanceCustomerNameParam aceita aliases customer/client/cliente", () => {
    assert.equal(parseFinanceCustomerNameParam({ customerName: "Esmaltec S/A" }), "Esmaltec S/A");
    assert.equal(parseFinanceCustomerNameParam({ client: "Esmaltec" }), "Esmaltec");
    assert.equal(parseFinanceCustomerNameParam({ customerId: "10" }), undefined);
  });
});

describe("financeArAnalyticalTitles customer filter", () => {
  const REF = new Date(2026, 5, 19);

  it("frontend envia customerName e não customerId UUID", () => {
    const qs = buildFinanceArAnalyticalTitlesQuery(
      normalizeFinanceArAnalyticalUiFilters({
        ...createDefaultFinanceArAnalyticalUiFilters(),
        status: "all",
        year: "2026",
        customerName: "Esmaltec S/A",
        personName: "Esmaltec S/A",
        customerId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      })
    );
    assert.match(qs, /customerName=Esmaltec/);
    assert.match(qs, /year=2026/);
    assert.doesNotMatch(qs, /customerId=f47ac10b/);
    assert.doesNotMatch(qs, /personName=/);
  });

  it("frontend envia customerId quando é personId Nomus numérico", () => {
    const qs = buildFinanceArAnalyticalTitlesQuery(
      normalizeFinanceArAnalyticalUiFilters({
        ...createDefaultFinanceArAnalyticalUiFilters(),
        status: "all",
        year: "2026",
        customerId: "10",
        customerName: "Esmaltec S/A",
        personName: "Esmaltec S/A",
      })
    );
    assert.match(qs, /customerId=10/);
    assert.doesNotMatch(qs, /customerName=/);
  });

  it("exportação Excel usa mesmos parâmetros de cliente", () => {
    const filters = normalizeFinanceArAnalyticalUiFilters({
      ...createDefaultFinanceArAnalyticalUiFilters(),
      status: "all",
      year: "2026",
      customerName: "Esmaltec S/A",
      personName: "Esmaltec S/A",
    });
    const exportQs = buildFinanceArAnalyticalTitlesExportQuery(filters);
    assert.match(exportQs, /customerName=Esmaltec/);
    assert.match(exportQs, /year=2026/);
  });

  it("cenário 1 — customerName exato + ano 2026 retorna títulos Esmaltec", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "ESMALTEC S/A",
        dueDate: new Date(2026, 7, 10),
        balanceReceivable: 500,
      }),
      arRow({
        externalId: 2,
        personName: "Outro Cliente",
        dueDate: new Date(2026, 7, 15),
        balanceReceivable: 200,
      }),
    ];
    const query = parseFinanceArTitlesQuery({
      year: "2026",
      customerName: "Esmaltec S/A",
      page: "1",
    });
    const payload = buildFinanceArTitlesPayload(rows, query, REF);
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.personName, "ESMALTEC S/A");
    assert.equal(payload.summary.totalOriginalValue, 500);
  });

  it("cenário 2 — customerName parcial Esmaltec", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "Esmaltec S.A.",
        dueDate: new Date(2026, 7, 1),
      }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      parseFinanceArTitlesQuery({ year: "2026", customerName: "Esmaltec", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
  });

  it("cenário 3 — ESMALTEC SA encontra Esmaltec S/A", () => {
    const rows = [
      arRow({ externalId: 1, personName: "Esmaltec S/A", dueDate: new Date(2026, 7, 1) }),
      arRow({ externalId: 2, personName: "Esmaltec S.A.", dueDate: new Date(2026, 8, 1) }),
    ];
    for (const filter of ["ESMALTEC SA", "Esmaltec S/A", "esmaltec"]) {
      const payload = buildFinanceArTitlesPayload(
        rows,
        parseFinanceArTitlesQuery({ year: "2026", customerName: filter, page: "1" }),
        REF
      );
      assert.equal(payload.total, 2, `filter=${filter}`);
    }
  });

  it("cenário 4 — cliente inexistente retorna zero sem crash", () => {
    const rows = [
      arRow({ externalId: 1, personName: "ESMALTEC S/A", dueDate: new Date(2026, 7, 1) }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      parseFinanceArTitlesQuery({
        year: "2026",
        customerName: "Cliente Que Não Existe",
        page: "1",
      }),
      REF
    );
    assert.equal(payload.total, 0);
    assert.equal(payload.summary.totalTitles, 0);
  });

  it("financeArTitlesPrismaFilters remove personName quando há customerName", () => {
    const query = parseFinanceArTitlesQuery({
      year: "2026",
      personName: "Esmaltec S/A",
      customerName: "Esmaltec S/A",
      page: "1",
    });
    const prismaFilters = financeArTitlesPrismaFilters(query);
    assert.equal(prismaFilters.personName, undefined);
    assert.equal(query.filters.year, 2026);
  });

  it("totalizadores refletem cliente filtrado", () => {
    const rows = [
      arRow({
        externalId: 1,
        personName: "ESMALTEC S/A",
        dueDate: new Date(2026, 7, 1),
        balanceReceivable: 150,
        amountReceivable: 200,
        amountReceived: 50,
      }),
      arRow({
        externalId: 2,
        personName: "ESMALTEC S/A",
        dueDate: new Date(2026, 7, 2),
        balanceReceivable: 250,
        amountReceivable: 250,
      }),
      arRow({
        externalId: 3,
        personName: "Beta SA",
        dueDate: new Date(2026, 7, 3),
        balanceReceivable: 999,
      }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      parseFinanceArTitlesQuery({ year: "2026", customerName: "Esmaltec S/A", page: "1" }),
      REF
    );
    assert.equal(payload.summary.totalTitles, 2);
    assert.equal(payload.summary.totalOriginalValue, 450);
    assert.equal(payload.summary.totalOpenValue, 400);
  });
});
