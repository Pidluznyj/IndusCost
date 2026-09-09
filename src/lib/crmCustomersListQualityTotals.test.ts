/**
 * Prova que os totais da Carteira contam o UNIVERSO do filtro, não a página.
 *
 * O bug corrigido: `totals` era `customers.filter(...).length` sobre o array já
 * paginado, então um universo de 50 clientes com página de 10 reportava no
 * máximo 10 — e o número mudava conforme o usuário paginava.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import {
  CRM_HAS_ACTIVE_OWNER_WHERE,
  CRM_HAS_ORDER_WITHOUT_NOMUS_SELLER_WHERE,
  CRM_HAS_PURCHASE_WHERE,
  EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS,
  fetchCrmCustomersListQualityTotals,
} from "@/src/lib/crmCustomersListQualityTotals.js";

type Counter = Parameters<typeof fetchCrmCustomersListQualityTotals>[0];

/** Fake que devolve uma contagem por chamada, na ordem, e registra os `where`. */
function counter(results: number[], seen: Prisma.CustomerWhereInput[] = []): Counter {
  let i = 0;
  return {
    customer: {
      count: async ({ where }: { where: Prisma.CustomerWhereInput }) => {
        seen.push(where);
        return results[i++] ?? 0;
      },
    },
  };
}

const BASE_WHERE: Prisma.CustomerWhereInput = { city: "Curitiba" };

describe("crmCustomersListQualityTotals", () => {
  it("conta o universo inteiro, não o tamanho da página", async () => {
    // Universo de 50 clientes; a página exibiria só 10.
    // 13 têm responsável, 38 têm compra, 5 têm pedido sem vendedor.
    const totals = await fetchCrmCustomersListQualityTotals(counter([13, 38, 5]), BASE_WHERE, 50);

    assert.equal(totals.customersWithoutCommercialOwner, 37); // 50 - 13
    assert.equal(totals.customersWithoutPurchase, 12); // 50 - 38
    assert.equal(totals.customersWithOrderWithoutNomusSeller, 5);
    assert.ok(
      totals.customersWithoutCommercialOwner > 10,
      "o total precisa poder ultrapassar o tamanho da página"
    );
  });

  it("usa o MESMO where da página em todas as contagens", async () => {
    const seen: Prisma.CustomerWhereInput[] = [];
    await fetchCrmCustomersListQualityTotals(counter([1, 1, 1], seen), BASE_WHERE, 10);

    assert.equal(seen.length, 3, "uma contagem por indicador, sem N+1");
    for (const where of seen) {
      assert.deepEqual(
        (where as { AND: unknown[] }).AND[0],
        BASE_WHERE,
        "o where da página tem que ancorar todo total"
      );
    }
    assert.deepEqual((seen[0] as { AND: unknown[] }).AND[1], CRM_HAS_ACTIVE_OWNER_WHERE);
    assert.deepEqual((seen[1] as { AND: unknown[] }).AND[1], CRM_HAS_PURCHASE_WHERE);
    assert.deepEqual(
      (seen[2] as { AND: unknown[] }).AND[1],
      CRM_HAS_ORDER_WITHOUT_NOMUS_SELLER_WHERE
    );
  });

  it("não consulta o banco quando o universo é vazio", async () => {
    const seen: Prisma.CustomerWhereInput[] = [];
    const totals = await fetchCrmCustomersListQualityTotals(counter([9, 9, 9], seen), BASE_WHERE, 0);
    assert.deepEqual(totals, EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS);
    assert.equal(seen.length, 0);
  });

  it("usa predicados positivos — nunca NOT/isNot sobre relação opcional", () => {
    // `NOT` + `is` sobre relação opcional já zerou resultado neste projeto.
    const json = JSON.stringify([
      CRM_HAS_ACTIVE_OWNER_WHERE,
      CRM_HAS_PURCHASE_WHERE,
      CRM_HAS_ORDER_WITHOUT_NOMUS_SELLER_WHERE,
    ]);
    assert.doesNotMatch(json, /"NOT"/);
    assert.doesNotMatch(json, /"isNot"/);
  });

  it("nunca devolve complemento negativo", async () => {
    // Contagem maior que o total (snapshot concorrente) não pode virar número negativo.
    const totals = await fetchCrmCustomersListQualityTotals(counter([99, 99, 0]), BASE_WHERE, 10);
    assert.equal(totals.customersWithoutCommercialOwner, 0);
    assert.equal(totals.customersWithoutPurchase, 0);
  });

  it("exclui CANCELLED e ERROR da população de compra", () => {
    const json = JSON.stringify(CRM_HAS_PURCHASE_WHERE);
    assert.match(json, /CANCELLED/);
    assert.match(json, /ERROR/);
  });
});

describe("crmCustomersList — contrato dos totais", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/crmCustomersList.ts"), "utf8");

  it("não deriva nenhum total do array paginado", () => {
    const idx = source.indexOf("    totals: {", source.indexOf("return {\n    customers,"));
    assert.doesNotMatch(
      source.slice(idx, idx + 400),
      /customers\.filter/,
      "totals não pode ser calculado sobre a página"
    );
  });

  it("conta o universo com o mesmo where da página", () => {
    assert.match(source, /prisma\.customer\.count\(\{ where \}\)/);
    assert.match(source, /fetchCrmCustomersListQualityTotals\(\s*prisma,\s*where,/);
  });

  it("página e total saem do mesmo snapshot", () => {
    assert.match(source, /prisma\.\$transaction\(\[/);
  });

  it("a divergência reusa a função que decide a flag por linha", () => {
    // Reimplementá-la em SQL contava divergência para todo owner __ID_ONLY__.
    assert.match(source, /ownerDiffersFromOrderSellers\(owners\.get\(id\), enrichment\)/);
    assert.match(source, /orderBy: \{ id: "asc" \}/, "amostra precisa ser determinística");
  });
});
