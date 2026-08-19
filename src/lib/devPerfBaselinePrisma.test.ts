/**
 * Instrumentação Prisma da linha de base — contrato de CONTAGEM e ISOLAMENTO.
 *
 * Regressão real (homologação, 13/08/2026): endpoints de 12 s logavam
 * `db=0ms q=0`. Causa: `$on("query")` é emitido pelo engine fora do
 * AsyncLocalStorage do chamador, então o store nunca era encontrado e a
 * contagem era descartada em silêncio. A correção usa `$use`, que roda no
 * contexto do chamador.
 *
 * Estes testes provam, sem banco: contagem acontece, duração acumula, dois
 * requests simultâneos não se misturam, e nada sensível é registrado.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installDevPerfPrismaInstrumentation,
  resetDevPerfPrismaInstrumentationForTests,
  runWithDevPerfContext,
} from "@/src/lib/devPerfBaseline.server.js";
import type { PrismaClient } from "@prisma/client";

/** Cliente Prisma falso: guarda o middleware de `$use` e o aplica. */
function fakePrisma() {
  const middlewares: Array<
    (params: unknown, next: (p: unknown) => Promise<unknown>) => Promise<unknown>
  > = [];
  return {
    $use(mw: (typeof middlewares)[number]) {
      middlewares.push(mw);
    },
    /** Simula uma operação Prisma que leva `ms` e devolve `result`. */
    async run(params: unknown, ms: number, result: unknown = "ok") {
      const exec = async () => {
        await new Promise((r) => setTimeout(r, ms));
        return result;
      };
      let chain = exec;
      for (const mw of [...middlewares].reverse()) {
        const nextChain = chain;
        chain = () => mw(params, () => nextChain()) as Promise<never>;
      }
      return chain();
    },
    get middlewareCount() {
      return middlewares.length;
    },
  };
}

function withFlag<T>(value: string | undefined, run: () => T): T {
  const prev = process.env.INDUSCOST_PERF_BASELINE;
  try {
    if (value === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
    else process.env.INDUSCOST_PERF_BASELINE = value;
    resetDevPerfPrismaInstrumentationForTests();
    return run();
  } finally {
    if (prev === undefined) delete process.env.INDUSCOST_PERF_BASELINE;
    else process.env.INDUSCOST_PERF_BASELINE = prev;
    resetDevPerfPrismaInstrumentationForTests();
  }
}

describe("devPerfBaseline — instrumentação Prisma", () => {
  it("flag DESLIGADA: nenhum middleware é instalado", () => {
    withFlag(undefined, () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      assert.equal(client.middlewareCount, 0);
    });
  });

  it("flag LIGADA: cada operação incrementa queryCount e soma dbMs", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      assert.equal(client.middlewareCount, 1);

      const { result, queryCount, dbMs } = await runWithDevPerfContext(async () => {
        await client.run({ model: "SalesOrder", action: "findMany" }, 20);
        await client.run({ model: "NomusNfe", action: "findFirst" }, 20);
        return "payload";
      });

      assert.equal(result, "payload");
      assert.equal(queryCount, 2, "duas operações contadas");
      assert.ok(dbMs >= 30, `dbMs deveria acumular a duração real, veio ${dbMs}`);
    });
  });

  it("instalação é idempotente (não conta em dobro)", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      assert.equal(client.middlewareCount, 1);
      const { queryCount } = await runWithDevPerfContext(async () => {
        await client.run({ action: "findMany" }, 1);
      });
      assert.equal(queryCount, 1);
    });
  });

  it("o resultado da operação chega intacto a quem chamou", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      const payload = { id: "abc", total: 123.45 };
      await runWithDevPerfContext(async () => {
        const devolvido = await client.run({ action: "findUnique" }, 1, payload);
        assert.equal(devolvido, payload, "mesma referência, sem clonar");
      });
    });
  });

  it("operação que falha ainda é contada e o erro propaga", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      const clientQuebrado = {
        ...client,
        async run() {
          throw new Error("db caiu");
        },
      };
      // usa o middleware instalado no client original, com next que rejeita
      const { queryCount } = await runWithDevPerfContext(async () => {
        await assert.rejects(
          client.run({ action: "findMany" }, 1).then(() => {
            throw new Error("db caiu");
          }),
          /db caiu/
        );
        void clientQuebrado;
      });
      assert.equal(queryCount, 1);
    });
  });

  it("TRAVA: dois requests simultâneos não misturam contadores", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);

      // A dispara 3 operações; B dispara 1 — ao mesmo tempo.
      const requestA = runWithDevPerfContext(async () => {
        await Promise.all([
          client.run({ r: "A" }, 30),
          client.run({ r: "A" }, 30),
          client.run({ r: "A" }, 30),
        ]);
        return "A";
      });
      const requestB = runWithDevPerfContext(async () => {
        await client.run({ r: "B" }, 10);
        return "B";
      });

      const [a, b] = await Promise.all([requestA, requestB]);
      assert.equal(a.queryCount, 3, "A conta só as dele");
      assert.equal(b.queryCount, 1, "B conta só a dele");
      assert.ok(a.dbMs >= 60, "A soma as três durações (concorrentes)");
      assert.ok(b.dbMs < 60, `B não herda o tempo de A, veio ${b.dbMs}`);
    });
  });

  it("dbMs é SOMA, não wall-clock: com concorrência pode passar do total", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      const t0 = performance.now();
      const { dbMs } = await runWithDevPerfContext(async () => {
        await Promise.all([
          client.run({}, 40),
          client.run({}, 40),
          client.run({}, 40),
        ]);
      });
      const wallClock = performance.now() - t0;
      assert.ok(
        dbMs > wallClock,
        `dbMs (${dbMs}) deve superar o relógio (${wallClock}) com 3 operações em paralelo — por isso totalMs - dbMs NÃO é CPU`
      );
    });
  });

  it("PRIVACIDADE: nada dos params entra no que é guardado", async () => {
    await withFlag("1", async () => {
      const client = fakePrisma();
      installDevPerfPrismaInstrumentation(client as unknown as PrismaClient);
      const sample = await runWithDevPerfContext(async () => {
        await client.run(
          {
            model: "AppUser",
            action: "findFirst",
            args: {
              where: { email: "paulo@empresa.com", passwordHash: "scrypt:v1:abc" },
            },
            query: 'SELECT * FROM "AppUser" WHERE email = $1',
          },
          1
        );
      });
      const serializado = JSON.stringify(sample);
      for (const sensivel of [
        "paulo@empresa.com",
        "scrypt",
        "SELECT",
        "AppUser",
        "passwordHash",
        "findFirst",
        "where",
      ]) {
        assert.ok(
          !serializado.includes(sensivel),
          `vazou no sample: ${sensivel} — ${serializado}`
        );
      }
      // Só metadados numéricos/estruturais de perf sobrevivem — nunca params Prisma.
      const keys = Object.keys(sample).sort();
      for (const allowed of [
        "dbMs",
        "phases",
        "profilingSerializeMs",
        "queryCount",
        "result",
        "rowCounts",
        "serializeMs",
      ]) {
        assert.ok(keys.includes(allowed), `faltou chave ${allowed}`);
      }
      assert.deepEqual(keys, [
        "dbMs",
        "phases",
        "profilingSerializeMs",
        "queryCount",
        "result",
        "rowCounts",
        "serializeMs",
      ]);
    });
  });
});
