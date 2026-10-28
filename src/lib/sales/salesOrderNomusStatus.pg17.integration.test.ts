/**
 * Status e cancelamentos de Pedidos de Venda Nomus num PostgreSQL 17 REAL (schema completo, descartável, loopback).
 * Simula sincronizações sucessivas do mesmo pedido pelo mesmo caminho do sync (lock por pedido + itens + histórico
 * + vínculo com proposta) e confere a previsão de faturamento pela consulta real (financeBillingForecast).
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/sales/salesOrderNomusStatus.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  commissionPg17BinDir,
  executeSqlFile,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";
import type { NomusSyncExistingItem, NomusSyncPlannedLine } from "../salesOrderNomusSync.server.ts";
import {
  applyNomusSalesOrderItemSyncInTx,
  lockNomusSalesOrderSyncInTx,
  NOMUS_SYNC_EXISTING_ITEM_SELECT,
} from "./salesOrderNomusItemSync.server.ts";
import {
  salesOrderNomusForecastValueSql,
  summarizeSalesOrderNomusLifecycle,
} from "./salesOrderNomusLifecycle.ts";
import {
  applyProposalSalesOrderLinkInTx,
  buildProposalLinkLineEvidence,
  loadProposalLinkCandidateIndex,
} from "./proposalSalesOrderLinkWriter.server.ts";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const STATUS_AUDIT_SQL = join(REPO, "scripts/audit-sales-order-nomus-status.sql");
const ROLLBACK = join(REPO, "docs/sales/proposal-sales-order-link.rollback.sql");
const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: suíte PostgreSQL 17 não executada.";

const REF = new Date("2026-10-28T12:00:00Z");
const DELIVERY = new Date("2026-11-10T12:00:00Z");
let seq = 0;

type Line = { lineId: number; status: string | null; fulfilled?: number | null; value?: number };

function normalized(status: string | null): { n: string; canceled: boolean; cut: boolean } {
  if (status === "6") return { n: "CANCELED", canceled: true, cut: false };
  if (status === "5") return { n: "FULFILLED_WITH_CUT", canceled: false, cut: true };
  if (status === "4") return { n: "FULFILLED", canceled: false, cut: false };
  if (status === "3") return { n: "PARTIAL", canceled: false, cut: false };
  if (status === "2") return { n: "RELEASED", canceled: false, cut: false };
  return { n: "UNKNOWN", canceled: false, cut: false };
}

describe("status e cancelamentos Nomus com PostgreSQL 17 real", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let prisma: PrismaClient;
  let forecast: typeof import("../financeBillingForecast.ts");
  let customerId = "";
  const productIds: string[] = [];

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "final" });
    process.env.DATABASE_URL = db.poolUrl(8);
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(8) });
    // A consulta oficial usa o cliente global de src/lib/prisma.ts: importada depois de apontar para o PG17.
    forecast = await import("../financeBillingForecast.ts");
    customerId = (await prisma.customer.create({ data: { companyName: "Cliente Status", taxId: "30000000000101" } })).id;
    for (let i = 0; i < 4; i += 1) {
      productIds.push((await prisma.product.create({ data: { sku: `SKU-ST-${i}`, name: `Produto ${i}` } as never })).id);
    }
  });
  after(async () => {
    await prisma?.$disconnect();
    const global = (globalThis as { prisma?: PrismaClient }).prisma;
    await global?.$disconnect();
    await db?.stop();
  });

  const plannedLines = (lines: Line[]): NomusSyncPlannedLine[] =>
    lines.map((l) => {
      const st = normalized(l.status);
      return {
        externalLineId: l.lineId,
        productId: productIds[l.lineId % productIds.length]!,
        externalProductId: 1000 + l.lineId,
        proposalItemId: null,
        skuSnapshot: "SKU",
        productNameSnapshot: "Produto",
        unit: "UN",
        quantity: 10,
        negotiatedPrice: (l.value ?? 100) / 10,
        totalNetValue: l.value ?? 100,
        notes: null,
        nomusItemStatusRaw: l.status,
        nomusItemStatusNormalized: st.n,
        nomusQuantityFulfilled: l.fulfilled ?? null,
        nomusQuantityPending: null,
        nomusIsCanceled: st.canceled,
        nomusIsCut: st.cut,
        nomusRawItem: { id: l.lineId, status: l.status == null ? undefined : Number(l.status) },
      };
    });

  /** Mesmo encadeamento de scripts/nomusSalesOrdersSyncV1.ts → runApplyOne (cabeçalho mínimo + itens + histórico). */
  async function syncOrder(externalId: number, lines: Line[], header: { total?: number; nfes?: unknown[] } = {}) {
    return prisma.$transaction(async (tx) => {
      await lockNomusSalesOrderSyncInTx(tx, externalId);
      const existing = await tx.salesOrder.findFirst({
        where: { sourceSystem: "NOMUS", externalSalesOrderId: externalId },
        select: { id: true },
      });
      const raw = { id: externalId, codigoPedido: `PD ${externalId}`, nfes: header.nfes ?? [], itensPedido: lines.map((l) => ({ id: l.lineId, status: l.status })) };
      let salesOrderId: string;
      let existingItems: NomusSyncExistingItem[] = [];
      if (existing) {
        salesOrderId = existing.id;
        await tx.salesOrder.update({ where: { id: salesOrderId }, data: { nomusRawResponse: raw as Prisma.InputJsonValue } });
        existingItems = (await tx.salesOrderItem.findMany({
          where: { salesOrderId },
          select: NOMUS_SYNC_EXISTING_ITEM_SELECT,
        })) as unknown as NomusSyncExistingItem[];
      } else {
        salesOrderId = (
          await tx.salesOrder.create({
            data: {
              orderCode: `PD ${externalId}`,
              customerId,
              sourceSystem: "NOMUS",
              externalSalesOrderId: externalId,
              status: "SENT_TO_NOMUS",
              issueDate: new Date("2026-10-01T12:00:00Z"),
              expectedDeliveryDate: DELIVERY,
              totalNetValue: header.total ?? lines.reduce((s, l) => s + (l.value ?? 100), 0),
              nomusRawResponse: raw as Prisma.InputJsonValue,
            } as never,
            select: { id: true },
          })
        ).id;
      }
      const result = await applyNomusSalesOrderItemSyncInTx(tx, {
        salesOrderId,
        plannedLines: plannedLines(lines),
        existingItems,
        runId: `run-${++seq}`,
      });
      return { salesOrderId, ...result };
    });
  }

  const statusEvents = (salesOrderId: string) =>
    prisma.salesOrderNomusStatusEvent.findMany({ where: { salesOrderId }, orderBy: [{ createdAt: "asc" }, { kind: "asc" }] });
  const forecastRow = async (salesOrderId: string) =>
    (await forecast.queryBillingForecastHorizonOrders(REF)).find((r) => (r as { id: string }).id === salesOrderId) as
      | { total_net_value: unknown }
      | undefined;

  it("1/3/2/9/10. aberto → item cancelado → todos cancelados → reativado; previsão e histórico em cada etapa", async () => {
    const ext = 50001;
    const open = await syncOrder(ext, [{ lineId: 1, status: "2", value: 600 }, { lineId: 2, status: "2", value: 400 }], { total: 1030 });
    assert.equal(Number((await forecastRow(open.salesOrderId))?.total_net_value), 1030, "aberto: valor do cabeçalho");

    await syncOrder(ext, [{ lineId: 1, status: "6", value: 600 }, { lineId: 2, status: "2", value: 400 }]);
    assert.equal(Number((await forecastRow(open.salesOrderId))?.total_net_value), 400, "parcial: só o item ativo");

    await syncOrder(ext, [{ lineId: 1, status: "6", value: 600 }, { lineId: 2, status: "6", value: 400 }]);
    assert.equal(await forecastRow(open.salesOrderId), undefined, "totalmente cancelado: fora da previsão");
    const kept = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: open.salesOrderId },
      select: { orderCode: true, status: true, items: { select: { id: true, nomusIsCanceled: true } } },
    });
    assert.equal(kept.orderCode, `PD ${ext}`, "número original preservado");
    assert.equal(kept.status, "SENT_TO_NOMUS", "cabeçalho não é reescrito como CANCELLED (fluxo IndusCost)");
    assert.equal(kept.items.length, 2, "itens nunca são apagados");
    assert.ok(kept.items.every((i) => i.nomusIsCanceled));

    const repeated = await syncOrder(ext, [{ lineId: 1, status: "6", value: 600 }, { lineId: 2, status: "6", value: 400 }]);
    assert.equal(repeated.statusEvents.length, 0, "repetição sem mudança não gera evento");

    const back = await syncOrder(ext, [{ lineId: 1, status: "2", value: 600 }, { lineId: 2, status: "6", value: 400 }]);
    assert.equal(back.plan.creates.length, 0, "reativação não duplica item");
    assert.equal(Number((await forecastRow(open.salesOrderId))?.total_net_value), 600, "reativado volta ao saldo elegível");

    const kinds = (await statusEvents(open.salesOrderId)).map((e) => e.kind);
    assert.deepEqual(kinds.sort(), [
      "ITEM_CANCELED",
      "ITEM_CANCELED",
      "ITEM_REACTIVATED",
      "ORDER_FULLY_CANCELED",
      "ORDER_REACTIVATED",
    ].sort());
  });

  it("5/7/8. corte, faturado integralmente e cancelado após faturamento parcial: previsão só do não faturado", async () => {
    const cut = await syncOrder(50002, [{ lineId: 1, status: "5", fulfilled: 4, value: 1000 }]);
    assert.equal(Number((await forecastRow(cut.salesOrderId))?.total_net_value), 400, "corte: só a fração atendida");

    const nfe = [{ numero: "1001", dataProcessamento: "20/10/2026", valorTotal: "500" }];
    const invoiced = await syncOrder(50003, [{ lineId: 1, status: "4", value: 500 }], { nfes: nfe });
    assert.equal(await forecastRow(invoiced.salesOrderId), undefined, "faturado não é previsão");

    const partial = await syncOrder(50004, [{ lineId: 1, status: "3", value: 500 }, { lineId: 2, status: "2", value: 500 }], { nfes: nfe });
    await syncOrder(50004, [{ lineId: 1, status: "3", value: 500 }, { lineId: 2, status: "6", value: 500 }], { nfes: nfe });
    const raw = await prisma.salesOrder.findUniqueOrThrow({ where: { id: partial.salesOrderId }, select: { nomusRawResponse: true } });
    assert.deepEqual((raw.nomusRawResponse as { nfes: unknown[] }).nfes, nfe, "NF-e realizada preservada após cancelamento");
    assert.equal(await forecastRow(partial.salesOrderId), undefined);
  });

  it("11/12. status ausente ou desconhecido não reativa item cancelado", async () => {
    const o = await syncOrder(50005, [{ lineId: 1, status: "6", value: 300 }]);
    await syncOrder(50005, [{ lineId: 1, status: null, value: 300 }]);
    await syncOrder(50005, [{ lineId: 1, status: "99", value: 300 }]);
    const item = await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: o.salesOrderId } });
    assert.equal(item.nomusIsCanceled, true);
    assert.equal(item.nomusItemStatusNormalized, "CANCELED");
    assert.equal(item.nomusItemStatusRaw, "99", "código recebido registrado para auditoria");
    assert.equal(await forecastRow(o.salesOrderId), undefined);
    const kinds = (await statusEvents(o.salesOrderId)).map((e) => e.kind);
    assert.deepEqual(kinds, ["ITEM_STATUS_UNKNOWN_PRESERVED", "ITEM_STATUS_UNKNOWN_PRESERVED"]);
  });

  it("15. sincronizações concorrentes do mesmo pedido: uma única transição registrada", async () => {
    const o = await syncOrder(50006, [{ lineId: 1, status: "2", value: 200 }, { lineId: 2, status: "2", value: 200 }]);
    const cancel: Line[] = [{ lineId: 1, status: "6", value: 200 }, { lineId: 2, status: "6", value: 200 }];
    await Promise.all([syncOrder(50006, cancel), syncOrder(50006, cancel), syncOrder(50006, cancel)]);
    const kinds = (await statusEvents(o.salesOrderId)).map((e) => e.kind).sort();
    assert.deepEqual(kinds, ["ITEM_CANCELED", "ITEM_CANCELED", "ORDER_FULLY_CANCELED"]);
    assert.equal(await prisma.salesOrderItem.count({ where: { salesOrderId: o.salesOrderId } }), 2);
  });

  it("16/17. cancelamento não apaga vínculo confiável com proposta; múltiplas candidatas seguem ambíguas", async () => {
    const proposal = await prisma.proposal.create({
      data: {
        title: "P-status",
        customerId,
        externalOpenedAt: new Date("2026-09-01T12:00:00Z"),
        items: { create: [{ productId: productIds[1]!, quantity: 1, unitCost: 5, suggestedPrice: 10, negotiatedPrice: 10, marginValue: 5, marginPerc: 50 }] },
      } as never,
      select: { id: true },
    });
    const o = await syncOrder(50007, [{ lineId: 1, status: "2", value: 100 }]);
    await prisma.salesOrder.update({
      where: { id: o.salesOrderId },
      data: { proposalId: proposal.id, proposalLinkSource: "MANUAL", proposalLinkStatus: "CONFIRMED" },
    });
    await syncOrder(50007, [{ lineId: 1, status: "6", value: 100 }]);
    const link = async (salesOrderId: string) =>
      prisma.$transaction(async (tx) => {
        const order = await tx.salesOrder.findUniqueOrThrow({
          where: { id: salesOrderId },
          select: { customerId: true, issueDate: true, items: { select: { productId: true, nomusItemExternalId: true } } },
        });
        const index = await loadProposalLinkCandidateIndex(tx, [order.customerId]);
        return applyProposalSalesOrderLinkInTx(tx, {
          salesOrderId,
          orderCustomerId: order.customerId,
          orderIssueDate: order.issueDate,
          explicit: { kind: "NONE" },
          lines: buildProposalLinkLineEvidence(index, order.customerId, order.items.map((it) => ({ lineKey: `line:${it.nomusItemExternalId}`, productId: it.productId }))),
          proposals: index.proposals,
          actor: "nomus-sales-orders-sync",
          runId: "status-test",
        });
      });
    const kept = await link(o.salesOrderId);
    assert.equal(kept.decision.proposalId, proposal.id);
    assert.equal(kept.decision.status, "CONFIRMED");

    // duas propostas com o produto do pedido: ambíguo antes e depois do cancelamento, nunca vinculado
    for (const title of ["P-a", "P-b"]) {
      await prisma.proposal.create({
        data: {
          title,
          customerId,
          externalOpenedAt: new Date("2026-09-01T12:00:00Z"),
          items: { create: [{ productId: productIds[3]!, quantity: 1, unitCost: 5, suggestedPrice: 10, negotiatedPrice: 10, marginValue: 5, marginPerc: 50 }] },
        } as never,
      });
    }
    const amb = await syncOrder(50008, [{ lineId: 3, status: "2", value: 100 }]);
    assert.equal((await link(amb.salesOrderId)).decision.status, "AMBIGUOUS");
    await syncOrder(50008, [{ lineId: 3, status: "6", value: 100 }]);
    const after = await link(amb.salesOrderId);
    assert.equal(after.decision.status, "AMBIGUOUS");
    assert.equal(after.decision.proposalId, null);
  });

  it("auditoria de status: somente leitura, sem dados pessoais, antes e depois da migration", async () => {
    const sql = readFileSync(STATUS_AUDIT_SQL, "utf8");
    assert.ok(!/[^\x00-\x7f]/.test(sql), "arquivo ASCII");
    const statements = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("--") && !l.trim().startsWith("\\"))
      .join("\n")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean);
    assert.match(statements[0]!, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
    assert.equal(statements.at(-1), "ROLLBACK");
    for (const stmt of statements.slice(1, -1)) {
      assert.match(stmt, /^(SELECT|WITH|SET LOCAL (statement_timeout|lock_timeout|idle_in_transaction_session_timeout))\b/, stmt.slice(0, 80));
      assert.doesNotMatch(stmt, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|LOCK)\b/i, stmt.slice(0, 80));
    }
    const run = () => {
      const u = new URL(db.url);
      const exe = process.platform === "win32" ? ".exe" : "";
      return spawnSync(
        join(pg17Bin!, `psql${exe}`),
        ["-X", "-q", "-h", u.hostname, "-p", u.port, "-U", decodeURIComponent(u.username), "-d", "postgres", "-f", STATUS_AUDIT_SQL],
        { encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" } }
      );
    };
    const post = run();
    assert.equal(post.status, 0, post.stderr);
    for (const section of ["S0.", "S1.", "S2.", "S3.", "S4.", "S5.", "S6.", "S7."]) assert.ok(post.stdout.includes(`== ${section}`), section);
    assert.match(post.stdout, /TOTALMENTE_CANCELADO/);
    assert.match(post.stdout, /ORDER_FULLY_CANCELED/);
    assert.ok(!post.stdout.includes("Cliente Status"), "sem nome de cliente");
    assert.ok(!post.stdout.includes("30000000000101"), "sem documento");

    await executeSqlFile(db.url, ROLLBACK);
    const pre = run();
    assert.equal(pre.status, 0, pre.stderr);
    assert.match(pre.stdout, /Historico ainda nao disponivel/);
    assert.match(pre.stdout, /TOTALMENTE_CANCELADO/);
  });

  it("20. valor da previsão em SQL = regra em TypeScript para todos os pedidos gravados", async () => {
    const orders = await prisma.salesOrder.findMany({
      select: {
        id: true,
        totalNetValue: true,
        items: { select: { quantity: true, totalNetValue: true, nomusIsCanceled: true, nomusIsStale: true, nomusIsCut: true, nomusQuantityFulfilled: true } },
      },
    });
    assert.ok(orders.length >= 8);
    const sqlRows = await prisma.$queryRaw<Array<{ id: string; v: unknown; eligible: boolean }>>(Prisma.sql`
      SELECT so.id::text AS id, ${salesOrderNomusForecastValueSql("so")} AS v,
             (SELECT bool_or(NOT i."nomusIsCanceled" AND NOT i."nomusIsStale") FROM "SalesOrderItem" i WHERE i."salesOrderId" = so.id) AS eligible
      FROM "SalesOrder" so`);
    const byId = new Map(sqlRows.map((r) => [r.id, r]));
    for (const order of orders) {
      const ts = summarizeSalesOrderNomusLifecycle(
        Number(order.totalNetValue),
        order.items.map((i) => ({
          quantity: Number(i.quantity),
          totalNetValue: Number(i.totalNetValue),
          nomusIsCanceled: i.nomusIsCanceled,
          nomusIsStale: i.nomusIsStale,
          nomusIsCut: i.nomusIsCut,
          nomusQuantityFulfilled: i.nomusQuantityFulfilled == null ? null : Number(i.nomusQuantityFulfilled),
        }))
      );
      const row = byId.get(order.id)!;
      if (ts.forecastValue == null) assert.equal(row.eligible, false, `pedido ${order.id} fora da previsão`);
      else assert.equal(Number(row.v), ts.forecastValue, `pedido ${order.id}`);
    }
  });
});
