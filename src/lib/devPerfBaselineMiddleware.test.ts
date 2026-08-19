/**
 * Middleware da linha de base — contrato de SEGURANÇA e NÃO-INTERFERÊNCIA.
 *
 * Agora que a flag pode ser ligada em produção, estas travas passam a valer
 * sobre dados reais de cliente:
 *  1. o corpo da resposta chega ao Express exatamente como o handler mandou;
 *  2. só metadados de performance saem (header e log) — nunca query string,
 *     cabeçalho, cookie, token ou conteúdo do payload;
 *  3. com a flag desligada o middleware é um passthrough puro.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";
import {
  MAX_PERF_BASELINE_SAMPLES,
  clearDevPerfSamples,
  createDevPerfBaselineMiddleware,
  getDevPerfSamples,
} from "@/src/lib/devPerfBaseline.server.js";

type FakeRes = Response & {
  __headers: Record<string, string>;
  __jsonBody: unknown;
  __finish: () => void;
};

function fakeReq(url: string, method = "GET"): Request {
  const [path] = url.split("?");
  return {
    method,
    path: path ?? url,
    originalUrl: url,
    headers: {
      authorization: "Bearer TOKEN-SUPER-SECRETO",
      cookie: "session=abc123; token=xyz789",
    },
  } as unknown as Request;
}

function fakeRes(): FakeRes {
  const handlers: Array<() => void> = [];
  const res = {
    statusCode: 200,
    __headers: {} as Record<string, string>,
    __jsonBody: undefined as unknown,
    setHeader(name: string, value: string) {
      (this as unknown as FakeRes).__headers[name] = value;
    },
    json(body: unknown) {
      (this as unknown as FakeRes).__jsonBody = body;
      return this;
    },
    on(event: string, cb: () => void) {
      if (event === "finish") handlers.push(cb);
      return this;
    },
    __finish() {
      for (const cb of handlers) cb();
    },
  };
  return res as unknown as FakeRes;
}

function withFlag(value: string | undefined, run: () => void): void {
  const prev = process.env.INDUSCOST_PERF_BASELINE;
  try {
    if (value === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
    else process.env.INDUSCOST_PERF_BASELINE = value;
    run();
  } finally {
    if (prev === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
    else process.env.INDUSCOST_PERF_BASELINE = prev;
  }
}

/** Captura o console.info do middleware sem deixar vazar para a saída do teste. */
function captureConsoleInfo(run: () => void): string[] {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  try {
    run();
  } finally {
    console.info = original;
  }
  return lines;
}

describe("devPerfBaseline middleware — não interfere e não vaza", () => {
  it("com a flag DESLIGADA é passthrough: nenhum header, nenhum log", () => {
    withFlag(undefined, () => {
      const mw = createDevPerfBaselineMiddleware();
      const req = fakeReq("/api/finance/cash-flow/dashboard?year=2026");
      const res = fakeRes();
      let nextCalled = false;
      const lines = captureConsoleInfo(() => {
        mw(req, res, (() => {
          nextCalled = true;
        }) as unknown as NextFunction);
        res.json({ total: 10 });
        res.__finish();
      });
      assert.equal(nextCalled, true);
      assert.deepEqual(res.__headers, {});
      assert.deepEqual(lines, []);
      assert.deepEqual(res.__jsonBody, { total: 10 });
    });
  });

  it("com a flag LIGADA o corpo da resposta é entregue intacto", () => {
    withFlag("1", () => {
      const mw = createDevPerfBaselineMiddleware();
      const req = fakeReq("/api/finance/cash-flow/dashboard?year=2026");
      const res = fakeRes();
      const body = {
        blocks: { totalReceivableOpen: 1234.56 },
        monthlySeries: [{ month: 1, inflowAmount: 10 }],
      };
      captureConsoleInfo(() => {
        mw(req, res, (() => {}) as unknown as NextFunction);
        res.json(body);
        res.__finish();
      });
      // Mesmo conteúdo E mesma referência: nada é clonado ou reescrito.
      assert.deepEqual(res.__jsonBody, body);
      assert.equal(res.__jsonBody, body);
    });
  });

  it("o header expõe apenas métricas — sem query string, token ou cookie", () => {
    withFlag("1", () => {
      const mw = createDevPerfBaselineMiddleware();
      const req = fakeReq(
        "/api/finance/cash-flow/dashboard?year=2026&personCnpj=12345678000199"
      );
      const res = fakeRes();
      captureConsoleInfo(() => {
        mw(req, res, (() => {}) as unknown as NextFunction);
        res.json({ ok: true });
        res.__finish();
      });
      const header = res.__headers["X-IndusCost-Perf"] ?? "";
      assert.match(header, /^totalMs=[\d.]+;dbMs=[\d.]+;queries=\d+;bytes=\d+$/);
      for (const secret of ["TOKEN", "session", "12345678000199", "year=2026"]) {
        assert.ok(!header.includes(secret), `header vazou: ${secret}`);
      }
    });
  });

  it("o log traz método, rota sem query string, status e métricas — nada além", () => {
    withFlag("1", () => {
      const mw = createDevPerfBaselineMiddleware();
      const req = fakeReq(
        "/api/finance/cash-flow/dashboard?year=2026&personCnpj=12345678000199&customerName=ACME"
      );
      const res = fakeRes();
      const lines = captureConsoleInfo(() => {
        mw(req, res, (() => {}) as unknown as NextFunction);
        res.json({ segredo: "valor financeiro sensível" });
        res.__finish();
      });
      assert.equal(lines.length, 1);
      const line = lines[0]!;
      assert.ok(line.startsWith("[perf-baseline:http] GET /api/finance/cash-flow/dashboard"));
      assert.match(line, /status=200 total=[\d.]+ms db=[\d.]+ms q=\d+ bytes≈\d+/);
      assert.match(line, /profilingSerializeMs=[\d.]+ \(excludedFromTotalMs\)/);
      for (const secret of [
        "personCnpj",
        "12345678000199",
        "ACME",
        "customerName",
        "year=2026",
        "TOKEN-SUPER-SECRETO",
        "session=abc123",
        "valor financeiro sensível",
        "SELECT",
      ]) {
        assert.ok(!line.includes(secret), `log vazou: ${secret}`);
      }
    });
  });

  /**
   * O buffer é uma janela deslizante: em produção o processo vive semanas e
   * um array sem teto viraria vazamento silencioso.
   */
  function recordRequests(count: number, startIndex = 0): void {
    const mw = createDevPerfBaselineMiddleware();
    captureConsoleInfo(() => {
      for (let i = 0; i < count; i += 1) {
        const req = fakeReq(`/api/finance/req-${startIndex + i}`);
        const res = fakeRes();
        mw(req, res, (() => {}) as unknown as NextFunction);
        res.json({ i });
        res.__finish();
      }
    });
  }

  it("até o teto, todas as amostras permanecem", () => {
    withFlag("1", () => {
      clearDevPerfSamples();
      recordRequests(MAX_PERF_BASELINE_SAMPLES);
      const samples = getDevPerfSamples();
      assert.equal(samples.length, MAX_PERF_BASELINE_SAMPLES);
      assert.equal(samples[0]?.path, "/api/finance/req-0");
      assert.equal(
        samples.at(-1)?.path,
        `/api/finance/req-${MAX_PERF_BASELINE_SAMPLES - 1}`
      );
    });
  });

  it("acima do teto, as mais antigas são descartadas e o array nunca cresce", () => {
    withFlag("1", () => {
      clearDevPerfSamples();
      const extra = 120;
      recordRequests(MAX_PERF_BASELINE_SAMPLES + extra);
      const samples = getDevPerfSamples();
      assert.equal(samples.length, MAX_PERF_BASELINE_SAMPLES, "teto respeitado");
      // A janela retida é o FIM da sequência — o começo saiu.
      assert.equal(samples[0]?.path, `/api/finance/req-${extra}`);
      assert.equal(
        samples.at(-1)?.path,
        `/api/finance/req-${MAX_PERF_BASELINE_SAMPLES + extra - 1}`
      );
      // E continua estável se seguir recebendo tráfego.
      recordRequests(50, MAX_PERF_BASELINE_SAMPLES + extra);
      assert.equal(getDevPerfSamples().length, MAX_PERF_BASELINE_SAMPLES);
      clearDevPerfSamples();
      assert.equal(getDevPerfSamples().length, 0, "reset continua funcionando");
    });
  });

  it("rotas fora do escopo instrumentado passam direto mesmo com a flag ligada", () => {
    withFlag("1", () => {
      const mw = createDevPerfBaselineMiddleware();
      const req = fakeReq("/api/auth/me");
      const res = fakeRes();
      const lines = captureConsoleInfo(() => {
        mw(req, res, (() => {}) as unknown as NextFunction);
        res.json({ user: "paulo" });
        res.__finish();
      });
      assert.deepEqual(res.__headers, {});
      assert.deepEqual(lines, []);
      assert.deepEqual(res.__jsonBody, { user: "paulo" });
    });
  });
});
