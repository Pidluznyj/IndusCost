import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { allocateProportional } from "./commission-money.shared.js";
import {
  buildCommissionPortfolioOutlook,
  outlookInvariantsHold,
  type OutlookQuery,
  type OutlookScheduleInput,
} from "./commissionPortfolioOutlook.js";
import { resolveCommissionAccessScope } from "./commissionAccessScope.js";
import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";

const TODAY = "2026-09-28";

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

function schedule(partial: Partial<OutlookScheduleInput> & Pick<OutlookScheduleInput, "scheduleId">): OutlookScheduleInput {
  return {
    scheduleStatus: "ACTIVE",
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
    dueDate: "2026-11-15",
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

function auth(partial: Partial<AppAuthContext>): AppAuthContext {
  return {
    id: "user",
    name: "User",
    email: "u@example.com",
    role: "VIEWER",
    permissions: [],
    externalSellerId: null,
    sellerResponsibleName: null,
    ...partial,
  } as AppAuthContext;
}

describe("previsão de comissões", () => {
  it("1 e 4. um CR integral realiza tudo na competência do receiptDate", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          receipts: [
            {
              externalId: 1,
              receiptDate: "2026-07-31",
              receivedAmount: 10_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    const line = payload.lines[0]!;
    assert.equal(line.realizedCommission, 300);
    assert.equal(line.forecastCommission, 0);
    assert.equal(line.status, "REALIZADA");
    assert.equal(payload.months.find((row) => row.month === "2026-07")?.realized, 300);
    assert.equal(outlookInvariantsHold(line), true);
  });

  it("2, 3 e 21. vários CRs usam o rateio já materializado e fecham o total", () => {
    const parts = allocateProportional(3000, [
      { key: "a", weight: 30_000 },
      { key: "b", weight: 30_000 },
      { key: "c", weight: 40_000 },
    ]);
    assert.equal(parts[0]?.amount, 900);
    assert.equal(parts[1]?.amount, 900);
    assert.equal(parts[2]?.amount, 1200);
    assert.equal(
      parts.reduce((sum, row) => sum + row.amount, 0),
      3000
    );
    const payload = buildCommissionPortfolioOutlook(
      parts.map((part, index) =>
        schedule({
          scheduleId: part.key,
          receivableId: index + 1,
          nominalAmount: [30_000, 30_000, 40_000][index]!,
          allocatedCommission: part.amount,
          dueDate: "2026-11-15",
        })
      ),
      query(),
      TODAY
    );
    assert.equal(
      payload.lines.reduce((sum, row) => sum + row.allocatedCommission, 0),
      3000
    );
    assert.equal(payload.cards.forecast, 3000);
    assert.equal(payload.cards.realized, 0);
  });

  it("5 e 6. recebimento parcial e vários recebimentos no mesmo CR", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          receipts: [
            {
              externalId: 1,
              receiptDate: "2026-08-10",
              receivedAmount: 4_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
            {
              externalId: 2,
              receiptDate: "2026-09-02",
              receivedAmount: 1_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    const line = payload.lines[0]!;
    assert.equal(line.realizedCommission, 150);
    assert.equal(line.forecastCommission, 150);
    assert.equal(line.status, "PARCIALMENTE_RECEBIDA");
    assert.equal(line.receipts[0]?.realizedCommission, 120);
    assert.equal(line.receipts[1]?.realizedCommission, 30);
    assert.equal(payload.months.find((row) => row.month === "2026-08")?.realized, 120);
    assert.equal(payload.months.find((row) => row.month === "2026-09")?.realized, 30);
    assert.equal(payload.months.find((row) => row.month === "2026-11")?.forecast, 150);
  });

  it("7. recebimento acima do nominal não gera comissão sobre o excedente", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          receipts: [
            {
              externalId: 9,
              receiptDate: "2026-08-01",
              receivedAmount: 10_300,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    const line = payload.lines[0]!;
    assert.equal(line.eligibleReceived, 10_000);
    assert.equal(line.receipts[0]?.excessAmount, 300);
    assert.equal(line.realizedCommission, 300);
    assert.equal(line.forecastCommission, 0);
  });

  it("8. CR futuro fica previsto no mês do vencimento", () => {
    const payload = buildCommissionPortfolioOutlook(
      [schedule({ scheduleId: "s1", dueDate: "2026-11-15" })],
      query(),
      TODAY
    );
    assert.equal(payload.lines[0]?.status, "PREVISTA");
    assert.equal(payload.months[0]?.month, "2026-11");
    assert.equal(payload.months[0]?.kind, "future");
    assert.equal(payload.cards.forecast, 300);
  });

  it("9. CR vencido permanece no mês original e não anda para o mês atual", () => {
    const payload = buildCommissionPortfolioOutlook(
      [schedule({ scheduleId: "s1", dueDate: "2026-08-15", balanceReceivable: 10_000 })],
      query(),
      TODAY
    );
    const line = payload.lines[0]!;
    assert.equal(line.status, "VENCIDA_NAO_RECEBIDA");
    assert.equal(line.dueMonth, "2026-08");
    assert.equal(payload.months.some((row) => row.month === "2026-09" && row.forecast > 0), false);
    assert.ok((line.daysOverdue ?? 0) > 0);
  });

  it("10 e 11. competência é receiptDate, mesmo com baixa em outro mês", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          dueDate: "2026-08-03",
          receipts: [
            {
              externalId: 31,
              receiptDate: "2026-07-31",
              receivedAmount: 10_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(payload.months.find((row) => row.month === "2026-07")?.realized, 300);
    assert.equal(payload.months.find((row) => row.month === "2026-08")?.realized ?? 0, 0);
  });

  it("12. o dono é o vendedor do pedido, não um filtro de carteira atual", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          canonicalSellerId: "seller-do-pedido",
          canonicalSellerName: "Vendedor do PV",
          rawSellerId: 10,
        }),
      ],
      query({ canonicalSellerId: "responsavel-atual" }),
      TODAY
    );
    assert.equal(payload.totalLines, 0);
    const own = buildCommissionPortfolioOutlook(
      [schedule({ scheduleId: "s1", rawSellerId: 10 })],
      query({ canonicalSellerId: "seller-1" }),
      TODAY
    );
    assert.equal(own.lines[0]?.canonicalSellerName, "Vendedor do pedido");
  });

  it("13. pedido sem vendedor não entra na comissão econômica", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          canonicalSellerId: null,
          rawSellerId: null,
          sellerResolutionStatus: "NO_SELLER",
          allocatedCommission: 300,
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(payload.lines[0]?.status, "SEM_VENDEDOR");
    assert.equal(payload.lines[0]?.allocatedCommission, 0);
    assert.equal(payload.cards.expected, 0);
  });

  it("14. cliente excluído não gera previsto nem realizado", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          scheduleStatus: "CUSTOMER_EXCLUDED",
          allocatedCommission: 300,
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(payload.lines[0]?.status, "CUSTOMER_EXCLUDED");
    assert.equal(payload.cards.expected, 0);
  });

  it("15. schedule substituído fica cancelado e fora do total", () => {
    const payload = buildCommissionPortfolioOutlook(
      [schedule({ scheduleId: "s1", scheduleStatus: "SUPERSEDED", allocatedCommission: 300 })],
      query(),
      TODAY
    );
    assert.equal(payload.lines[0]?.status, "CANCELADA");
    assert.equal(payload.cards.expected, 0);
  });

  it("16 e 17. liberado pelo fechamento IndusCost e pago pelo lote ou pelo histórico Nomus", () => {
    const released = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          receipts: [
            {
              externalId: 4,
              receiptDate: "2026-08-20",
              receivedAmount: 10_000,
              coverageSource: "INDUSCOST_CLOSING",
              coveredCommissionAmount: 300,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(released.lines[0]?.releasedCommission, 300);
    assert.equal(released.lines[0]?.paidCommission, 0);
    assert.equal(released.lines[0]?.status, "LIBERADA");
    assert.equal(released.cards.balanceToPay, 300);

    const paid = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s2",
          receivableId: 2,
          paidToSellerAmount: 300,
          receipts: [
            {
              externalId: 5,
              receiptDate: "2026-08-20",
              receivedAmount: 10_000,
              coverageSource: "INDUSCOST_CLOSING",
              coveredCommissionAmount: 300,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(paid.lines[0]?.paidCommission, 300);
    assert.equal(paid.lines[0]?.status, "PAGA");
    assert.equal(paid.cards.balanceToPay, 0);
  });

  it("18. o mesmo recebimento não realiza duas vezes", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          receipts: [
            {
              externalId: 7,
              receiptDate: "2026-08-01",
              receivedAmount: 10_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
            {
              externalId: 7,
              receiptDate: "2026-08-02",
              receivedAmount: 10_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(payload.lines[0]?.receipts.length, 1);
    assert.equal(payload.lines[0]?.realizedCommission, 300);
  });

  it("19 e 20. SELLER fica na própria carteira; ADMIN enxerga o conjunto", () => {
    const seller = resolveCommissionAccessScope(
      auth({ role: "SELLER", externalSellerId: 10, permissions: ["commissions.seller.own"] })
    );
    assert.equal(seller.dataScope, "own");
    assert.equal(seller.nomusSellerId, 10);
    const admin = resolveCommissionAccessScope(auth({ role: "ADMIN", permissions: ["commissions.seller.all"] }));
    assert.equal(admin.dataScope, "global");
    const superAdmin = resolveCommissionAccessScope(auth({ role: "SUPER_ADMIN" }));
    assert.equal(superAdmin.dataScope, "global");

    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({ scheduleId: "mine", rawSellerId: 10, canonicalSellerName: "Eu" }),
        schedule({
          scheduleId: "other",
          rawSellerId: 99,
          receivableId: 2,
          canonicalSellerId: "other",
          canonicalSellerName: "Outro",
        }),
      ],
      query({ ownNomusSellerId: 10, sellerLocked: true }),
      TODAY
    );
    assert.equal(payload.totalLines, 1);
    assert.equal(payload.lines[0]?.canonicalSellerName, "Eu");
    assert.equal(payload.sellerLocked, true);
  });

  it("22. título baixado sem evento de recebimento não vira previsto nem realizado", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          balanceReceivable: 0,
          amountReceivedOnTitle: 10_000,
          receipts: [],
          dueDate: "2026-12-01",
        }),
      ],
      query(),
      TODAY
    );
    const line = payload.lines[0]!;
    assert.equal(line.status, "INCONSISTENCIA_SEM_RECEBIMENTO");
    assert.equal(line.realizedCommission, 0);
    assert.equal(line.forecastCommission, 0);
    assert.match(line.inconsistency ?? "", /não inventa/);
  });

  it("23, 24 e 25. cobertura histórica é só leitura e não muda o previsto em aberto", () => {
    const server = readFileSync(
      new URL("./commissionPortfolioOutlook.server.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(server, /commissionReceiptCoverage\.(create|update|delete|upsert)/);
    assert.doesNotMatch(server, /commissionMonthlyClosing\.(create|update|delete|upsert)/);
    assert.doesNotMatch(server, /commissionReceiptLedgerLine\.(create|update|delete)/);

    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          receipts: [
            {
              externalId: 70,
              receiptDate: "2026-08-26",
              receivedAmount: 4_000,
              coverageSource: "NOMUS_LEGACY",
              coveredCommissionAmount: 120,
            },
          ],
        }),
      ],
      query(),
      TODAY
    );
    assert.equal(payload.lines[0]?.realizedCommission, 120);
    assert.equal(payload.lines[0]?.forecastCommission, 180);
    assert.equal(payload.lines[0]?.paidCommission, 120);
    assert.equal(payload.cards.forecast, 180);
  });

  it("26. fechamento já gravado não é reescrito por esta projeção", () => {
    const routes = readFileSync(new URL("../commissionsRoutes.ts", import.meta.url), "utf8");
    const block = routes.slice(routes.indexOf("/api/commissions/portfolio-outlook"));
    assert.match(block, /getCommissionPortfolioOutlook/);
    assert.doesNotMatch(block.slice(0, 500), /cancelReceiptClosing|reprocessReceiptClosing/);
  });

  it("27. cards do período batem com a soma do mês filtrado", () => {
    const payload = buildCommissionPortfolioOutlook(
      [
        schedule({
          scheduleId: "s1",
          dueDate: "2026-11-15",
          receipts: [
            {
              externalId: 1,
              receiptDate: "2026-09-10",
              receivedAmount: 4_000,
              coverageSource: null,
              coveredCommissionAmount: null,
            },
          ],
        }),
      ],
      query({ fromMonth: "2026-09", toMonth: "2026-09" }),
      TODAY
    );
    const september = payload.months.find((row) => row.month === "2026-09");
    assert.equal(payload.cards.realized, september?.realized);
    assert.equal(payload.cards.forecast, 0);
    assert.equal(payload.cards.expected, payload.cards.realized + payload.cards.forecast);
    assert.equal(september?.kind, "current");
  });
});
