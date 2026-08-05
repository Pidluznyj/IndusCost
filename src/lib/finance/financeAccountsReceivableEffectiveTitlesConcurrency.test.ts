/**
 * Prova de segurança da mitigação de latência do Fluxo de Caixa.
 *
 * CONTEXTO
 * `buildFinanceArEffectiveContextsForOrders` chama `getOrderFullAudit`
 * (auditoria 360º — ~28 consultas por pedido) para até 80 pedidos do
 * portfólio, em lotes paralelos de `EFFECTIVE_ORDER_AUDIT_CONCURRENCY`. Subir
 * essa constante de 4 para 8 reduz o número de ondas sequenciais pela metade
 * — mas só é seguro se o CONJUNTO de pedidos processados e o RESULTADO final
 * não dependerem do tamanho do lote nem da ordem de conclusão.
 *
 * Este arquivo prova essa invariante de duas formas:
 *
 * 1. Reimplementa o MESMO formato do algoritmo real (loop chunked +
 *    Promise.all + push num array, depois merge por chave num Map) com uma
 *    função async mock — sem banco, sem getOrderFullAudit — e mostra que
 *    tamanhos de lote diferentes (1, 4, 8, 16, e maior que a lista inteira)
 *    produzem exatamente o mesmo conjunto final, mesmo quando a conclusão das
 *    promises é deliberadamente fora de ordem (setTimeout aleatorizado).
 * 2. Confirma por leitura de código-fonte que a implementação real usa a
 *    constante nomeada (não reintroduziu um literal solto) e que o merge
 *    final é por chave (Map), que é a propriedade que sustenta a prova em (1).
 *
 * Não testa `getOrderFullAudit` em si (precisa de banco) — testa a FORMA do
 * algoritmo que o envolve, que é o que muda com este commit.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

type Item = { id: string; weight: number };

/** Mesmo formato do algoritmo real: chunked loop + Promise.all + push. */
async function processInChunks(
  items: readonly Item[],
  concurrency: number,
  work: (item: Item) => Promise<{ id: string; value: number }>
): Promise<Array<{ id: string; value: number }>> {
  const results: Array<{ id: string; value: number }> = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const slice = items.slice(i, i + concurrency);
    const settled = await Promise.all(slice.map((item) => work(item)));
    for (const r of settled) results.push(r);
  }
  return results;
}

/** Mesmo formato do merge real: Map por chave, único vencedor por id. */
function mergeByKey(
  results: ReadonlyArray<{ id: string; value: number }>
): Map<string, number> {
  const byId = new Map<string, number>();
  for (const r of results) byId.set(r.id, r.value);
  return byId;
}

/** Simula latência de rede/DB variável e fora de ordem — pior caso realista. */
function fakeAudit(item: Item): Promise<{ id: string; value: number }> {
  const jitterMs = (item.weight * 7919) % 13; // determinístico, mas não-monótono
  return new Promise((resolve) => {
    setTimeout(() => resolve({ id: item.id, value: item.weight * 10 }), jitterMs);
  });
}

function makeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: `order-${i}`, weight: i + 1 }));
}

describe("mitigação de concorrência — invariante de resultado", () => {
  it("lotes de tamanhos diferentes processam o MESMO conjunto de itens", async () => {
    const items = makeItems(80); // mesmo teto do portfólio real (PORTFOLIO_ORDER_LIMIT)
    const sizes = [1, 4, 8, 16, 200]; // 200 > items.length: um lote só

    const resultsBySize = await Promise.all(
      sizes.map((size) => processInChunks(items, size, fakeAudit))
    );

    const idSets = resultsBySize.map((r) => new Set(r.map((x) => x.id)));
    const expected = new Set(items.map((i) => i.id));
    for (const set of idSets) {
      assert.deepEqual(set, expected, "conjunto de ids processados mudou com o lote");
    }
  });

  it("o merge final por chave é IDÊNTICO entre concorrência 4 e 8, mesmo com conclusão fora de ordem", async () => {
    const items = makeItems(80);

    const [withFour, withEight] = await Promise.all([
      processInChunks(items, 4, fakeAudit),
      processInChunks(items, 8, fakeAudit),
    ]);

    const mergedFour = mergeByKey(withFour);
    const mergedEight = mergeByKey(withEight);

    assert.equal(mergedFour.size, 80);
    assert.equal(mergedEight.size, 80);
    assert.deepEqual(
      [...mergedFour.entries()].sort(),
      [...mergedEight.entries()].sort(),
      "o resultado fundido diverge entre concorrência 4 e 8 — a mitigação NÃO é segura"
    );
  });

  it("nenhum item é processado duas vezes nem perdido (lotes irregulares)", async () => {
    // 80 não é múltiplo de tamanhos ímpares — prova que o último lote parcial
    // não duplica nem descarta itens.
    for (const size of [3, 6, 7, 11]) {
      const items = makeItems(80);
      const results = await processInChunks(items, size, fakeAudit);
      assert.equal(results.length, 80, `tamanho de lote ${size} alterou a contagem`);
      assert.equal(
        new Set(results.map((r) => r.id)).size,
        80,
        `tamanho de lote ${size} duplicou algum id`
      );
    }
  });

  it("valor de UM item nunca muda com o tamanho do lote (a auditoria em si não é afetada)", async () => {
    const items = makeItems(80);
    const [withFour, withEight] = await Promise.all([
      processInChunks(items, 4, fakeAudit),
      processInChunks(items, 8, fakeAudit),
    ]);
    const byIdFour = mergeByKey(withFour);
    const byIdEight = mergeByKey(withEight);
    for (const item of items) {
      assert.equal(byIdFour.get(item.id), byIdEight.get(item.id));
    }
  });
});

describe("mitigação de concorrência — implementação real usa a constante nomeada", () => {
  const src = readFileSync(
    join(
      process.cwd(),
      "src",
      "lib",
      "finance",
      "financeAccountsReceivableEffectiveTitles.server.ts"
    ),
    "utf8"
  );

  it("a constante EFFECTIVE_ORDER_AUDIT_CONCURRENCY existe e vale 8", () => {
    assert.match(src, /EFFECTIVE_ORDER_AUDIT_CONCURRENCY\s*=\s*8/);
  });

  it("o ponto de chamada usa a constante — não um literal solto", () => {
    assert.match(
      src,
      /const CONCURRENCY = EFFECTIVE_ORDER_AUDIT_CONCURRENCY;/
    );
    // Rollback documentado: se precisar reverter, é só trocar o "8" acima.
    assert.equal(
      /const CONCURRENCY = \d+;/.test(src),
      false,
      "voltou a existir um literal solto — quebra o rollback de uma linha só"
    );
  });

  it("o merge final continua por chave (Map) — é a propriedade que sustenta a prova acima", () => {
    assert.match(src, /byOrder\.set\(ctx\.schedule\.salesOrderId, ctx\)/);
  });
});
