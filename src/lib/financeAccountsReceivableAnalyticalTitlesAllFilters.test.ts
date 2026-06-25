import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArAnalyticalTitlesQuery,
  createDefaultFinanceArAnalyticalUiFilters,
  normalizeFinanceArAnalyticalUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import {
  buildFinanceArTitlesPayload,
  financeArTitlesPrismaFilters,
  parseFinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";

const REF = new Date(2026, 5, 19);

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId" | "dueDate">
): FinanceArDashboardRow {
  return {
    companyName: partial.companyName ?? "Empresa",
    personId: partial.personId ?? partial.externalId,
    personName: partial.personName ?? "Cliente",
    personCnpj: partial.personCnpj ?? null,
    description: "Título",
    competenceDate: partial.competenceDate ?? new Date(2026, 0, 1),
    settlementDate: null,
    amountReceivable: partial.amountReceivable ?? partial.balanceReceivable ?? 100,
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

describe("financeArAnalyticalTitles all filters", () => {
  const esmaltecRows = [
    arRow({
      externalId: 1,
      personName: "ESMALTEC S/A",
      personCnpj: "08.056.614/0001-00",
      dueDate: new Date(2026, 7, 10),
      balanceReceivable: 500,
      companyName: "Koppetel",
    }),
    arRow({
      externalId: 2,
      personName: "Outro Cliente",
      dueDate: new Date(2026, 7, 15),
      balanceReceivable: 200,
    }),
  ];

  it("cliente: CNPJ IndusCost diferente do Nomus não zera via Prisma", () => {
    const query = parseFinanceArTitlesQuery({
      year: "2026",
      customerName: "Esmaltec S/A",
      customerCnpj: "99.999.999/0001-99",
      page: "1",
    });
    const prismaFilters = financeArTitlesPrismaFilters(query);
    assert.equal(prismaFilters.personName, undefined);
    assert.equal(prismaFilters.personCnpj, undefined);

    const payload = buildFinanceArTitlesPayload(esmaltecRows, query, REF);
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.personName, "ESMALTEC S/A");
  });

  it("cliente: fallback personName → customerName na normalização", () => {
    const normalized = normalizeFinanceArAnalyticalUiFilters({
      ...createDefaultFinanceArAnalyticalUiFilters(),
      status: "all",
      year: "2026",
      personName: "Esmaltec S/A",
      customerName: "",
    });
    assert.equal(normalized.customerName, "Esmaltec S/A");
    const qs = buildFinanceArAnalyticalTitlesQuery(normalized);
    assert.match(qs, /customerName=Esmaltec/);
    assert.doesNotMatch(qs, /personName=/);
    assert.doesNotMatch(qs, /personCnpj=/);
  });

  it("cliente: query usa customerCnpj e não personCnpj", () => {
    const qs = buildFinanceArAnalyticalTitlesQuery(
      normalizeFinanceArAnalyticalUiFilters({
        ...createDefaultFinanceArAnalyticalUiFilters(),
        status: "all",
        year: "2026",
        customerName: "Esmaltec S/A",
        personCnpj: "08.056.614/0001-00",
      })
    );
    assert.match(qs, /customerCnpj=/);
    assert.doesNotMatch(qs, /personCnpj=/);
  });

  it("ano vencimento 2026", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({ externalId: 1, dueDate: new Date(2026, 3, 1) }),
        arRow({ externalId: 2, dueDate: new Date(2025, 3, 1) }),
      ],
      parseFinanceArTitlesQuery({ year: "2026", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
  });

  it("mês vencimento", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({ externalId: 1, dueDate: new Date(2026, 5, 10) }),
        arRow({ externalId: 2, dueDate: new Date(2026, 6, 10) }),
      ],
      parseFinanceArTitlesQuery({ year: "2026", month: "6", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
  });

  it("empresa por nome", () => {
    const payload = buildFinanceArTitlesPayload(
      esmaltecRows,
      parseFinanceArTitlesQuery({ year: "2026", companyName: "Koppetel", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
  });

  it("status overdue", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({ externalId: 1, dueDate: new Date(2026, 2, 1), balanceReceivable: 100 }),
        arRow({ externalId: 2, dueDate: new Date(2026, 8, 1), balanceReceivable: 100 }),
      ],
      parseFinanceArTitlesQuery({ year: "2026", status: "overdue", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
  });

  it("documento / NF", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({ externalId: 1, dueDate: new Date(2026, 7, 1), sourceInvoiceNumber: "NF-6845" }),
        arRow({ externalId: 2, dueDate: new Date(2026, 7, 2), sourceInvoiceNumber: "NF-9999" }),
      ],
      parseFinanceArTitlesQuery({ year: "2026", document: "6845", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
  });

  it("valor mínimo e máximo positivos", () => {
    const rows = [
      arRow({ externalId: 1, dueDate: new Date(2026, 7, 1), amountReceivable: 50 }),
      arRow({ externalId: 2, dueDate: new Date(2026, 7, 2), amountReceivable: 150 }),
      arRow({ externalId: 3, dueDate: new Date(2026, 7, 3), amountReceivable: 300 }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      parseFinanceArTitlesQuery({ year: "2026", minValue: "100", maxValue: "200", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 2);
  });

  it("valor máximo 0,00 não zera resultados", () => {
    const payload = buildFinanceArTitlesPayload(
      esmaltecRows,
      parseFinanceArTitlesQuery({ year: "2026", maxValue: "0,00", page: "1" }),
      REF
    );
    assert.equal(payload.total, 2);
  });

  it("origem com NF", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({ externalId: 1, dueDate: new Date(2026, 7, 1), sourceInvoiceId: 10 }),
        arRow({ externalId: 2, dueDate: new Date(2026, 7, 2), sourceInvoiceId: null, sourceInvoiceNumber: null }),
      ],
      parseFinanceArTitlesQuery({ year: "2026", origin: "withNfe", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
  });

  it("situação de atraso overdue", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({ externalId: 1, dueDate: new Date(2026, 2, 1), balanceReceivable: 100 }),
        arRow({ externalId: 2, dueDate: new Date(2026, 8, 1), balanceReceivable: 100 }),
      ],
      parseFinanceArTitlesQuery({ year: "2026", delaySituation: "overdue", page: "1" }),
      REF
    );
    assert.equal(payload.total, 1);
  });

  it("emissão issueDateFrom/issueDateTo", () => {
    const payload = buildFinanceArTitlesPayload(
      [
        arRow({
          externalId: 1,
          dueDate: new Date(2026, 7, 1),
          competenceDate: new Date(2026, 4, 15),
        }),
        arRow({
          externalId: 2,
          dueDate: new Date(2026, 7, 2),
          competenceDate: new Date(2026, 1, 15),
        }),
      ],
      parseFinanceArTitlesQuery({
        year: "2026",
        issueDateFrom: "2026-05-01",
        issueDateTo: "2026-06-30",
        page: "1",
      }),
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
  });

  it("combinação cliente Esmaltec + ano 2026", () => {
    const payload = buildFinanceArTitlesPayload(
      esmaltecRows,
      parseFinanceArTitlesQuery({
        year: "2026",
        customerName: "Esmaltec S/A",
        customerCnpj: "99.999.999/0001-99",
        page: "1",
      }),
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.summary.totalOriginalValue, 500);
  });
});
