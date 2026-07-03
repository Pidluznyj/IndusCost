import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function readServer(): string {
  return readFileSync(join(process.cwd(), "server.ts"), "utf8");
}

describe("server startup — prisma client scope", () => {
  it("server.ts importa prisma de src/lib/prisma.js", () => {
    const server = readServer();
    assert.match(server, /import \{ prisma \} from "\.\/src\/lib\/prisma\.js"/);
  });

  it("createProductCostAnalysisEngine usa prisma importado no escopo do módulo", () => {
    const server = readServer();
    const startIdx = server.indexOf("async function startServer()");
    assert.ok(startIdx >= 0);
    const startBlock = server.slice(startIdx, startIdx + 800);
    assert.match(startBlock, /createProductCostAnalysisEngine\(prisma\)/);
    assert.doesNotMatch(
      startBlock.slice(0, startBlock.indexOf("createProductCostAnalysisEngine")),
      /\b(const|let)\s+prisma\b/
    );
  });
});
