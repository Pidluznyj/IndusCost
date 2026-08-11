/**
 * dedupeInFlight — mecanismo que corrige a lentidão do Relatório Presidencial:
 * as 3 cargas de portfólio AR (período/ano/comparativo histórico) rodam em
 * paralelo e frequentemente auditam os MESMOS pedidos (getOrderFullAudit,
 * ~28 consultas cada) ao mesmo tempo. Testado aqui de forma pura — sem
 * Prisma/banco — porque o Postgres não está acessível neste ambiente; a
 * garantia comportamental (coalesce só em janela concorrente, nunca serve
 * dado obsoleto) é 100% verificável sem infraestrutura.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dedupeInFlight } from "./requestDedupe.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("dedupeInFlight", () => {
  it("duas chamadas CONCORRENTES com a mesma chave compartilham uma única execução de factory()", async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const d = deferred<number>();
    const factory = () => {
      calls += 1;
      return d.promise;
    };

    const p1 = dedupeInFlight(cache, "order-1", factory);
    const p2 = dedupeInFlight(cache, "order-1", factory);
    assert.equal(calls, 1, "factory só deve rodar uma vez para chamadas concorrentes");

    d.resolve(42);
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 42);
    assert.equal(r2, 42);
  });

  it("simula as 3 cargas do Relatório Presidencial auditando o MESMO pedido em paralelo: 1 execução para N chamadores", async () => {
    const cache = new Map<string, Promise<{ orderId: string; auditedAt: number }>>();
    let auditCalls = 0;
    const auditOrder = (orderId: string) => {
      auditCalls += 1;
      return Promise.resolve({ orderId, auditedAt: auditCalls });
    };

    // período, ano, comparativo histórico — todas pedem o mesmo pedido "PD-620" ao mesmo tempo.
    const [fromPeriod, fromYear, fromHistorical] = await Promise.all([
      dedupeInFlight(cache, "PD-620", () => auditOrder("PD-620")),
      dedupeInFlight(cache, "PD-620", () => auditOrder("PD-620")),
      dedupeInFlight(cache, "PD-620", () => auditOrder("PD-620")),
    ]);
    assert.equal(auditCalls, 1, "3 cargas concorrentes → 1 auditoria real, não 3");
    assert.deepEqual(fromPeriod, fromYear);
    assert.deepEqual(fromYear, fromHistorical);
  });

  it("chamadas SEQUENCIAIS (fora da janela concorrente) NUNCA reaproveitam resultado — sem dado obsoleto", async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const factory = () => {
      calls += 1;
      return Promise.resolve(calls);
    };

    const first = await dedupeInFlight(cache, "order-1", factory);
    const second = await dedupeInFlight(cache, "order-1", factory);
    assert.equal(calls, 2, "cada chamada não concorrente deve bater na fonte de novo");
    assert.equal(first, 1);
    assert.equal(second, 2);
  });

  it("chaves diferentes (pedidos diferentes) nunca coalescem entre si", async () => {
    const cache = new Map<string, Promise<string>>();
    const calls: string[] = [];
    const factory = (id: string) => () => {
      calls.push(id);
      return Promise.resolve(id);
    };

    const [a, b] = await Promise.all([
      dedupeInFlight(cache, "PD-1", factory("PD-1")),
      dedupeInFlight(cache, "PD-2", factory("PD-2")),
    ]);
    assert.deepEqual(calls.sort(), ["PD-1", "PD-2"]);
    assert.equal(a, "PD-1");
    assert.equal(b, "PD-2");
  });

  it("entrada é removida do cache mesmo quando factory() rejeita — falha não fica presa para chamadas futuras", async () => {
    const cache = new Map<string, Promise<number>>();
    let calls = 0;
    const failingFactory = () => {
      calls += 1;
      return Promise.reject(new Error("boom"));
    };

    await assert.rejects(() => dedupeInFlight(cache, "order-1", failingFactory));
    assert.equal(cache.size, 0, "cache deve ficar vazio após rejeição");

    const okFactory = () => {
      calls += 1;
      return Promise.resolve(99);
    };
    const result = await dedupeInFlight(cache, "order-1", okFactory);
    assert.equal(result, 99);
    assert.equal(calls, 2, "nova chamada após falha deve executar de novo (sem estado obsoleto)");
  });

  it("chamadores concorrentes que falham recebem o MESMO erro (comportamento aceitável — mesma causa raiz)", async () => {
    const cache = new Map<string, Promise<number>>();
    const err = new Error("db indisponível");
    let calls = 0;
    const factory = () => {
      calls += 1;
      return Promise.reject(err);
    };

    const results = await Promise.allSettled([
      dedupeInFlight(cache, "order-1", factory),
      dedupeInFlight(cache, "order-1", factory),
    ]);
    assert.equal(calls, 1);
    assert.equal(results[0]!.status, "rejected");
    assert.equal(results[1]!.status, "rejected");
  });
});
