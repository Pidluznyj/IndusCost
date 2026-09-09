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
import { Prisma } from "@prisma/client";
import {
  CRM_CUSTOMERS_QUALITY_TOTALS_MAX,
  EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS,
  fetchCrmCustomersListQualityTotals,
} from "@/src/lib/crmCustomersListQualityTotals.js";

type QueryRunner = Parameters<typeof fetchCrmCustomersListQualityTotals>[0];

function runnerReturning(
  row: Record<string, bigint | number | null>,
  calls: Prisma.Sql[] = []
): QueryRunner {
  return {
    $queryRaw: async <T,>(query: Prisma.Sql): Promise<T> => {
      calls.push(query);
      return [row] as unknown as T;
    },
  };
}

function uuidAt(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

describe("crmCustomersListQualityTotals", () => {
  it("conta o universo inteiro, não o tamanho da página", async () => {
    // 50 clientes no universo; a página exibiria só 10.
    const universe = Array.from({ length: 50 }, (_, i) => uuidAt(i));
    const calls: Prisma.Sql[] = [];
    const runner = runnerReturning(
      {
        without_owner: 37n,
        without_purchase: 12n,
        order_without_seller: 5n,
        divergence: 3n,
      },
      calls
    );

    const totals = await fetchCrmCustomersListQualityTotals(runner, universe);

    // O número reportado é o do universo (37), nunca limitado pela página (10).
    assert.equal(totals.customersWithoutCommercialOwner, 37);
    assert.equal(totals.customersWithoutPurchase, 12);
    assert.equal(totals.customersWithOrderWithoutNomusSeller, 5);
    assert.equal(totals.customersWithOwnerSellerDivergence, 3);
    assert.ok(
      totals.customersWithoutCommercialOwner > 10,
      "o total precisa poder ultrapassar o tamanho da página"
    );

    // Uma única consulta agregada — sem N+1 por cliente.
    assert.equal(calls.length, 1);
    // E ela recebeu os 50 ids do universo, não os 10 da página.
    const params = calls[0]!.values;
    const passedIds = params.filter((v) => typeof v === "string" && v.startsWith("00000000-"));
    assert.equal(passedIds.length, 50);
  });

  it("não consulta o banco quando o universo é vazio", async () => {
    const calls: Prisma.Sql[] = [];
    const runner = runnerReturning({}, calls);
    const totals = await fetchCrmCustomersListQualityTotals(runner, []);
    assert.deepEqual(totals, EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS);
    assert.equal(calls.length, 0);
  });

  it("converte bigint do Postgres e trata linha ausente", async () => {
    const fromBigint = await fetchCrmCustomersListQualityTotals(
      runnerReturning({
        without_owner: 9n,
        without_purchase: 0n,
        order_without_seller: 2n,
        divergence: 0n,
      }),
      [uuidAt(1)]
    );
    assert.equal(fromBigint.customersWithoutCommercialOwner, 9);
    assert.equal(typeof fromBigint.customersWithoutCommercialOwner, "number");

    const emptyRunner: QueryRunner = {
      $queryRaw: async <T,>(): Promise<T> => [] as unknown as T,
    };
    const noRow = await fetchCrmCustomersListQualityTotals(emptyRunner, [uuidAt(1)]);
    assert.deepEqual(noRow, EMPTY_CRM_CUSTOMERS_QUALITY_TOTALS);
  });

  it("exclui CANCELLED e ERROR da população de compra, como o resto da tela", async () => {
    const calls: Prisma.Sql[] = [];
    await fetchCrmCustomersListQualityTotals(runnerReturning({}, calls), [uuidAt(1)]);
    const sql = calls[0]!.sql;
    assert.match(sql, /NOT IN \('CANCELLED', 'ERROR'\)/);
  });

  it("mede divergência só contra pedidos com vendedor Nomus informado", async () => {
    const calls: Prisma.Sql[] = [];
    await fetchCrmCustomersListQualityTotals(runnerReturning({}, calls), [uuidAt(1)]);
    const sql = calls[0]!.sql;
    // A divergência compara identidades; pedido sem vendedor tem contador próprio.
    assert.match(sql, /"externalSellerId" IS NOT NULL/);
    assert.match(sql, /"externalSellerId" IS NULL/);
    // Só responsável ATIVO forma carteira.
    assert.match(sql, /"isActive" = true/);
  });
});

describe("crmCustomersList — contrato dos totais", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/crmCustomersList.ts"), "utf8");

  it("não deriva nenhum total do array paginado", () => {
    const totalsBlock = source.slice(
      source.indexOf("    totals: {", source.indexOf("return {\n    customers,"))
    );
    assert.doesNotMatch(
      totalsBlock.slice(0, 400),
      /customers\.filter/,
      "totals não pode ser calculado sobre a página"
    );
  });

  it("conta o universo com o mesmo where da página", () => {
    assert.match(source, /prisma\.customer\.count\(\{ where \}\)/);
    assert.match(source, /fetchCrmCustomersListQualityTotals/);
  });

  it("aplica teto e sinaliza truncamento em vez de subestimar", () => {
    assert.match(source, /CRM_CUSTOMERS_QUALITY_TOTALS_MAX/);
    assert.match(source, /qualityTotalsTruncated/);
    assert.ok(CRM_CUSTOMERS_QUALITY_TOTALS_MAX > 0);
  });
});
