import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertBundleContainsNoForbiddenSecrets,
  contextToRedactionReport,
  createRedactionReport,
  createSanitizationContext,
  redactionMask,
  sanitizeDiagnosticError,
  sanitizeDiagnosticHeaders,
  sanitizeDiagnosticLogLines,
  sanitizeDiagnosticPayload,
  sanitizeDiagnosticText,
} from "./sanitizeDiagnosticPayload.server.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";

describe("sanitizeDiagnosticPayload", () => {
  it("mascara DATABASE_URL em string", () => {
    const ctx = createSanitizationContext();
    const out = sanitizeDiagnosticText(
      "DATABASE_URL=postgresql://user:secret@host/db",
      ctx
    );
    assert.match(out, /\[REDACTED:DATABASE_URL\]/);
    assert.doesNotMatch(out, /postgresql:\/\//);
    assert.ok(ctx.redactedFieldsCount >= 1);
  });

  it("mascara header Authorization", () => {
    const ctx = createSanitizationContext();
    const headers = sanitizeDiagnosticHeaders(
      { Authorization: "Bearer abc123xyz", "Content-Type": "application/json" },
      ctx
    );
    assert.equal(headers.Authorization, redactionMask("Authorization"));
    assert.equal(headers["Content-Type"], "application/json");
  });

  it("mascara Cookie", () => {
    const ctx = createSanitizationContext();
    const headers = sanitizeDiagnosticHeaders(
      { Cookie: "session=abc123; path=/" },
      ctx
    );
    assert.equal(headers.Cookie, redactionMask("Cookie"));
  });

  it("mascara JWT em texto livre", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const ctx = createSanitizationContext();
    const out = sanitizeDiagnosticText(`Token recebido: ${jwt}`, ctx);
    assert.match(out, /\[REDACTED:JWT\]/);
    assert.doesNotMatch(out, /eyJhbGci/);
  });

  it("sanitiza JSON aninhado", () => {
    const ctx = createSanitizationContext();
    const out = sanitizeDiagnosticPayload(
      {
        config: {
          apiKey: "sk-live-secret",
          host: "api.example.com",
        },
        DATABASE_URL: "postgresql://u:p@h/d",
      },
      ctx
    ) as Record<string, unknown>;
    assert.equal(out.DATABASE_URL, redactionMask("DATABASE_URL"));
    assert.equal(
      (out.config as Record<string, unknown>).apiKey,
      redactionMask("apiKey")
    );
    assert.equal((out.config as Record<string, unknown>).host, "api.example.com");
  });

  it("logs Prisma permanecem úteis sem segredos", () => {
    const ctx = createSanitizationContext();
    const logs = sanitizeDiagnosticLogLines(
      [
        "prisma:query SELECT id, sku FROM Product WHERE id = $1",
        "prisma:error Error in connector: DATABASE_URL=postgresql://user:pass@db/prod",
        "prisma:info Connection pool timeout after 5000ms",
      ],
      ctx
    );
    assert.match(logs, /SELECT id, sku FROM Product/);
    assert.match(logs, /Connection pool timeout/);
    assert.doesNotMatch(logs, /postgresql:\/\//);
    assert.match(logs, /\[REDACTED:DATABASE_URL\]/);
  });

  it("redaction report contabiliza campos mascarados", () => {
    const before = {
      headers: { Authorization: "Bearer x" },
      DATABASE_URL: "postgresql://a:b@c/d",
    };
    const after = sanitizeDiagnosticPayload(before);
    const report = createRedactionReport(before, after, [
      "08_API_TRACE.json",
      "12_LOGS_SANITIZED.log",
    ]);
    assert.ok(report.redactedFieldsCount >= 2);
    assert.ok(report.redactedPatterns.length >= 1);
    assert.deepEqual(report.filesSanitized.sort(), [
      "08_API_TRACE.json",
      "12_LOGS_SANITIZED.log",
    ]);
  });

  it("sanitizeDiagnosticError limita stack trace", () => {
    const ctx = createSanitizationContext();
    const err = new Error("Falha com token=abc123");
    err.stack = ["Error: Falha", ...Array.from({ length: 30 }, (_, i) => `  at fn${i} ()`)].join(
      "\n"
    );
    const out = sanitizeDiagnosticError(err, ctx);
    assert.match(String(out.message), /\[REDACTED:TOKEN\]|Falha/);
    const stack = String(out.stack ?? "");
    assert.ok(stack.split("\n").length <= 20);
  });

  it("contextToRedactionReport agrega padrões", () => {
    const ctx = createSanitizationContext();
    sanitizeDiagnosticText("Authorization: Bearer abc", ctx);
    sanitizeDiagnosticText("Cookie: sid=1", ctx);
    const report = contextToRedactionReport(ctx);
    assert.ok(report.redactedFieldsCount >= 2);
    assert.ok(report.redactedPatterns.includes("authorization"));
    assert.ok(report.redactedPatterns.includes("cookie"));
  });
});

describe("sanitizeDiagnosticPayload bundle safety", () => {
  it("nenhum arquivo do bundle contém segredos proibidos", () => {
    const bundle = buildChatGptDiagnosticBundle({
      scope: "SYSTEM",
      context: {
        scope: "SYSTEM",
        apiCalls: [
          {
            method: "GET",
            path: "/api/test",
            status: 200,
          },
        ],
        errorMessage: "Erro com Bearer leaked-token-should-not-appear",
      },
      logs: [
        "DATABASE_URL=postgresql://user:pass@host/db",
        "Authorization: Bearer secret-token",
      ],
      systemSnapshot: {
        DATABASE_URL: "postgresql://leak:pass@host/db",
        password: "plain-password",
        token: "access-token-value",
      },
    });
    assertRequiredBundleStructure(bundle);

    for (const [path, content] of Object.entries(bundle.entries)) {
      if (path.endsWith(".gitkeep")) continue;
      assert.doesNotMatch(content, /\.env\b/i, `${path} contém .env`);
      assert.doesNotMatch(content, /Bearer /, `${path} contém Bearer `);
      assert.doesNotMatch(content, /DATABASE_URL=/, `${path} contém DATABASE_URL=`);
      assert.doesNotMatch(content, /postgresql:\/\//, `${path} contém connection string`);
      assert.doesNotMatch(
        content,
        /(?:senha|password)\s*[:=]\s*[^\s\[\n\r]{3,}/i,
        `${path} contém senha clara`
      );
    }

    const redaction = JSON.parse(bundle.entries["15_REDACTION_REPORT.json"]);
    assert.ok(redaction.redactedFieldsCount >= 1);
    assert.ok(Array.isArray(redaction.filesSanitized));
    assert.ok(redaction.filesSanitized.length >= 1);

    const combined = Object.values(bundle.entries).join("\n");
    assert.doesNotThrow(() => assertBundleContainsNoForbiddenSecrets(combined));
  });
});
