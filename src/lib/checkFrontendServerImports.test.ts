import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  findFrontendServerImportLeaks,
  FORBIDDEN_NODE_BUILTINS,
  traceFromEntry,
} from "../../scripts/checkFrontendServerImports.ts";

describe("check:frontend-server-imports — Node builtins", () => {
  it("lista builtins Node proibidos inclui crypto e util", () => {
    assert.equal(FORBIDDEN_NODE_BUILTINS.has("crypto"), true);
    assert.equal(FORBIDDEN_NODE_BUILTINS.has("util"), true);
    assert.equal(FORBIDDEN_NODE_BUILTINS.has("node:crypto"), true);
    assert.equal(FORBIDDEN_NODE_BUILTINS.has("fs"), true);
  });

  it("falha em fixture com cadeia frontend → crypto/util (caso appAuth)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "induscost-fe-imports-"));
    try {
      mkdirSync(path.join(root, "src", "components"), { recursive: true });
      mkdirSync(path.join(root, "src", "lib", "auth"), { recursive: true });
      writeFileSync(
        path.join(root, "src", "main.tsx"),
        `import "./App.tsx";\n`
      );
      writeFileSync(
        path.join(root, "src", "App.tsx"),
        `import { SalesOrdersModule } from "./components/SalesOrdersModule.tsx";\nexport default SalesOrdersModule;\n`
      );
      writeFileSync(
        path.join(root, "src", "components", "SalesOrdersModule.tsx"),
        `import { decimalToNumber } from "../lib/helpers.ts";\nexport function SalesOrdersModule() { return decimalToNumber(1); }\n`
      );
      writeFileSync(
        path.join(root, "src", "lib", "helpers.ts"),
        `import { hasPermission } from "./appAuth.ts";\nexport function decimalToNumber(n: number) { void hasPermission; return n; }\n`
      );
      writeFileSync(
        path.join(root, "src", "lib", "appAuth.ts"),
        `import crypto from "crypto";\nimport { promisify } from "util";\nexport const hasPermission = () => true;\nvoid crypto; void promisify;\n`
      );

      const leaks = findFrontendServerImportLeaks(root);
      assert.ok(leaks.length >= 1, "deveria detectar leak");
      assert.ok(
        leaks.some((l) => l.kind === "node builtin" && /crypto|util/.test(l.spec)),
        `esperava node builtin crypto/util, got ${JSON.stringify(leaks)}`
      );
      const chain = leaks[0]!;
      assert.ok(
        chain.path.some((p) => p.includes("appAuth")),
        `cadeia deveria incluir appAuth: ${chain.path.join(" -> ")}`
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("árvore real do repositório não alcança crypto/util via appAuth", () => {
    const leaks = findFrontendServerImportLeaks(process.cwd());
    assert.deepEqual(leaks, []);

    const mainAbs = path.join(process.cwd(), "src", "main.tsx");
    const chain = traceFromEntry(mainAbs);
    assert.equal(chain, null);

    // Proteção específica do regresso HOTFIX-04 / appAuth
    const helpers = path.join(
      process.cwd(),
      "src",
      "lib",
      "executiveDashboardHelpers.ts"
    );
    const fromHelpers = traceFromEntry(helpers);
    assert.equal(
      fromHelpers,
      null,
      fromHelpers
        ? `executiveDashboardHelpers ainda vaza: ${fromHelpers.path.join(" -> ")} via ${fromHelpers.spec}`
        : ""
    );
  });
});
