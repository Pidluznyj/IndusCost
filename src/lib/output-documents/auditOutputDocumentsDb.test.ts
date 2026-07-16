import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS,
  AUDIT_OUTPUT_DOCUMENTS_DB_FORBIDDEN_WRITE_PATTERNS,
  buildAuditResult,
  buildEmptyAuditSections,
  disconnectPrismaSafe,
  formatAuditOutputDocumentsDbMarkdown,
  formatDatabaseUnavailableMessage,
  isDatabaseUnavailableError,
  parseAuditOutputDocumentsDbArgs,
  readDatabaseUrlSafe,
  resolveDefaultOutputPaths,
  sanitizeDatabaseUrl,
} from "./auditOutputDocumentsDb.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(
  HERE,
  "..",
  "..",
  "..",
  "scripts",
  "auditOutputDocumentsDb.ts"
);

describe("parseAuditOutputDocumentsDbArgs", () => {
  it("aplica valores padrão quando argv está vazio", () => {
    const options = parseAuditOutputDocumentsDbArgs([]);
    assert.equal(options.document, AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.document);
    assert.equal(options.order, AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.order);
    assert.equal(options.nfe, AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.nfe);
    assert.equal(
      options.sampleLimit,
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.sampleLimit
    );
    assert.equal(
      options.jsonOutput,
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.jsonOutput
    );
    assert.equal(
      options.markdownOutput,
      AUDIT_OUTPUT_DOCUMENTS_DB_DEFAULTS.markdownOutput
    );
  });

  it("parseia argumentos nomeados", () => {
    const options = parseAuditOutputDocumentsDbArgs([
      "--document=9001",
      "--order=PD02139",
      "--nfe=6937",
      "--sample-limit=5",
      "--json-output=tmp/out.json",
      "--markdown-output=tmp/out.md",
    ]);
    assert.deepEqual(options, {
      document: 9001,
      order: "PD02139",
      nfe: 6937,
      sampleLimit: 5,
      jsonOutput: "tmp/out.json",
      markdownOutput: "tmp/out.md",
    });
  });

  it("rejeita inteiros inválidos", () => {
    assert.throws(
      () => parseAuditOutputDocumentsDbArgs(["--document=0"]),
      /--document inválido/
    );
    assert.throws(
      () => parseAuditOutputDocumentsDbArgs(["--nfe=abc"]),
      /--nfe inválido/
    );
    assert.throws(
      () => parseAuditOutputDocumentsDbArgs(["--sample-limit=-1"]),
      /--sample-limit inválido/
    );
  });
});

describe("sanitizeDatabaseUrl / readDatabaseUrlSafe", () => {
  it("sanitiza host, porta e database sem usuário/senha", () => {
    const sanitized = sanitizeDatabaseUrl(
      "postgresql://auditor_user:s3cret@db.example.com:5432/induscost_prod?sslmode=require"
    );
    assert.ok(sanitized);
    assert.equal(sanitized!.host, "db.example.com");
    assert.equal(sanitized!.port, "5432");
    assert.equal(sanitized!.database, "induscost_prod");
    assert.equal(
      sanitized!.display,
      "postgresql://db.example.com:5432/induscost_prod"
    );
    assert.ok(!sanitized!.display.includes("auditor_user"));
    assert.ok(!sanitized!.display.includes("s3cret"));
  });

  it("não inclui credenciais mesmo quando a senha tem caracteres especiais", () => {
    const sanitized = sanitizeDatabaseUrl(
      "postgresql://u:p%40ss@localhost:5432/mydb"
    );
    assert.ok(sanitized);
    assert.equal(sanitized!.display, "postgresql://localhost:5432/mydb");
    assert.ok(!sanitized!.display.includes("p%40ss"));
    assert.ok(!sanitized!.display.includes("@ss"));
  });

  it("retorna erro claro quando DATABASE_URL está ausente", () => {
    const missing = readDatabaseUrlSafe({});
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.match(missing.error, /DATABASE_URL ausente/);

    const empty = readDatabaseUrlSafe({ DATABASE_URL: "   " });
    assert.equal(empty.ok, false);
  });

  it("aceita URL válida sem logar a URL completa", () => {
    const ok = readDatabaseUrlSafe({
      DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/induscost",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    const sanitized = sanitizeDatabaseUrl(ok.url);
    assert.equal(sanitized?.display, "postgresql://127.0.0.1:5432/induscost");
  });
});

describe("resolveDefaultOutputPaths", () => {
  it("expõe caminhos padrão documentados", () => {
    assert.deepEqual(resolveDefaultOutputPaths(), {
      jsonOutput: "docs/output-documents/audit-output-documents-db.json",
      markdownOutput: "docs/output-documents/audit-output-documents-db.md",
    });
  });
});

describe("estrutura básica do resultado", () => {
  it("monta scaffold com metadados e seções vazias", () => {
    const startedAt = new Date("2026-07-16T12:00:00.000Z");
    const finishedAt = new Date("2026-07-16T12:00:01.250Z");
    const options = parseAuditOutputDocumentsDbArgs([]);
    const result = buildAuditResult({
      startedAt,
      finishedAt,
      options,
      database: sanitizeDatabaseUrl(
        "postgresql://u:p@localhost:5432/induscost"
      ),
      status: "ok",
    });

    assert.equal(result.meta.mode, "scaffold");
    assert.equal(result.meta.readOnly, true);
    assert.equal(result.meta.startedAt, "2026-07-16T12:00:00.000Z");
    assert.equal(result.meta.finishedAt, "2026-07-16T12:00:01.250Z");
    assert.equal(result.meta.durationMs, 1250);
    assert.equal(result.meta.database?.host, "localhost");
    assert.equal(result.status, "ok");
    assert.equal(result.error, null);

    const sections = buildEmptyAuditSections();
    assert.deepEqual(result.sections.counts, sections.counts);
    assert.equal(result.sections.documentFocus, null);
    assert.equal(result.sections.orderFocus, null);
    assert.equal(result.sections.nfeFocus, null);
    assert.deepEqual(result.sections.samples, {});
    assert.deepEqual(result.sections.gaps, []);
    assert.deepEqual(result.sections.risks, []);
    assert.ok(result.sections.notes.length >= 1);

    const markdown = formatAuditOutputDocumentsDbMarkdown(result);
    assert.match(markdown, /Status/);
    assert.match(markdown, /scaffold/);
    assert.match(markdown, /8451/);
    assert.match(markdown, /PD02590/);
    assert.match(markdown, /7208/);
  });
});

describe("banco indisponível e desconexão", () => {
  it("classifica erros de indisponibilidade e formata mensagem clara", () => {
    assert.equal(
      isDatabaseUnavailableError(
        Object.assign(new Error("Can't reach database server at `localhost:5432`"), {
          name: "PrismaClientInitializationError",
        })
      ),
      true
    );
    assert.equal(
      isDatabaseUnavailableError(new Error("P1001: Can't reach database server")),
      true
    );
    assert.equal(
      isDatabaseUnavailableError(new Error("validation failed")),
      false
    );

    const message = formatDatabaseUnavailableMessage(
      sanitizeDatabaseUrl("postgresql://u:p@db.host:5432/app")
    );
    assert.match(message, /indisponível/);
    assert.match(message, /db\.host:5432\/app/);
    assert.ok(!message.includes("postgresql://u:p@"));
  });

  it("desconecta o Prisma mesmo em erro", async () => {
    let disconnectCalls = 0;
    const prisma = {
      $disconnect: async () => {
        disconnectCalls += 1;
      },
    };

    await disconnectPrismaSafe(prisma);
    assert.equal(disconnectCalls, 1);

    await disconnectPrismaSafe({
      $disconnect: async () => {
        disconnectCalls += 1;
        throw new Error("disconnect failed");
      },
    });
    assert.equal(disconnectCalls, 2);

    await disconnectPrismaSafe(null);
    await disconnectPrismaSafe(undefined);
    assert.equal(disconnectCalls, 2);
  });
});

describe("garantia read-only do script", () => {
  it("não contém operações de escrita Prisma no runner", () => {
    const source = readFileSync(SCRIPT_PATH, "utf8");
    for (const pattern of AUDIT_OUTPUT_DOCUMENTS_DB_FORBIDDEN_WRITE_PATTERNS) {
      assert.equal(
        pattern.test(source),
        false,
        `padrão de escrita proibido encontrado: ${pattern}`
      );
    }
    assert.match(source, /disconnectPrismaSafe/);
    assert.match(source, /probeDatabaseConnectivity/);
  });
});
