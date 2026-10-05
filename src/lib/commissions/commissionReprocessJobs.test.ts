/**
 * Reprocessamento de comissões em segundo plano: a prévia sem filtro analisava
 * até 2000 pedidos em uma única requisição, estourava os 100 s do proxy
 * (HTTP 524) e a tela exibia o HTML da página de erro.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { CommissionValidationError } from "./commissionApiValidation.js";
import { isCommissionReprocessJobRunning } from "./commissionReprocess.js";
import { CommissionReprocessError, type CommissionReprocessProgress } from "./commissionReprocess.server.js";
import {
  COMMISSION_REPROCESS_JOB_RESULT_TTL_MS,
  clearCommissionReprocessJobsForTest,
  commissionReprocessJobRunningView,
  getCommissionReprocessJob,
  startCommissionReprocessJob,
  waitForCommissionReprocessJob,
} from "./commissionReprocessJobs.server.js";
import { gatewayErrorMessage, parseApiErrorPayload } from "../http.js";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => clearCommissionReprocessJobsForTest());

describe("commission reprocess jobs", () => {
  it("rodada rápida termina dentro da espera e devolve o resultado", async () => {
    const job = startCommissionReprocessJob("preview", "user-1", async () => ({ mode: "preview" }));
    assert.equal(await waitForCommissionReprocessJob(job, 1000), true);
    assert.equal(job.status, "done");
    assert.deepEqual(job.result, { mode: "preview" });
    assert.equal(job.error, null);
  });

  it("rodada longa: a espera expira, o job segue rodando com progresso e conclui depois", async () => {
    const gate = deferred<{ mode: string }>();
    let report: ((progress: CommissionReprocessProgress) => void) | null = null;
    const job = startCommissionReprocessJob("preview", "user-1", (onProgress) => {
      report = onProgress;
      return gate.promise;
    });
    assert.equal(await waitForCommissionReprocessJob(job, 20), false);
    assert.equal(job.status, "running");
    report!({ phase: "analyzing", processed: 340, total: 2000 });
    const view = commissionReprocessJobRunningView(job);
    assert.deepEqual(view, {
      jobId: job.id,
      kind: "preview",
      status: "running",
      progress: { phase: "analyzing", processed: 340, total: 2000 },
    });
    assert.equal(isCommissionReprocessJobRunning(view), true);
    assert.equal(isCommissionReprocessJobRunning({ mode: "preview", summary: {} }), false);

    gate.resolve({ mode: "preview" });
    assert.equal(await waitForCommissionReprocessJob(job, 1000), true);
    assert.equal(job.status, "done");
    assert.deepEqual(getCommissionReprocessJob(job.id, "user-1")?.result, { mode: "preview" });
  });

  it("erros de negócio preservam status e código; erro inesperado vira 500 sem vazar detalhe", async () => {
    const locked = startCommissionReprocessJob("apply", "user-1", async () => {
      throw new CommissionReprocessError("REPROCESS_LOCKED", 409, "Já existe um reprocessamento em andamento.");
    });
    await waitForCommissionReprocessJob(locked, 1000);
    assert.equal(locked.status, "error");
    assert.deepEqual(locked.error, {
      status: 409,
      code: "REPROCESS_LOCKED",
      message: "Já existe um reprocessamento em andamento.",
    });

    const invalid = startCommissionReprocessJob("preview", "user-1", async () => {
      throw new CommissionValidationError("INVALID_FIELD", "customerExternalId inválido.");
    });
    await waitForCommissionReprocessJob(invalid, 1000);
    assert.deepEqual(invalid.error, { status: 400, code: "INVALID_FIELD", message: "customerExternalId inválido." });

    const originalError = console.error;
    console.error = () => {};
    try {
      const boom = startCommissionReprocessJob("preview", "user-1", async () => {
        throw new Error("connection string postgres://segredo");
      });
      await waitForCommissionReprocessJob(boom, 1000);
      assert.equal(boom.error?.status, 500);
      assert.equal(boom.error?.message, "Erro ao gerar prévia de reprocessamento de comissões.");
    } finally {
      console.error = originalError;
    }
  });

  it("só quem iniciou enxerga a rodada; id desconhecido devolve null", async () => {
    const job = startCommissionReprocessJob("preview", "user-1", async () => 1);
    await waitForCommissionReprocessJob(job, 1000);
    assert.equal(getCommissionReprocessJob(job.id, "user-2"), null);
    assert.equal(getCommissionReprocessJob("nao-existe", "user-1"), null);
    assert.equal(getCommissionReprocessJob(job.id, "user-1")?.id, job.id);
  });

  it("resultado expira depois do TTL; rodada em andamento nunca é removida", async () => {
    let clock = 1_000;
    const now = () => clock;
    const done = startCommissionReprocessJob("preview", "user-1", async () => 1, now);
    await waitForCommissionReprocessJob(done, 1000);
    const gate = deferred<number>();
    const running = startCommissionReprocessJob("preview", "user-1", () => gate.promise, now);

    clock += COMMISSION_REPROCESS_JOB_RESULT_TTL_MS + 1;
    const trigger = startCommissionReprocessJob("preview", "user-1", async () => 2, now);
    await waitForCommissionReprocessJob(trigger, 1000);
    assert.equal(getCommissionReprocessJob(done.id, "user-1"), null);
    assert.equal(getCommissionReprocessJob(running.id, "user-1")?.status, "running");
    gate.resolve(3);
    await waitForCommissionReprocessJob(running, 1000);
  });
});

describe("commission reprocess — rotas, motor e tela", () => {
  const routes = read("src/lib/commissionsRoutes.ts");
  const server = read("src/lib/commissions/commissionReprocess.server.ts");
  const panel = read("src/components/commissions/CommissionReprocessPanel.tsx");

  it("POST preview/apply iniciam job, esperam bem menos que os 100 s do proxy e respondem 202 se ainda roda", () => {
    const wait = Number(/COMMISSION_REPROCESS_SYNC_WAIT_MS = ([\d_]+)/.exec(routes)![1]!.replace(/_/g, ""));
    assert.ok(wait >= 5_000 && wait <= 60_000, String(wait));
    for (const kind of ["preview", "apply"]) {
      const start = routes.indexOf(`app.post("/api/commissions/reprocess/${kind}"`);
      const block = routes.slice(start, routes.indexOf("\n  });", start));
      assert.match(block, /reprocessGuard/);
      assert.match(block, new RegExp(`startCommissionReprocessJob\\("${kind}", user\\.id`));
      assert.match(block, /onProgress/);
      assert.match(block, /waitForCommissionReprocessJob\(job, COMMISSION_REPROCESS_SYNC_WAIT_MS\)/);
      assert.match(block, /respondCommissionReprocessJob\(res, job\)/);
    }
    assert.match(routes, /res\.status\(202\)\.json\(commissionReprocessJobRunningView\(job\)\)/);
    const statusStart = routes.indexOf('app.get("/api/commissions/reprocess/jobs/:jobId"');
    const statusBlock = routes.slice(statusStart, routes.indexOf("\n  });", statusStart));
    assert.match(statusBlock, /reprocessGuard/);
    assert.match(statusBlock, /getCommissionReprocessJob\(String\(req\.params\.jobId\), user\.id\)/);
    assert.match(statusBlock, /REPROCESS_JOB_NOT_FOUND/);
  });

  it("análise em pool paralelo limitado, com progresso e aviso de teto; aplicação continua sequencial", () => {
    const concurrency = Number(/REPROCESS_EVALUATION_CONCURRENCY = (\d+)/.exec(server)![1]);
    assert.ok(concurrency >= 2 && concurrency <= 8);
    const compute = server.slice(server.indexOf("async function computeReprocessRows"), server.indexOf("type ReprocessLockValue"));
    assert.match(compute, /Promise\.all\(/);
    assert.match(compute, /REPROCESS_EVALUATION_CONCURRENCY/);
    assert.match(compute, /evaluated\[index\] = await evaluateReprocessRow/);
    assert.match(compute, /phase: "analyzing"/);
    assert.match(compute, /orderLimitReached: orderIds\.length >= MAX_ORDERS/);
    assert.match(server, /orderLimit: \{ limit: MAX_ORDERS, reached: orderLimitReached \}/);
    // Escrita (rematerialização + schedule) segue um pedido por vez, dentro do lock.
    const apply = server.slice(server.indexOf("export async function applyCommissionReprocess"));
    assert.match(apply, /withReprocessLock\(db, input\.userId/);
    assert.match(apply, /for \(const row of rows\) \{/);
    assert.match(apply, /phase: "applying"/);
    // A avaliação continua dry-run.
    assert.match(server, /salesOrderId: order\.id,\s+dryRun: true/);
  });

  it("tela acompanha o job por GET, mostra o progresso e avisa quando o teto cortou a seleção", () => {
    assert.match(panel, /isCommissionReprocessJobRunning\(payload\)/);
    assert.match(panel, /\/api\/commissions\/reprocess\/jobs\/\$\{encodeURIComponent\(payload\.jobId\)\}/);
    assert.match(panel, /REPROCESS_JOB_POLL_MS/);
    assert.match(panel, /de \$\{progress\.total\} pedido\(s\)/);
    assert.match(panel, /preview\.orderLimit\?\.reached/);
    assert.match(panel, /unmountedRef\.current/);
  });
});

describe("http — página de erro do proxy não vira texto na tela", () => {
  const cloudflare =
    '<!DOCTYPE html> <!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]--> <head><title>524</title></head>';

  it("524 em HTML vira mensagem clara de demora", async () => {
    const res = new Response(cloudflare, { status: 524, headers: { "content-type": "text/html; charset=UTF-8" } });
    const payload = await parseApiErrorPayload(res);
    assert.doesNotMatch(payload.message, /</);
    assert.match(payload.message, /demorou demais para responder \(HTTP 524\)/);
  });

  it("HTML sem content-type também é detectado; 502 indica indisponibilidade", async () => {
    const res = new Response("<html><body>Bad gateway</body></html>", { status: 502 });
    res.headers.delete("content-type");
    const payload = await parseApiErrorPayload(res);
    assert.equal(payload.message, gatewayErrorMessage(502));
    assert.match(payload.message, /indisponível/);
    assert.equal(gatewayErrorMessage(500), "Erro HTTP 500");
  });

  it("JSON e texto simples continuam como antes", async () => {
    const json = new Response(JSON.stringify({ error: "Motivo obrigatório.", code: "INVALID_REASON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    assert.deepEqual(await parseApiErrorPayload(json), {
      message: "Motivo obrigatório.",
      code: "INVALID_REASON",
      existingSupplierId: undefined,
      conflicts: undefined,
    });
    const plain = new Response("Payload muito grande", { status: 413, headers: { "content-type": "text/plain" } });
    assert.equal((await parseApiErrorPayload(plain)).message, "Payload muito grande");
  });
});
