/**
 * NOMUS-CRON-02 — Testes do wrapper de orquestração
 * `runNomusAccountsReceivableThenPurchaseOrdersSync.sh` (AR → Pedidos de
 * Compra, substituindo o cron fixo independente "27 (star)/2 * * *").
 *
 * Duas camadas:
 *  1) Verificação por leitura de código-fonte (regex), no mesmo padrão de
 *     `scripts/nomusProposalsSyncV1Wiring.test.ts` — trava decisões que um
 *     teste comportamental sozinho não alcançaria com clareza (mensagens de
 *     log, ausência de escrita Nomus, abandono do cron antigo).
 *  2) Testes comportamentais reais, executando o script via `bash` contra
 *     runners AR/PO STUB (scripts .sh fake, sem rede/DB) injetados via
 *     `NOMUS_AR_RUNNER_SCRIPT`/`NOMUS_PO_RUNNER_SCRIPT` — confirma a cadeia
 *     de exit codes fim-a-fim, não só a intenção no texto do script.
 *     `bash` é uma dependência já assumida pelo projeto (todos os runners
 *     `runNomus*.sh` só rodam via bash — ver scripts em package.json); se
 *     o binário não estiver disponível neste ambiente, a suíte comportamental
 *     é pulada (skip) em vez de falhar, para não quebrar CI sem bash.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const WRAPPER_PATH = join(
  process.cwd(),
  "scripts",
  "runNomusAccountsReceivableThenPurchaseOrdersSync.sh"
);

describe("runNomusAccountsReceivableThenPurchaseOrdersSync.sh — leitura de código", () => {
  const src = read("scripts/runNomusAccountsReceivableThenPurchaseOrdersSync.sh");

  it("dispara o runner de AR primeiro, capturando o exit code em AR_EXIT_CODE", () => {
    assert.match(src, /"\$AR_RUNNER" "\$AR_MODE"/);
    assert.match(src, /AR_EXIT_CODE=\$\?/);
  });

  it("se AR falhar (exit != 0), NÃO chama o runner de Pedidos de Compra e preserva o exit code do AR", () => {
    const failBlock = src.slice(
      src.indexOf('if [[ "$AR_EXIT_CODE" -ne 0 ]]; then'),
      src.indexOf("fi", src.indexOf('if [[ "$AR_EXIT_CODE" -ne 0 ]]; then'))
    );
    assert.match(failBlock, /CHAIN_RESULT=AR_FAILED/);
    assert.match(failBlock, /exit "\$AR_EXIT_CODE"/);
    assert.doesNotMatch(failBlock, /\$PO_RUNNER/);
  });

  it("se AR concluir (exit 0), dispara o runner de Pedidos de Compra", () => {
    assert.match(src, /"\$PO_RUNNER" "\$PO_MODE"/);
    assert.match(src, /PO_EXIT_CODE=\$\?/);
  });

  it("exit final é o do Pedidos de Compra quando o AR concluiu — nunca reescreve o resultado do AR", () => {
    const tailStart = src.indexOf("if [[ \"$PO_EXIT_CODE\" -ne 0 ]]; then");
    const tail = src.slice(tailStart);
    assert.match(tail, /CHAIN_RESULT=AR_OK_PO_FAILED/);
    assert.match(tail, /CHAIN_RESULT=AR_OK_PO_OK/);
    assert.match(src, /exit "\$PO_EXIT_CODE"/);
    // A mensagem de falha de PO explicitamente não reclassifica o AR.
    assert.match(src, /isso NÃO reabre nem reclassifica o resultado do AR/);
  });

  it("não introduz nenhuma escrita HTTP (POST/PUT/PATCH/DELETE) contra o Nomus", () => {
    assert.doesNotMatch(src, /\bPOST\b/);
    assert.doesNotMatch(src, /\bPUT\b/);
    assert.doesNotMatch(src, /\bPATCH\b/);
    assert.doesNotMatch(src, /\bDELETE\b/);
  });

  it("não adquire lock próprio — delega inteiramente aos runners filhos (AR e PO já têm o seu)", () => {
    assert.doesNotMatch(src, /flock/);
  });

  it("documenta explicitamente que não foi instalado no crontab do host (NOT EXECUTED)", () => {
    assert.match(src, /NÃO instalado no crontab do host nesta entrega/);
  });
});

describe("runNomusPurchaseOrdersSync.sh — abandono do cron fixo 27 */2 * * *", () => {
  const src = read("scripts/runNomusPurchaseOrdersSync.sh");

  it("não apresenta mais 27 */2 * * * como candidato de cron a instalar", () => {
    assert.doesNotMatch(src, /Candidato de cron: 27 \*\/2/);
  });

  it("documenta o abandono e o novo disparo via wrapper AR → Pedidos de Compra", () => {
    assert.match(src, /ABANDONADO/);
    assert.match(src, /runNomusAccountsReceivableThenPurchaseOrdersSync\.sh/);
  });

  it("o lock de shell próprio não usa mais um nome que sugere ser o lock global compartilhado", () => {
    const lockLine = src.split("\n").find((line) => line.startsWith("LOCK_FILE="));
    assert.ok(lockLine, "esperava encontrar a linha de atribuição de LOCK_FILE");
    assert.doesNotMatch(lockLine as string, /purchase-orders-sync-global\.lock/);
    assert.match(lockLine as string, /purchase-orders-shell\.lock/);
  });
});

describe("nomusPurchaseOrdersSyncLock.ts — reutiliza o probe do lock global (não reimplementa flock)", () => {
  const src = read("src/lib/nomus/nomusPurchaseOrdersSyncLock.ts");

  it("importa probeGlobalNomusSyncLockHeld em vez de reimplementar checagem de flock", () => {
    assert.match(
      src,
      /import\s*\{\s*probeGlobalNomusSyncLockHeld\s*\}\s*from\s*"\.\.\/nomusProductionOrdersSyncLock\.js"/
    );
  });

  it("expõe o código GLOBAL_LOCK_HELD distinto de LOCKED", () => {
    assert.match(src, /"GLOBAL_LOCK_HELD"/);
    assert.match(src, /"LOCKED"/);
  });
});

// --- Comportamental: executa o wrapper de verdade via bash, contra runners
// AR/PO stub (sem rede/DB), confirmando a cadeia de exit codes fim-a-fim. ---

const bashAvailable = (() => {
  try {
    const probe = spawnSync("bash", ["--version"], { stdio: "ignore" });
    return !probe.error && probe.status === 0;
  } catch {
    return false;
  }
})();

function writeStubRunner(dir: string, name: string, exitCode: number): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `#!/usr/bin/env bash\necho "[stub:${name}] mode=$1"\nexit ${exitCode}\n`,
    "utf8"
  );
  chmodSync(path, 0o755);
  return path;
}

function runChain(args: {
  arExit: number;
  poExit: number;
}): { status: number | null; stdout: string } {
  const dir = mkdtempSync(join(tmpdir(), "ar-then-po-chain-"));
  try {
    const arStub = writeStubRunner(dir, "ar-stub.sh", args.arExit);
    const poStub = writeStubRunner(dir, "po-stub.sh", args.poExit);
    const logDir = join(dir, "logs");

    const result = spawnSync("bash", [WRAPPER_PATH, "apply", "apply"], {
      env: {
        ...process.env,
        NOMUS_AR_RUNNER_SCRIPT: arStub,
        NOMUS_PO_RUNNER_SCRIPT: poStub,
        NOMUS_SYNC_LOG_DIR: logDir,
      },
      encoding: "utf8",
    });
    return { status: result.status, stdout: result.stdout ?? "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("runNomusAccountsReceivableThenPurchaseOrdersSync.sh — comportamento fim-a-fim (stubs)", {
  skip: !bashAvailable ? "bash não disponível neste ambiente" : false,
}, () => {
  it("AR SUCCESS (0) → dispara PO; exit final = exit do PO", () => {
    const { status, stdout } = runChain({ arExit: 0, poExit: 0 });
    assert.equal(status, 0);
    assert.match(stdout, /AR_EXIT_CODE=0/);
    assert.match(stdout, /\[stub:po-stub\.sh\]/, "PO deveria ter sido chamado");
    assert.match(stdout, /PO_EXIT_CODE=0/);
    assert.match(stdout, /CHAIN_RESULT=AR_OK_PO_OK/);
  });

  it("AR FAILED (1) → NÃO dispara PO; exit final = exit do AR", () => {
    const { status, stdout } = runChain({ arExit: 1, poExit: 0 });
    assert.equal(status, 1);
    assert.match(stdout, /AR_EXIT_CODE=1/);
    assert.doesNotMatch(stdout, /\[stub:po-stub\.sh\]/, "PO NÃO deveria ter sido chamado");
    assert.match(stdout, /CHAIN_RESULT=AR_FAILED/);
  });

  it("AR SUCCESS (0), PO FAILED (1) → dispara PO; exit final = exit do PO; AR não é reclassificado", () => {
    const { status, stdout } = runChain({ arExit: 0, poExit: 1 });
    assert.equal(status, 1);
    assert.match(stdout, /AR_EXIT_CODE=0/);
    assert.match(stdout, /PO_EXIT_CODE=1/);
    assert.match(stdout, /CHAIN_RESULT=AR_OK_PO_FAILED/);
  });
});
