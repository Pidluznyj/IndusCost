/**
 * Vínculo Pedido de Venda → Proposta num PostgreSQL 17 REAL (schema completo do projeto, descartável, loopback).
 * Cobre: proposta criada no IndusCost, preservação em sincronizações repetidas, importação interrompida,
 * concorrência real entre conexões (vaga 1:1), dados legados, reconciliação DRY-RUN / APPLY protegido / reversão,
 * migration aditiva + rollback com dados existentes, e a auditoria SQL somente leitura executada pelo psql.
 *
 * Executar: COMMISSION_PG17_BIN=<bin do PostgreSQL 17> npx tsx --test src/lib/sales/proposalSalesOrderLink.pg17.integration.test.ts
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, before, describe, it } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import {
  commissionPg17BinDir,
  executeSqlFile,
  startCommissionPostgres17,
  type CommissionPg17Database,
} from "../../../scripts/testing/commissionPostgresHarness.js";
import { extractNomusProposalReferences, type NomusProposalReferenceField } from "../nomus/nomusProposalOrderReference.ts";
import {
  applyProposalSalesOrderLinkInTx,
  buildProposalLinkLineEvidence,
  generatedSalesOrderLinkData,
  loadProposalLinkCandidateIndex,
  lockProposalSlotForGeneratedOrderInTx,
  recordGeneratedSalesOrderLinkEventInTx,
  resolveExplicitProposalReference,
} from "./proposalSalesOrderLinkWriter.server.ts";
import {
  applyProposalLinkReconcilePlan,
  buildProposalLinkReconcilePlan,
  revertProposalLinkReconcileRun,
} from "./proposalSalesOrderLinkReconcile.server.ts";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");
const MIGRATION = join(REPO, "prisma/migrations/20261102120000_proposal_sales_order_link_traceability/migration.sql");
const ROLLBACK = join(REPO, "docs/sales/proposal-sales-order-link.rollback.sql");
const AUDIT_SQL = join(REPO, "scripts/audit-proposal-sales-order-link.sql");

const pg17Bin = commissionPg17BinDir();
const SKIP = pg17Bin ? false : "COMMISSION_PG17_BIN ausente: suíte PostgreSQL 17 não executada.";

// Campo FICTÍCIO usado só para exercitar o caminho da referência explícita (nenhum campo real está confirmado).
const TEST_REFERENCE_FIELDS: NomusProposalReferenceField[] = [{ path: "campoTesteIdProposta", identifies: "EXTERNAL_ID" }];

let seq = 0;

function fixtures(prisma: PrismaClient) {
  const product = (label: string) =>
    prisma.product.create({ data: { sku: `SKU-${label}-${++seq}`, name: `Produto ${label}` } as never, select: { id: true } });
  const customer = (name: string, taxId: string) =>
    prisma.customer.create({ data: { companyName: name, taxId }, select: { id: true } });
  const proposal = (
    customerId: string,
    productIds: string[],
    opts: { nomus?: boolean; openedAt?: string; code?: string } = {}
  ) => {
    const ext = ++seq;
    return prisma.proposal.create({
      data: {
        title: opts.code ?? `P-${ext}`,
        customerId,
        sourceSystem: opts.nomus === false ? null : "NOMUS",
        externalProposalId: opts.nomus === false ? null : ext,
        externalProposalCode: opts.nomus === false ? null : (opts.code ?? `PR-${ext}`),
        externalOpenedAt: new Date(opts.openedAt ?? "2026-09-01T12:00:00Z"),
        items: {
          create: productIds.map((productId) => ({
            productId,
            externalProductId: opts.nomus === false ? null : ++seq,
            quantity: 1,
            unitCost: 5,
            suggestedPrice: 10,
            negotiatedPrice: 10,
            marginValue: 5,
            marginPerc: 50,
          })),
        },
      } as never,
      select: { id: true, externalProposalId: true },
    });
  };
  const order = (customerId: string, productIds: string[], opts: { proposalId?: string; raw?: Prisma.InputJsonValue } = {}) => {
    const ext = ++seq;
    return prisma.salesOrder.create({
      data: {
        orderCode: `PD-${ext}`,
        customerId,
        sourceSystem: "NOMUS",
        externalSalesOrderId: ext,
        status: "SENT_TO_NOMUS",
        issueDate: new Date("2026-10-01T12:00:00Z"),
        proposalId: opts.proposalId ?? null,
        nomusRawResponse: opts.raw ?? { id: ext, codigoPedido: `PD-${ext}` },
        items: {
          create: productIds.map((productId, i) => ({
            productId,
            externalProductId: ++seq,
            nomusItemExternalId: ext * 100 + i,
            quantity: 1,
            unitCost: 5,
            negotiatedPrice: 10,
            totalNetValue: 10,
            totalCost: 5,
            marginValue: 5,
            marginPerc: 50,
            skuSnapshot: "SKU",
            productNameSnapshot: "Produto",
          })),
        },
      } as never,
      select: { id: true },
    });
  };
  return { product, customer, proposal, order };
}

/** Mesmo encadeamento do sync de pedidos (scripts/nomusSalesOrdersSyncV1.ts → runApply). */
async function syncLink(
  prisma: PrismaClient,
  salesOrderId: string,
  opts: { fields?: NomusProposalReferenceField[]; afterLink?: () => never; dryRun?: boolean } = {}
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.salesOrder.findUniqueOrThrow({
      where: { id: salesOrderId },
      select: {
        customerId: true,
        issueDate: true,
        nomusRawResponse: true,
        items: { select: { productId: true, nomusItemExternalId: true } },
      },
    });
    const index = await loadProposalLinkCandidateIndex(tx, [order.customerId]);
    const result = await applyProposalSalesOrderLinkInTx(tx, {
      salesOrderId,
      orderCustomerId: order.customerId,
      orderIssueDate: order.issueDate,
      explicit: await resolveExplicitProposalReference(tx, extractNomusProposalReferences(order.nomusRawResponse, opts.fields ?? [])),
      lines: buildProposalLinkLineEvidence(
        index,
        order.customerId,
        order.items.map((it) => ({ lineKey: `line:${it.nomusItemExternalId}`, productId: it.productId }))
      ),
      proposals: index.proposals,
      actor: "nomus-sales-orders-sync",
      runId: "test-run",
      dryRun: opts.dryRun,
    });
    opts.afterLink?.();
    return result;
  });
}

const linkState = (prisma: PrismaClient, id: string) =>
  prisma.salesOrder.findUniqueOrThrow({
    where: { id },
    select: { proposalId: true, proposalLinkSource: true, proposalLinkStatus: true, proposalLinkEvidence: true },
  });
const events = (prisma: PrismaClient, salesOrderId: string) =>
  prisma.salesOrderProposalLinkEvent.findMany({ where: { salesOrderId }, orderBy: { createdAt: "asc" } });

describe("vínculo Pedido → Proposta com PostgreSQL 17 real", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let prisma: PrismaClient;
  let f: ReturnType<typeof fixtures>;

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "final" });
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(12) });
    f = fixtures(prisma);
  });
  after(async () => {
    await prisma?.$disconnect();
    await db?.stop();
  });

  it("proposta criada no IndusCost (sem ids do Nomus) é encontrada pelo produto local e inferida", async () => {
    const c = await f.customer("Cliente IndusCost", "20000000000101");
    const p1 = await f.product("ic");
    const prop = await f.proposal(c.id, [p1.id], { nomus: false });
    const o = await f.order(c.id, [p1.id]);
    const r = await syncLink(prisma, o.id);
    assert.equal(r.decision.reason, "INFERRED_SINGLE_PROPOSAL");
    const s = await linkState(prisma, o.id);
    assert.equal(s.proposalId, prop.id);
    assert.equal(s.proposalLinkSource, "INFERRED_ITEMS");
    assert.equal(s.proposalLinkStatus, "INFERRED");
    const ev = await events(prisma, o.id);
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.kind, "LINKED");
    assert.equal(ev[0]!.newProposalId, prop.id);
  });

  it("sincronizações repetidas preservam o vínculo, sem eventos duplicados, mesmo quando surge ambiguidade", async () => {
    const c = await f.customer("Cliente recorrente", "20000000000202");
    const p1 = await f.product("rec");
    const prop = await f.proposal(c.id, [p1.id]);
    const o = await f.order(c.id, [p1.id]);
    await syncLink(prisma, o.id);
    await syncLink(prisma, o.id);
    await syncLink(prisma, o.id);
    assert.equal((await events(prisma, o.id)).length, 1);
    // nova proposta com o mesmo produto: a inferência fica ambígua, mas o vínculo não é apagado
    await f.proposal(c.id, [p1.id]);
    const r = await syncLink(prisma, o.id);
    assert.equal(r.decision.reason, "CURRENT_LINK_PRESERVED_WITHOUT_CORROBORATION");
    const s = await linkState(prisma, o.id);
    assert.equal(s.proposalId, prop.id);
    assert.equal(s.proposalLinkStatus, "INFERRED");
    assert.equal((await events(prisma, o.id)).length, 1);
  });

  it("importação interrompida desfaz vínculo e evento; o reprocessamento conclui", async () => {
    const c = await f.customer("Cliente interrompido", "20000000000303");
    const p1 = await f.product("int");
    const prop = await f.proposal(c.id, [p1.id]);
    const o = await f.order(c.id, [p1.id]);
    await assert.rejects(
      syncLink(prisma, o.id, {
        afterLink: () => {
          throw new Error("queda simulada depois de gravar o vínculo");
        },
      }),
      /queda simulada/
    );
    assert.equal((await linkState(prisma, o.id)).proposalId, null);
    assert.equal((await events(prisma, o.id)).length, 0);
    await syncLink(prisma, o.id);
    assert.equal((await linkState(prisma, o.id)).proposalId, prop.id);
    assert.equal((await events(prisma, o.id)).length, 1);
  });

  it("concorrência real: dois pedidos disputando a mesma proposta → um vínculo, o outro CONFLICT, sem P2002", async () => {
    const c = await f.customer("Cliente concorrência", "20000000000404");
    const p1 = await f.product("conc");
    const prop = await f.proposal(c.id, [p1.id]);
    const o1 = await f.order(c.id, [p1.id]);
    const o2 = await f.order(c.id, [p1.id]);
    const results = await Promise.all([syncLink(prisma, o1.id), syncLink(prisma, o2.id)]);
    const linked = results.filter((r) => r.decision.proposalId === prop.id);
    const conflicts = results.filter((r) => r.decision.reason === "PROPOSAL_ALREADY_LINKED_TO_OTHER_ORDER");
    assert.equal(linked.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]!.decision.candidateProposalId, prop.id);
    assert.equal(await prisma.salesOrder.count({ where: { proposalId: prop.id } }), 1);

    // o mesmo pedido processado em paralelo por duas execuções: um único evento
    const o3 = await f.order(c.id, [(await f.product("conc2")).id]);
    const prop3 = await prisma.proposal.create({
      data: {
        title: "P-conc3",
        customerId: c.id,
        externalOpenedAt: new Date("2026-09-01T12:00:00Z"),
        items: {
          create: [{
            productId: (await prisma.salesOrderItem.findFirstOrThrow({ where: { salesOrderId: o3.id } })).productId,
            quantity: 1, unitCost: 5, suggestedPrice: 10, negotiatedPrice: 10, marginValue: 5, marginPerc: 50,
          }],
        },
      } as never,
      select: { id: true },
    });
    await Promise.all([syncLink(prisma, o3.id), syncLink(prisma, o3.id), syncLink(prisma, o3.id)]);
    assert.equal((await linkState(prisma, o3.id)).proposalId, prop3.id);
    assert.equal((await events(prisma, o3.id)).length, 1);
  });

  it("dados antigos: vínculo legado (sem origem) é preservado como LEGACY/INFERRED; divergência vira CONFLICT", async () => {
    const c = await f.customer("Cliente legado", "20000000000505");
    const p1 = await f.product("leg1");
    const p2 = await f.product("leg2");
    const propOld = await f.proposal(c.id, [p1.id]);
    const propOther = await f.proposal(c.id, [p2.id]);
    const corroborated = await f.order(c.id, [p1.id], { proposalId: propOld.id });
    const r1 = await syncLink(prisma, corroborated.id);
    assert.equal(r1.decision.source, "LEGACY");
    assert.equal(r1.decision.status, "INFERRED");
    assert.equal((await linkState(prisma, corroborated.id)).proposalId, propOld.id);

    const divergent = await f.order(c.id, [p2.id], { proposalId: (await f.proposal(c.id, [p1.id])).id });
    const r2 = await syncLink(prisma, divergent.id);
    assert.equal(r2.decision.status, "CONFLICT");
    assert.equal(r2.decision.candidateProposalId, propOther.id);
    const s = await linkState(prisma, divergent.id);
    assert.notEqual(s.proposalId, propOther.id, "vínculo legado não é trocado silenciosamente");
    assert.equal(s.proposalLinkStatus, "CONFLICT");
  });

  it("dry-run (escritor e reconciliação) não grava nada", async () => {
    const c = await f.customer("Cliente dry-run", "20000000000606");
    const p1 = await f.product("dry");
    await f.proposal(c.id, [p1.id]);
    const o = await f.order(c.id, [p1.id]);
    const before = JSON.stringify(await prisma.salesOrder.findMany({ orderBy: { id: "asc" }, select: { id: true, proposalId: true, proposalLinkSource: true, proposalLinkStatus: true, proposalLinkEvidence: true } }));
    const eventsBefore = await prisma.salesOrderProposalLinkEvent.count();
    const r = await syncLink(prisma, o.id, { dryRun: true });
    assert.equal(r.written, false);
    assert.equal(r.decision.reason, "INFERRED_SINGLE_PROPOSAL");
    const plan = await buildProposalLinkReconcilePlan(prisma);
    assert.ok(plan.totals.orders > 0);
    const after = JSON.stringify(await prisma.salesOrder.findMany({ orderBy: { id: "asc" }, select: { id: true, proposalId: true, proposalLinkSource: true, proposalLinkStatus: true, proposalLinkEvidence: true } }));
    assert.equal(after, before);
    assert.equal(await prisma.salesOrderProposalLinkEvent.count(), eventsBefore);
  });

  it("reconciliação: referência explícita aplicada só com o hash revisado e revertida pelo runId", async () => {
    const c = await f.customer("Cliente explícito", "20000000000707");
    const p1 = await f.product("exp");
    await f.proposal(c.id, [p1.id]);
    const target = await f.proposal(c.id, [p1.id]); // inferência sozinha seria ambígua
    const o = await f.order(c.id, [p1.id], { raw: { id: 1, campoTesteIdProposta: target.externalProposalId } });

    const plan = await buildProposalLinkReconcilePlan(prisma, { referenceFields: TEST_REFERENCE_FIELDS, salesOrderIds: [o.id] });
    const row = plan.rows.find((r) => r.salesOrderId === o.id)!;
    assert.equal(row.action, "APPLY_EXPLICIT");
    assert.equal(row.candidateProposalId, target.id);
    assert.deepEqual(plan.applicable, [{ salesOrderId: o.id, proposalId: target.id, action: "APPLY_EXPLICIT" }]);

    await assert.rejects(
      applyProposalLinkReconcilePlan(prisma, { confirmPlanHash: "hash-errado", authorizedBy: "teste", referenceFields: TEST_REFERENCE_FIELDS }),
      /Plano mudou/
    );
    await assert.rejects(
      applyProposalLinkReconcilePlan(prisma, { confirmPlanHash: plan.planHash, authorizedBy: " ", referenceFields: TEST_REFERENCE_FIELDS }),
      /authorized-by/
    );
    // o plano completo (todos os pedidos do banco) precisa do próprio hash
    const fullPlan = await buildProposalLinkReconcilePlan(prisma, { referenceFields: TEST_REFERENCE_FIELDS });
    const applied = await applyProposalLinkReconcilePlan(prisma, {
      confirmPlanHash: fullPlan.planHash,
      authorizedBy: "revisor",
      referenceFields: TEST_REFERENCE_FIELDS,
      runId: "reconcile-test-explicit",
    });
    assert.equal(applied.applied, fullPlan.applicable.length);
    const s = await linkState(prisma, o.id);
    assert.equal(s.proposalId, target.id);
    assert.equal(s.proposalLinkSource, "NOMUS_REFERENCE");
    assert.equal(s.proposalLinkStatus, "CONFIRMED");

    // idempotência: um novo APPLY do mesmo plano já não tem o que aplicar (hash muda)
    const again = await buildProposalLinkReconcilePlan(prisma, { referenceFields: TEST_REFERENCE_FIELDS, salesOrderIds: [o.id] });
    assert.equal(again.applicable.length, 0);

    const reverted = await revertProposalLinkReconcileRun(prisma, { runId: "reconcile-test-explicit", authorizedBy: "revisor" });
    assert.ok(reverted.reverted >= 1);
    const back = await linkState(prisma, o.id);
    assert.equal(back.proposalId, null);
    const kinds = (await events(prisma, o.id)).map((e) => e.kind);
    assert.deepEqual(kinds, ["LINKED", "REVERTED"]);
  });

  it("reconciliação com conflitos: proposta de outro cliente nunca é aplicada; troca exige replaceExisting", async () => {
    const a = await f.customer("Cliente A conflito", "20000000000808");
    const b = await f.customer("Cliente B conflito", "20000000000909");
    const p1 = await f.product("cf");
    const propA1 = await f.proposal(a.id, [p1.id]);
    const propA2 = await f.proposal(a.id, [p1.id]);
    const propB = await f.proposal(b.id, [p1.id]);
    const unlinked = await f.order(a.id, [p1.id]); // ambíguo (A1 × A2)
    const linked = await f.order(a.id, [p1.id], { proposalId: propA1.id });

    const manual = [
      { salesOrderId: unlinked.id, proposalId: propB.id, reviewer: "revisor" },
      { salesOrderId: linked.id, proposalId: propA2.id, reviewer: "revisor" },
    ];
    const plan = await buildProposalLinkReconcilePlan(prisma, { manual, salesOrderIds: [unlinked.id, linked.id] });
    assert.equal(plan.rows.find((r) => r.salesOrderId === unlinked.id)!.action, "REVIEW_CONFLICT");
    assert.equal(plan.rows.find((r) => r.salesOrderId === linked.id)!.action, "REVIEW_CONFLICT");
    assert.equal(plan.totals.conflicts, 2);
    assert.equal(plan.applicable.length, 0);

    const manualOk = [
      { salesOrderId: unlinked.id, proposalId: propA2.id, reviewer: "revisor", note: "conferido no Nomus" },
      { salesOrderId: linked.id, proposalId: propA1.id, reviewer: "revisor" },
    ];
    const fullPlan = await buildProposalLinkReconcilePlan(prisma, { manual: manualOk });
    const result = await applyProposalLinkReconcilePlan(prisma, {
      confirmPlanHash: fullPlan.planHash,
      authorizedBy: "revisor",
      manual: manualOk,
      runId: "reconcile-test-manual",
    });
    assert.equal(result.applied, 2);
    const s1 = await linkState(prisma, unlinked.id);
    assert.equal(s1.proposalId, propA2.id);
    assert.equal(s1.proposalLinkSource, "MANUAL");
    assert.equal(s1.proposalLinkStatus, "CONFIRMED");
    const s2 = await linkState(prisma, linked.id);
    assert.equal(s2.proposalId, propA1.id, "confirmação manual da mesma proposta");
    assert.equal(s2.proposalLinkSource, "MANUAL");
    // proposta B continua sem pedido; nenhum vínculo entre clientes
    assert.equal(await prisma.salesOrder.count({ where: { proposalId: propB.id } }), 0);
  });

  it("pedido gerado pela proposta no IndusCost: vaga travada, origem INDUSCOST_GENERATED e evento", async () => {
    const c = await f.customer("Cliente gerado", "20000000001010");
    const p1 = await f.product("gen");
    const prop = await f.proposal(c.id, [p1.id], { nomus: false });
    const created = await prisma.$transaction(async (tx) => {
      assert.equal(await lockProposalSlotForGeneratedOrderInTx(tx, prop.id), null);
      const now = new Date();
      const so = await tx.salesOrder.create({
        data: {
          ...generatedSalesOrderLinkData(prop.id, now),
          orderCode: `PV-gen-${++seq}`,
          customerId: c.id,
          status: "READY_TO_SEND",
          issueDate: now,
        } as never,
        select: { id: true },
      });
      await recordGeneratedSalesOrderLinkEventInTx(tx, { salesOrderId: so.id, proposalId: prop.id, actor: "generate-sales-order:teste", now });
      return so;
    });
    const owner = await prisma.$transaction((tx) => lockProposalSlotForGeneratedOrderInTx(tx, prop.id));
    assert.equal(owner?.id, created.id);
    const s = await linkState(prisma, created.id);
    assert.equal(s.proposalLinkSource, "INDUSCOST_GENERATED");
    assert.equal(s.proposalLinkStatus, "CONFIRMED");
    // o sync posterior mantém o vínculo confirmado
    const r = await syncLink(prisma, created.id);
    assert.equal(r.decision.reason, "CURRENT_LINK_CONFIRMED");
    assert.equal((await events(prisma, created.id)).length, 1);
  });
});

/** Snapshot do catálogo (colunas, índices, constraints, enums) para comparar estados do schema. */
async function catalogSnapshot(prisma: PrismaClient): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ line: string }>>(`
    SELECT 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '') AS line
      FROM information_schema.columns WHERE table_schema = 'public'
    UNION ALL SELECT 'idx ' || indexdef FROM pg_indexes WHERE schemaname = 'public'
    UNION ALL SELECT 'con ' || conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    UNION ALL SELECT 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname
    ORDER BY 1`);
  return rows.map((r) => r.line).join("\n");
}

function runAudit(db: CommissionPg17Database): { status: number | null; stdout: string; stderr: string } {
  const u = new URL(db.url);
  const exe = process.platform === "win32" ? ".exe" : "";
  const r = spawnSync(
    join(pg17Bin!, `psql${exe}`),
    ["-X", "-q", "-h", u.hostname, "-p", u.port, "-U", decodeURIComponent(u.username), "-d", "postgres", "-f", AUDIT_SQL],
    { encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" } }
  );
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

describe("migration aditiva, rollback e auditoria SQL (PostgreSQL 17 real)", { skip: SKIP }, () => {
  let db: CommissionPg17Database;
  let prisma: PrismaClient;

  before(async () => {
    db = await startCommissionPostgres17(pg17Bin!, { schema: "final" });
    prisma = new PrismaClient({ datasourceUrl: db.poolUrl(4) });
  });
  after(async () => {
    await prisma?.$disconnect();
    await db?.stop();
  });

  it("auditoria é somente leitura por construção (só SELECT/WITH/SET LOCAL dentro de BEGIN READ ONLY … ROLLBACK)", () => {
    const sql = readFileSync(AUDIT_SQL, "utf8");
    assert.ok(!/[^\x00-\x7f]/.test(sql), "arquivo ASCII (psql no Windows lê argumentos/arquivo em ANSI)");
    const statements = sql
      .split(/\r?\n/)
      .filter((l) => !l.trim().startsWith("--") && !l.trim().startsWith("\\"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    assert.match(statements[0]!, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/);
    assert.equal(statements.at(-1), "ROLLBACK");
    for (const stmt of statements.slice(1, -1)) {
      assert.match(stmt, /^(SELECT|WITH|SET LOCAL (statement_timeout|lock_timeout|idle_in_transaction_session_timeout))\b/, stmt.slice(0, 80));
      assert.doesNotMatch(stmt, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|LOCK)\b/i, stmt.slice(0, 80));
    }
  });

  it("dados existentes sobrevivem ao rollback e à reaplicação; auditoria roda antes e depois da migration sem expor dados pessoais", async () => {
    const f = fixtures(prisma);
    const pf1 = await f.customer("Fulana Pessoa Fisica Secreta", "123.456.789-09");
    const pf2 = await f.customer("Fulana Duplicada Secreta", "12345678909");
    const prod = await f.product("mig");
    const legacyProposal = await f.proposal(pf1.id, [prod.id]);
    const legacyOrder = await f.order(pf1.id, [prod.id], { proposalId: legacyProposal.id });
    await f.order(pf2.id, [prod.id]);
    const before = await catalogSnapshot(prisma);

    await executeSqlFile(db.url, ROLLBACK);
    const rolledBack = await catalogSnapshot(prisma);
    assert.doesNotMatch(rolledBack, /proposalLink|SalesOrderProposalLinkEvent|NomusProposalImportIssue|nomusProductInactive|ProposalLinkSource/);
    const legacy = await prisma.$queryRawUnsafe<Array<{ proposalId: string }>>(
      `SELECT "proposalId"::text AS "proposalId" FROM "SalesOrder" WHERE id = $1::uuid`,
      legacyOrder.id
    );
    assert.equal(legacy[0]!.proposalId, legacyProposal.id);

    // auditoria no schema anterior à migration (como hoje em produção e homologação)
    const pre = runAudit(db);
    assert.equal(pre.status, 0, pre.stderr);
    for (const section of ["A1.", "A2.", "A3.", "A4.", "A5.", "A6.", "A7.", "A8.", "A9."]) assert.ok(pre.stdout.includes(`== ${section}`), section);
    assert.ok(!pre.stdout.includes("Secreta"), "sem nome de cliente na saída");
    assert.ok(!pre.stdout.includes("12345678909") && !pre.stdout.includes("123.456.789-09"), "documento mascarado");
    assert.match(pre.stdout, /12\*{7}09/);

    await executeSqlFile(db.url, MIGRATION);
    assert.equal(await catalogSnapshot(prisma), before, "migration reconstrói exatamente o schema final");
    const after = await prisma.salesOrder.findUniqueOrThrow({
      where: { id: legacyOrder.id },
      select: { proposalId: true, proposalLinkSource: true, proposalLinkStatus: true },
    });
    assert.deepEqual(after, { proposalId: legacyProposal.id, proposalLinkSource: null, proposalLinkStatus: null });
    assert.equal(await prisma.proposalItem.count({ where: { nomusProductInactive: true } }), 0);

    const post = runAudit(db);
    assert.equal(post.status, 0, post.stderr);
  });
});
