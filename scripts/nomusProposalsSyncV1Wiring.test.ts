/**
 * Verificação por leitura de código-fonte da correção de confiabilidade do
 * sync de Propostas (SYNC-07 hardening). `nomusProposalsSyncV1.ts` faz
 * chamadas HTTP reais e grava no Postgres via Prisma — sem banco/rede nesta
 * suíte, então travamos por regex o que os testes comportamentais de
 * `src/lib/nomusRestClient.test.ts` e `src/lib/nomusProposalsIntegrationRun.test.ts`
 * não alcançam sozinhos: que o SCRIPT realmente usa o motor corrigido, em
 * vez de ter revivido uma implementação local sem timeout.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("nomusProposalsSyncV1.ts — usa o motor HTTP compartilhado (sem timeout local duplicado)", () => {
  const src = read("scripts/nomusProposalsSyncV1.ts");

  it("importa fetchNomusJson do cliente REST compartilhado — não reimplementa fetch cru", () => {
    assert.match(src, /import\s*\{[^}]*fetchNomusJson[^}]*\}\s*from\s*"\.\.\/src\/lib\/nomusRestClient\.ts"/s);
  });

  it("não existe mais um `fetch(url, { method: \"GET\", headers })` sem signal (o bug original)", () => {
    // O único fetch cru remanescente é o de fetchPricingSnapshotUnitCost,
    // que agora TEM signal/AbortController — nenhuma chamada Nomus usa
    // fetch cru sem passar pelo helper compartilhado.
    const rawNomusFetch = /await fetch\(url, \{ method: "GET", headers \}\);/;
    assert.doesNotMatch(src, rawNomusFetch);
  });

  it("as três chamadas Nomus (propostas/produtos/pessoas) passam por fetchJsonWithRetry → fetchNomusJson", () => {
    assert.match(src, /async function fetchJsonWithRetry\(/);
    assert.match(src, /return fetchNomusJson\(url, \{/);
    const callSites = src.match(/await fetchJsonWithRetry\(/g) ?? [];
    assert.equal(callSites.length, 3, "esperava 3 call sites (propostas, produtos, pessoas)");
  });

  it("chamada interna (pricing-snapshot) também tem AbortController/timeout — não fica sem timeout só porque não é Nomus", () => {
    const fnBody = src.slice(
      src.indexOf("async function fetchPricingSnapshotUnitCost"),
      src.indexOf("async function mapLatestUnitCostByProductId")
    );
    assert.match(fnBody, /new AbortController\(\)/);
    assert.match(fnBody, /signal: controller\.signal/);
    assert.match(fnBody, /clearTimeout\(timer\)/);
  });

  it("NOMUS_HTTP_TIMEOUT_MS é resolvido via helper central — não um literal 60000 solto", () => {
    assert.match(src, /const HTTP_TIMEOUT_MS = resolveNomusHttpTimeoutMs\(\);/);
    assert.doesNotMatch(src, /timeoutMs:\s*60000/);
  });
});

describe("nomusProposalsSyncV1.ts — toda execução termina num estado final auditável", () => {
  const src = read("scripts/nomusProposalsSyncV1.ts");

  it("registra SKIPPED quando o lock está ocupado, ANTES do return — nunca aparece como sucesso", () => {
    const lockBlock = src.slice(src.indexOf("if (!lock.ok) {"), src.indexOf("try {\n    const { plans"));
    assert.match(lockBlock, /status: "SKIPPED"/);
    assert.match(lockBlock, /await persistProposalsIntegrationRun\(/);
  });

  it("registra SUCCESS no dry-run e no apply", () => {
    const successCalls = src.match(/status: "SUCCESS",[\s\S]{0,40}startedAt,/g) ?? [];
    assert.ok(successCalls.length >= 2, "esperava registro SUCCESS tanto no dry-run quanto no apply");
  });

  it("registra FAILED num catch que RELANÇA o erro (exit code != 0 preservado)", () => {
    const mainBody = src.slice(src.indexOf("async function main("), src.indexOf("\nmain()\n"));
    assert.match(mainBody, /catch \(error\) \{[\s\S]*status: "FAILED"[\s\S]*throw error;/);
  });

  it("o lock é sempre liberado no finally, independente do resultado", () => {
    assert.match(src, /\} finally \{\s*\/\/ Sempre libera/);
    assert.match(src, /releaseProposalsSyncLock\(/);
  });

  it("nenhum segredo (token/authorization) é logado", () => {
    assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*NOMUS_TOKEN/);
    assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*Authorization/);
  });
});

describe("runNomusProposalsHourlySync.sh — encaminha o próprio log para o IntegrationRun", () => {
  const src = read("scripts/runNomusProposalsHourlySync.sh");

  it("exporta NOMUS_PROPOSALS_RUNNER_LOG com o caminho real do log desta execução", () => {
    assert.match(src, /export NOMUS_PROPOSALS_RUNNER_LOG="\$RUN_LOG"/);
  });
});
