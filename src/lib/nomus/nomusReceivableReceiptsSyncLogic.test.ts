import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  assessReceiptsFullScan,
  buildReceiptsPageParams,
  computeReceiptsPaginationPlan,
  hasNextReceiptsPage,
  NOMUS_RECEIPTS_PAGE_SIZE,
  normalizeSinceArgument,
  pageIsFullyBeforeSince,
  parseReceiptsSyncCli,
  pickReceiptsArray,
  resolveReceiptsRunStatus,
} from "./nomusReceivableReceiptsSyncLogic.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/**
 * O cabeçalho do runner explica as regras citando os próprios termos proibidos
 * ("não usa --since", "não adquire o lock global"). Só o código executável conta.
 */
function shellCodeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const RUNNER = "scripts/runNomusReceivableReceiptsSync.sh";
const SYNC_SCRIPT = "scripts/nomusReceivableReceiptsSync.ts";

/** Varredura que chegou ao fim real da origem, sem nenhum recorte. */
const CLEAN_FULL_SCAN = {
  startPage: 1,
  singlePage: null,
  sinceCivilDate: null,
  stoppedBecauseEmpty: false,
  stoppedBecauseNoNext: true,
  stoppedBecauseMaxPages: false,
  stoppedBecauseSince: false,
} as const;

describe("nomusReceivableReceiptsSyncLogic", () => {
  it("preview é o default e apply precisa ser explícito", () => {
    assert.equal(parseReceiptsSyncCli([]).mode, "preview");
    assert.equal(parseReceiptsSyncCli(["preview"]).mode, "preview");
    assert.equal(parseReceiptsSyncCli(["apply"]).mode, "apply");
    assert.equal(parseReceiptsSyncCli(["--apply"]).mode, "apply");
  });

  it("envia apenas `pagina` — único parâmetro comprovado do endpoint", () => {
    assert.deepEqual(buildReceiptsPageParams(3), { pagina: "3" });
    assert.deepEqual(buildReceiptsPageParams(0), { pagina: "1" });
    assert.deepEqual(buildReceiptsPageParams(Number.NaN), { pagina: "1" });
  });

  it("respeita as 50 linhas por página da instalação", () => {
    assert.equal(NOMUS_RECEIPTS_PAGE_SIZE, 50);
    assert.equal(hasNextReceiptsPage([], 1, 50), true);
    assert.equal(hasNextReceiptsPage([], 1, 49), false);
    assert.equal(hasNextReceiptsPage([], 1, 0), false);
    assert.equal(hasNextReceiptsPage({ totalPaginas: 2 }, 2, 50), false);
    assert.equal(hasNextReceiptsPage({ hasMore: false }, 1, 50), false);
  });

  it("extrai a lista de recebimentos de formatos de envelope conhecidos", () => {
    assert.equal(pickReceiptsArray([{ id: 1 }]).length, 1);
    assert.equal(pickReceiptsArray({ recebimentos: [{ id: 1 }] }).length, 1);
    assert.equal(pickReceiptsArray({ data: { dados: [{ id: 1 }, { id: 2 }] } }).length, 2);
    assert.deepEqual(pickReceiptsArray(null), []);
  });

  it("plano de paginação suporta backfill histórico", () => {
    const options = parseReceiptsSyncCli(["apply", "--startPage", "5", "--maxPages", "40"]);
    assert.deepEqual(computeReceiptsPaginationPlan(options), { firstPage: 5, lastPage: 44 });

    const single = parseReceiptsSyncCli(["preview", "--page", "7"]);
    assert.equal(single.singlePage, 7);
    assert.deepEqual(computeReceiptsPaginationPlan(single), { firstPage: 7, lastPage: 7 });
  });

  it("--since aceita ISO e BR", () => {
    assert.equal(normalizeSinceArgument("2026-01-01"), "2026-01-01");
    assert.equal(normalizeSinceArgument("01/01/2026"), "2026-01-01");
    assert.equal(normalizeSinceArgument("janeiro"), null);
    assert.equal(parseReceiptsSyncCli(["apply", "--since", "01/06/2026"]).sinceCivilDate, "2026-06-01");
  });

  it("só encerra o backfill quando a página INTEIRA é anterior à janela", () => {
    assert.equal(pageIsFullyBeforeSince(["2026-05-30", "2026-05-29"], "2026-06-01"), true);
    // Um único item dentro da janela mantém a varredura — nada é descartado por item.
    assert.equal(pageIsFullyBeforeSince(["2026-05-30", "2026-06-02"], "2026-06-01"), false);
    assert.equal(pageIsFullyBeforeSince([null, null], "2026-06-01"), false);
    assert.equal(pageIsFullyBeforeSince(["2026-05-30"], null), false);
  });
});

/**
 * A rotina diária existe para uma fonte financeira: uma carga truncada que se
 * apresenta como sucesso é pior do que nenhuma carga. Estes testes existem para
 * garantir que "li algumas páginas" nunca seja confundido com "percorri tudo".
 */
describe("prova de varredura completa", () => {
  it("full scan limpo começa na página 1 e termina no fim real da paginação", () => {
    const options = parseReceiptsSyncCli(["apply", "--maxPages", "200", "--require-full-scan"]);
    assert.equal(options.startPage, 1, "a rotina automática SEMPRE começa na página 1");
    assert.equal(options.singlePage, null);
    assert.equal(options.sinceCivilDate, null, "a rotina automática nunca recorta janela");
    assert.equal(options.requireFullScan, true);

    const assessment = assessReceiptsFullScan(CLEAN_FULL_SCAN);
    assert.equal(assessment.complete, true);
    assert.deepEqual(assessment.blockers, []);
  });

  it("página vazia também é fim legítimo da origem", () => {
    const assessment = assessReceiptsFullScan({
      ...CLEAN_FULL_SCAN,
      stoppedBecauseNoNext: false,
      stoppedBecauseEmpty: true,
    });
    assert.equal(assessment.complete, true);
  });

  it("parar por maxPages NUNCA conta como varredura completa", () => {
    const assessment = assessReceiptsFullScan({
      ...CLEAN_FULL_SCAN,
      stoppedBecauseNoNext: false,
      stoppedBecauseMaxPages: true,
    });
    assert.equal(assessment.complete, false);
    assert.ok(assessment.blockers.includes("STOPPED_BY_MAX_PAGES"));
  });

  it("começar depois da página 1 desqualifica a varredura", () => {
    const assessment = assessReceiptsFullScan({ ...CLEAN_FULL_SCAN, startPage: 4 });
    assert.equal(assessment.complete, false);
    assert.ok(assessment.blockers.includes("STARTED_AFTER_FIRST_PAGE"));
  });

  it("página única desqualifica mesmo terminando sem erro", () => {
    const assessment = assessReceiptsFullScan({
      ...CLEAN_FULL_SCAN,
      startPage: 3,
      singlePage: 3,
      stoppedBecauseNoNext: false,
      stoppedBecauseMaxPages: true,
    });
    assert.equal(assessment.complete, false);
    assert.ok(assessment.blockers.includes("SINGLE_PAGE"));
  });

  it("--since desqualifica mesmo sem ter chegado a disparar", () => {
    // A intenção do chamador foi recortar a janela: a execução não prova
    // cobertura total, ainda que por acaso tenha varrido tudo.
    const naoDisparou = assessReceiptsFullScan({
      ...CLEAN_FULL_SCAN,
      sinceCivilDate: "2026-01-01",
    });
    assert.equal(naoDisparou.complete, false);
    assert.ok(naoDisparou.blockers.includes("SINCE_WINDOW_APPLIED"));

    const disparou = assessReceiptsFullScan({
      ...CLEAN_FULL_SCAN,
      sinceCivilDate: "2026-01-01",
      stoppedBecauseNoNext: false,
      stoppedBecauseSince: true,
    });
    assert.equal(disparou.complete, false);
    assert.ok(disparou.blockers.includes("STOPPED_BY_SINCE"));
  });

  it("terminar sem nenhuma condição terminal é incompleto", () => {
    // Sem página vazia e sem fim de paginação, não há prova de que a origem
    // acabou — só de que o laço parou.
    const assessment = assessReceiptsFullScan({
      ...CLEAN_FULL_SCAN,
      stoppedBecauseNoNext: false,
    });
    assert.equal(assessment.complete, false);
    assert.ok(assessment.blockers.includes("NO_TERMINAL_PAGE"));
  });
});

describe("status operacional da execução", () => {
  const BASE = {
    requireFullScan: true,
    failOnMissing: false,
    fullScanComplete: true,
    blockers: [] as never[],
    writeErrors: 0,
    missingInSource: 0,
  };

  it("varredura completa sem erro é sucesso com exit 0", () => {
    const outcome = resolveReceiptsRunStatus(BASE);
    assert.equal(outcome.status, "SUCCESS");
    assert.equal(outcome.exitCode, 0);
  });

  it("erro de gravação derruba a execução em QUALQUER modo", () => {
    // Antes deste contrato o script contava os erros e ainda saía com 0 — um
    // cron em cima disso reportaria carga saudável com o banco pela metade.
    for (const requireFullScan of [true, false]) {
      const outcome = resolveReceiptsRunStatus({ ...BASE, requireFullScan, writeErrors: 3 });
      assert.equal(outcome.status, "FAILED");
      assert.equal(outcome.exitCode, 1);
      assert.ok(outcome.reasons.some((r) => r.includes("erros_gravacao=3")));
    }
  });

  it("varredura incompleta NÃO passa silenciosamente por sucesso", () => {
    const outcome = resolveReceiptsRunStatus({
      ...BASE,
      fullScanComplete: false,
      blockers: ["STOPPED_BY_MAX_PAGES"] as never,
    });
    assert.equal(outcome.status, "INCOMPLETE");
    assert.equal(outcome.exitCode, 1);
    assert.ok(outcome.reasons.some((r) => r.includes("STOPPED_BY_MAX_PAGES")));
  });

  it("execução manual recortada continua legítima (retrocompatível)", () => {
    // `--page 3` / `--since` sem --require-full-scan seguem terminando em 0.
    const outcome = resolveReceiptsRunStatus({
      ...BASE,
      requireFullScan: false,
      fullScanComplete: false,
      blockers: ["SINGLE_PAGE"] as never,
    });
    assert.equal(outcome.status, "SUCCESS");
    assert.equal(outcome.exitCode, 0);
  });

  it("ausência na origem é aviso por padrão, e falha só sob pedido explícito", () => {
    const aviso = resolveReceiptsRunStatus({ ...BASE, missingInSource: 7 });
    assert.equal(aviso.status, "SUCCESS_WITH_WARNINGS");
    assert.equal(aviso.exitCode, 0, "cron não pode falhar toda noite por condição permanente");
    assert.ok(aviso.reasons.some((r) => r.includes("ausentes_na_origem=7")));

    const escalado = resolveReceiptsRunStatus({
      ...BASE,
      missingInSource: 7,
      failOnMissing: true,
    });
    assert.equal(escalado.status, "SUCCESS_WITH_WARNINGS");
    assert.equal(escalado.exitCode, 1);
  });

  it("erro de gravação tem precedência sobre aviso de ausência", () => {
    const outcome = resolveReceiptsRunStatus({
      ...BASE,
      writeErrors: 1,
      missingInSource: 99,
    });
    assert.equal(outcome.status, "FAILED");
  });
});

describe("contrato do runner automático", () => {
  it("o runner existe, trava com flock e não embute regra de negócio", () => {
    const runner = read(RUNNER);
    assert.match(runner, /#!\/usr\/bin\/env bash/);
    assert.match(runner, /set -Eeuo pipefail/);
    assert.match(runner, /flock -n 9/);
    assert.match(runner, /induscost-nomus-receivable-receipts\.lock/);
    assert.match(runner, /npm run/);
    // Regra de negócio mora no TypeScript, nunca no shell.
    for (const forbidden of [/prisma\./i, /\.upsert\s*\(/, /payloadHash/]) {
      assert.doesNotMatch(runner, forbidden);
    }
  });

  it("o runner NÃO adquire o lock global do Nomus", () => {
    // OP-04: locks não compartilham pathname, justamente para não autolockar
    // com o runner diário/pedidos, que detém o global durante todo o pipeline.
    assert.doesNotMatch(shellCodeOnly(read(RUNNER)), /induscost-nomus-sync-global\.lock/);
  });

  it("colisão de lock termina em SKIPPED com exit 0, nunca em falha", () => {
    const runner = read(RUNNER);
    assert.match(runner, /SKIPPED: outra execução de Recebimentos/);
    const skipBlock = runner.slice(runner.indexOf("if ! flock -n 9"));
    assert.match(skipBlock.slice(0, 400), /EXIT_CODE=0/);
    assert.match(skipBlock.slice(0, 400), /exit 0/);
  });

  it("o runner tem log individual por execução e propaga o exit code", () => {
    const runner = read(RUNNER);
    assert.match(runner, /runner-receivable-receipts_\$\{MODE\}_\$\{RUN_STAMP\}\.log/);
    assert.match(runner, /tee -a "\$RUN_LOG"/);
    assert.match(runner, /STARTED_AT=/);
    assert.match(runner, /FINISHED_AT=/);
    assert.match(runner, /EXIT_CODE=\$EXIT_CODE/);
    assert.match(runner, /exit "\$EXIT_CODE"/);
  });

  it("a rotina automática faz FULL SCAN e nunca usa --since", () => {
    const runner = shellCodeOnly(read(RUNNER));
    assert.doesNotMatch(runner, /--since/, "cron não pode recortar janela");
    assert.doesNotMatch(runner, /--page\b/, "cron não pode fixar página");
    assert.doesNotMatch(runner, /--startPage/, "cron sempre começa na página 1");

    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    for (const mode of ["preview", "apply"]) {
      const cmd = pkg.scripts[`sync:nomus:receipts:fullscan:${mode}`];
      assert.ok(cmd, `script npm ausente para ${mode}`);
      assert.match(cmd, /--require-full-scan/);
      assert.match(cmd, /--maxPages 200/);
      assert.doesNotMatch(cmd, /--since/);
      assert.doesNotMatch(cmd, /--startPage/);
    }
  });

  it("o runner não vaza credencial no log", () => {
    assert.doesNotMatch(read(RUNNER), /NOMUS_TOKEN|Authorization|NOMUS_AUTH_HEADER_VALUE/i);
  });

  it("HTTP/retry/429 continuam vindo do cliente Nomus oficial", () => {
    const script = read(SYNC_SCRIPT);
    assert.match(script, /fetchNomusJson/);
    // Nenhum cliente paralelo, nenhum retry reimplementado localmente.
    assert.doesNotMatch(script, /\bnew Agent\(/);
    assert.doesNotMatch(script, /Retry-After/i);
    assert.doesNotMatch(script, /setTimeout\([^)]*backoff/i);
  });

  it("ausência na origem nunca vira delete automático", () => {
    const script = read(SYNC_SCRIPT);
    assert.match(script, /auditReceiptsMissingInSource/);
    for (const destructive of [
      /nomusReceivableReceipt\.delete/,
      /nomusReceivableReceipt\.deleteMany/,
      /deleteMany\s*\(/,
    ]) {
      assert.doesNotMatch(script, destructive, "recebimento jamais é apagado automaticamente");
    }
  });

  it("idempotência por externalId/payloadHash permanece intacta", () => {
    const script = read(SYNC_SCRIPT);
    assert.match(script, /where: \{ externalId: row\.externalId \}/);
    assert.match(script, /existing\.payloadHash === row\.payloadHash/);
    // syncedAt é atualizado mesmo sem mudança de payload: é a evidência de que
    // o registro foi REOBSERVADO na origem nesta varredura.
    assert.match(script, /data: \{ syncedAt \}/);
  });
});
