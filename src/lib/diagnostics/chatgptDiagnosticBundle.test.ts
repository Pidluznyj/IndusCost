import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { after, describe, it } from "node:test";

// O builder só grava em tmp/ do projeto (gitignored); o teste remove o que gerou para não acumular
// arquivos no servidor onde o gate do deploy roda.
const generated: string[] = [];
after(() => {
  for (const path of generated) rmSync(path, { recursive: true, force: true });
});
import {
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticFinding,
} from "./chatgptDiagnosticTypes.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
  buildMinimalSystemDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  redactionMask,
  sanitizeDiagnosticPayload,
} from "./sanitizeDiagnosticPayload.server.js";

describe("chatgptDiagnosticBundle", () => {
  it("gera bundle mínimo SYSTEM com arquivos obrigatórios", () => {
    const bundle = buildChatGptDiagnosticBundle({ scope: "SYSTEM" });
    assertRequiredBundleStructure(bundle);
    for (const path of REQUIRED_BUNDLE_ROOT_FILES) {
      assert.ok(bundle.entries[path], `ausente: ${path}`);
    }
    assert.match(bundle.entries["00_README_FOR_CHATGPT.md"], /ChatGPT/);
    assert.match(bundle.entries["CHATGPT_ANALYSIS_PROMPT.md"], /IndusCost/);
  });

  it("manifest.json lista todos os arquivos do bundle", () => {
    const bundle = buildChatGptDiagnosticBundle({ scope: "SYSTEM" });
    const manifest = JSON.parse(bundle.entries["manifest.json"]);
    const entryPaths = new Set(Object.keys(bundle.entries));
    for (const file of manifest.files) {
      assert.ok(entryPaths.has(file.path), `manifest referencia ${file.path}`);
    }
    assert.equal(manifest.files.length, entryPaths.size);
  });

  it("findings têm severity, code, message e sourceRefs", () => {
    const bundle = buildChatGptDiagnosticBundle({ scope: "SYSTEM" });
    const diagnostics = JSON.parse(bundle.entries["04_DIAGNOSTICS.json"]) as {
      findings: DiagnosticFinding[];
    };
    assert.ok(diagnostics.findings.length >= 1);
    for (const finding of diagnostics.findings) {
      assert.ok(finding.severity);
      assert.ok(finding.code);
      assert.ok(finding.message);
      assert.ok(Array.isArray(finding.sourceRefs));
    }
  });

  it("JSONs obrigatórios são parseáveis", () => {
    const bundle = buildChatGptDiagnosticBundle({ scope: "SYSTEM" });
    for (const path of Object.keys(bundle.entries)) {
      if (!path.endsWith(".json")) continue;
      assert.doesNotThrow(() => JSON.parse(bundle.entries[path]), path);
    }
  });

  it("sanitiza DATABASE_URL em payloads", () => {
    const sanitized = sanitizeDiagnosticPayload({
      DATABASE_URL: "postgresql://user:pass@host/db",
      nested: { token: "secret-value" },
    });
    const obj = sanitized as Record<string, unknown>;
    assert.equal(obj.DATABASE_URL, redactionMask("DATABASE_URL"));
    assert.equal((obj.nested as Record<string, unknown>).token, redactionMask("token"));
  });

  it("builder grava apenas em tmp/diagnostic-bundles", async () => {
    const result = await buildMinimalSystemDiagnosticBundle();
    generated.push(result.outputDir, result.zipPath);
    assert.match(result.outputDir.replace(/\\/g, "/"), /^tmp\/diagnostic-bundles\//);
    assert.match(result.zipPath.replace(/\\/g, "/"), /^tmp\/diagnostic-bundles\//);
  });

  it("módulo não grava fora de tmp/", () => {
    const src = readFileSync("src/lib/diagnostics/diagnosticBundleBuilder.server.ts", "utf8");
    assert.match(src, /tmp\/diagnostic-bundles/);
    assert.doesNotMatch(src, /writeFileSync\([^)]*dist\//);
  });
});
