import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  DIAGNOSTIC_BUNDLE_MAX_TOTAL_BYTES,
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticFinding,
} from "./chatgptDiagnosticTypes.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import { redactionMask } from "./sanitizeDiagnosticPayload.server.js";
import {
  buildSystemDiagnosticBundleInput,
  buildSystemExecutiveSummaryMarkdown,
  collectGitSnapshot,
  collectRecentSanitizedLogLines,
  evaluateSystemAutoDiagnostics,
  listFilesystemMigrationNames,
  parseSystemDiagnosticRequest,
  scanDistForPrismaLeaks,
} from "./systemDiagnostic.server.js";

describe("systemDiagnostic", () => {
  it("parseia request SYSTEM", () => {
    const parsed = parseSystemDiagnosticRequest({ scope: "SYSTEM", context: {} });
    assert.equal(parsed.scope, "SYSTEM");
  });

  it("rejeita scope inválido", () => {
    assert.throws(
      () => parseSystemDiagnosticRequest({ scope: "PRODUCT_ENGINEERING" }),
      /SYSTEM/
    );
  });

  it("captura commit e branch git", () => {
    const git = collectGitSnapshot();
    assert.ok(git.commit === null || git.commit.length >= 7);
    assert.ok(git.branch === null || git.branch.length >= 1);
    assert.equal(typeof git.isDirty, "boolean");
  });

  it("lista migrations do filesystem", () => {
    const names = listFilesystemMigrationNames();
    assert.ok(names.length > 0);
    assert.ok(names.every((n) => !n.includes("/")));
  });

  it("detecta MIGRATION_PENDING", () => {
    const diags = evaluateSystemAutoDiagnostics({
      git: collectGitSnapshot(),
      buildInfo: { commit: "abc", buildTime: "2026-01-01", env: "development" },
      database: {
        databaseConfigured: true,
        provider: "postgresql",
        connectionOk: true,
        connectionError: null,
        appliedMigrations: ["m1"],
        pendingMigrations: ["m2_pending"],
        criticalTables: [{ table: "Product", exists: true }],
      },
      prismaVersions: {
        name: "react-example",
        version: "0.0.0",
        prismaClientVersion: "^5.22.0",
        prismaCliVersion: "^5.22.0",
      },
      browserLeaks: [],
      nomus: { syncConfigured: true, locks: { globalLockHeld: false } },
      recentFailures: [],
      logLines: [],
      distExists: true,
    });
    assert.ok(diags.some((d) => d.code === "MIGRATION_PENDING"));
  });

  it("detecta BUILD_ARTIFACT_STALE e FRONTEND_BUNDLE_SERVER_IMPORT", () => {
    const diags = evaluateSystemAutoDiagnostics({
      git: { commit: "deadbeef", branch: "main", isDirty: false, changedFilesCount: 0, statusSummary: "clean" },
      buildInfo: { commit: "cafebabe", buildTime: "2026-01-01", env: "development" },
      database: {
        databaseConfigured: true,
        provider: "postgresql",
        connectionOk: true,
        connectionError: null,
        appliedMigrations: [],
        pendingMigrations: [],
        criticalTables: [],
      },
      prismaVersions: {
        name: "x",
        version: "0.0.0",
        prismaClientVersion: "^5.22.0",
        prismaCliVersion: "^5.22.0",
      },
      browserLeaks: [{ file: "dist/assets/index.js", label: "@prisma/client" }],
      nomus: { syncConfigured: false, locks: {} },
      recentFailures: [],
      logLines: ["Unknown field `exclusionRuleId` for select statement"],
      distExists: true,
    });
    assert.ok(diags.some((d) => d.code === "BUILD_ARTIFACT_STALE"));
    assert.ok(diags.some((d) => d.code === "FRONTEND_BUNDLE_SERVER_IMPORT"));
    assert.ok(diags.some((d) => d.code === "UNKNOWN_FIELD_IN_PRISMA_SELECT"));
  });

  it("logs sanitizados não contêm DATABASE_URL bruto", () => {
    const lines = collectRecentSanitizedLogLines();
    const joined = lines.join("\n");
    assert.doesNotMatch(joined, /postgresql:\/\//);
  });

  it("executive summary inclui commit e migrations", () => {
    const md = buildSystemExecutiveSummaryMarkdown({
      git: { commit: "abc1234", branch: "main", isDirty: false, changedFilesCount: 0, statusSummary: "clean" },
      buildInfo: { commit: "abc1234", buildTime: "2026-06-01", env: "development" },
      pkg: { name: "react-example", version: "0.0.0", prismaClientVersion: "^5.22.0", prismaCliVersion: "^5.22.0" },
      database: {
        databaseConfigured: true,
        provider: "postgresql",
        connectionOk: true,
        connectionError: null,
        appliedMigrations: ["m1"],
        pendingMigrations: [],
        criticalTables: [{ table: "Product", exists: true }],
      },
      autoDiagnostics: [{ code: "SYSTEM_HEALTH_OK", severity: "info", title: "OK", message: "ok" }],
      nomus: { syncConfigured: true },
      distExists: true,
      generatedAt: "2026-06-01T00:00:00.000Z",
    });
    assert.match(md, /Commit/);
    assert.match(md, /Migrations aplicadas/);
    assert.match(md, /Branch/);
  });

  it("monta bundle SYSTEM completo sem segredos", async () => {
    const input = await buildSystemDiagnosticBundleInput(null, {
      screenTitle: "Gerar Relatório Analisável",
    });
    const bundle = buildChatGptDiagnosticBundle(input);
    assertRequiredBundleStructure(bundle);

    for (const path of REQUIRED_BUNDLE_ROOT_FILES) {
      assert.ok(bundle.entries[path], `ausente: ${path}`);
    }

    const snapshot = JSON.parse(bundle.entries["06_SYSTEM_SNAPSHOT.json"]);
    assert.equal(snapshot.app.appName, "IndusCost / My Industry");
    assert.ok(snapshot.app.nodeVersion);

    const allContent = Object.values(bundle.entries).join("\n");
    assert.doesNotMatch(allContent, /postgresql:\/\//);
    assert.doesNotMatch(allContent, /Bearer /);
    assert.ok(!allContent.includes(process.env.DATABASE_URL ?? "__no_db__"));

    const totalBytes = Object.values(bundle.entries).reduce(
      (sum, c) => sum + Buffer.byteLength(c, "utf8"),
      0
    );
    assert.ok(totalBytes < DIAGNOSTIC_BUNDLE_MAX_TOTAL_BYTES);
    assert.ok(totalBytes < 2_000_000, "bundle SYSTEM deve permanecer leve (<2MB)");
  });

  it("findings SYSTEM têm sourceRefs", async () => {
    const input = await buildSystemDiagnosticBundleInput(null);
    const bundle = buildChatGptDiagnosticBundle(input);
    const diagnostics = JSON.parse(bundle.entries["04_DIAGNOSTICS.json"]) as {
      findings: DiagnosticFinding[];
    };
    assert.ok(diagnostics.findings.length >= 1);
    for (const f of diagnostics.findings) {
      assert.ok(f.sourceRefs.length >= 1);
    }
  });

  it("scanDistForPrismaLeaks retorna array", () => {
    const leaks = scanDistForPrismaLeaks();
    assert.ok(Array.isArray(leaks));
  });

  it("rotas suportam SYSTEM", () => {
    const src = readFileSync("src/lib/diagnostics/diagnosticBundleRoutes.server.ts", "utf8");
    assert.match(src, /scope === "SYSTEM"/);
    assert.match(src, /buildAndWriteSystemDiagnosticBundle/);
  });

  it("sanitização mascara token em payload", () => {
    const masked = redactionMask("token");
    assert.match(masked, /REDACTED/);
  });
});
