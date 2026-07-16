import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  buildAuditResult,
  disconnectPrismaSafe,
  formatDatabaseUnavailableMessage,
  isDatabaseUnavailableError,
  parseAuditOutputDocumentsDbArgs,
  sanitizeDatabaseUrl,
} from "./auditOutputDocumentsDb.js";
import { writeAuditReports } from "./auditOutputDocumentsReports.io.js";
import {
  buildUnavailableAuditGuardResult,
  extractPrismaSqlTemplateBodies,
  resolveAuditProcessExitCode,
  scanAllAuditorReadOnlySources,
  scanAuditorSourceForReadOnlyViolations,
  stripCommentsAndStringLiterals,
} from "./auditOutputDocumentsReadOnlyGuard.js";

const tempRoots: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "induscost-readonly-guard-"));
  tempRoots.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("stripCommentsAndStringLiterals", () => {
  it("remove prosa de documentacao sem apagar codigo", () => {
    const source = `
      // não executa create, update, upsert ou delete
      /* .create( ) em comentario */
      const note = "texto com .create( )";
      prisma.nomusStockDocument.findMany();
    `;
    const stripped = stripCommentsAndStringLiterals(source);
    assert.equal(/\.create\s*\(/.test(stripped), false);
    assert.match(stripped, /findMany/);
  });
});

describe("scanAuditorSourceForReadOnlyViolations", () => {
  it("detecta Prisma write e SQL DML sem falso positivo em docs", () => {
    const clean = `
      /**
       * Este auditor não executa create, update, upsert ou delete.
       */
      const rows = await prisma.$queryRaw\`SELECT id FROM "NomusStockDocument"\`;
    `;
    assert.deepEqual(scanAuditorSourceForReadOnlyViolations("clean.ts", clean), []);

    const dirtyPrisma = `await prisma.nomusStockDocument.create({ data: {} });`;
    assert.ok(
      scanAuditorSourceForReadOnlyViolations("dirty.ts", dirtyPrisma).some(
        (v) => v.ruleId === "prisma.create"
      )
    );

    const dirtySql = `await prisma.$queryRaw\`INSERT INTO "X" (id) VALUES (1)\`;`;
    assert.ok(
      scanAuditorSourceForReadOnlyViolations("dirty-sql.ts", dirtySql).some(
        (v) => v.ruleId === "sql.dml_ddl"
      )
    );

    const forUpdate = `await prisma.$queryRaw\`SELECT 1 FOR UPDATE\`;`;
    assert.ok(
      scanAuditorSourceForReadOnlyViolations("lock.ts", forUpdate).some(
        (v) => v.ruleId === "sql.forUpdate"
      )
    );

    const nomusHttp = `await fetchNomus("/pedidos");`;
    assert.ok(
      scanAuditorSourceForReadOnlyViolations("nomus.ts", nomusHttp).some(
        (v) => v.ruleId === "nomus.clientCall"
      )
    );

    const httpServer = `import http from "node:http";\nhttp.createServer(() => {}).listen(3000);`;
    const httpHits = scanAuditorSourceForReadOnlyViolations("http.ts", httpServer);
    assert.ok(httpHits.some((v) => v.ruleId === "http.createServer"));
  });

  it("extrai apenas templates SQL Prisma", () => {
    const source = `
      const a = Prisma.sql\`SELECT 1\`;
      await prisma.$queryRaw\`SELECT 2\`;
      const notSql = \`INSERT INTO x\`;
    `;
    const bodies = extractPrismaSqlTemplateBodies(source);
    assert.equal(bodies.length, 2);
    assert.ok(bodies.every((b) => /SELECT/.test(b)));
  });
});

describe("scanAllAuditorReadOnlySources", () => {
  it("fontes reais do auditor passam na varredura estatica", () => {
    const violations = scanAllAuditorReadOnlySources();
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.file}:${v.ruleId}:${v.snippet}`).join("\n")
    );
  });
});

describe("banco indisponivel — mensagem, senha, exitCode, disconnect, I/O", () => {
  it("mensagem clara sem expor senha e exitCode != 0", () => {
    const guarded = buildUnavailableAuditGuardResult({
      rawDatabaseUrl: "postgresql://user:S3cr3tP@ss@db.host:5432/induscost",
      sanitize: sanitizeDatabaseUrl,
      formatMessage: formatDatabaseUnavailableMessage,
    });
    assert.equal(guarded.status, "unavailable");
    assert.equal(guarded.exitCode, 1);
    assert.equal(resolveAuditProcessExitCode("ok"), 0);
    assert.equal(resolveAuditProcessExitCode("error"), 1);
    assert.equal(resolveAuditProcessExitCode("args_invalid"), 1);
    assert.match(guarded.message, /indisponível/i);
    assert.match(guarded.message, /db\.host:5432\/induscost/);
    assert.ok(!guarded.message.includes("S3cr3tP@ss"));
    assert.ok(!guarded.message.includes("user:"));
    assert.ok(!(guarded.display ?? "").includes("S3cr3t"));
  });

  it("classifica erro de indisponibilidade e desconecta Prisma", async () => {
    assert.equal(
      isDatabaseUnavailableError(
        Object.assign(new Error("Can't reach database server"), {
          name: "PrismaClientInitializationError",
        })
      ),
      true
    );

    let disconnectCalls = 0;
    await disconnectPrismaSafe({
      $disconnect: async () => {
        disconnectCalls += 1;
      },
    });
    assert.equal(disconnectCalls, 1);
  });

  it("falha de escrita nao deixa arquivo .tmp parcial invalido", () => {
    const root = makeTempDir();
    const blocker = join(root, "blocked");
    writeFileSync(blocker, "file", "utf8");
    const badJson = join(blocker, "out.json");
    const badMd = join(blocker, "out.md");

    const result = buildAuditResult({
      startedAt: new Date("2026-07-16T23:00:00.000Z"),
      finishedAt: new Date("2026-07-16T23:00:01.000Z"),
      options: parseAuditOutputDocumentsDbArgs([]),
      database: sanitizeDatabaseUrl(
        "postgresql://u:p@localhost:5432/induscost"
      ),
      status: "unavailable",
      error: formatDatabaseUnavailableMessage(
        sanitizeDatabaseUrl("postgresql://u:p@localhost:5432/induscost")
      ),
      mode: "examples-audit",
    });

    assert.throws(() =>
      writeAuditReports({
        result,
        jsonOutput: badJson,
        markdownOutput: badMd,
      })
    );

    const leftovers = readdirSync(root, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
    assert.equal(existsSync(badJson), false);
    assert.equal(existsSync(badMd), false);
  });

  it("escrita atomica bem-sucedida produz JSON valido completo", () => {
    const root = makeTempDir();
    const result = buildAuditResult({
      startedAt: new Date("2026-07-16T23:00:00.000Z"),
      finishedAt: new Date("2026-07-16T23:00:01.000Z"),
      options: parseAuditOutputDocumentsDbArgs([]),
      database: null,
      status: "unavailable",
      error: "Banco de dados indisponível para o alvo sanitizado localhost:5432/x.",
      mode: "examples-audit",
    });
    const written = writeAuditReports({
      result,
      jsonOutput: join(root, "a.json"),
      markdownOutput: join(root, "a.md"),
    });
    const parsed = JSON.parse(readFileSync(written.jsonPath, "utf8"));
    assert.equal(parsed.metadata.status, "unavailable");
    assert.ok(parsed.metadata.error);
    assert.ok(!String(parsed.metadata.error).includes("password"));
  });
});
