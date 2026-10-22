/**
 * Trava de somente leitura e script de auditoria da Visão 360° (sem banco real).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  COMMISSION_AUDIT_CHECKED_TABLES,
  CommissionAuditRefused,
  Commission360ReadOnlyViolation,
  buildCommission360AuditDatabaseUrl,
  checkCommissionAuditSession,
  runCommissionReadOnlyAudit,
  type CommissionAuditSession,
  createCommission360ReadOnlyPrisma,
  describeCommission360DatabaseUrl,
} from "./commission360ReadOnlyGuard.js";
import { buildCommission360ReceivablesCsv, classifyCommission360Receivable } from "./commission360View.js";

function fakeBase() {
  const executed: string[] = [];
  const model = (name: string) => ({
    findMany: async () => {
      executed.push(`${name}.findMany`);
      return [{ id: 1 }];
    },
    count: async () => 1,
    create: async () => executed.push(`${name}.create`),
    update: async () => executed.push(`${name}.update`),
    upsert: async () => executed.push(`${name}.upsert`),
    delete: async () => executed.push(`${name}.delete`),
    updateMany: async () => executed.push(`${name}.updateMany`),
    deleteMany: async () => executed.push(`${name}.deleteMany`),
    createMany: async () => executed.push(`${name}.createMany`),
  });
  return {
    executed,
    base: {
      commissionReceivableSchedule: model("commissionReceivableSchedule"),
      commissionPaymentBatch: model("commissionPaymentBatch"),
      $transaction: async () => executed.push("$transaction"),
      $executeRaw: async () => executed.push("$executeRaw"),
      $executeRawUnsafe: async () => executed.push("$executeRawUnsafe"),
      $queryRaw: async () => executed.push("$queryRaw"),
      $queryRawUnsafe: async () => executed.push("$queryRawUnsafe"),
      $disconnect: async () => executed.push("$disconnect"),
    },
  };
}

describe("trava de somente leitura", () => {
  it("leituras passam e são contadas", async () => {
    const { base, executed } = fakeBase();
    const guard = createCommission360ReadOnlyPrisma(base);
    assert.deepEqual(await guard.client.commissionReceivableSchedule.findMany(), [{ id: 1 }]);
    assert.equal(await guard.client.commissionPaymentBatch.count(), 1);
    assert.deepEqual(executed, ["commissionReceivableSchedule.findMany"]);
    assert.equal(guard.reads.get("commissionReceivableSchedule.findMany"), 1);
    assert.deepEqual(guard.blocked, []);
  });

  it("toda escrita é bloqueada ANTES de chegar ao cliente real", async () => {
    const { base, executed } = fakeBase();
    const guard = createCommission360ReadOnlyPrisma(base);
    const attempts: Array<() => Promise<unknown>> = [
      () => guard.client.commissionReceivableSchedule.create(),
      () => guard.client.commissionReceivableSchedule.update(),
      () => guard.client.commissionReceivableSchedule.upsert(),
      () => guard.client.commissionReceivableSchedule.delete(),
      () => guard.client.commissionPaymentBatch.updateMany(),
      () => guard.client.commissionPaymentBatch.deleteMany(),
      () => guard.client.commissionPaymentBatch.createMany(),
      () => guard.client.$transaction(),
      () => guard.client.$executeRaw(),
      () => guard.client.$executeRawUnsafe(),
      () => guard.client.$queryRaw(),
      () => guard.client.$queryRawUnsafe(),
    ];
    for (const attempt of attempts) {
      assert.throws(() => attempt(), Commission360ReadOnlyViolation);
    }
    assert.equal(guard.blocked.length, attempts.length);
    assert.deepEqual(executed, [], "nenhuma operação de escrita chegou ao cliente");
    await guard.client.$disconnect();
    assert.deepEqual(executed, ["$disconnect"]);
  });

  it("destino mostrado sem senha e URL de auditoria com pool limitado", () => {
    const url = "postgresql://auditor:s3cr3t%40x@db.homolog.local:5433/induscost_homolog?schema=public";
    assert.deepEqual(describeCommission360DatabaseUrl(url), {
      host: "db.homolog.local",
      port: "5433",
      database: "induscost_homolog",
      user: "auditor",
      schema: "public",
    });
    const audit = new URL(buildCommission360AuditDatabaseUrl(url));
    assert.equal(audit.searchParams.get("connection_limit"), "3");
    assert.equal(audit.searchParams.get("application_name"), "induscost-audit-commission-360");
    assert.equal(audit.searchParams.get("schema"), "public");
    assert.equal(decodeURIComponent(audit.password), "s3cr3t@x");
  });
});

describe("script de auditoria (sem banco)", () => {
  const script = join(process.cwd(), "scripts/auditCommission360CrReconciliation.ts");
  const run = (args: string[], env: Record<string, string | undefined>) =>
    spawnSync(process.execPath, [join(process.cwd(), "node_modules/tsx/dist/cli.mjs"), script, ...args], {
      env: { ...process.env, DATABASE_URL: undefined, ...env },
      encoding: "utf8",
      timeout: 120_000,
    });
  const offline = "postgresql://offline:offline@127.0.0.1:1/induscost_homolog?schema=public";

  it("sem DATABASE_URL só explica e sai com 0", () => {
    const result = run([], { DATABASE_URL: "" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /DATABASE_URL ausente/);
  });

  it("recusa (código 3) sem --target-db, com período inválido ou longo demais — antes de conectar", () => {
    for (const args of [[], ["--target-db=x", "--from=2026-13"], ["--target-db=x", "--from=2024-01", "--to=2026-12"], ["--target-db=x", "--top=0"]]) {
      const result = run(args, { DATABASE_URL: offline });
      assert.equal(result.status, 3, `${args.join(" ")}: ${result.stdout} ${result.stderr}`);
      assert.match(result.stderr, /Recusado/);
      assert.doesNotMatch(result.stdout, /Sessão:/, "não chegou a consultar o banco");
    }
  });

  it("banco inacessível: falha com código 1 sem nenhuma leitura de negócio", () => {
    const result = run(["--target-db=induscost_homolog"], { DATABASE_URL: offline });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Destino: host 127\.0\.0\.1:1 · banco induscost_homolog · usuário offline/);
    assert.doesNotMatch(result.stdout, /offline:offline/, "senha nunca aparece");
    assert.doesNotMatch(result.stdout, /Leituras feitas/);
  });

  for (const [name, loaderModule] of [
    ["scripts/auditCommission360CrReconciliation.ts", "commission360View.server.js"],
    ["scripts/auditCommissionR1Duplication.ts", "commissionR1Audit.server.js"],
  ] as const) {
    it(`fonte de ${name}: conferência → transação READ ONLY → trava → loaders; nenhum SQL próprio`, () => {
      const source = readFileSync(join(process.cwd(), name), "utf8");
      assert.doesNotMatch(source, /^import .*(commission360View|commissionR1Audit)(\.server)?\.js/m, "loader nunca importado estaticamente");
      const checkAt = source.indexOf("await checkCommissionAuditSession(base");
      const txAt = source.indexOf("await runCommissionReadOnlyAudit(");
      const guardAt = source.indexOf("(globalThis as unknown as { prisma: unknown }).prisma = guard.client;");
      const loaderAt = source.indexOf(`await import("../src/lib/commissions/${loaderModule}")`);
      assert.ok(checkAt > 0 && txAt > checkAt && guardAt > txAt && loaderAt > guardAt, "ordem das garantias");
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        // hash SHA-256 dos fontes no registro de parâmetros (node:crypto), não é Prisma
        .replace(/createHash\("sha256"\)\.update\(/g, "");
      assert.doesNotMatch(code, /\$(queryRaw|executeRaw|transaction)|\.create\(|\.update\(|\.upsert\(|\.delete\(/);
    });
  }

  it("módulo da trava: o único SQL próprio são as três instruções de conferência/READ ONLY", () => {
    const code = readFileSync(join(process.cwd(), "src/lib/commissions/commission360ReadOnlyGuard.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const executes = [...code.matchAll(/\$executeRawUnsafe\(\s*"([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(executes, ["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"]);
    const queries = [...code.matchAll(/\$queryRawUnsafe\(\s*("(?:[^"\\]|\\.)*"|\w+)/g)].map((match) => match[1]!.trim());
    assert.equal(queries.length, 2);
    assert.match(queries[0]!, /^SESSION_SQL$/);
    assert.match(queries[1]!, /^"SELECT current_setting\('transaction_read_only'\)/);
    assert.match(code, /const SESSION_SQL = `\s*SELECT current_database\(\)/);
    assert.doesNotMatch(code.replace(/const SESSION_SQL = `[\s\S]*?`;/, ""), /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b\s+(INTO|TABLE|FROM|\w+\s+SET)/i);
  });
});

describe("CSV da conciliação", () => {
  it("texto da origem não vira fórmula e campos com ; ou aspas são escapados", () => {
    const row = classifyCommission360Receivable({
      receivableId: 1,
      invoiceNumber: "100",
      sourceInvoiceId: null,
      dueDate: "2026-11-10",
      customerName: '=HYPERLINK("http://x";"clique")',
      nominalAmount: 10,
      openBalance: 10,
      suspended: false,
      groupCompany: false,
      orderLinks: [],
      snapshots: [],
      nfeReceivables: [],
      outlookLines: [],
    });
    const [, body] = buildCommission360ReceivablesCsv([row]).split("\n");
    assert.match(body!, /^1;100;2026-11-10;"'=HYPERLINK\(""http:\/\/x"";""clique""\)";/);
  });
});

describe("conferência do ambiente e transação somente leitura", () => {
  const session = (over: Partial<CommissionAuditSession> = {}): CommissionAuditSession => ({
    database: "teste_bi_homolog",
    user: "induscost_audit_ro",
    version: "17.2",
    serverPort: 5433,
    readOnly: "off",
    canWrite: false,
    ...over,
  });
  const client = (row: CommissionAuditSession | null) => ({
    sql: [] as string[],
    async $queryRawUnsafe(sql: string, ...params: unknown[]) {
      this.sql.push(sql);
      assert.deepEqual(params[0], [...COMMISSION_AUDIT_CHECKED_TABLES]);
      return row ? [row] : [];
    },
  });
  const expected = { database: "teste_bi_homolog", port: 5433, requireReadOnlyRole: false };

  it("aceita o banco e a porta informados e devolve a sessão", async () => {
    const result = await checkCommissionAuditSession(client(session()), expected);
    assert.equal(result.user, "induscost_audit_ro");
  });

  it("recusa banco errado, porta errada, schema sem tabelas e papel com escrita quando exigido", async () => {
    await assert.rejects(checkCommissionAuditSession(client(session({ database: "teste_bi" })), expected), /diferente do informado/);
    await assert.rejects(checkCommissionAuditSession(client(session({ serverPort: 5432 })), expected), /Porta do servidor/);
    await assert.rejects(checkCommissionAuditSession(client(session({ canWrite: null })), expected), /não existem no schema/);
    await assert.rejects(
      checkCommissionAuditSession(client(session({ canWrite: true })), { ...expected, requireReadOnlyRole: true }),
      CommissionAuditRefused
    );
    const writable = await checkCommissionAuditSession(client(session({ canWrite: true })), expected);
    assert.equal(writable.canWrite, true, "sem --require-readonly-role só avisa");
  });

  function txBase(readOnlyAnswer: string) {
    const statements: string[] = [];
    const tx = {
      commissionReceivableSchedule: { findMany: async () => [{ id: "s" }], create: async () => statements.push("create") },
      async $executeRawUnsafe(sql: string) {
        statements.push(sql);
        return 0;
      },
      async $queryRawUnsafe(sql: string) {
        statements.push(sql);
        return [{ readOnly: readOnlyAnswer, isolation: "repeatable read" }];
      },
    };
    const base = {
      options: null as unknown,
      async $transaction(fn: (client: typeof tx) => Promise<unknown>, options?: unknown) {
        this.options = options;
        return fn(tx);
      },
    };
    return { base, statements };
  }

  it("primeira instrução da transação é SET TRANSACTION ... READ ONLY; o cliente entregue é a trava", async () => {
    const { base, statements } = txBase("on");
    const result = await runCommissionReadOnlyAudit(
      base,
      async (guard, info) => {
        assert.equal(info.readOnly, "on");
        assert.deepEqual(await guard.client.commissionReceivableSchedule.findMany(), [{ id: "s" }]);
        assert.throws(() => guard.client.commissionReceivableSchedule.create(), Commission360ReadOnlyViolation);
        assert.throws(() => guard.client.$executeRawUnsafe("DELETE FROM x"), Commission360ReadOnlyViolation);
        return "ok";
      },
      { timeoutMs: 60_000 }
    );
    assert.equal(result, "ok");
    assert.equal(statements[0], "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    assert.ok(!statements.includes("create") && !statements.includes("DELETE FROM x"));
    assert.deepEqual(base.options, { maxWait: 10_000, timeout: 60_000 });
  });

  it("recusa se a sessão não ficar em transaction_read_only = on (nada é lido)", async () => {
    const { base } = txBase("off");
    let called = false;
    await assert.rejects(
      runCommissionReadOnlyAudit(base, async () => {
        called = true;
      }, { timeoutMs: 1000 }),
      /não ficou em modo somente leitura/
    );
    assert.equal(called, false);
  });
});
