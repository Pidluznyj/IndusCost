/**
 * Previsão de comissões — a comissão futura é a parte vinculada ao saldo AINDA
 * EM ABERTO do título. Regressão do defeito em que a previsão era
 * "atribuída − realizada pelos eventos de recebimento" e inflava quando o saldo
 * real do CR era menor do que os eventos deixavam supor.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  computeCommissionReleasedFromReceivablePrincipal,
  computeReleasedAmountForReceivable,
  resolveReceivableCommissionPrincipal,
} from "./commission-money.shared.js";
import {
  buildCommissionPortfolioOutlook,
  outlookInvariantsHold,
  type OutlookLine,
  type OutlookQuery,
  type OutlookReceiptInput,
  type OutlookScheduleInput,
  type OutlookTitleFacts,
} from "./commissionPortfolioOutlook.js";
import {
  auditCommissionPortfolioOutlook,
  buildOutlookAuditCsv,
  formatOutlookAuditReport,
  OUTLOOK_AUDIT_CAUSES,
} from "./commissionPortfolioOutlookAudit.js";
import {
  buildReceivableStatusMatrix,
  formatReceivableStatusMatrix,
  type ReceivableStatusAuditRow,
} from "./nomusReceivableStatusAudit.js";
import { parseCommissionPortfolioOutlookQuery, resolveOutlookOpenBalance } from "./commissionPortfolioOutlook.server.js";
import {
  forecastCommissionFromMaterializedSchedule,
  pickMaterializedScheduleForReceivable,
  resolveOpenReceivableBalance,
  type MaterializedReceivableScheduleInput,
} from "./commissionReceiptEngine.js";
import { resolveCommissionAccessScope } from "./commissionAccessScope.js";
import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";

const TODAY = "2026-09-28";
const HERE = path.dirname(fileURLToPath(import.meta.url));

function query(partial: Partial<OutlookQuery> = {}): OutlookQuery {
  return {
    fromMonth: null,
    toMonth: null,
    canonicalSellerId: null,
    customerId: null,
    orderCode: null,
    status: null,
    page: 1,
    pageSize: 50,
    ownNomusSellerId: null,
    sellerLocked: false,
    ...partial,
  };
}

/** CR de R$ 10.000 com R$ 300 de comissão, vencendo em outubro/2026. */
function cr(partial: Partial<OutlookScheduleInput> & Pick<OutlookScheduleInput, "scheduleId">): OutlookScheduleInput {
  return {
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    salesOrderId: "so-1",
    orderCode: "PV-1",
    customerId: "c-1",
    customerName: "Cliente",
    canonicalSellerId: "seller-1",
    canonicalSellerName: "Vendedor do pedido",
    rawSellerId: 10,
    sellerResolutionStatus: "RESOLVED",
    nfeNumber: "100",
    receivableId: 1,
    receivableCode: "CR-1",
    installmentNumber: 1,
    dueDate: "2026-10-15",
    nominalAmount: 10_000,
    allocatedCommission: 300,
    sharePercent: 100,
    balanceReceivable: 10_000,
    amountReceivedOnTitle: 0,
    paidToSellerAmount: 0,
    receipts: [],
    ...partial,
  };
}

function receipt(externalId: number, receiptDate: string, receivedAmount: number): OutlookReceiptInput {
  return { externalId, receiptDate, receivedAmount, coverageSource: null, coveredCommissionAmount: null };
}

function only(fact: OutlookScheduleInput): OutlookLine {
  const payload = buildCommissionPortfolioOutlook([fact], query(), TODAY);
  const line = payload.lines[0]!;
  assert.equal(outlookInvariantsHold(line), true, "invariantes da linha");
  return line;
}

/** Regra antiga (defeito): atribuída − realizada pelos eventos, sem olhar o saldo do título. */
function legacyForecast(line: OutlookLine): number {
  return Math.round((line.allocatedCommission - line.realizedCommission) * 100) / 100;
}

describe("comissão futura segue o saldo em aberto do título", () => {
  it("1. CR integralmente em aberto: futuro = comissão atribuída", () => {
    const line = only(cr({ scheduleId: "s" }));
    assert.equal(line.forecastCommission, 300);
    assert.equal(line.realizedCommission, 0);
    assert.equal(line.unreconciledCommission, 0);
    assert.equal(line.status, "PREVISTA");
  });

  it("2. CR parcialmente recebido (saldo 6.000): futuro = 180", () => {
    const line = only(cr({ scheduleId: "s", balanceReceivable: 6_000, receipts: [receipt(1, "2026-09-10", 4_000)] }));
    assert.equal(line.realizedCommission, 120);
    assert.equal(line.forecastCommission, 180);
    assert.equal(line.unreconciledCommission, 0);
    assert.equal(line.status, "PARCIALMENTE_RECEBIDA");
  });

  it("3. CR quase quitado (saldo 2.000): futuro = 60", () => {
    const line = only(cr({ scheduleId: "s", balanceReceivable: 2_000, receipts: [receipt(1, "2026-09-10", 8_000)] }));
    assert.equal(line.realizedCommission, 240);
    assert.equal(line.forecastCommission, 60);
  });

  it("4. CR quitado: futuro = 0", () => {
    const line = only(cr({ scheduleId: "s", balanceReceivable: 0, receipts: [receipt(1, "2026-09-10", 10_000)] }));
    assert.equal(line.realizedCommission, 300);
    assert.equal(line.forecastCommission, 0);
    assert.equal(line.unreconciledCommission, 0);
  });

  it("5. REGRESSÃO: eventos de recebimento incompletos não inflam o futuro; vale o saldo oficial", () => {
    // Saldo real 2.000, mas só 5.000 em eventos sincronizados (faltam 3.000 de eventos).
    const line = only(cr({ scheduleId: "s", balanceReceivable: 2_000, receipts: [receipt(1, "2026-09-10", 5_000)] }));
    assert.equal(legacyForecast(line), 150, "a regra antiga mostraria 150");
    assert.equal(line.forecastCommission, 60, "pelo saldo real só existem 60 de comissão futura");
    assert.equal(line.realizedCommission, 150, "não inventa recebimento que não tem evento");
    assert.equal(line.unreconciledCommission, 90);
    assert.match(line.inconsistency ?? "", /fora da previsão/);
  });

  it("6. recebimentos acima do original (juros/multa): comissão nunca passa da atribuída", () => {
    const line = only(cr({ scheduleId: "s", balanceReceivable: 0, receipts: [receipt(1, "2026-09-10", 10_500)] }));
    assert.equal(line.realizedCommission, 300);
    assert.equal(line.forecastCommission, 0);
    assert.equal(line.receipts[0]?.excessAmount, 500);
  });

  it("7. pagamento parcial com juros: o realizado segue a regra atual do principal e o futuro fecha no teto", () => {
    // 5.300 recebidos (5.000 de principal + 300 de juros); o título ainda deve 5.000.
    const line = only(cr({ scheduleId: "s", balanceReceivable: 5_000, receipts: [receipt(1, "2026-09-10", 5_300)] }));
    assert.equal(line.realizedCommission, 159);
    assert.equal(line.forecastCommission, 141);
    assert.equal(line.realizedCommission + line.forecastCommission, 300);
    assert.equal(line.unreconciledCommission, 0);
  });

  it("7b. saldo do título acima do nominal (juros no saldo) não aumenta a comissão", () => {
    const line = only(cr({ scheduleId: "s", balanceReceivable: 10_800 }));
    assert.equal(line.openPrincipal, 10_000);
    assert.equal(line.forecastCommission, 300);
    const negative = only(cr({ scheduleId: "s", balanceReceivable: -50, receipts: [receipt(1, "2026-09-10", 10_000)] }));
    assert.equal(negative.openPrincipal, 0);
    assert.equal(negative.forecastCommission, 0);
  });

  it("8. desconto/abatimento: título quitado por menos não deixa comissão futura (regra canônica do principal)", () => {
    const line = only(cr({ scheduleId: "s", balanceReceivable: 0, receipts: [receipt(1, "2026-09-10", 9_500)] }));
    // Mesma proporção usada na liberação oficial: min(recebido, original) / original.
    assert.equal(
      line.realizedCommission,
      computeCommissionReleasedFromReceivablePrincipal({ commissionExpectedAmount: 300, receivableOriginalAmount: 10_000, receivedAmount: 9_500 })
    );
    assert.equal(line.realizedCommission, 285);
    assert.equal(line.forecastCommission, 0);
    assert.equal(line.unreconciledCommission, 15);
    assert.deepEqual(
      resolveReceivableCommissionPrincipal({ receivableOriginalAmount: 10_000, receivedAmount: 9_500, openBalance: 0 }).auditFlags,
      ["RECEIVABLE_DISCOUNT_DETECTED"]
    );
  });

  it("9. título baixado sem evento de recebimento: não inventa recebimento nem comissão futura", () => {
    for (const amountReceivedOnTitle of [10_000, 0, null]) {
      const line = only(cr({ scheduleId: "s", balanceReceivable: 0, amountReceivedOnTitle }));
      assert.equal(line.forecastCommission, 0, `amountReceived=${amountReceivedOnTitle}`);
      assert.equal(line.realizedCommission, 0);
      assert.equal(line.status, "INCONSISTENCIA_SEM_RECEBIMENTO");
      assert.match(line.inconsistency ?? "", /sem evento de recebimento/);
    }
  });

  it("10. CR sem registro no contas a receber: futuro 0, motivo visível, nada entra nos totais", () => {
    const payload = buildCommissionPortfolioOutlook(
      [cr({ scheduleId: "s", balanceReceivable: null, amountReceivedOnTitle: null, dueDate: "2026-10-15" })],
      query(),
      TODAY
    );
    const line = payload.lines[0]!;
    assert.equal(line.openPrincipal, null);
    assert.equal(line.forecastCommission, 0);
    assert.equal(line.unreconciledCommission, 300);
    assert.match(line.inconsistency ?? "", /não encontrado/);
    assert.equal(line.status, "TITULO_NAO_ENCONTRADO");
    assert.equal(payload.cards.forecast, 0);
    assert.equal(payload.cards.unreconciled, 300);
    assert.equal(outlookInvariantsHold(line), true);
  });

  it("11. schedule CUSTOMER_EXCLUDED: futuro = 0", () => {
    const line = only(cr({ scheduleId: "s", scheduleStatus: "CUSTOMER_EXCLUDED" }));
    assert.equal(line.forecastCommission, 0);
    assert.equal(line.status, "CUSTOMER_EXCLUDED");
  });

  it("12. schedule stale/superseded/cancelado/orphan fica fora", () => {
    for (const scheduleStatus of ["STALE", "SUPERSEDED", "CANCELLED", "ORPHAN"]) {
      const line = only(cr({ scheduleId: "s", scheduleStatus }));
      assert.equal(line.forecastCommission, 0, scheduleStatus);
      assert.equal(line.allocatedCommission, 0, scheduleStatus);
      assert.equal(line.status, "CANCELADA", scheduleStatus);
    }
  });

  it("13. vendedor ausente ou não resolvido não recebe comissão futura", () => {
    for (const partial of [
      { sellerResolutionStatus: "NO_SELLER" },
      { sellerResolutionStatus: "SELLER_UNRESOLVED" },
      { canonicalSellerId: null, rawSellerId: null },
    ]) {
      const line = only(cr({ scheduleId: "s", ...partial }));
      assert.equal(line.forecastCommission, 0);
      assert.equal(line.status, "SEM_VENDEDOR");
    }
  });

  it("14 e 15. várias parcelas do mesmo pedido: a soma do futuro é a comissão econômica restante, sem duplicar", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        cr({ scheduleId: "p1", receivableId: 1, installmentNumber: 1, dueDate: "2026-09-10", balanceReceivable: 0, receipts: [receipt(1, "2026-09-10", 10_000)] }),
        cr({ scheduleId: "p2", receivableId: 2, installmentNumber: 2, dueDate: "2026-10-10", balanceReceivable: 5_000, receipts: [receipt(2, "2026-09-20", 5_000)] }),
        cr({ scheduleId: "p3", receivableId: 3, installmentNumber: 3, dueDate: "2026-11-10" }),
      ],
      query(),
      TODAY
    );
    assert.deepEqual(payload.lines.map((line) => line.forecastCommission), [0, 150, 300]);
    assert.equal(payload.cards.forecast, 450);
    assert.equal(payload.cards.realized, 450);
    // Pedido de 900 de comissão: 450 já realizados + 450 ainda a receber.
    assert.equal(payload.lines.reduce((sum, line) => sum + line.allocatedCommission, 0), 900);
    // O mesmo evento repetido não realiza duas vezes nem muda o futuro.
    const duplicated = only(cr({ scheduleId: "d", balanceReceivable: 6_000, receipts: [receipt(7, "2026-09-10", 4_000), receipt(7, "2026-09-10", 4_000)] }));
    assert.equal(duplicated.realizedCommission, 120);
    assert.equal(duplicated.forecastCommission, 180);
  });

  it("16. recebimento parcial em setembro e saldo vencendo em outubro: realizado em setembro, futuro só em outubro", () => {
    const payload = buildCommissionPortfolioOutlook(
      [cr({ scheduleId: "s", dueDate: "2026-10-15", balanceReceivable: 6_000, receipts: [receipt(1, "2026-09-10", 4_000)] })],
      query(),
      TODAY
    );
    const september = payload.months.find((row) => row.month === "2026-09");
    const october = payload.months.find((row) => row.month === "2026-10");
    assert.deepEqual([september?.realized, september?.forecast], [120, 0]);
    assert.deepEqual([october?.realized, october?.forecast], [0, 180]);
  });

  it("17. realizada + futura nunca ultrapassa a atribuída, para qualquer combinação de saldo e recebimentos", () => {
    const balances = [null, -10, 0, 0.01, 1_999.99, 2_000, 5_000, 9_999.99, 10_000, 12_345.67];
    const receiptSets = [[], [4_000], [5_000, 3_000], [10_000], [10_500], [3_333.33, 3_333.33, 3_333.34], [0.01], [9_999.99]];
    const commissions = [0, 0.01, 299.99, 300, 1_234.56];
    for (const balanceReceivable of balances) {
      for (const amounts of receiptSets) {
        for (const allocatedCommission of commissions) {
          const line = buildCommissionPortfolioOutlook(
            [cr({ scheduleId: "s", balanceReceivable, allocatedCommission, receipts: amounts.map((amount, index) => receipt(index + 1, "2026-09-10", amount)) })],
            query(),
            TODAY
          ).lines[0]!;
          const label = JSON.stringify({ balanceReceivable, amounts, allocatedCommission });
          assert.equal(outlookInvariantsHold(line), true, label);
          assert.ok(line.forecastCommission >= 0 && line.forecastCommission <= line.allocatedCommission, label);
          assert.ok(line.realizedCommission >= 0 && line.realizedCommission <= line.allocatedCommission, label);
          assert.ok(line.realizedCommission + line.forecastCommission <= line.allocatedCommission + 0.001, label);
          if (!balanceReceivable || balanceReceivable <= 0) assert.equal(line.forecastCommission, 0, label);
        }
      }
    }
  });
});

describe("cards, timeline, filtros e período da previsão", () => {
  const globalScope = resolveCommissionAccessScope({
    id: "u",
    name: "Admin",
    email: "a@example.com",
    role: "SUPER_ADMIN",
    permissions: [],
    externalSellerId: null,
    sellerResponsibleName: null,
  } as AppAuthContext);

  const facts: OutlookScheduleInput[] = [
    cr({ scheduleId: "a1", receivableId: 1, orderCode: "PV-100", canonicalSellerId: "ana", rawSellerId: 1, dueDate: "2026-09-20", balanceReceivable: 0, receipts: [receipt(1, "2026-09-18", 10_000)] }),
    cr({ scheduleId: "a2", receivableId: 2, orderCode: "PV-100", canonicalSellerId: "ana", rawSellerId: 1, dueDate: "2026-10-20", balanceReceivable: 6_000, receipts: [receipt(2, "2026-09-25", 4_000)] }),
    cr({ scheduleId: "a3", receivableId: 3, orderCode: "PV-101", canonicalSellerId: "ana", rawSellerId: 1, dueDate: "2026-09-05" }),
    cr({ scheduleId: "b1", receivableId: 4, orderCode: "PV-200", canonicalSellerId: "bia", rawSellerId: 2, dueDate: "2026-11-10" }),
    cr({ scheduleId: "b2", receivableId: 5, orderCode: "PV-200", canonicalSellerId: "bia", rawSellerId: 2, dueDate: "2026-11-25", balanceReceivable: 2_000, receipts: [receipt(5, "2026-09-02", 5_000)] }),
    // Vencido em julho e ainda em aberto: histórico anterior à previsão.
    cr({ scheduleId: "old", receivableId: 6, orderCode: "PV-050", canonicalSellerId: "ana", rawSellerId: 1, dueDate: "2026-07-10" }),
  ];
  const serverQuery = (raw: Record<string, unknown> = {}) => ({ ...parseCommissionPortfolioOutlookQuery(raw, globalScope), pageSize: 50 });

  it("18. não existe mais \"Total esperado\": realizado e futuro não são somados no payload nem na tela", () => {
    const payload = buildCommissionPortfolioOutlook(facts, serverQuery(), TODAY);
    assert.equal("expected" in payload.cards, false);
    assert.equal(payload.months.every((month) => !("expected" in month)), true);
    const page = readFileSync(path.join(HERE, "../../components/commissions/pages/CommissionsPortfolioOutlookPage.tsx"), "utf8");
    assert.doesNotMatch(page, /Total esperado/i);
    assert.doesNotMatch(page, /Realizado \+ previsto/i);
    assert.doesNotMatch(page, /\.expected\b/);
    assert.match(page, /label="Comissão ainda a receber"/);
    assert.match(page, /Realizada aguardando fechamento/);
    assert.match(page, /Liberada e ainda não paga/);
    assert.match(page, /Vencida e não recebida/);
    // O card principal mostra só o futuro.
    assert.match(page, /label="Comissão ainda a receber"\s+amount=\{cards\?\.forecast \?\? 0\}/);
  });

  it("19. a timeline mensal e os cards fecham exatamente com a soma do detalhe", () => {
    const payload = buildCommissionPortfolioOutlook(facts, serverQuery(), TODAY);
    const byMonth = new Map<string, number>();
    for (const line of payload.lines) {
      if (line.forecastCommission > 0 && line.dueMonth) {
        byMonth.set(line.dueMonth, (byMonth.get(line.dueMonth) ?? 0) + line.forecastCommission);
      }
    }
    for (const month of payload.months) {
      assert.equal(month.forecast, byMonth.get(month.month) ?? 0, month.month);
    }
    const total = payload.lines.reduce((sum, line) => sum + line.forecastCommission, 0);
    assert.equal(payload.cards.forecast, total);
    assert.equal(payload.months.reduce((sum, month) => sum + month.forecast, 0), total);
    // a2 = 180 (out), a3 = 300 (set, vencido), b1 = 300 (nov), b2 = 60 (nov; regra antiga daria 150).
    assert.equal(payload.cards.forecast, 840);
    assert.equal(payload.cards.overdueForecast, 300);
    assert.equal(payload.cards.unreconciled, 90);
    assert.deepEqual(
      payload.months.map((month) => [month.month, month.forecast]),
      [["2026-09", 300], ["2026-10", 180], ["2026-11", 360]]
    );
  });

  it("20. filtro por vendedor mantém os valores do vendedor", () => {
    const ana = buildCommissionPortfolioOutlook(facts, { ...serverQuery(), canonicalSellerId: "ana" }, TODAY);
    const bia = buildCommissionPortfolioOutlook(facts, { ...serverQuery(), canonicalSellerId: "bia" }, TODAY);
    const all = buildCommissionPortfolioOutlook(facts, serverQuery(), TODAY);
    assert.equal(ana.cards.forecast, 480);
    assert.equal(bia.cards.forecast, 360);
    assert.equal(ana.cards.forecast + bia.cards.forecast, all.cards.forecast);
    // Vendedor logado só enxerga a própria carteira.
    const own = buildCommissionPortfolioOutlook(facts, { ...serverQuery(), ownNomusSellerId: 2 }, TODAY);
    assert.equal(own.cards.forecast, 360);
    assert.equal(own.lines.every((line) => line.rawSellerId === 2), true);
  });

  it("21. filtro por pedido mantém os valores do pedido", () => {
    const payload = buildCommissionPortfolioOutlook(facts, { ...serverQuery(), orderCode: "pv-100" }, TODAY);
    assert.deepEqual(payload.lines.map((line) => line.scheduleId), ["a1", "a2"]);
    assert.equal(payload.cards.forecast, 180);
    assert.equal(payload.cards.realized, 420);
  });

  it("22. paginação não altera cards nem totais", () => {
    const whole = buildCommissionPortfolioOutlook(facts, serverQuery(), TODAY);
    const first = buildCommissionPortfolioOutlook(facts, { ...serverQuery(), pageSize: 2, page: 1 }, TODAY);
    const second = buildCommissionPortfolioOutlook(facts, { ...serverQuery(), pageSize: 2, page: 2 }, TODAY);
    assert.equal(first.lines.length, 2);
    assert.deepEqual(first.cards, whole.cards);
    assert.deepEqual(second.cards, whole.cards);
    assert.deepEqual(first.months, whole.months);
    assert.equal(first.totalLines, whole.totalLines);
  });

  it("23 e 24. o período começa em 09/2026 e o que venceu antes continua fora da previsão", () => {
    const payload = buildCommissionPortfolioOutlook(facts, serverQuery({ from: "2026-01" }), TODAY);
    assert.equal(payload.lines.some((line) => line.scheduleId === "old"), false);
    assert.equal(payload.months.every((month) => month.month >= "2026-09"), true);
    // Sem o piso (motor genérico), o título de julho existe e está em aberto.
    const generic = buildCommissionPortfolioOutlook(facts, query(), TODAY);
    assert.equal(generic.lines.find((line) => line.scheduleId === "old")?.forecastCommission, 300);
  });
});

describe("a previsão não toca no fechamento oficial", () => {
  it("nenhum módulo de fechamento, ledger, cobertura ou pagamento importa a previsão", () => {
    const outlookFiles = new Set(["commissionPortfolioOutlook.ts", "commissionPortfolioOutlook.server.ts", "commissionPortfolioOutlookAudit.ts"]);
    const offenders = readdirSync(HERE)
      .filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes(".test.") && !outlookFiles.has(name))
      .filter((name) => /from\s+["'][^"']*commissionPortfolioOutlook/.test(readFileSync(path.join(HERE, name), "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("a regra canônica de liberação pelo principal continua a mesma (valores fixados)", () => {
    const base = { commissionExpectedAmount: 300, receivableOriginalAmount: 10_000 };
    assert.equal(computeCommissionReleasedFromReceivablePrincipal({ ...base, receivedAmount: 0 }), 0);
    assert.equal(computeCommissionReleasedFromReceivablePrincipal({ ...base, receivedAmount: 4_000 }), 120);
    assert.equal(computeCommissionReleasedFromReceivablePrincipal({ ...base, receivedAmount: 10_000 }), 300);
    assert.equal(computeCommissionReleasedFromReceivablePrincipal({ ...base, receivedAmount: 10_500 }), 300);
    assert.equal(computeReleasedAmountForReceivable({ commissionAmount: 300, alreadyReleased: 120, receivableAmount: 10_000, receivedAmount: 8_000 }), 120);
    const breakdown = resolveReceivableCommissionPrincipal({ receivableOriginalAmount: 10_000, receivedAmount: 10_500 });
    assert.equal(breakdown.commissionPrincipalAmount, 10_000);
    assert.equal(breakdown.ignoredFinancialChargesAmount, 500);
  });
});

describe("só a versão vigente do pedido e um schedule por título, como no fechamento", () => {
  it("REGRESSÃO: schedule de snapshot substituído não soma de novo a comissão do título", () => {
    // Pedido rematerializado: a versão antiga ficou SUPERSEDED, mas o schedule dela continua ACTIVE.
    const payload = buildCommissionPortfolioOutlook(
      [
        cr({ scheduleId: "antigo", orderSnapshotStatus: "SUPERSEDED", scheduleCreatedAt: "2026-08-01T10:00:00.000Z" }),
        cr({ scheduleId: "vigente", orderSnapshotStatus: "ACTIVE", scheduleCreatedAt: "2026-09-01T10:00:00.000Z" }),
      ],
      query(),
      TODAY
    );
    assert.equal(payload.cards.forecast, 300, "a regra antiga mostraria 600");
    const old = payload.lines.find((line) => line.scheduleId === "antigo")!;
    assert.equal(old.status, "CANCELADA");
    assert.equal(old.allocatedCommission, 0);
    assert.match(old.inconsistency ?? "", /versão substituída/);
    // Status desconhecido do snapshot pai também não vale (desconhecido = não vigente).
    assert.equal(only(cr({ scheduleId: "s", orderSnapshotStatus: null })).forecastCommission, 0);
  });

  it("dois schedules vigentes para o mesmo título: vale o mais recente (mesma escolha do motor), sem duplicar", () => {
    const schedules = [
      { scheduleId: "a", scheduleStatus: "ACTIVE", orderSnapshotStatus: "ACTIVE", createdAt: "2026-08-01T10:00:00.000Z", allocated: 111 },
      { scheduleId: "b", scheduleStatus: "ACTIVE", orderSnapshotStatus: "ACTIVE", createdAt: "2026-09-01T10:00:00.000Z", allocated: 300 },
      { scheduleId: "c", scheduleStatus: "CUSTOMER_EXCLUDED", orderSnapshotStatus: "ACTIVE", createdAt: "2026-09-15T10:00:00.000Z", allocated: 50 },
    ];
    const payload = buildCommissionPortfolioOutlook(
      schedules.map((row) =>
        cr({ scheduleId: row.scheduleId, scheduleStatus: row.scheduleStatus, orderSnapshotStatus: row.orderSnapshotStatus, scheduleCreatedAt: row.createdAt, allocatedCommission: row.allocated })
      ),
      query(),
      TODAY
    );
    assert.equal(payload.cards.forecast, 300);
    assert.deepEqual(
      payload.lines.map((line) => [line.scheduleId, line.forecastCommission, line.status]),
      [["a", 0, "CANCELADA"], ["b", 300, "PREVISTA"], ["c", 0, "CANCELADA"]]
    );
    // O motor de fechamento escolhe o mesmo schedule.
    const picked = pickMaterializedScheduleForReceivable(
      [...schedules]
        .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
        .map((row) => ({ id: row.scheduleId, scheduleStatus: row.scheduleStatus, orderSnapshotStatus: row.orderSnapshotStatus }) as unknown as MaterializedReceivableScheduleInput)
    );
    assert.equal(picked?.id, "b");
  });

  it("título cancelado ou com cobrança suspensa na origem fica fora, como no fechamento", () => {
    for (const partial of [{ titleCancelled: true }, { titleSuspended: true }]) {
      const line = only(cr({ scheduleId: "s", ...partial, receipts: [receipt(1, "2026-09-10", 4_000)], balanceReceivable: 6_000 }));
      assert.equal(line.forecastCommission, 0);
      assert.equal(line.realizedCommission, 0);
      assert.equal(line.status, "CANCELADA");
      assert.match(line.inconsistency ?? "", /Fica fora do fechamento/);
    }
  });

  it("regra viva de Exceções por cliente e empresa do grupo zeram a comissão mesmo com schedule ACTIVE", () => {
    for (const partial of [{ customerExcludedByActiveRule: true }, { groupCompany: true }]) {
      const line = only(cr({ scheduleId: "s", ...partial, balanceReceivable: 6_000, receipts: [receipt(1, "2026-09-10", 4_000)] }));
      assert.equal(line.forecastCommission, 0);
      assert.equal(line.realizedCommission, 0);
      assert.equal(line.allocatedCommission, 0);
      assert.equal(line.status, "CUSTOMER_EXCLUDED");
      assert.match(line.inconsistency ?? "", /como no fechamento/);
    }
    const loader = readFileSync(path.join(HERE, "commissionPortfolioOutlook.server.ts"), "utf8");
    assert.match(loader, /loadActiveCustomerExclusionRuleSnapshots\(\)/);
    assert.match(loader, /referenceDate: row\.orderSnapshot\.saleDate/);
    assert.match(loader, /isCommissionInternalGroupReceivable\(/);
  });

  it("o loader só busca schedules da versão vigente do pedido", () => {
    const loader = readFileSync(path.join(HERE, "commissionPortfolioOutlook.server.ts"), "utf8");
    assert.match(loader, /options\.includeSupersededSnapshots \? \{\} : commissionActiveSnapshotWhere\(\)/);
    assert.match(loader, /const \{ facts \} = await loadCommissionPortfolioOutlookFacts\(where\);/);
  });
});

describe("a previsão usa a mesma regra de saldo em aberto do motor oficial", () => {
  it("saldo em aberto: igual a resolveOpenReceivableBalance (saldo da origem; sem ele, original − recebido)", () => {
    const cases = [
      { balanceReceivable: 2_000, amountReceivable: 10_000, amountReceived: 8_000 },
      { balanceReceivable: 0, amountReceivable: 10_000, amountReceived: 9_500 },
      { balanceReceivable: -5, amountReceivable: 10_000, amountReceived: 10_000 },
      { balanceReceivable: null, amountReceivable: 10_000, amountReceived: 4_000 },
      { balanceReceivable: null, amountReceivable: 10_000, amountReceived: 10_500 },
    ];
    for (const item of cases) {
      const canonical = resolveOpenReceivableBalance({
        nomusReceivableId: 1,
        settlementDate: null,
        amountReceivable: item.amountReceivable,
        amountReceived: item.amountReceived,
        balanceReceivable: item.balanceReceivable ?? undefined,
      });
      assert.equal(Math.round(resolveOutlookOpenBalance(item) * 100) / 100, canonical, JSON.stringify(item));
    }
  });

  it("comissão futura: igual a forecastCommissionFromMaterializedSchedule quando os recebimentos batem com o saldo", () => {
    for (const balance of [10_000, 6_000, 2_000, 0.01, 0, 12_000]) {
      const line = only(
        cr({
          scheduleId: "s",
          balanceReceivable: balance,
          receipts: balance < 10_000 ? [receipt(1, "2026-09-10", Math.round((10_000 - balance) * 100) / 100)] : [],
        })
      );
      const canonical = forecastCommissionFromMaterializedSchedule({
        schedule: { receivableNominalAmount: 10_000, scheduledCommissionAmount: 300 } as MaterializedReceivableScheduleInput,
        receivable: { nomusReceivableId: 1, settlementDate: null, amountReceivable: 10_000, amountReceived: 0, balanceReceivable: balance },
      });
      assert.ok(Math.abs(line.forecastCommission - canonical.forecastCommissionAmount) <= 0.01, `saldo ${balance}: ${line.forecastCommission} × ${canonical.forecastCommissionAmount}`);
    }
  });
});

describe("auditoria CR a CR: regra antiga × regra nova", () => {
  const title = (partial: Partial<OutlookTitleFacts> = {}): OutlookTitleFacts => ({
    dueDate: "2026-10-15",
    balance: 10_000,
    balanceRaw: 10_000,
    amountReceivable: 10_000,
    amountReceived: 0,
    invoiceNumber: "100",
    settlementDate: null,
    cancelled: false,
    suspended: false,
    sourcePresenceStatus: "PRESENT",
    ...partial,
  });

  // Um CR por causa. Todos de R$ 10.000 com R$ 300 de comissão, vencendo em outubro/2026, salvo indicação.
  const facts = [
    cr({ scheduleId: "ok", receivableId: 1 }),
    cr({ scheduleId: "snapshot-antigo", receivableId: 1, orderSnapshotStatus: "SUPERSEDED", scheduleCreatedAt: "2026-08-01T00:00:00.000Z" }),
    cr({ scheduleId: "duplicado-novo", receivableId: 2, scheduleCreatedAt: "2026-09-02T00:00:00.000Z" }),
    cr({ scheduleId: "duplicado-velho", receivableId: 2, scheduleCreatedAt: "2026-09-01T00:00:00.000Z" }),
    cr({ scheduleId: "excecao", receivableId: 3, customerExcludedByActiveRule: true }),
    cr({ scheduleId: "grupo", receivableId: 4, groupCompany: true }),
    cr({ scheduleId: "cancelado", receivableId: 5, titleCancelled: true }),
    cr({ scheduleId: "suspenso", receivableId: 6, titleSuspended: true }),
    cr({ scheduleId: "removido-na-origem", receivableId: 7, balanceReceivable: null }),
    cr({ scheduleId: "sem-registro", receivableId: 8, balanceReceivable: null, dueDate: null }),
    cr({ scheduleId: "quitado-sem-evento", receivableId: 9, balanceReceivable: 0 }),
    cr({ scheduleId: "receipt-incompleto", receivableId: 10, balanceReceivable: 2_000, receipts: [receipt(10, "2026-09-10", 5_000)] }),
    cr({ scheduleId: "desconto", receivableId: 11, balanceReceivable: 0, receipts: [receipt(11, "2026-09-10", 9_500)] }),
    cr({ scheduleId: "saldo-menor", receivableId: 12, balanceReceivable: 3_000, receipts: [receipt(12, "2026-09-10", 5_000)] }),
    cr({ scheduleId: "vencido-julho", receivableId: 13, dueDate: "2026-07-10" }),
    cr({ scheduleId: "vencido-agosto-parcial", receivableId: 14, dueDate: "2026-08-20", balanceReceivable: 4_000, receipts: [receipt(14, "2026-08-25", 6_000)] }),
    cr({ scheduleId: "quitado-julho", receivableId: 15, dueDate: "2026-07-05", balanceReceivable: 0, receipts: [receipt(15, "2026-07-06", 10_000)] }),
  ];
  const titles = new Map<number, OutlookTitleFacts>([
    [1, title()],
    [2, title()],
    [3, title()],
    [4, title({ groupCompany: true })],
    [5, title({ cancelled: true })],
    [6, title({ suspended: true })],
    [7, title({ balance: null, sourcePresenceStatus: "MISSING_CONFIRMED" })],
    [9, title({ balance: 0, balanceRaw: 0, amountReceived: 0 })],
    [10, title({ balance: 2_000, balanceRaw: 2_000, amountReceived: 8_000 })],
    [11, title({ balance: 0, balanceRaw: 0, amountReceived: 9_500 })],
    [12, title({ balance: 3_000, balanceRaw: 3_000, amountReceived: 5_000 })],
    [13, title({ dueDate: "2026-07-10" })],
    [14, title({ dueDate: "2026-08-20", balance: 4_000, balanceRaw: 4_000, amountReceived: 6_000 })],
    [15, title({ dueDate: "2026-07-05", balance: 0, balanceRaw: 0, amountReceived: 10_000 })],
  ]);
  const audit = auditCommissionPortfolioOutlook(facts, titles, { fromMonth: "2026-09", toMonth: null, today: TODAY });
  const causeOf = (scheduleId: string) => audit.rows.find((row) => row.fact.scheduleId === scheduleId)?.cause ?? null;

  it("classifica cada CR divergente pela causa objetiva", () => {
    assert.deepEqual(
      audit.rows.filter((row) => row.cause).map((row) => [row.fact.scheduleId, row.cause, row.titleDifference]),
      [
        ["snapshot-antigo", "SNAPSHOT_SUBSTITUIDO", 300],
        ["duplicado-velho", "SCHEDULE_DUPLICADO", 300],
        ["excecao", "EXCLUSAO_CLIENTE", 300],
        ["grupo", "EMPRESA_GRUPO", 300],
        ["cancelado", "CANCELADO", 300],
        ["suspenso", "COBRANCA_SUSPENSA", 300],
        ["removido-na-origem", "TITULO_NAO_ENCONTRADO", 300],
        ["sem-registro", "TITULO_NAO_ENCONTRADO", 300],
        ["quitado-sem-evento", "TITULO_QUITADO", 300],
        ["receipt-incompleto", "RECEIPT_INCOMPLETO", 90],
        ["desconto", "DESCONTO_ABATIMENTO", 15],
        ["saldo-menor", "SALDO_REAL_MENOR", 60],
      ]
    );
    assert.equal(causeOf("ok"), null);
    assert.equal(causeOf("duplicado-novo"), null);
    // Todas as causas pedidas existem no catálogo.
    for (const cause of ["SNAPSHOT_SUBSTITUIDO", "SALDO_REAL_MENOR", "RECEIPT_INCOMPLETO", "TITULO_QUITADO", "DESCONTO_ABATIMENTO", "CANCELADO", "COBRANCA_SUSPENSA", "EXCLUSAO_CLIENTE", "EMPRESA_GRUPO", "SCHEDULE_DUPLICADO", "TITULO_NAO_ENCONTRADO", "OUTRO"]) {
      assert.ok((OUTLOOK_AUDIT_CAUSES as readonly string[]).includes(cause), cause);
    }
  });

  it("fecha a conciliação: antiga − nova = diferença removida = soma das causas, com a não explicada visível", () => {
    const { reconciliation } = audit;
    // No período (venc. a partir de 09/2026): 10 CRs sem evento × 300 + 150 + 15 + 150 dos parcialmente recebidos.
    assert.equal(reconciliation.legacyForecastTotal, 3_315);
    // ok 300 + duplicado-novo 300 + receipt-incompleto 60 + saldo-menor 90.
    assert.equal(reconciliation.newForecastTotal, 750);
    assert.equal(reconciliation.newForecastTotal, audit.cards.forecast, "o total novo é o card da tela");
    assert.equal(reconciliation.removedDifference, 2_565);
    assert.equal(reconciliation.legacyForecastTotal - reconciliation.newForecastTotal, reconciliation.removedDifference);
    assert.equal(reconciliation.byCause.reduce((sum, entry) => sum + entry.difference, 0), reconciliation.removedDifference);
    assert.equal(reconciliation.explainedDifference, 2_565);
    assert.equal(reconciliation.unexplainedDifference, 0);
    assert.equal(reconciliation.balanced, true);
    assert.deepEqual(
      reconciliation.byCause.map((entry) => [entry.cause, entry.count, entry.difference]),
      [
        ["SNAPSHOT_SUBSTITUIDO", 1, 300],
        ["SCHEDULE_DUPLICADO", 1, 300],
        ["EXCLUSAO_CLIENTE", 1, 300],
        ["EMPRESA_GRUPO", 1, 300],
        ["CANCELADO", 1, 300],
        ["COBRANCA_SUSPENSA", 1, 300],
        // "sem-registro" não tem vencimento: a regra antiga também não o somava no período.
        ["TITULO_NAO_ENCONTRADO", 1, 300],
        ["TITULO_QUITADO", 1, 300],
        ["RECEIPT_INCOMPLETO", 1, 90],
        ["DESCONTO_ABATIMENTO", 1, 15],
        ["SALDO_REAL_MENOR", 1, 60],
      ]
    );
    assert.equal(audit.rows.reduce((sum, row) => sum + row.difference, 0), reconciliation.removedDifference);
  });

  it("título não encontrado sai do total, mas aparece como pendência de dados com a comissão potencial", () => {
    assert.deepEqual(audit.dataPending, { count: 2, potentialCommission: 600, inPeriodPotentialCommission: 300 });
    const pending = audit.rows.filter((row) => row.dataPending);
    assert.deepEqual(pending.map((row) => [row.fact.scheduleId, row.line.forecastCommission, row.pendingPotentialCommission]), [
      ["removido-na-origem", 0, 300],
      ["sem-registro", 0, 300],
    ]);
  });

  it("vencidos antes de 09/2026 ainda em aberto ficam separados da previsão mensal e entram no saldo gerencial", () => {
    assert.deepEqual(audit.overdueBeforePeriod, { count: 2, openPrincipal: 14_000, forecast: 420, legacyForecast: 420 });
    assert.deepEqual(
      audit.months.map((month) => [month.month, month.forecast]),
      [["2026-09", 0], ["2026-10", 750]]
    );
    assert.equal(audit.managerialOpenCommission, 750 + 420);
    // Quitado em julho não é pendência econômica.
    assert.equal(audit.rows.find((row) => row.fact.scheduleId === "quitado-julho")?.line.forecastCommission, 0);
  });

  it("relatório e CSV trazem a conciliação e todos os campos do CR divergente", () => {
    const report = formatOutlookAuditReport(audit, { today: TODAY, fromMonth: "2026-09", toMonth: null, seller: null, totalSchedules: facts.length, top: 40 }).join("\n");
    assert.match(report, /PREVISÃO REGRA ANTIGA/);
    assert.match(report, /− PREVISÃO REGRA NOVA/);
    assert.match(report, /= DIFERENÇA REMOVIDA/);
    assert.match(report, /SOMA DAS CAUSAS/);
    assert.match(report, /DIFERENÇA NÃO EXPLICADA \(OUTRO\)/);
    assert.match(report, /PASS: soma das causas = diferença removida/);
    assert.match(report, /PENDÊNCIA DE DADOS \/ NÃO CONCILIADO/);
    assert.match(report, /VENCIDOS ANTES DE 2026-09 AINDA EM ABERTO/);
    assert.match(report, /SALDO GERENCIAL/);
    assert.match(report, /schedule receipt-incompleto · snapshot vigente \(ACTIVE\) · atribuída 300,00 · antiga 150,00 · nova 60,00 · diferença 90,00 · causa RECEIPT_INCOMPLETO/);
    assert.match(report, /original 10000,00 · balanceReceivable 2000,00 · amountReceived 8000,00 · Σ receipts 5000,00/);
    assert.match(report, /schedule snapshot-antigo · snapshot substituído \(SUPERSEDED\)/);

    const csv = buildOutlookAuditCsv(audit).split("\r\n");
    const header = csv[0]!.replace("\uFEFF", "").split(";");
    for (const column of ["vendedor", "pedido", "nf", "cr", "parcela", "vencimento", "valor_original", "balance_receivable", "amount_received_titulo", "soma_receipts", "schedule_id", "snapshot_pv", "comissao_atribuida", "previsao_antiga", "previsao_nova", "diferenca_titulo", "causa", "pendencia_de_dados", "vencido_antes_do_periodo"]) {
      assert.ok(header.includes(column), column);
    }
    assert.equal(csv.filter((line) => line.trim()).length, facts.length + 1);
  });

  it("conciliação que não fecha é reportada como FAIL, nunca escondida", () => {
    const broken = { ...audit, reconciliation: { ...audit.reconciliation, unexplainedDifference: 12.34, balanced: false } };
    const report = formatOutlookAuditReport(broken, { today: TODAY, fromMonth: "2026-09", toMonth: null, seller: null, totalSchedules: facts.length, top: 5 }).join("\n");
    assert.match(report, /FAIL: soma das causas ≠ diferença removida/);
  });
});

describe("status do título no Nomus é baixa, não cancelamento (auditoria real de 30/09/2026)", () => {
  it("REGRESSÃO: o loader não deriva cancelamento de NomusAccountsReceivable.status", () => {
    const loader = readFileSync(path.join(HERE, "commissionPortfolioOutlook.server.ts"), "utf8");
    assert.doesNotMatch(loader, /cancelled:\s*row\.status/);
    assert.doesNotMatch(loader, /status === false/);
    assert.match(loader, /cancelled: false,/);
    assert.match(loader, /nomusStatus: row\.status,/);
    // O saldo desconhecido continua vindo só da ausência confirmada na origem.
    assert.match(loader, /isNomusSourceOperationallyPresent\(row\.sourcePresenceStatus\)/);
  });

  it("CR com status=false, saldo integral e nenhum recebimento é comissão a receber (PD 02396 / PD 02838)", () => {
    const openTitle = (partial: Partial<OutlookTitleFacts>): OutlookTitleFacts => ({
      dueDate: "2026-10-22",
      balance: 98_000,
      balanceRaw: 98_000,
      amountReceivable: 98_000,
      amountReceived: 0,
      invoiceNumber: "7434",
      settlementDate: null,
      cancelled: false,
      nomusStatus: false,
      suspended: false,
      sourcePresenceStatus: "PRESENT",
      ...partial,
    });
    const facts = [
      cr({ scheduleId: "pd-02396", receivableId: 7434, orderCode: "PD 02396", dueDate: "2026-10-22", nominalAmount: 98_000, balanceReceivable: 98_000, allocatedCommission: 2_036.32 }),
      cr({ scheduleId: "pd-02838", receivableId: 7651, orderCode: "PD 02838", installmentNumber: 3, dueDate: "2026-10-01", nominalAmount: 12_240, balanceReceivable: 12_240, allocatedCommission: 456.26 }),
      // Snapshot substituído continua fora: é a causa real encontrada na auditoria.
      cr({ scheduleId: "pd-02396-antigo", receivableId: 7434, orderCode: "PD 02396", orderSnapshotStatus: "SUPERSEDED", dueDate: "2026-10-22", nominalAmount: 98_000, balanceReceivable: 98_000, allocatedCommission: 2_036.32 }),
    ];
    const titles = new Map<number, OutlookTitleFacts>([
      [7434, openTitle({})],
      [7651, openTitle({ dueDate: "2026-10-01", balance: 12_240, balanceRaw: 12_240, amountReceivable: 12_240, invoiceNumber: "7651" })],
    ]);
    const audit = auditCommissionPortfolioOutlook(facts, titles, { fromMonth: "2026-09", toMonth: null, today: TODAY });
    assert.equal(audit.reconciliation.newForecastTotal, 2_492.58);
    assert.equal(audit.reconciliation.legacyForecastTotal, 4_528.9);
    assert.deepEqual(
      audit.reconciliation.byCause.map((entry) => [entry.cause, entry.count, entry.difference]),
      [["SNAPSHOT_SUBSTITUIDO", 1, 2_036.32]]
    );
    assert.equal(audit.reconciliation.balanced, true);
    assert.equal(audit.rows.some((row) => row.cause === "CANCELADO"), false);
    const csv = buildOutlookAuditCsv(audit);
    assert.ok(csv.split("\r\n")[0]!.includes("status_nomus"));
    assert.match(formatOutlookAuditReport(audit, { today: TODAY, fromMonth: "2026-09", toMonth: null, seller: null, totalSchedules: 3, top: 5 }).join("\n"), /status Nomus false/);
  });

  it("matriz do status: false com saldo em aberto e true sem saldo → o campo descreve baixa", () => {
    const row = (externalId: number, partial: Partial<ReceivableStatusAuditRow>): ReceivableStatusAuditRow => ({
      externalId,
      status: false,
      suspendCollection: false,
      sourcePresenceStatus: "PRESENT",
      amountReceivable: 1_000,
      amountReceived: 0,
      balanceReceivable: 1_000,
      settlementDate: null,
      dueDate: "2026-10-10",
      receiptCount: 0,
      ...partial,
    });
    const matrix = buildReceivableStatusMatrix([
      row(1, {}),
      row(2, {}),
      row(3, { amountReceived: 400, balanceReceivable: 600, receiptCount: 1 }),
      row(4, { status: true, amountReceived: 1_000, balanceReceivable: 0, settlementDate: "2026-09-10", receiptCount: 1 }),
      row(5, { status: true, amountReceived: 1_000, balanceReceivable: 0, settlementDate: "2026-09-12", receiptCount: 2 }),
      row(6, { status: null }),
    ]);
    const [falseBucket, trueBucket, nullBucket] = matrix.buckets;
    assert.deepEqual(
      [falseBucket!.titles, falseBucket!.balancePositive, falseBucket!.fullyOpen, falseBucket!.partiallyReceived, falseBucket!.openBalanceTotal],
      [3, 3, 2, 1, 2_600]
    );
    assert.deepEqual([trueBucket!.titles, trueBucket!.balanceZeroOrLess, trueBucket!.settled, trueBucket!.withSettlementDate, trueBucket!.withReceipt], [2, 2, 2, 2, 2]);
    assert.equal(nullBucket!.titles, 1);
    assert.deepEqual(falseBucket!.examples.fullyOpen, [1, 2]);
    assert.equal(matrix.verdict, "FALSE_MEANS_OPEN");
    assert.match(formatReceivableStatusMatrix(matrix).join("\n"), /true = baixado, false = em aberto/);
  });

  it("matriz do status: dados misturados não viram conclusão", () => {
    const base = { suspendCollection: false, sourcePresenceStatus: "PRESENT", amountReceivable: 100, dueDate: null, receiptCount: 0 };
    const matrix = buildReceivableStatusMatrix([
      { ...base, externalId: 1, status: false, amountReceived: 0, balanceReceivable: 100, settlementDate: null },
      { ...base, externalId: 2, status: false, amountReceived: 100, balanceReceivable: 0, settlementDate: "2026-09-01" },
      { ...base, externalId: 3, status: true, amountReceived: 0, balanceReceivable: 100, settlementDate: null },
      { ...base, externalId: 4, status: true, amountReceived: 100, balanceReceivable: 0, settlementDate: "2026-09-01" },
    ]);
    assert.equal(matrix.verdict, "INCONCLUSIVE");
  });
});
