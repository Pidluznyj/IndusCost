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

  it("com globalLockWaitSeconds=0 (comportamento legado), lock global ativo bloqueia na hora — sem esperar", () => {
    const lockFile = tempLockPath();
    const blocked = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => true, // simula runNomusDailySync.sh segurando o lock global
      globalLockWaitSeconds: 0,
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
    let waitCalled = false;
    const acquired = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => false,
      waitForGlobalLock: () => {
        waitCalled = true;
        return true;
      },
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    // TESTE P0 (seção 18/10) — global livre não introduz espera artificial.
    assert.equal(waitCalled, false, "não deve chamar waitForGlobalLock quando o probe já diz livre");
    assert.equal(acquired.wait, null);
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

describe("nomus proposals sync lock — espera segura pelo lock global (hotfix GLOBAL_LOCK_HELD → WAIT → EXECUTE)", () => {
  function tempWaiterLockPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "proposals-waiter-lock-"));
    return join(dir, "hourly-waiter.lock");
  }

  // TESTE P0 (seção 17) — global ocupado e depois livre: não retorna
  // GLOBAL_LOCK_HELD imediato, espera, e prossegue assim que libera.
  it("global ocupado → espera → libera dentro do timeout → SUCCESS com metadados de espera", () => {
    const lockFile = tempLockPath();
    const waiterLockFile = tempWaiterLockPath();
    const acquired = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => true, // global ocupado no instante da checagem
      waiterLockFile,
      globalLockWaitSeconds: 2700,
      waitForGlobalLock: (timeoutSeconds) => {
        assert.equal(timeoutSeconds, 2700);
        return true; // liberou dentro do timeout
      },
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    assert.ok(acquired.wait);
    assert.equal(acquired.wait?.reason, "GLOBAL_LOCK_HELD");
    assert.equal(acquired.wait?.timeoutSeconds, 2700);
    assert.ok(acquired.wait!.waitDurationMs >= 0);
    // waiter lock liberado após a espera (não fica órfão)
    assert.equal(existsSync(waiterLockFile), false);
    releaseProposalsSyncLock({ lockFile, token: acquired.token });
  });

  // TESTE P0 (seção 19) — timeout: global não libera dentro da janela.
  it("global ocupado além do timeout → GLOBAL_LOCK_WAIT_TIMEOUT, sem lock de propostas criado, sem waiter órfão", () => {
    const lockFile = tempLockPath();
    const waiterLockFile = tempWaiterLockPath();
    const result = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => true,
      waiterLockFile,
      globalLockWaitSeconds: 5,
      waitForGlobalLock: () => false, // nunca libera dentro do timeout simulado
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "GLOBAL_LOCK_WAIT_TIMEOUT");
    assert.match(result.message, /SKIPPED/);
    assert.equal(result.wait?.timeoutSeconds, 5);
    assert.equal(existsSync(lockFile), false); // não chegou a tentar o lock de propostas
    assert.equal(existsSync(waiterLockFile), false); // waiter liberado mesmo no timeout
  });

  // TESTE P0 (seção 20/6) — no máximo um waiter horário por vez.
  it("segunda execução com waiter já ativo → HOURLY_WAITER_ALREADY_ACTIVE, não espera em paralelo", () => {
    const lockFile1 = tempLockPath();
    const lockFile2 = tempLockPath();
    const waiterLockFile = tempWaiterLockPath();

    let firstWaitCalls = 0;
    let secondWaitCalls = 0;

    // Simula o primeiro waiter "no meio da espera": ocupamos o waiterLockFile
    // manualmente ANTES da segunda tentativa, como se a primeira execução
    // ainda estivesse com o processo vivo (PID atual) esperando.
    writeFileSync(
      waiterLockFile,
      JSON.stringify({ version: 1, token: "primeiro-waiter", pid: process.pid, startedAt: new Date().toISOString() }),
      "utf8"
    );

    const second = acquireProposalsSyncLock({
      mode: "apply",
      lockFile: lockFile2,
      respectGlobalLock: true,
      probeGlobalLock: () => true,
      waiterLockFile,
      globalLockWaitSeconds: 2700,
      waitForGlobalLock: () => {
        secondWaitCalls += 1;
        return true;
      },
    });

    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "HOURLY_WAITER_ALREADY_ACTIVE");
    assert.match(second.message, /SKIPPED/);
    assert.equal(secondWaitCalls, 0, "segunda execução não deve chamar waitForGlobalLock — não espera em paralelo");
    assert.equal(firstWaitCalls, 0);
    // waiter do "primeiro" continua intacto — a segunda não pode derrubá-lo
    assert.ok(existsSync(waiterLockFile));

    releaseProposalsSyncLock({ lockFile: lockFile1, token: "n/a" });
  });

  // TESTE P0 (seção 20) — waiter órfão (PID morto) é reclaimado, não trava para sempre.
  it("waiter lock órfão (PID morto) é reclaimado — não bloqueia waiters futuros indefinidamente", () => {
    const lockFile = tempLockPath();
    const waiterLockFile = tempWaiterLockPath();
    writeFileSync(
      waiterLockFile,
      JSON.stringify({ version: 1, token: "waiter-morto", pid: 99999999, startedAt: new Date().toISOString() }),
      "utf8"
    );

    const acquired = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => true,
      waiterLockFile,
      globalLockWaitSeconds: 2700,
      waitForGlobalLock: () => true,
    });
    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    releaseProposalsSyncLock({ lockFile, token: acquired.token });
  });

  // TESTE P0 (seção 16/44) — deadlock: pipeline diário roda propostas com
  // NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK=0 (respectGlobalLock: false aqui) —
  // NUNCA entra no fluxo de espera, mesmo com o global "ocupado" (é ele quem
  // o detém). Não pode chamar waitForGlobalLock nem o waiter lock.
  it("chamada nested do pipeline diário (respectGlobalLock=false) nunca espera — sem deadlock consigo mesma", () => {
    const lockFile = tempLockPath();
    const waiterLockFile = tempWaiterLockPath();
    let waitCalled = false;

    const acquired = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: false, // === NOMUS_PROPOSALS_RESPECT_GLOBAL_LOCK=0 do runNomusDailySync.sh
      probeGlobalLock: () => true, // o próprio pipeline diário detém o global — probe veria "ocupado"
      waiterLockFile,
      waitForGlobalLock: () => {
        waitCalled = true;
        return true;
      },
    });

    assert.equal(acquired.ok, true);
    if (!acquired.ok) return;
    assert.equal(waitCalled, false, "chamada com respectGlobalLock=false não pode esperar o próprio lock que já detém");
    assert.equal(acquired.wait, null);
    assert.equal(existsSync(waiterLockFile), false, "não cria waiter lock quando não está respeitando o global");
    releaseProposalsSyncLock({ lockFile, token: acquired.token });
  });

  // TESTE P0 (seção 21) — execução longa de Propostas: enquanto o primeiro
  // waiter já adquiriu e está "executando" (holder vivo no proposals.lock),
  // um segundo runner horário não inicia uma segunda sync — LOCK_HELD comum,
  // não GLOBAL_LOCK_*, prova que a serialização normal continua intacta após
  // a espera.
  it("execução longa: enquanto o primeiro detém proposals.lock, o segundo recebe LOCK_HELD (não duplica sync)", () => {
    const lockFile = tempLockPath();
    const first = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => false, // global livre — primeiro adquire e "executa"
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = acquireProposalsSyncLock({
      mode: "apply",
      lockFile,
      respectGlobalLock: true,
      probeGlobalLock: () => false, // global também livre para o segundo
    });
    assert.equal(second.ok, false);
    if (second.ok) return;
    assert.equal(second.code, "LOCK_HELD");

    releaseProposalsSyncLock({ lockFile, token: first.token });
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
