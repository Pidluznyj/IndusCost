import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  collectValueExports,
  findMissingNamedExports,
  wouldCatchHistoricalAlertConfigPatchBug,
} from "../../scripts/checkServerImports.ts";

describe("check:server-imports", () => {
  it("o probe histórico ainda captura parseMaterialMarketAlertConfigPatch ausente", () => {
    assert.equal(wouldCatchHistoricalAlertConfigPatchBug(), true);
    const exports = collectValueExports(
      path.join(process.cwd(), "src/lib/materialMarketAlertConfig.ts")
    );
    assert.equal(exports.values.has("parseMaterialMarketAlertConfigPatch"), false);
  });

  it("detecta named export fantasma em um par sintético de arquivos", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "induscost-server-imports-"));
    try {
      const modPath = path.join(dir, "mod.ts");
      const importerPath = path.join(dir, "importer.ts");
      writeFileSync(modPath, "export function realHelper() { return 1; }\n");
      writeFileSync(
        importerPath,
        "import { parseMaterialMarketAlertConfigPatch } from './mod.js';\n"
      );

      const issues = findMissingNamedExports([importerPath]);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.name, "parseMaterialMarketAlertConfigPatch");
      assert.equal(issues[0]?.reason, "missing-export");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audit routes atuais não têm named import fantasma (estático)", () => {
    const issues = findMissingNamedExports(["src/lib/materialMarketAuditRoutes.ts"]);
    assert.deepEqual(issues, []);
  });
});
