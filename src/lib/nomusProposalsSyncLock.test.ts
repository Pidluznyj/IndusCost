import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acquireProposalsSyncLock,
  parseProposalsSyncLockPayload,
  releaseProposalsSyncLock,
  formatProposalsLockBlockedLog,
} from "./nomusProposalsSyncLock.js";
import {
  NOMUS_PROPOSALS_HOURLY_SCHEDULE_HINT,
  NOMUS_PROPOSALS_SYNC_TARGET,
  resolveProposalsSyncLockFile,
  shouldRespectGlobalNomusLock,
} from "./nomusProposalsSyncConstants.js";

function tempLockPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "proposals-lock-"));
  return join(dir, "proposals.lock");
}

describe("nomus proposals sync constants", () => {
  it("target oficial e cadência horária no minuto 37 (sem conflito com NF-e=0, AR/CP=17, DS=23)", () => {
    assert.equal(NOMUS_PROPOSALS_SYNC_TARGET, "proposals");
    assert.ok(NOMUS_PROPOSALS_HOURLY_SCHEDULE_HINT.includes("37 * * * *"));
  });

  it("resolve lock file default e via env", () => {
    assert.equal(resolveProposalsSyncLockFile({}), "/tmp/induscost-nomus-proposals.lock");
    assert.equal(
      resolveProposalsSyncLockFile({ NOMUS_PROPOSALS_SYNC_LOCK_FILE: "/tmp/custom.lock" }),
      "/tmp/custom.lock"
    );
  });

  it("respeita lock global por padrão; desliga só com 0/false/no", () => {
    assert.equal(shouldRespectGlobalNomusLock({}), true);
    assert.equal(shouldRespectGlobalNomusLock({ NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK: "0" }), false);
    assert.equal(shouldRespectGlobalNomusLock({ NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK: "false" }), false);
    assert.equal(shouldRespectGlobalNomusLock({ NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK: "1" }), true);
  });
});

describe("nomus proposals sync lock", () => {
  it("adquire e libera lock após sucesso", () => {
    const lockFile = tempLockPath();
    const first = acquireProposalsSyncLock({ mode: "apply", lockFile, respectGlobalLock: false });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.ok(existsSync(lockFile));
    assert.equal(releaseProposalsSyncLock({ lockFile, token: first.token }), true);
    assert.equal(existsSync(lockFile), false);
  });

  it("segunda execução concorrente retorna SKIPPED (LOCK_HELD) sem matar a primeira", () => {
    const lockFile = tempLockPath();
    const first = acquireProposalsSyncLock({ mode: "apply", lockFile, respectGlobalLock: false });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = acquireProposalsSyncLock({ mode: "apply", lockFile, respectGlobalLock: false });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "LOCK_HELD");
    assert.match(second.message, /SKIPPED/);
    assert.match(formatProposalsLockBlockedLog(second), /SKIPPED/);
    // primeira execução não foi derrubada
    assert.ok(existsSync(lockFile));
    assert.equal(first.payload.pid, process.pid);

    releaseProposalsSyncLock({ lockFile, token: first.token });
  });

  it("sync diário (02:00) e horário usam a mesma proteção: lock global ativo bloqueia o horário", () => {
    const lockFile = tempLockPath();
    const blocked = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => true, // simula runNomusDailySync.sh segurando o lock global
    });
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "GLOBAL_LOCK_HELD");
    assert.match(blocked.message, /SKIPPED/);
    // não chega a criar o lock de entidade quando bloqueado no nível global
    assert.equal(existsSync(lockFile), false);
  });

  it("quando o lock global não está ativo, execução horária segue normalmente", () => {
    const lockFile = tempLockPath();
    const acquired = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => false,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    releaseProposalsSyncLock({ lockFile, token: acquired.token });
  });

  it("reclaima lock de processo interrompido (PID morto) — não é sucesso parcial travado para sempre", () => {
    const lockFile = tempLockPath();
    writeFileSync(
      lockFile,
      JSON.stringify({
        version: 1,
        token: "dead-token",
        pid: 99999999,
        mode: "apply",
        startedAt: new Date().toISOString(),
        hostname: "test",
      }),
      "utf8"
    );
    const acquired = acquireProposalsSyncLock({ mode: "apply", lockFile, respectGlobalLock: false });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    releaseProposalsSyncLock({ lockFile, token: acquired.token });
  });

  it("release só remove se o token pertencer ao dono atual", () => {
    const lockFile = tempLockPath();
    const first = acquireProposalsSyncLock({ mode: "apply", lockFile, respectGlobalLock: false });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(releaseProposalsSyncLock({ lockFile, token: "token-de-outro-processo" }), false);
    assert.ok(existsSync(lockFile));
    releaseProposalsSyncLock({ lockFile, token: first.token });
  });

  it("parseia payload de lock", () => {
    const payload = parseProposalsSyncLockPayload(
      JSON.stringify({
        version: 1,
        token: "t",
        pid: 1,
        mode: "dry",
        startedAt: "2026-01-01T00:00:00.000Z",
        hostname: null,
      })
    );
    assert.equal(payload?.mode, "dry");
  });
});

describe("nomus proposals hourly sync — wiring", () => {
  it("runner shell horário existe, chama o orquestrador oficial e não vaza segredos", () => {
    const shell = readFileSync(
      join(process.cwd(), "scripts/runNomusProposalsHourlySync.sh"),
      "utf8"
    );
    assert.match(shell, /\[nomus-proposals-hourly\]/);
    assert.match(shell, /sync:nomus:all:\$\{MODE\}.*--only=proposals/);
    assert.match(shell, /37 \* \* \* \*/);
    assert.doesNotMatch(shell, /NOMUS_TOKEN=|Authorization:/);
  });

  it("package.json expõe os scripts do runner horário", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    assert.match(
      pkg.scripts["sync:nomus:proposals:hourly:apply"] ?? "",
      /runNomusProposalsHourlySync\.sh apply/
    );
    assert.match(pkg.scripts["sync:nomus:proposals:apply"] ?? "", /nomusProposalsSyncV1/);
  });

  it("runner diário (02:00) desliga a checagem do lock global no passo de propostas — evita autolock", () => {
    const dailyShell = readFileSync(join(process.cwd(), "scripts/runNomusDailySync.sh"), "utf8");
    assert.match(dailyShell, /NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK=0/);
  });
});
