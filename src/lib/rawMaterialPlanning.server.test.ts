/**
 * Planejamento de Matéria-Prima — datas vindas de colunas NULLABLE.
 *
 * Bug de produção: `MaterialPurchasePlan.purchaseDate` e `expectedArrivalDate`
 * são opcionais no schema, mas eram formatadas com `formatYmd(date: Date)` sem
 * guarda. Bastava UMA anotação de compra salva sem datas (só nº do pedido ou
 * quantidade) para a tela inteira morrer com
 * "Cannot read properties of null (reading 'toISOString')".
 *
 * O `tsconfig` não liga `strictNullChecks`, então o compilador não pegou —
 * por isso a proteção precisa de teste.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { formatYmdOrNull } from "./rawMaterialPlanning.server.js";

const SERVER = readFileSync(
  join(process.cwd(), "src/lib/rawMaterialPlanning.server.ts"),
  "utf8"
);

describe("rawMaterialPlanning — formatYmdOrNull", () => {
  it("null e undefined viram null em vez de estourar", () => {
    assert.equal(formatYmdOrNull(null), null);
    assert.equal(formatYmdOrNull(undefined), null);
  });

  it("data válida vira o dia civil YYYY-MM-DD", () => {
    assert.equal(formatYmdOrNull(new Date("2026-09-02T00:00:00.000Z")), "2026-09-02");
    // Coluna @db.Date chega como meia-noite UTC: o dia não pode deslocar.
    assert.equal(formatYmdOrNull(new Date("2026-01-01T00:00:00.000Z")), "2026-01-01");
    assert.equal(formatYmdOrNull(new Date("2026-12-31T00:00:00.000Z")), "2026-12-31");
  });
});

describe("rawMaterialPlanning — nenhuma data nullable sem guarda", () => {
  it("a anotação de compra usa a versão null-safe", () => {
    assert.match(SERVER, /purchaseDate: formatYmdOrNull\(p\.purchaseDate\)/);
    assert.match(SERVER, /expectedArrivalDate: formatYmdOrNull\(p\.expectedArrivalDate\)/);
  });

  it("todo formatYmd cru é sobre valor comprovadamente não-nulo", () => {
    /*
     * Uma chamada `formatYmd(x)` só é aceitável quando:
     *   a) `x` é uma Date criada no próprio fluxo (`now`);
     *   b) a chamada está dentro de um ternário que testa `x`; ou
     *   c) existe uma guarda de saída antecipada `if (!x)` antes no arquivo.
     * Qualquer outra forma deve usar `formatYmdOrNull`.
     */
    const linhas = SERVER.split("\n");
    const chamadas = linhas
      .map((linha, i) => ({ linha: linha.trim(), i }))
      .filter(({ linha }) => /[^a-zA-Z]formatYmd\(/.test(` ${linha}`))
      .filter(({ linha }) => !linha.startsWith("function formatYmd"))
      .filter(({ linha }) => !linha.includes("formatYmdOrNull"))
      .map((c) => ({
        ...c,
        arg: (/[^a-zA-Z]formatYmd\(([^)]*)\)/.exec(` ${c.linha}`) ?? [, ""])[1].trim(),
      }));

    assert.ok(chamadas.length > 0, "nenhuma chamada encontrada — regex quebrou?");
    for (const { linha, arg, i } of chamadas) {
      const ternarioNaLinha = linha.includes("?") && linha.includes(arg);
      const dateLocal = arg === "now";
      const guardaAntes = linhas
        .slice(0, i)
        .some((anterior) => anterior.includes(`if (!${arg})`));
      assert.ok(
        ternarioNaLinha || dateLocal || guardaAntes,
        `formatYmd sem guarda em coluna possivelmente nula (linha ${i + 1}): ${linha}`
      );
    }
  });
});
