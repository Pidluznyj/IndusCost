import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDailyRadar,
  collectDailyRadarMovements,
} from "./financeCashFlowDailyRadar.js";
import type { FinanceCashFlowApRow } from "./financeCashFlowDashboard.js";
import { formatCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import { formatFinanceDate } from "./financeAccountsReceivableFormat.js";
import {
  buildFinanceCashFlowDailyRadarExportPayload,
  parseDailyRadarExportQuery,
} from "./financeCashFlowDailyRadarExport.js";
import { getAccountsPayableOperationalDueDate } from "./financeAccountsPayableOperational.js";

const BASE = new Date(2026, 6, 15, 12, 0, 0, 0);

/** Simula Prisma DATE: meia-noite UTC do dia civil. */
function prismaDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function ap13335Row(): FinanceCashFlowApRow {
  return {
    externalId: 13335,
    companyName: "KOPPETEL",
    personName: "CONTA ADMINISTRATIVA",
    personCnpj: "000756",
    description: "(Parcela 7 de 12)",
    dueDate: prismaDate("2026-07-20"),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: prismaDate("2026-02-20"),
    amountPayable: 33738.65,
    amountPaid: 0,
    balancePayable: 33738.65,
    paymentMethodName: "Transferência Bancária",
    bankAccountName: "0.2 Viacredi - Koppetel",
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date("2026-06-24T12:00:00.000Z"),
  };
}

describe("financeCivilDate", () => {
  it("data 2026-07-20 não vira 2026-07-19", () => {
    assert.equal(toCivilDateKey(prismaDate("2026-07-20")), "2026-07-20");
    assert.equal(formatCivilDate(prismaDate("2026-07-20")), "20/07/2026");
  });

  it("ISO 2026-07-20T00:00:00.000Z mantém chave civil 2026-07-20", () => {
    assert.equal(toCivilDateKey("2026-07-20T00:00:00.000Z"), "2026-07-20");
    assert.equal(formatFinanceDate("2026-07-20T00:00:00.000Z"), "20/07/2026");
  });
});

describe("financeCashFlowDailyRadar civil dates", () => {
  it("AP 13335 — CONTA ADMINISTRATIVA aparece em 20/07/2026, não em 19/07/2026", () => {
    const row = ap13335Row();
    assert.equal(toCivilDateKey(row.dueDate), "2026-07-20");
    assert.equal(
      toCivilDateKey(getAccountsPayableOperationalDueDate(row)),
      "2026-07-20"
    );

    const movements = collectDailyRadarMovements([], [row], BASE);
    assert.equal(movements.length, 1);
    assert.equal(toCivilDateKey(movements[0]!.operationalDate), "2026-07-20");

    const rangePayload = buildFinanceCashFlowDailyRadar(
      [],
      [row],
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    const detail = rangePayload.selectedDetail!;
    const mapped = detail.payables.rows[0]!;
    assert.equal(mapped.operationalDate, "2026-07-20");
    assert.equal(mapped.vencimentoOficial, "2026-07-20");
    assert.equal(mapped.dataAgendada, null);
    assert.equal(mapped.dataPagamento, null);
    assert.equal(mapped.dataUsadaNoFluxo, "2026-07-20");
    assert.equal(mapped.fonteDataFluxo, "vencimento");
    assert.equal(formatFinanceDate(mapped.operationalDate), "20/07/2026");

    const day19 = buildFinanceCashFlowDailyRadar(
      [],
      [row],
      { baseDate: BASE, rangeKey: "0-7", day: "2026-07-19" },
      BASE
    );
    assert.equal(day19.selectedDetail!.payables.rows.length, 0);

    const day20 = buildFinanceCashFlowDailyRadar(
      [],
      [row],
      { baseDate: BASE, rangeKey: "0-7", day: "2026-07-20" },
      BASE
    );
    assert.equal(day20.selectedDetail!.payables.rows.length, 1);
    assert.equal(day20.selectedDetail!.payables.rows[0]!.operationalDate, "2026-07-20");
  });

  it("AP sem agendamento usa vencimento oficial", () => {
    const row = ap13335Row();
    const mapped = buildFinanceCashFlowDailyRadar(
      [],
      [row],
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    ).selectedDetail!.payables.rows[0]!;
    assert.equal(mapped.fonteDataFluxo, "vencimento");
    assert.equal(mapped.dataUsadaNoFluxo, mapped.vencimentoOficial);
  });

  it("AP com agendamento posterior mantém vencimento no fluxo", () => {
    const row = ap13335Row();
    row.scheduleDate = prismaDate("2026-07-25");
    const mapped = buildFinanceCashFlowDailyRadar(
      [],
      [row],
      { baseDate: BASE, rangeKey: "0-7", day: "2026-07-20" },
      BASE
    ).selectedDetail!.payables.rows[0]!;
    assert.equal(mapped.fonteDataFluxo, "vencimento");
    assert.equal(mapped.dataUsadaNoFluxo, "2026-07-20");
    assert.equal(mapped.operationalDate, "2026-07-20");
    assert.equal(mapped.dataAgendada, "2026-07-25");
  });

  it("exportação Excel/PDF usa a mesma data civil corrigida", () => {
    const row = ap13335Row();
    const query = parseDailyRadarExportQuery({
      baseDate: "2026-07-15",
      range: "0-7",
      day: "2026-07-20",
    });
    const payload = buildFinanceCashFlowDailyRadarExportPayload(
      [],
      [row],
      query,
      { userName: "Paulo" },
      BASE
    );
    assert.equal(payload.payables.rows[0]?.operationalDate, "2026-07-20");
    assert.equal(payload.selectedDate, "2026-07-20");
  });

  it("agrupamento e exibição usam o mesmo dateKey", () => {
    const row = ap13335Row();
    const payload = buildFinanceCashFlowDailyRadar(
      [],
      [row],
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    const dayCard = payload.selectedRange!.days.find((d) => d.date === "2026-07-20");
    assert.ok(dayCard);
    assert.equal(dayCard!.payableCount, 1);
    assert.equal(payload.selectedDetail!.payables.rows[0]!.operationalDate, dayCard!.date);
  });
});
