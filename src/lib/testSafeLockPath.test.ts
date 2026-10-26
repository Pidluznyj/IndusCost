import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isNodeTestProcess, isProductionLockPath, testSafeLockPath } from "./testSafeLockPath.js";

// Este arquivo NUNCA cria lock real: no servidor isso atrapalharia as rotinas em execução.
describe("locks reais isolados em processos de teste", () => {
  it("L1. reconhece os locks de produção pelo diretório do sistema e pelo prefixo induscost-", () => {
    assert.equal(isProductionLockPath("/tmp/induscost-nomus-accounts-receivable.canonical.lock"), true);
    assert.equal(isProductionLockPath("/run/lock/induscost-deploy.lock"), true);
    assert.equal(isProductionLockPath("/var/lock/induscost-x.lock"), true);
    assert.equal(isProductionLockPath("/tmp/op04-ar-canon-1.canonical.lock"), false);
    assert.equal(isProductionLockPath("/tmp/induscost-test-locks-1/induscost-x.lock"), false);
    assert.equal(isProductionLockPath(join(tmpdir(), "algo", "induscost-x.lock")), false);
  });

  it("L2. dentro do test runner o lock real vai para um diretório temporário do processo", () => {
    assert.equal(isNodeTestProcess(), true);
    const mapped = testSafeLockPath("/tmp/induscost-nomus-sales-orders.lock");
    assert.equal(mapped, join(tmpdir(), `induscost-test-locks-${process.pid}`, "induscost-nomus-sales-orders.lock"));
    assert.equal(testSafeLockPath("/tmp/induscost-nomus-sales-orders.lock"), mapped, "determinístico (adquirir e liberar)");
    assert.equal(testSafeLockPath(mapped), mapped, "idempotente");
  });

  it("L3. fora do test runner nada muda (rotinas reais usam o lock real)", () => {
    assert.equal(testSafeLockPath("/tmp/induscost-nomus-sales-orders.lock", {}), "/tmp/induscost-nomus-sales-orders.lock");
  });

  it("L4. caminhos temporários escolhidos pelo próprio teste não são alterados", () => {
    const own = join(tmpdir(), "op04-ar-canon-123.canonical.lock");
    assert.equal(testSafeLockPath(own), own);
  });

  it("L5. todos os pontos de aquisição/liberação de lock passam pelo isolamento", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "src/lib/nomus/nomusCanonicalSync.server.ts",
      "src/lib/nomus/nomusAccountsReceivableSourceReconciliation.server.ts",
      "src/lib/nomus/nomusAccountsPayableSourceReconciliation.server.ts",
      "src/lib/nomus/nomusSalesOrderSourceReconciliation.server.ts",
      "src/lib/nomus/nomusLifecycleBackfill.server.ts",
      "src/lib/nomusProductionOrdersSyncLock.ts",
      "src/lib/nomusProposalsSyncLock.ts",
      "src/lib/nomusStockDocumentsSyncLock.ts",
      "src/lib/sales/salesOrderFlowRebuild.ts",
    ]) {
      assert.match(readFileSync(file, "utf8"), /testSafeLockPath\(/, file);
    }
  });
});
