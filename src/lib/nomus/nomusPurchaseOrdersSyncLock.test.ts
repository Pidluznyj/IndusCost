import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { acquireNomusPurchaseOrdersSyncLock } from "./nomusPurchaseOrdersSyncLock.js";

function tempLockFile(): string {
  return join(tmpdir(), `induscost-test-lock-${randomUUID()}.lock`);
}

test("lock — segunda aquisição concorrente (mesmo processo vivo) é bloqueada (LOCKED)", () => {
  const lockFile = tempLockFile();
  try {
    const first = acquireNomusPurchaseOrdersSyncLock({ mode: "apply", lockFile });
    assert.equal(first.ok, true);

    const second = acquireNomusPurchaseOrdersSyncLock({ mode: "apply", lockFile });
    assert.equal(second.ok, false);
    if (second.ok === false) assert.equal(second.code, "LOCKED");

    if (first.ok) first.release();
  } finally {
    rmSync(lockFile, { force: true });
  }
});

test("lock — release libera o lock para a próxima execução", () => {
  const lockFile = tempLockFile();
  try {
    const first = acquireNomusPurchaseOrdersSyncLock({ mode: "apply", lockFile });
    assert.equal(first.ok, true);
    if (first.ok) first.release();

    const second = acquireNomusPurchaseOrdersSyncLock({ mode: "apply", lockFile });
    assert.equal(second.ok, true);
    if (second.ok) second.release();
  } finally {
    rmSync(lockFile, { force: true });
  }
});

test("lock — lock de PID morto é auto-curado (self-heal)", () => {
  const lockFile = tempLockFile();
  try {
    // PID improvável de estar vivo — simula processo morto sem release().
    const deadPid = 999999;
    const fakeLockPayload = JSON.stringify({
      version: 1,
      token: "dead-token",
      pid: deadPid,
      mode: "apply",
      startedAt: new Date().toISOString(),
      hostname: null,
    });
    writeFileSync(lockFile, fakeLockPayload, "utf8");

    const result = acquireNomusPurchaseOrdersSyncLock({ mode: "apply", lockFile });
    assert.equal(result.ok, true, "lock de PID morto deve ser auto-curado, não bloquear para sempre");
    if (result.ok) result.release();
  } finally {
    rmSync(lockFile, { force: true });
  }
});
