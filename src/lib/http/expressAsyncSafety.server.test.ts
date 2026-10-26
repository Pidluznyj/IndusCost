/**
 * Rede de segurança HTTP (Express 4): rejeição de handler async → handler global → resposta controlada; o processo
 * continua vivo. Inclui a reprodução do incidente de 26/10/2026 num processo Node separado (sem a correção o
 * processo morre com código 1; com a correção responde e segue atendendo).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import express from "express";
import {
  createGlobalErrorHandler,
  describeErrorForLog,
  installExpressAsyncErrorForwarding,
  prismaErrorCode,
} from "./expressAsyncSafety.server.ts";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..");

function prismaLikeError(code: string, message = "Unique constraint failed on the fields: (`taxId`) — dado sensível"): Error {
  return Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code, meta: { target: ["taxId"] } });
}

describe("rede de segurança HTTP (Express 4)", () => {
  let base = "";
  let close: () => Promise<void>;
  const logs: string[] = [];

  before(async () => {
    installExpressAsyncErrorForwarding();
    const app = express();
    app.use(express.json());
    app.get("/alive", (_req, res) => res.json({ ok: true }));
    app.post("/p2002", async () => {
      await Promise.resolve();
      throw prismaLikeError("P2002");
    });
    app.post("/p2025", async () => {
      throw prismaLikeError("P2025", "Record to update not found.");
    });
    app.post("/boom", async () => {
      await new Promise((r) => setTimeout(r, 5));
      throw new Error("falha interna com senha=segredo e SELECT * FROM \"Customer\"");
    });
    app.post("/prisma-other", async () => {
      throw prismaLikeError("P1001", "Can't reach database server at db.interno:5432");
    });
    app.post("/json", (req, res) => res.json(req.body));
    app.get("/partial", async (_req, res) => {
      res.status(200).write("parcial");
      throw new Error("depois de começar a resposta");
    });
    const router = express.Router();
    router.get("/router-boom", async () => {
      throw new Error("rejeição dentro de express.Router");
    });
    app.use(router);
    app.use(async (err: unknown, _req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if ((err as { marker?: string }).marker === "async-error-mw") throw new Error("middleware de erro async rejeitou");
      next(err);
    });
    app.get("/async-error-mw", async () => {
      throw Object.assign(new Error("x"), { marker: "async-error-mw" });
    });
    app.use(createGlobalErrorHandler({ production: true, log: (label) => logs.push(label) }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => new Promise((r) => server.close(() => r()));
  });
  after(() => close());

  it("A1. rejeição genérica → 500 controlado, sem mensagem interna nem stack; servidor segue atendendo", async () => {
    const r = await fetch(`${base}/boom`, { method: "POST" });
    assert.equal(r.status, 500);
    const body = await r.json();
    assert.equal(body.code, "INTERNAL_ERROR");
    assert.doesNotMatch(JSON.stringify(body), /segredo|SELECT|stack/);
    assert.equal((await fetch(`${base}/alive`)).status, 200);
  });

  it("A2. P2002 de qualquer rota → 409 estável; P2025 → 404; outros erros Prisma → 500 sem detalhes", async () => {
    const dup = await fetch(`${base}/p2002`, { method: "POST" });
    assert.equal(dup.status, 409);
    const dupBody = await dup.json();
    assert.equal(dupBody.code, "UNIQUE_CONSTRAINT_VIOLATION");
    assert.doesNotMatch(JSON.stringify(dupBody), /taxId|sensível/);
    assert.equal((await fetch(`${base}/p2025`, { method: "POST" })).status, 404);
    const other = await fetch(`${base}/prisma-other`, { method: "POST" });
    assert.equal(other.status, 500);
    assert.doesNotMatch(await other.text(), /db\.interno/);
  });

  it("A3. erro 4xx explícito (JSON inválido) mantém o status e a mensagem pública", async () => {
    const r = await fetch(`${base}/json`, { method: "POST", headers: { "content-type": "application/json" }, body: "{inválido" });
    assert.equal(r.status, 400);
  });

  it("A4. rejeição em express.Router e em middleware de erro async também é tratada", async () => {
    assert.equal((await fetch(`${base}/router-boom`)).status, 500);
    assert.equal((await fetch(`${base}/async-error-mw`)).status, 500);
  });

  it("A5. erro depois de a resposta começar: conexão encerrada pelo Express, processo segue", async () => {
    await fetch(`${base}/partial`).then((r) => r.text()).catch(() => "conexão encerrada");
    assert.equal((await fetch(`${base}/alive`)).status, 200);
    assert.ok(logs.some((l) => l.includes("/partial")));
  });

  it("A6. utilitários: código Prisma e descrição para log sem a mensagem", () => {
    assert.equal(prismaErrorCode(prismaLikeError("P2002")), "P2002");
    assert.equal(prismaErrorCode(new Error("x")), null);
    assert.equal(describeErrorForLog(prismaLikeError("P2002")), "PrismaClientKnownRequestError(P2002)");
    assert.doesNotMatch(describeErrorForLog(new Error("senha=1")), /senha/);
  });
});

describe("reprodução do incidente de 26/10/2026 em processo separado", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "async-safety-proc-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  /** Servidor mínimo: POST /api/customers rejeita com P2002 como o prisma.customer.create da produção. */
  function serverScript(withFix: boolean) {
    const file = join(dir, `server-${withFix ? "fix" : "nofix"}.mts`);
    writeFileSync(
      file,
      `import express from ${JSON.stringify(pathToFileURL(join(REPO, "node_modules/express/index.js")).href)};
import { createGlobalErrorHandler, installExpressAsyncErrorForwarding, installProcessSafetyNet } from ${JSON.stringify(pathToFileURL(join(REPO, "src/lib/http/expressAsyncSafety.server.ts")).href)};
let server;
if (${withFix}) {
  installExpressAsyncErrorForwarding();
  installProcessSafetyNet({ getServer: () => server, graceMs: Number(process.env.GRACE_MS ?? 3000), log: (m) => console.log(m) });
}
const app = express();
app.use(express.json());
app.get("/alive", (_req, res) => res.json({ ok: true }));
app.post("/api/customers", async (_req, res) => {
  const err = Object.assign(new Error("Unique constraint failed on the fields: (\`taxId\`)"), { name: "PrismaClientKnownRequestError", code: "P2002" });
  await Promise.reject(err);
  res.json({});
});
app.get("/route-boom", async () => { throw new Error("falha numa rota"); });
// Rotina em segundo plano sem tratamento (ex.: sincronização disparada sem .catch).
app.get("/background", (_req, res) => { void Promise.reject(new Error("sincronização em segundo plano falhou")); res.json({ ok: true }); });
app.get("/background-twice", (_req, res) => { void Promise.reject(new Error("rotina A")); void Promise.reject(new Error("rotina B")); res.json({ ok: true }); });
app.get("/slow", async (req, res) => { await new Promise((r) => setTimeout(r, Number(req.query.ms ?? 1000))); res.json({ ok: "concluída" }); });
app.get("/hang", () => {});
app.use(createGlobalErrorHandler({ production: true, log: () => {} }));
server = app.listen(0, "127.0.0.1", () => console.log("PORT=" + server.address().port));
`
    );
    return file;
  }

  async function startChild(withFix: boolean, extraEnv: Record<string, string> = {}) {
    // Sem NODE_TEST_CONTEXT: o filho é um servidor comum, não um subprocesso do test runner.
    const { NODE_TEST_CONTEXT: _ctx, ...env } = process.env;
    const child = spawn(process.execPath, ["--import", "tsx", serverScript(withFix)], { cwd: REPO, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    let gone = false;
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => ((gone = true), r(code))));
    for (let i = 0; i < 400 && !gone && !/PORT=\d+/.test(out); i++) await new Promise((r) => setTimeout(r, 50));
    const port = Number(/PORT=(\d+)/.exec(out)?.[1]);
    assert.ok(port > 0, out);
    return { child, base: `http://127.0.0.1:${port}`, exited, output: () => out };
  }
  const post = (base: string) =>
    fetch(`${base}/api/customers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taxId: "08.535.015/0001-66" }) })
      .then((r) => r.status)
      .catch(() => "sem resposta");

  it("I1. SEM a correção: CNPJ duplicado derruba o processo (código 1) — o 502 da produção", async () => {
    const s = await startChild(false);
    const status = await Promise.race([post(s.base), new Promise((r) => setTimeout(() => r("timeout"), 5000))]);
    const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r("vivo"), 5000))]);
    if (code === "vivo") s.child.kill();
    assert.equal(code, 1, `processo deveria morrer; status=${String(status)} saída=${s.output()}`);
    assert.notEqual(status, 409);
  });

  it("I2. COM a correção: repetir o cadastro devolve 409; erros de rota nunca encerram o processo", async () => {
    const s = await startChild(true);
    try {
      assert.equal(await post(s.base), 409);
      assert.equal(await post(s.base), 409);
      assert.equal((await fetch(`${s.base}/route-boom`)).status, 500);
      await new Promise((r) => setTimeout(r, 300));
      assert.equal((await fetch(`${s.base}/alive`)).status, 200);
      assert.equal(s.child.exitCode, null, "processo vivo");
      assert.doesNotMatch(s.output(), /encerramento supervisionado/);
    } finally {
      s.child.kill();
    }
  });

  it("S1. rejeição em segundo plano: registra, para de aceitar conexões, conclui a requisição em andamento e sai com 1", async () => {
    const s = await startChild(true);
    const inFlight = fetch(`${s.base}/slow?ms=1500`).then(async (r) => ({ status: r.status, body: await r.json() }));
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await fetch(`${s.base}/background`)).status, 200);
    await new Promise((r) => setTimeout(r, 300));
    const late = await fetch(`${s.base}/alive`).then((r) => r.status).catch(() => "recusada");
    assert.equal(late, "recusada", "novas conexões recusadas durante o encerramento");
    assert.deepEqual(await inFlight, { status: 200, body: { ok: "concluída" } }, "requisição em andamento concluída");
    assert.equal(await s.exited, 1);
    assert.match(s.output(), /\[unhandledRejection\] Error fora de uma requisição — estado do processo incerto; encerramento supervisionado/);
    assert.match(s.output(), /requisições em andamento concluídas; saindo com código 1/);
  });

  it("S2. requisição presa não impede a saída: prazo esgotado → código 1", async () => {
    const s = await startChild(true, { GRACE_MS: "1200" });
    void fetch(`${s.base}/hang`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    const t0 = Date.now();
    await fetch(`${s.base}/background`);
    assert.equal(await s.exited, 1);
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 1000 && elapsed < 6000, `saiu em ${elapsed} ms`);
    assert.match(s.output(), /prazo de 1200 ms esgotado/);
  });

  it("S3. várias rejeições: um único encerramento; as seguintes só são registradas", async () => {
    const s = await startChild(true, { GRACE_MS: "1500" });
    void fetch(`${s.base}/hang`).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    await fetch(`${s.base}/background-twice`);
    assert.equal(await s.exited, 1);
    assert.equal((s.output().match(/encerramento supervisionado/g) ?? []).length, 1);
    assert.equal((s.output().match(/durante o encerramento/g) ?? []).length, 1);
  });
});
