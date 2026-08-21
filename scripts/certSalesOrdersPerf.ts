/**
 * CERTIFICAÇÃO DE PERFORMANCE — Pedidos de Venda (gráficos + margens).
 *
 * Roda os TRÊS caminhos reais da tela contra o PostgreSQL de homologação,
 * medindo latência e contando consultas Prisma, e emite uma impressão digital
 * canônica do payload para provar equivalência BASE vs FEATURE.
 *
 * Uso (dentro de uma worktree do repo, com node_modules disponível):
 *   DATABASE_URL='postgresql://USUARIO:SENHA@127.0.0.1:5433/teste_bi_homolog' \
 *   node --import ./node_modules/tsx/dist/loader.mjs scripts/certSalesOrdersPerf.ts <ROTULO>
 *
 * SOMENTE LEITURA: nenhuma escrita, migration ou seed. Aborta se a DATABASE_URL
 * não for exatamente 127.0.0.1:5433/teste_bi_homolog.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 1. GATE DO BANCO — roda ANTES de qualquer import do Prisma / dos motores.
//
// Importante: `src/lib/prisma.ts` instancia o PrismaClient no momento do
// import, usando o DATABASE_URL ambiente (inclusive o do .env do repo, que no
// servidor pode apontar para PRODUÇÃO). Por isso a validação acontece aqui, com
// os motores carregados só depois via import() dinâmico, e o cliente recebe a
// URL explicitamente — nunca por herança de .env.
// ---------------------------------------------------------------------------

const REQUIRED = { host: "127.0.0.1", port: "5433", database: "teste_bi_homolog" };

function assertHomologDatabase(): { target: string; url: string } {
  const raw = process.env.DATABASE_URL ?? "";
  if (!raw) {
    throw new Error(
      "ABORTADO: DATABASE_URL não definida no ambiente. Defina-a EXPLICITAMENTE na linha de comando — este script nunca herda o .env do repositório."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("ABORTADO: DATABASE_URL inválida.");
  }
  const database = parsed.pathname.replace(/^\//, "");
  const actual = { host: parsed.hostname, port: parsed.port, database };
  const ok =
    actual.host === REQUIRED.host &&
    actual.port === REQUIRED.port &&
    actual.database === REQUIRED.database;
  if (!ok) {
    throw new Error(
      `ABORTADO: alvo proibido. esperado ${REQUIRED.host}:${REQUIRED.port}/${REQUIRED.database} — recebido ${actual.host}:${actual.port}/${actual.database}`
    );
  }
  return { target: `${actual.host}:${actual.port}/${actual.database}`, url: raw };
}

/** Falha imediata e limpa, antes de qualquer conexão possível. */
function gateOrExit(): { target: string; url: string } {
  try {
    return assertHomologDatabase();
  } catch (error) {
    console.error("");
    console.error(String(error instanceof Error ? error.message : error));
    console.error("");
    process.exit(1);
  }
}

const GATE = gateOrExit();

// ---------------------------------------------------------------------------
// 2. Instrumentação de consultas
// ---------------------------------------------------------------------------

type QueryStats = {
  total: number;
  dbMs: number;
  byTable: Record<string, number>;
};

const TRACKED_TABLES = [
  "PriceTable",
  "PriceTableVersion",
  "PriceTableItem",
  "SalesOrder",
  "SalesOrderItem",
  "ProductionCostTableVersion",
  "ProductionCostTableItem",
  "Product",
];

function newStats(): QueryStats {
  return { total: 0, dbMs: 0, byTable: Object.fromEntries(TRACKED_TABLES.map((t) => [t, 0])) };
}

let current: QueryStats = newStats();

// ---------------------------------------------------------------------------
// 3. Canonicalização determinística do payload
// ---------------------------------------------------------------------------

function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return `D:${value.toISOString()}`;
  if (value instanceof Map) {
    return {
      __map: [...value.entries()]
        .map(([k, v]) => [String(k), canonical(v)] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    };
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object") {
    // Prisma.Decimal e afins
    const maybe = value as { toNumber?: () => number; toFixed?: (n: number) => string };
    if (typeof maybe.toNumber === "function" && typeof maybe.toFixed === "function") {
      return `N:${maybe.toFixed(8)}`;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `X:${String(value)}`;
    // Normaliza -0 e ruído de ponto flutuante do próprio JS.
    return `N:${(value === 0 ? 0 : value).toFixed(8)}`;
  }
  return value;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// 4. Estatística
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

type Scenario = {
  name: string;
  run: () => Promise<unknown>;
};

type Measurement = {
  name: string;
  min: number;
  median: number;
  p95: number;
  samples: number[];
  queries: number;
  dbMs: number;
  byTable: Record<string, number>;
  fingerprint: string;
  payloadBytes: number;
};

const WARMUP = 2;
const RUNS = 5;

/** Cliente ativo — preenchido em main(), usado só para desconectar no erro. */
let activePrisma: { $disconnect: () => Promise<void> } | null = null;

async function measure(scenario: Scenario): Promise<Measurement> {
  for (let i = 0; i < WARMUP; i += 1) await scenario.run();

  const samples: number[] = [];
  let lastStats = newStats();
  let lastPayload: unknown = null;
  const fingerprints = new Set<string>();

  for (let i = 0; i < RUNS; i += 1) {
    current = newStats();
    const started = process.hrtime.bigint();
    const payload = await scenario.run();
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    samples.push(elapsed);
    lastStats = current;
    lastPayload = payload;
    fingerprints.add(fingerprint(payload));
  }

  if (fingerprints.size !== 1) {
    throw new Error(
      `NÃO DETERMINÍSTICO: ${scenario.name} produziu ${fingerprints.size} payloads distintos entre execuções`
    );
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name: scenario.name,
    min: sorted[0]!,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    samples,
    queries: lastStats.total,
    dbMs: Math.round(lastStats.dbMs),
    byTable: lastStats.byTable,
    fingerprint: [...fingerprints][0]!,
    payloadBytes: JSON.stringify(canonical(lastPayload)).length,
  };
}

// ---------------------------------------------------------------------------
// 5. Cenários — janela anual 2026, filtros idênticos aos da tela
// ---------------------------------------------------------------------------

/** Data de referência FIXA: sem ela o ano do gráfico viria de new Date(). */
const REFERENCE_DATE = new Date("2026-08-21T12:00:00.000Z");
const YEAR = 2026;

const LIST_QUERY: Record<string, unknown> = {
  year: String(YEAR),
  page: "1",
  pageSize: "20",
};

const RESULT_QUERY: Record<string, unknown> = {
  year: String(YEAR),
  asOfDate: "2026-08-21",
};

async function main() {
  const { target, url } = GATE;
  const label = process.argv[2] ?? "SEM_ROTULO";

  // Imports dinâmicos: só agora, com o alvo já provado, o Prisma e os motores
  // entram em memória (o singleton de src/lib/prisma.ts conecta no import).
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({
    log: [{ emit: "event", level: "query" }],
    datasources: { db: { url } },
  });
  activePrisma = prisma;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$on("query", (event: { query: string; duration: number }) => {
    current.total += 1;
    current.dbMs += Number(event.duration) || 0;
    for (const table of TRACKED_TABLES) {
      // identificadores citados: "public"."PriceTableVersion"
      if (event.query.includes(`"${table}"`)) {
        current.byTable[table] = (current.byTable[table] ?? 0) + 1;
        break;
      }
    }
  });

  const [{ buildSalesOrderResultDashboard }, { loadSalesOrderListMarginSummary }, { loadSalesOrderListPageMargins }] =
    await Promise.all([
      import("../src/lib/salesOrderResultEngine.server.js"),
      import("../src/lib/salesOrderListMarginSummary.server.js"),
      import("../src/lib/salesOrderListPageMargins.server.js"),
    ]);

  console.log("============================================================");
  console.log(`CERTIFICAÇÃO PEDIDOS DE VENDA — rótulo: ${label}`);
  console.log(`banco: ${target}`);
  console.log(`janela: ano ${YEAR} | warmup=${WARMUP} runs=${RUNS}`);
  console.log(`referência fixa: ${REFERENCE_DATE.toISOString()}`);
  console.log("============================================================");

  // População (contexto do benchmark, não é medição)
  const totalOrders = await prisma.salesOrder.count({
    where: {
      issueDate: {
        gte: new Date(`${YEAR}-01-01T00:00:00.000Z`),
        lt: new Date(`${YEAR + 1}-01-01T00:00:00.000Z`),
      },
    },
  });
  const totalItems = await prisma.salesOrderItem.count({
    where: {
      SalesOrder: {
        issueDate: {
          gte: new Date(`${YEAR}-01-01T00:00:00.000Z`),
          lt: new Date(`${YEAR + 1}-01-01T00:00:00.000Z`),
        },
      },
    },
  });
  console.log(`população ${YEAR}: pedidos=${totalOrders} itens=${totalItems}`);
  console.log("");

  const scenarios: Scenario[] = [
    {
      name: "/api/sales-orders/results",
      run: () => buildSalesOrderResultDashboard(prisma, RESULT_QUERY, REFERENCE_DATE),
    },
    {
      name: "/api/sales-orders/margin-summary",
      run: () =>
        loadSalesOrderListMarginSummary(prisma, LIST_QUERY, {
          referenceDate: REFERENCE_DATE,
        }),
    },
    {
      name: "/api/sales-orders/page-margins",
      run: () => loadSalesOrderListPageMargins(prisma, LIST_QUERY),
    },
    {
      name: "carga conjunta da tela",
      run: () =>
        Promise.all([
          buildSalesOrderResultDashboard(prisma, RESULT_QUERY, REFERENCE_DATE),
          loadSalesOrderListMarginSummary(prisma, LIST_QUERY, {
            referenceDate: REFERENCE_DATE,
          }),
          loadSalesOrderListPageMargins(prisma, LIST_QUERY),
        ]),
    },
  ];

  const results: Measurement[] = [];
  for (const scenario of scenarios) {
    process.stdout.write(`medindo ${scenario.name} ... `);
    const measurement = await measure(scenario);
    results.push(measurement);
    console.log("ok");
  }

  console.log("");
  console.log("RESULTADOS");
  console.log(
    "cenário".padEnd(36) +
      "min".padStart(10) +
      "mediana".padStart(11) +
      "p95".padStart(10) +
      "queries".padStart(9) +
      "dbMs".padStart(8)
  );
  for (const r of results) {
    console.log(
      r.name.padEnd(36) +
        `${r.min.toFixed(0)}ms`.padStart(10) +
        `${r.median.toFixed(0)}ms`.padStart(11) +
        `${r.p95.toFixed(0)}ms`.padStart(10) +
        String(r.queries).padStart(9) +
        String(r.dbMs).padStart(8)
    );
  }

  console.log("");
  console.log("IMPRESSÃO DIGITAL DO PAYLOAD (equivalência)");
  for (const r of results) {
    console.log(`  ${r.name.padEnd(36)} ${r.fingerprint}  (${r.payloadBytes} bytes canônicos)`);
  }

  console.log("");
  console.log("CONSULTAS POR TABELA (última execução de cada cenário)");
  for (const r of results) {
    const detail = Object.entries(r.byTable)
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t}=${n}`)
      .join(" ");
    console.log(`  ${r.name.padEnd(36)} ${detail || "(nenhuma)"}`);
  }

  const outFile = `cert-sales-perf-${label}.json`;
  writeFileSync(
    outFile,
    JSON.stringify(
      { label, target, year: YEAR, totalOrders, totalItems, results },
      null,
      2
    )
  );
  console.log("");
  console.log(`JSON gravado em ${outFile}`);

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(String(error instanceof Error ? error.message : error));
  await activePrisma?.$disconnect().catch(() => {});
  process.exit(1);
});
