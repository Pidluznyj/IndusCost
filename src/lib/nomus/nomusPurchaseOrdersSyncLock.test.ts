import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  acquireNomusPurchaseOrdersSyncLock,
  shouldRespectPurchaseOrdersGlobalLock,
} from "./nomusPurchaseOrdersSyncLock.js";

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

// --- NOMUS-CRON-02: probe (não aquisição) do lock global Nomus, mesmo
// padrão de Ordens de Produção (OP-11) — cobre o requisito "lock global
// ocupado impede concorrência indevida" sem duplicar a checagem de flock.

test("lock global — GLOBAL_LOCK_HELD quando o probe do lock global reporta ocupado (default respeita)", () => {
  const lockFile = tempLockFile();
  try {
    const result = acquireNomusPurchaseOrdersSyncLock({
      mode: "apply",
      lockFile,
      probeGlobalLock: () => true, // simula flock global ocupado (daily/SO em andamento)
    });
    assert.equal(result.ok, false);
    if (result.ok === false) assert.equal(result.code, "GLOBAL_LOCK_HELD");
  } finally {
    rmSync(lockFile, { force: true });
  }
});

test("lock global — não chega a criar o lock de arquivo próprio quando o lock global está ocupado", () => {
  const lockFile = tempLockFile();
  try {
    const result = acquireNomusPurchaseOrdersSyncLock({
      mode: "apply",
      lockFile,
      probeGlobalLock: () => true,
    });
    assert.equal(result.ok, false);
    // Nada foi escrito em disco — não há lock de arquivo de entidade órfão.
    assert.equal(existsSync(lockFile), false);
  } finally {
    rmSync(lockFile, { force: true });
  }
});

test("lock global — probe livre permite adquirir normalmente o lock de entidade", () => {
  const lockFile = tempLockFile();
  try {
    const result = acquireNomusPurchaseOrdersSyncLock({
      mode: "apply",
      lockFile,
      probeGlobalLock: () => false,
    });
    assert.equal(result.ok, true);
    if (result.ok) result.release();
  } finally {
    rmSync(lockFile, { force: true });
  }
});

test("lock global — respectGlobalLock=false ignora explicitamente o lock global ocupado (uso interno controlado)", () => {
  const lockFile = tempLockFile();
  try {
    const result = acquireNomusPurchaseOrdersSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: false,
      probeGlobalLock: () => true,
    });
    assert.equal(result.ok, true, "respectGlobalLock=false deve ignorar o probe global");
    if (result.ok) result.release();
  } finally {
    rmSync(lockFile, { force: true });
  }
});

test("lock global — shouldRespectPurchaseOrdersGlobalLock: default=1 (respeita); '0'/'false'/'no' desligam", () => {
  assert.equal(shouldRespectPurchaseOrdersGlobalLock({}), true);
  assert.equal(
    shouldRespectPurchaseOrdersGlobalLock({ NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK: "0" }),
    false
  );
  assert.equal(
    shouldRespectPurchaseOrdersGlobalLock({ NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK: "false" }),
    false
  );
  assert.equal(
    shouldRespectPurchaseOrdersGlobalLock({ NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK: "no" }),
    false
  );
  assert.equal(
    shouldRespectPurchaseOrdersGlobalLock({ NOMUS_PURCHASE_ORDERS_RESPECT_GLOBAL_LOCK: "1" }),
    true
  );
});
