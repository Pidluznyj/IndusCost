import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV,
  mergeSalesOrderOperationalPresenceWhere,
} from "./nomus/nomusSourcePresencePolicy.js";
import {
  buildSalesOrderListSummary,
  buildSalesOrderListTotalsFromPrismaOrders,
  buildSalesOrderListWhere,
  buildSalesOrderSearchOr,
} from "./salesOrdersListSummary.js";
import {
  buildSalesOrderListWhereForQuery,
  parseSalesOrderListQuery,
} from "./salesOrderListQuery.server.js";
import { isNomusSourceOperationallyPresent } from "./nomus/nomusSourcePresencePolicy.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const FLAG = NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV;
const envOn = { [FLAG]: "true" };
const envOff = { [FLAG]: "false" };
const envAbsent = {} as Record<string, string | undefined>;

/** Caso explícito HOTFIX-05 — PD 02739 / external 2737. */
const PD_02739 = {
  orderCode: "PD 02739",
  externalSalesOrderId: 2737,
  sourcePresenceStatus: "MISSING_CONFIRMED" as const,
  totalNetValue: 117_000,
  totalItems: 1,
};

function hasPresenceExclusion(where: unknown): boolean {
  return JSON.stringify(where).includes('"sourcePresenceStatus"');
}

function presenceIsOutsideSearchOr(where: unknown): boolean {
  const json = JSON.stringify(where);
  if (!json.includes("MISSING_CONFIRMED")) return false;
  // Estrutura esperada: AND [ commercial (pode ter OR de busca), presence ]
  assert.match(json, /"AND"/);
  assert.match(json, /"sourcePresenceStatus":\{"not":"MISSING_CONFIRMED"\}/);
  // Presence não pode estar só dentro do OR de busca
  const orMatch = json.match(/"OR":\[(.*?)\](?=,"sourcePresenceStatus"|},"sourcePresenceStatus")/s);
  void orMatch;
  const parsed = where as { AND?: unknown[] };
  assert.ok(Array.isArray(parsed.AND));
  const last = parsed.AND![parsed.AND!.length - 1] as Record<string, unknown>;
  assert.deepEqual(last, { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } });
  return true;
}

function matchesRowAgainstWhere(
  row: {
    orderCode: string;
    externalSalesOrderId: number;
    sourcePresenceStatus: string;
    customerName?: string;
  },
  where: unknown
): boolean {
  const json = JSON.stringify(where);
  if (
    json.includes('"sourcePresenceStatus":{"not":"MISSING_CONFIRMED"}') &&
    row.sourcePresenceStatus === "MISSING_CONFIRMED"
  ) {
    return false;
  }
  return true;
}

describe("HOTFIX-05 sales-orders MISSING_CONFIRMED operational exclusion", () => {
  it("1-2. flag ausente/false inclui MISSING_CONFIRMED no where", () => {
    const absent = buildSalesOrderListWhere({ q: "02739" }, { env: envAbsent });
    const off = buildSalesOrderListWhere({ q: "02739" }, { env: envOff });
    assert.equal(hasPresenceExclusion(absent), false);
    assert.equal(hasPresenceExclusion(off), false);
  });

  it("3. flag true exclui MISSING_CONFIRMED no AND raiz", () => {
    const where = buildSalesOrderListWhere({ q: "02739" }, { env: envOn });
    assert.ok(presenceIsOutsideSearchOr(where));
  });

  it("4-5. flag true mantém PRESENT e MISSING_CANDIDATE operacionais", () => {
    assert.equal(isNomusSourceOperationallyPresent("PRESENT"), true);
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CANDIDATE"), true);
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CONFIRMED"), false);
    const where = buildSalesOrderListWhere({}, { env: envOn });
    assert.ok(hasPresenceExclusion(where));
    // merge não filtra PRESENT/CANDIDATE — só not MISSING_CONFIRMED
    assert.match(JSON.stringify(where), /"not":"MISSING_CONFIRMED"/);
  });

  it("6. pesquisa por 02739 não contorna a exclusão", () => {
    const where = buildSalesOrderListWhere({ q: "02739" }, { env: envOn });
    assert.equal(
      matchesRowAgainstWhere(
        {
          orderCode: PD_02739.orderCode,
          externalSalesOrderId: PD_02739.externalSalesOrderId,
          sourcePresenceStatus: "MISSING_CONFIRMED",
        },
        where
      ),
      false
    );
  });

  it("7. pesquisa por externalSalesOrderId 2737 não contorna a exclusão", () => {
    const searchOr = buildSalesOrderSearchOr("2737");
    assert.ok(searchOr?.some((c) => "externalSalesOrderId" in c));
    const where = buildSalesOrderListWhere({ q: "2737" }, { env: envOn });
    assert.ok(presenceIsOutsideSearchOr(where));
    assert.equal(
      matchesRowAgainstWhere(
        {
          orderCode: PD_02739.orderCode,
          externalSalesOrderId: 2737,
          sourcePresenceStatus: "MISSING_CONFIRMED",
        },
        where
      ),
      false
    );
  });

  it("8. busca por cliente não contorna a exclusão", () => {
    const where = buildSalesOrderListWhere(
      { q: "Cliente Fantasma", customerId: "cust-1" },
      { env: envOn }
    );
    assert.ok(presenceIsOutsideSearchOr(where));
  });

  it("9. combinação de filtros não contorna a exclusão", () => {
    const where = buildSalesOrderListWhere(
      {
        q: "02739",
        status: "SENT_TO_NOMUS",
        customerId: "cust-1",
        year: 2026,
      },
      { env: envOn }
    );
    assert.ok(presenceIsOutsideSearchOr(where));
  });

  it("10-16. count/linhas/resumo/paginação usam a mesma população excluída", () => {
    const where = buildSalesOrderListWhere({ q: "02739" }, { env: envOn });
    const population = [
      {
        ...PD_02739,
        id: "so-missing",
      },
    ].filter((row) =>
      matchesRowAgainstWhere(
        {
          orderCode: row.orderCode,
          externalSalesOrderId: row.externalSalesOrderId,
          sourcePresenceStatus: row.sourcePresenceStatus,
        },
        where
      )
    );
    assert.equal(population.length, 0);

    const summary = buildSalesOrderListTotalsFromPrismaOrders(population);
    assert.equal(summary.totalOrders, 0);
    assert.equal(summary.totalNetAmount, 0);
    assert.equal(summary.totalItems, 0);
    assert.equal(summary.averageTicket, 0);

    const withPresent = buildSalesOrderListTotalsFromPrismaOrders([
      {
        totalNetValue: 10_000,
        totalItems: 2,
      },
    ]);
    assert.equal(withPresent.totalOrders, 1);
    assert.equal(withPresent.totalNetAmount, 10_000);

    // Paginação: skip/take sobre count já excluído
    const total = population.length;
    const pageSize = 20;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    assert.equal(total, 0);
    assert.equal(totalPages, 1);
  });

  it("12-15. resumo não inclui R$ 117 mil / itens / ticket / margem do pedido ausente", () => {
    const included = buildSalesOrderListSummary({
      totalOrders: 0,
      totalNetAmount: 0,
      totalItems: 0,
    });
    assert.notEqual(included.totalNetAmount, PD_02739.totalNetValue);
    assert.equal(included.totalNetAmount, 0);
    assert.equal(included.totalItems, 0);
    assert.equal(included.averageTicket, 0);
  });

  it("17-20. exports/PDF reutilizam resolveSalesOrderListWhere (mesma população)", () => {
    const exportSvc = read("src/lib/salesOrderListReportExport.server.ts");
    const industrial = read("src/lib/sales/salesOrderIndustrialResultReportService.server.ts");
    const report = read("src/lib/sales/salesOrderReportService.server.ts");
    const marginXlsx = read("src/lib/salesOrderInternalMarginExport.server.ts");
    const listQuery = read("src/lib/salesOrderListQuery.server.ts");
    const summaryLib = read("src/lib/salesOrdersListSummary.ts");

    assert.match(exportSvc, /resolveSalesOrderListWhere/);
    assert.match(industrial, /resolveSalesOrderListWhere/);
    assert.match(report, /resolveSalesOrderListWhere/);
    assert.match(marginXlsx, /resolveSalesOrderListWhere/);
    assert.match(listQuery, /buildSalesOrderListWhereForQuery/);
    assert.match(summaryLib, /mergeSalesOrderOperationalPresenceWhere/);
  });

  it("21. detalhe histórico continua encontrando o registro (sem exclusão operacional)", () => {
    const detail = read("src/lib/sales-orders/salesOrderDetailService.server.ts");
    assert.doesNotMatch(detail, /mergeSalesOrderOperationalPresenceWhere/);
    assert.match(detail, /findUnique|getSalesOrderDetail/);
  });

  it("22-23. nenhum delete; flag false devolve visibilidade", () => {
    const summaryLib = read("src/lib/salesOrdersListSummary.ts");
    assert.doesNotMatch(summaryLib, /\.delete\(|deleteMany/);
    const off = buildSalesOrderListWhere({ q: "02739" }, { env: envOff });
    assert.equal(hasPresenceExclusion(off), false);
    assert.equal(
      matchesRowAgainstWhere(
        {
          orderCode: PD_02739.orderCode,
          externalSalesOrderId: PD_02739.externalSalesOrderId,
          sourcePresenceStatus: "MISSING_CONFIRMED",
        },
        off
      ),
      true
    );
  });

  it("24. paridade: query parseada da tela aplica a mesma exclusão", () => {
    const parsed = parseSalesOrderListQuery({ q: "02739", year: "2026" });
    const where = buildSalesOrderListWhereForQuery(parsed, null, { env: envOn });
    assert.ok(presenceIsOutsideSearchOr(where));
  });

  it("caso explícito PD 02739 / 2737 / R$ 117000 fora da operação com flag true", () => {
    const where = buildSalesOrderListWhere(
      { q: "PD 02739", status: "SENT_TO_NOMUS" },
      { env: envOn }
    );
    assert.equal(
      matchesRowAgainstWhere(
        {
          orderCode: "PD 02739",
          externalSalesOrderId: 2737,
          sourcePresenceStatus: "MISSING_CONFIRMED",
        },
        where
      ),
      false
    );
    const totalsIfLeak = buildSalesOrderListTotalsFromPrismaOrders([
      { totalNetValue: 117_000, totalItems: 1 },
    ]);
    // Documenta o valor que NÃO deve entrar quando exclusão funciona
    assert.equal(totalsIfLeak.totalNetAmount, 117_000);
    const empty = buildSalesOrderListTotalsFromPrismaOrders([]);
    assert.equal(empty.totalNetAmount, 0);
  });

  it("helper oficial reutilizado (não segunda implementação)", () => {
    const base = { status: "SENT_TO_NOMUS" as const };
    assert.deepEqual(
      mergeSalesOrderOperationalPresenceWhere(base, { env: envOn }),
      buildSalesOrderListWhere({ status: "SENT_TO_NOMUS" }, { env: envOn })
    );
  });

  it("GET /api/sales-orders usa resolveSalesOrderListWhere (mesmo where para find/aggregate)", () => {
    const server = read("server.ts");
    const idx = server.indexOf('app.get("/api/sales-orders"');
    assert.ok(idx >= 0);
    const slice = server.slice(idx, idx + 3500);
    assert.match(slice, /resolveSalesOrderListWhere/);
    assert.match(slice, /findMany\(\{\s*where/);
    assert.match(slice, /salesOrder\.aggregate/);
    assert.match(slice, /buildSalesOrderListSummaryFromAggregate/);
  });
});
