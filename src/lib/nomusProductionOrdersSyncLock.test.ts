import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireProductionOrdersSyncLock,
  parseProductionOrdersSyncLockPayload,
  releaseProductionOrdersSyncLock,
} from "@/src/lib/nomusProductionOrdersSyncLock.js";
import {
  buildProductionOrdersSyncAuditRecord,
  formatProductionOrdersSyncAuditLog,
  maskProductionOrdersSensitiveText,
  resolveProductionOrdersSyncExitCode,
  resolveProductionOrdersSyncStatus,
} from "@/src/lib/nomusProductionOrdersSyncAudit.js";
import { withProductionOrdersSyncGuard } from "@/src/lib/nomusProductionOrdersSyncGuard.server.js";
import { NOMUS_PRODUCTION_ORDERS_LOG_PREFIX } from "@/src/lib/nomusProductionOrdersSyncConstants.js";
import { runNomusProductionOrdersBackfill } from "@/src/lib/nomusProductionOrdersBackfill.server.js";
import { runNomusProductionOrdersIncremental } from "@/src/lib/nomusProductionOrdersIncremental.server.js";

function tempLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "op-lock-"));
  return join(dir, "production-orders.lock");
}

describe("production orders sync lock", () => {
  it("adquire e libera lock após sucesso", () => {
    const lockFile = tempLockPath();
    const first = acquireProductionOrdersSyncLock({
      type: "backfill",
      mode: "apply",
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.ok(existsSync(lockFile));
    assert.equal(releaseProductionOrdersSyncLock({ lockFile, token: first.token }), true);
    assert.equal(existsSync(lockFile), false);
  });

  it("bloqueia lock concorrente sem matar o dono", () => {
    const lockFile = tempLockPath();
    const first = acquireProductionOrdersSyncLock({
      type: "incremental",
      mode: "apply",
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = acquireProductionOrdersSyncLock({
      type: "backfill",
      mode: "preview",
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "LOCK_HELD");
    assert.match(second.message, /SKIPPED/);
    assert.ok(existsSync(lockFile));
    assert.equal(first.payload.pid, process.pid);

    releaseProductionOrdersSyncLock({ lockFile, token: first.token });
  });

  it("libera após erro e permite nova aquisição", async () => {
    const lockFile = tempLockPath();
    const audits: unknown[] = [];
    await assert.rejects(
      () =>
        withProductionOrdersSyncGuard(
          {
            type: "backfill",
            mode: "apply",
            lockFile,
            respectGlobalLock: false,
            env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
            persistAudit: (a) => {
              audits.push(a);
            },
            logger: () => {},
          },
          async () => {
            throw new Error("boom Authorization: Bearer secret-token");
          },
          () => {
            throw new Error("não deveria mapear");
          }
        ),
      /boom/
    );
    assert.equal(existsSync(lockFile), false);
    assert.equal(audits.length, 1);
    const audit = audits[0] as { status: string; finalMessage: string };
    assert.equal(audit.status, "FAILED");
    assert.doesNotMatch(audit.finalMessage, /secret-token/);
  });

  it("reclaima lock de processo interrompido (PID morto)", () => {
    const lockFile = tempLockPath();
    writeFileSync(
      lockFile,
      JSON.stringify({
        version: 1,
        token: "dead-token",
        pid: 99999999,
        type: "backfill",
        mode: "apply",
        startedAt: new Date().toISOString(),
        hostname: "test",
      }),
      "utf8"
    );
    const acquired = acquireProductionOrdersSyncLock({
      type: "incremental",
      mode: "apply",
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    releaseProductionOrdersSyncLock({ lockFile, token: acquired.token });
  });

  it("bloqueia quando lock global está ativo", () => {
    const lockFile = tempLockPath();
    const blocked = acquireProductionOrdersSyncLock({
      type: "incremental",
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => true,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "GLOBAL_LOCK_HELD");
    assert.equal(existsSync(lockFile), false);
  });
});

describe("production orders sync audit", () => {
  it("mascara segredos e formata métricas finais", () => {
    const masked = maskProductionOrdersSensitiveText(
      "token=abc Authorization: Bearer xyz NOMUS_TOKEN=sekrit"
    );
    assert.doesNotMatch(masked, /abc|xyz|sekrit/);

    const startedAt = new Date("2026-07-16T12:00:00.000Z");
    const finishedAt = new Date("2026-07-16T12:00:05.000Z");
    const audit = buildProductionOrdersSyncAuditRecord({
      type: "incremental",
      mode: "apply",
      startedAt,
      finishedAt,
      status: "SUCCESS",
      cutoff: "2026-07-13T12:00:00.000Z",
      pages: 2,
      received: 10,
      created: 3,
      updated: 4,
      unchanged: 2,
      invalid: 1,
      links: 5,
      resolved: 2,
      pending: 1,
      deactivated: 1,
      errors: 0,
      rateLimit429: 2,
      finalMessage: "incremental concluído",
      exitCode: 0,
      lockFile: "/tmp/x.lock",
    });
    assert.equal(audit.durationMs, 5000);
    assert.equal(audit.rateLimit429, 2);
    const line = formatProductionOrdersSyncAuditLog(audit);
    assert.match(line, new RegExp(NOMUS_PRODUCTION_ORDERS_LOG_PREFIX.replace(/[[\]]/g, "\\$&")));
    assert.match(line, /type=incremental/);
    assert.match(line, /429=2/);
    assert.match(line, /cutoff=2026-07-13/);
    assert.equal(resolveProductionOrdersSyncStatus({ errors: 0 }), "SUCCESS");
    assert.equal(resolveProductionOrdersSyncExitCode("BLOCKED"), 0);
  });

  it("parseia payload de lock", () => {
    const payload = parseProductionOrdersSyncLockPayload(
      JSON.stringify({
        version: 1,
        token: "t",
        pid: 1,
        type: "backfill",
        mode: "preview",
        startedAt: "2026-01-01T00:00:00.000Z",
        hostname: null,
      })
    );
    assert.equal(payload?.type, "backfill");
  });
});

describe("production orders sync guard — registro de execução", () => {
  it("backfill bloqueado não consulta API e registra auditoria", async () => {
    const lockFile = tempLockPath();
    const holder = acquireProductionOrdersSyncLock({
      type: "incremental",
      mode: "apply",
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(holder.ok, true);
    if (!holder.ok) return;

    let apiCalls = 0;
    const audits: Array<{ status: string; type: string }> = [];
    const summary = await runNomusProductionOrdersBackfill({
      argv: ["preview"],
      options: {
        mode: "preview",
        pageSize: 10,
        maxPages: 1,
        hardMaxPages: 10,
        startPage: 1,
        reprocess: true,
        cursorFile: null,
      },
      skipLock: false,
      lockFile,
      respectGlobalLock: false,
      probeGlobalLock: () => false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
      fetchPage: async () => {
        apiCalls += 1;
        return { items: [], fingerprint: "empty" };
      },
      persistAudit: (a) => {
        audits.push({ status: a.status, type: a.type });
      },
      logger: () => {},
    });

    assert.equal(summary.lockBlocked, true);
    assert.equal(apiCalls, 0);
    assert.equal(summary.exitCode, 0);
    assert.equal(audits[0]?.status, "BLOCKED");
    assert.equal(audits[0]?.type, "backfill");
    assert.equal(summary.pagesRead, 0);

    releaseProductionOrdersSyncLock({ lockFile, token: holder.token });
  });

  it("incremental e backfill compartilham o mesmo lock", async () => {
    const lockFile = tempLockPath();
    const audits: string[] = [];
    const first = await runNomusProductionOrdersIncremental({
      argv: ["preview"],
      options: {
        mode: "preview",
        selector: null,
        overlapHours: 72,
        pageSize: 10,
        maxPages: 1,
        fallbackMaxPages: 1,
        stateFile: null,
        strictSelector: false,
      },
      skipLock: false,
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
      fetchPages: async () => ({ pagesRead: 1, recordsReceived: 0, items: [] }),
      persistAudit: (a) => {
        audits.push(a.status);
      },
      logger: () => {},
      now: new Date("2026-07-16T15:00:00.000Z"),
    });
    assert.equal(first.lockBlocked, false);
    assert.ok(first.audit);
    assert.equal(first.audit!.type, "incremental");
    assert.match(formatProductionOrdersSyncAuditLog(first.audit!), /pages=/);

    // Simula concorrência: segura lock e tenta backfill
    const held = acquireProductionOrdersSyncLock({
      type: "incremental",
      mode: "apply",
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
    });
    assert.equal(held.ok, true);
    if (!held.ok) return;

    const blocked = await runNomusProductionOrdersBackfill({
      options: {
        mode: "apply",
        pageSize: 10,
        maxPages: 1,
        hardMaxPages: 10,
        startPage: 1,
        reprocess: true,
        cursorFile: null,
      },
      skipLock: false,
      lockFile,
      respectGlobalLock: false,
      env: { NOMUS_PRODUCTION_ORDERS_UNDER_SHELL_LOCK: "1" },
      fetchPage: async () => {
        throw new Error("API não deve ser chamada");
      },
      persistAudit: (a) => {
        audits.push(a.status);
      },
      logger: () => {},
    });
    assert.equal(blocked.lockBlocked, true);
    assert.ok(audits.includes("BLOCKED"));
    releaseProductionOrdersSyncLock({ lockFile, token: held.token });
  });
});

describe("production orders lock wiring", () => {
  it("shell e scripts package.json existem", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(pkg.scripts["test:nomus:production-orders"] ?? "", /SyncLock|SyncAudit|Guard/i);
    const shell = readFileSync(
      join(process.cwd(), "scripts/runNomusProductionOrdersSync.sh"),
      "utf8"
    );
    assert.match(shell, /\[nomus-production-orders\]/);
    assert.match(shell, /flock -n/);
    assert.doesNotMatch(shell, /NOMUS_TOKEN|Authorization/);
  });
});
