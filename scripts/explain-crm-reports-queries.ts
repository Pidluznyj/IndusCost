/**
 * EXPLAIN das consultas de CRM > Relatórios — SOMENTE LEITURA, homologação.
 *
 * Captura o SQL EXATO que o Prisma gera para as consultas do relatório
 * (clientes elegíveis e um lote de pedidos canônicos, igual ao endpoint) e
 * roda `EXPLAIN (ANALYZE, BUFFERS)` em cada um. EXPLAIN ANALYZE executa a
 * consulta, mas são só SELECTs — nada é escrito.
 *
 * Serve para decidir, com evidência, se falta índice. Índice só entra em
 * migration se o plano provar necessidade (ex.: Seq Scan caro em SalesOrder
 * filtrando customerId).
 *
 * Uso:
 *   npx tsx scripts/explain-crm-reports-queries.ts
 *   npx tsx scripts/explain-crm-reports-queries.ts --chunk=1000
 *   npx tsx scripts/explain-crm-reports-queries.ts --no-analyze   # só EXPLAIN (não executa)
 */

import { PrismaClient } from "@prisma/client";
import { crmEligibleCustomerWhere } from "../src/lib/commercial/crmManagementOrderFacts.server.ts";
import { crmCanonicalSalesOrderWhere } from "../src/lib/commercial/crmCanonicalSalesOrderScope.server.ts";
import {
  CRM_REPORTS_ID_CHUNK_SIZE,
  createPrismaCrmReportsDataSource,
} from "../src/lib/commercial/crmReportsOperationalService.server.ts";

type CapturedQuery = { query: string; params: unknown[]; durationMs: number };

const prisma = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
const captured: CapturedQuery[] = [];
let capturing = false;
prisma.$on("query" as never, (event: { query: string; params: string; duration: number }) => {
  if (!capturing) return;
  let params: unknown[] = [];
  try {
    params = JSON.parse(event.params) as unknown[];
  } catch {
    params = [];
  }
  captured.push({ query: event.query, params, durationMs: event.duration });
});

function parseArgs(argv: string[]) {
  const chunkArg = argv.find((a) => a.startsWith("--chunk="));
  const chunk = chunkArg ? Number(chunkArg.slice("--chunk=".length)) : CRM_REPORTS_ID_CHUNK_SIZE;
  return {
    chunk: Number.isInteger(chunk) && chunk > 0 ? chunk : CRM_REPORTS_ID_CHUNK_SIZE,
    analyze: !argv.includes("--no-analyze"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ds = createPrismaCrmReportsDataSource(prisma);

  capturing = true;
  const customers = await ds.findCustomers(crmEligibleCustomerWhere());
  const ids = customers.slice(0, args.chunk).map((c) => c.id);
  const canonicalWhere = crmCanonicalSalesOrderWhere({ allYears: true }, { ignorePeriod: true });
  const orders = ids.length
    ? await ds.findSalesOrders({ AND: [canonicalWhere, { customerId: { in: ids } }] })
    : [];
  capturing = false;

  console.log(`Clientes elegíveis: ${customers.length} · lote EXPLAIN: ${ids.length} clientes · pedidos no lote: ${orders.length}`);
  console.log(`Lotes necessários no universo global: ${Math.ceil(customers.length / args.chunk)}\n`);

  const selects = captured.filter((q) => /^\s*SELECT/i.test(q.query));
  for (const [index, q] of selects.entries()) {
    console.log(`=== Consulta ${index + 1} (${q.durationMs} ms no Prisma) ===`);
    console.log(q.query.length > 1500 ? `${q.query.slice(0, 1500)} …[${q.query.length} chars]` : q.query);
    const explain = args.analyze ? "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) " : "EXPLAIN (FORMAT TEXT) ";
    const plan = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(explain + q.query, ...q.params);
    console.log("--- plano ---");
    for (const row of plan) console.log(row["QUERY PLAN"]);
    console.log("");
  }
}

main()
  .catch((error) => {
    console.error("Falha no EXPLAIN:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
