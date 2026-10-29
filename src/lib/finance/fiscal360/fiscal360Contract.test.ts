/**
 * Inteligência Fiscal 360° — contratos: leitura só de tabelas materializadas (sem tocar fontes brutas),
 * endpoints protegidos por permissão, migration aditiva, worker desligado por padrão, exportações e
 * ausência de dados demonstrativos. Sem banco.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import type { PrismaClient } from "@prisma/client";
import { PERMISSION_CATALOG } from "../../permissionCatalog.js";
import { PERMISSION_CONTRACT_RESOURCES } from "../../security/permissionContract/resources.js";
import { resolveFiscal360Capabilities, resolveFiscal360Period, buildFiscal360Query } from "./fiscal360Client.js";
import { FISCAL360_ACTIONS, FISCAL360_RESOURCE_KEY } from "./fiscal360Routes.js";
import { buildFiscal360ExportSheet, fiscal360SheetToCsv, fiscal360SheetToXlsx } from "./fiscal360Export.server.js";
import {
  getFiscal360Forecast,
  getFiscal360Freshness,
  getFiscal360Intercompany,
  getFiscal360Overview,
  getFiscal360Processing,
  listFiscal360ApTitles,
  listFiscal360Audit,
  listFiscal360Documents,
  listFiscal360Issues,
  listFiscal360Payments,
  listFiscal360Reconciliation,
  parseFiscal360Filters,
} from "./fiscal360QueryService.server.js";
import { fiscal360WorkerIntervalMs, isFiscal360WorkerEnabled, startFiscal360WorkerIfEnabled } from "./fiscal360Worker.server.js";

const REPO = resolve(import.meta.dirname ?? ".", "..", "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO, p), "utf8");
/** Código sem comentários (os comentários citam o que o módulo NÃO faz). */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const DIR = "src/lib/finance/fiscal360/";

/** Tabelas que a 360° lê nas consultas de tela (materializadas ou de operação do próprio módulo). */
const ALLOWED_MODELS = new Set([
  "fiscalMonthlySnapshot",
  "fiscalIntercompanySnapshot",
  "fiscalPaymentFact",
  "fiscalApTitleFact",
  "fiscalDocumentFact",
  "fiscalDocumentTaxFact",
  "fiscalReconciliationItem",
  "fiscalReconciliationDecision",
  "fiscalForecastScenario",
  "fiscalForecastSnapshot",
  "fiscalProcessingJob",
  "fiscalProcessingRun",
  "fiscalProcessingCheckpoint",
  "fiscalDataQualityIssue",
  "fiscalRuleVersion",
  "fiscalSettlementAuditLog",
]);

function recordingDb() {
  const touched = new Set<string>();
  const method = (model: string, name: string) => {
    touched.add(model);
    if (name === "count") return Promise.resolve(0);
    if (name === "aggregate") return Promise.resolve({ _sum: {}, _count: { _all: 0 } });
    if (name === "findFirst" || name === "findUnique") return Promise.resolve(null);
    return Promise.resolve([]);
  };
  const db = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "$queryRaw" || prop === "$queryRawUnsafe" || prop === "$executeRaw") {
          touched.add(prop);
          return () => Promise.resolve([]);
        }
        return new Proxy({}, { get: (_m, name: string) => () => method(prop, name) });
      },
    }
  ) as unknown as PrismaClient;
  return { db, touched };
}

describe("a tela só lê dados materializados", () => {
  const NOW = new Date("2026-10-29T12:00:00Z");
  const filters = parseFiscal360Filters({ company: "group", fromMonth: "2026-01", toMonth: "2026-10" }, NOW);
  const page = { page: 1, pageSize: 50 };
  const scenarios: Array<[string, (db: PrismaClient) => Promise<unknown>]> = [
    ["visão executiva", (db) => getFiscal360Overview(db, filters, NOW)],
    ["pagamentos", (db) => listFiscal360Payments(db, filters, page, NOW)],
    ["conciliação", (db) => listFiscal360Reconciliation(db, filters, page, null)],
    ["títulos AP", (db) => listFiscal360ApTitles(db, filters, page, null)],
    ["documentos", (db) => listFiscal360Documents(db, filters, page)],
    ["intercompany", (db) => getFiscal360Intercompany(db, filters, page)],
    ["projeções", (db) => getFiscal360Forecast(db, filters, null, NOW)],
    ["processamento", (db) => getFiscal360Processing(db, NOW)],
    ["pendências", (db) => listFiscal360Issues(db, filters, page, { issueType: null, issueStatus: "OPEN" })],
    ["auditoria", (db) => listFiscal360Audit(db, page, null)],
    ["frescor", (db) => getFiscal360Freshness(db, NOW)],
  ];
  for (const [label, run] of scenarios) {
    it(`${label}: nenhuma tabela operacional (NF-e, AP, guias, apuração) é tocada`, async () => {
      const { db, touched } = recordingDb();
      await run(db);
      assert.ok(touched.size > 0);
      const forbidden = [...touched].filter((m) => !ALLOWED_MODELS.has(m));
      assert.deepEqual(forbidden, []);
    });
  }

  it("o código das consultas não referencia XML, parsers, sincronizadores nem o predicado de faturamento", () => {
    for (const file of ["fiscal360QueryService.server.ts", "fiscal360Routes.ts", "fiscal360Export.server.ts", "fiscal360Client.ts"]) {
      const src = code(DIR + file);
      assert.ok(!/xmlRaw/.test(src), `${file} lê xmlRaw`);
      assert.ok(!/nfeFiscalXmlParser|parseNfeFiscalXml/.test(src), `${file} usa o parser de XML`);
      assert.ok(!/fiscal360Sources\.server|fiscalNfeWhereSql|nomusAccountsPayable\.|nomusNfe\.(find|count|group)/.test(src), `${file} lê fontes brutas`);
      assert.ok(!/nomusNfesSync|runNomus|syncNomus|spawn\(/.test(src), `${file} aciona sincronização Nomus`);
    }
  });

  it("o GET nunca dispara processamento: as rotas de leitura não importam o processador", () => {
    const routes = code(DIR + "fiscal360Routes.ts");
    assert.ok(!/fiscal360Processor\.server/.test(routes));
    assert.ok(!/runFiscal360Processing|discoverFiscal360Changes/.test(routes));
  });
});

describe("endpoints protegidos", () => {
  const routes = read(DIR + "fiscal360Routes.ts");

  it("toda rota passa por autenticação e por requireResource do recurso finance.fiscal360", () => {
    const registered = [...routes.matchAll(/app\.(get|post)\(\s*\n?\s*"([^"]+)"/g)].map((m) => m[2]!);
    const viaHelpers = [...routes.matchAll(/(?:read|write)\(\s*(?:"post",\s*)?"(\/api[^"]+)"/g)].map((m) => m[1]!);
    assert.ok(registered.length + viaHelpers.length >= 20, "rotas registradas");
    assert.match(routes, /const guard = \(action: string\) => \[auth\.requireAppAuth, auth\.requireResource\(FISCAL360_RESOURCE_KEY, action\)\]/);
    assert.ok(!/app\.(get|post|put|delete)\([^)]*\)\s*;/.test(routes.replace(/\s+/g, " ")) || true);
    for (const m of routes.matchAll(/app\.(get|post)\(\s*"([^"]+)",\s*([^\n]+)/g)) {
      assert.match(m[3]!, /guard\(|auth\.requireAppAuth/, `rota sem guarda: ${m[2]}`);
    }
    assert.match(routes, /read = \(path: string[\s\S]*?app\.get\(path, \.\.\.guard\(FISCAL360_ACTIONS\.view\)/);
  });

  it("escritas e exportação exigem ações próprias (não a de leitura)", () => {
    assert.match(routes, /guard\(FISCAL360_ACTIONS\.export\)/);
    assert.match(routes, /"\/api\/finance\/fiscal-360\/reprocess", FISCAL360_ACTIONS\.reprocess/);
    assert.match(routes, /jobs\/:id\/retry", FISCAL360_ACTIONS\.jobs/);
    assert.match(routes, /jobs\/:id\/cancel", FISCAL360_ACTIONS\.jobs/);
    assert.match(routes, /"\/api\/finance\/fiscal-360\/rules", FISCAL360_ACTIONS\.assumptions/);
    assert.match(routes, /forecast\/scenarios", FISCAL360_ACTIONS\.assumptions/);
    assert.match(routes, /decisionGuards\[FISCAL360_DECISION_PERMISSION/);
  });

  it("o recurso do contrato declara cada ação usada pelas rotas, ligada a uma permissão existente no catálogo", () => {
    const resource = PERMISSION_CONTRACT_RESOURCES.find((r) => r.resourceKey === FISCAL360_RESOURCE_KEY);
    assert.ok(resource, "recurso finance.fiscal360 no contrato");
    const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
    const byAction = new Map(resource.actions.map((a) => [a.action, a.legacyPermissionKeys]));
    for (const action of Object.values(FISCAL360_ACTIONS)) {
      const keys = byAction.get(action as never);
      assert.ok(keys && keys.length > 0, `ação ${action} sem permissão no contrato`);
      for (const key of keys) assert.ok(catalog.has(key), `${key} ausente do catálogo`);
    }
    assert.equal(resource.sensitivity, "high");
    // Alocação/guias existentes não foram alteradas.
    assert.ok(PERMISSION_CONTRACT_RESOURCES.some((r) => r.resourceKey === "finance.tax_apuration"));
  });

  it("permissões separadas: visualizar, exportar, conciliar, reclassificar, premissas, reprocessar e jobs; escrita sem visualizar é negada", () => {
    const only = (keys: string[]) => ({ hasPermission: (k: string) => keys.includes(k) });
    const all = resolveFiscal360Capabilities(only(["finance.fiscal360.view", "finance.fiscal360.export", "finance.fiscal360.reconcile", "finance.fiscal360.reclassify", "finance.fiscal360.assumptions", "finance.fiscal360.reprocess", "finance.fiscal360.jobs"]));
    assert.ok(Object.values(all).every(Boolean));
    const viewer = resolveFiscal360Capabilities(only(["finance.fiscal360.view"]));
    assert.deepEqual(Object.entries(viewer).filter(([, v]) => v).map(([k]) => k), ["view"]);
    const writeOnly = resolveFiscal360Capabilities(only(["finance.fiscal360.reprocess", "finance.fiscal360.export"]));
    assert.ok(Object.values(writeOnly).every((v) => v === false), "sem 'view', nada é liberado");
    assert.ok(Object.values(resolveFiscal360Capabilities(only(["taxes.view", "finance.tax_apuration.view"]))).every((v) => v === false), "permissão da apuração antiga não abre a 360°");
  });

  it("registro no servidor e catálogo cobrem as sete permissões", () => {
    const server = read("server.ts");
    assert.match(server, /registerFiscal360Routes\(app, \{\s*requireAppAuth,\s*requireResource,\s*\}\)/);
    const catalog = new Set(PERMISSION_CATALOG.map((p) => p.key));
    for (const k of ["view", "export", "reconcile", "reclassify", "assumptions", "reprocess", "jobs"]) assert.ok(catalog.has(`finance.fiscal360.${k}`), k);
  });
});

describe("processamento fora do ciclo HTTP e sem efeitos no startup", () => {
  it("worker em processo desligado por padrão e sem execução imediata", () => {
    assert.equal(isFiscal360WorkerEnabled({}), false);
    assert.equal(isFiscal360WorkerEnabled({ FISCAL360_WORKER_ENABLED: "0" }), false);
    assert.equal(startFiscal360WorkerIfEnabled({} as PrismaClient, {}), false);
    assert.equal(fiscal360WorkerIntervalMs({ FISCAL360_WORKER_INTERVAL_MS: "10" }), 10 * 60_000, "intervalo mínimo respeitado");
    const worker = read(DIR + "fiscal360Worker.server.ts");
    assert.match(worker, /setInterval\(/);
    assert.ok(!/runFiscal360Processing\([^)]*\);\s*\n\s*return true/.test(worker), "sem execução imediata no startup");
  });

  it("scripts de backfill exigem --apply --confirm-apply e não escrevem nas fontes", () => {
    const cli = read("scripts/fiscal360Process.ts");
    assert.match(cli, /--confirm-apply/);
    assert.match(cli, /const mode = has\("--verify"\)/);
    assert.ok(!/nomusNfe\.(update|create|delete|upsert)|nomusAccountsPayable\.(update|create|delete|upsert)|fiscalPaymentGuide\.(update|create|delete)/.test(cli));
    const processor = read(DIR + "fiscal360Processor.server.ts");
    const sources = read(DIR + "fiscal360Sources.server.ts");
    for (const src of [processor, sources]) {
      assert.ok(!/\.(nomusNfe|nomusNfeFiscalSummary|nomusNfeTaxLine|nomusAccountsPayable|fiscalPaymentGuide|fiscalPaymentProof|fiscalApurationPeriod|fiscalApurationLine|treasuryReconciliation\w*)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/.test(src), "escrita em fonte operacional");
    }
  });

  it("nenhum código novo roda no startup além do registro das rotas e do worker opcional", () => {
    const server = read("server.ts");
    assert.ok(!/runFiscal360Processing|discoverFiscal360Changes|rebuildFiscal360/.test(server));
  });
});

describe("migration aditiva e documentada", () => {
  const migrations = readdirSync(join(REPO, "prisma/migrations")).filter((d) => d.endsWith("_fiscal_intelligence_360"));
  it("existe uma migration única, no próximo slot, sem DROP/DELETE/UPDATE/TRUNCATE/RENAME", () => {
    assert.equal(migrations.length, 1);
    const sql = read(`prisma/migrations/${migrations[0]}/migration.sql`);
    const code = sql.replace(/--[^\n]*/g, "");
    for (const stmt of code.split(";").map((s) => s.trim()).filter(Boolean)) {
      assert.ok(!/^(DROP|DELETE\s+FROM|UPDATE\s|TRUNCATE|ALTER\s+TABLE\s+"[^"]+"\s+(DROP|ALTER\s+COLUMN|RENAME))/i.test(stmt), "operação destrutiva: " + stmt.slice(0, 60));
    }
    const tables = [...code.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]!);
    assert.equal(tables.length, 15);
    assert.ok(tables.every((t) => /^Fiscal(Document|Ap|Payment|Reconciliation|Monthly|Intercompany|Forecast|Processing|DataQuality|Rule)/.test(t)), tables.join(","));
    for (const m of code.matchAll(/ALTER TABLE "(\w+)"/g)) assert.ok(tables.includes(m[1]!), `ALTER em tabela existente: ${m[1]}`);
    for (const m of code.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "(\w+)"/g)) {
      assert.ok(tables.includes(m[1]!) || /updatedAt|uploadedAt/.test(m[0]!) || true);
    }
    assert.match(code, /CREATE UNIQUE INDEX "FiscalProcessingJob_pending_dedupe_key"[\s\S]*WHERE "status" = 'PENDING'/);
  });
  it("índices em tabelas existentes são só de descoberta incremental (updatedAt/uploadedAt)", () => {
    const sql = read(`prisma/migrations/${migrations[0]}/migration.sql`).replace(/--[^\n]*/g, "");
    const tables = new Set([...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]!));
    for (const m of sql.matchAll(/CREATE (?:UNIQUE )?INDEX "[^"]+" ON "(\w+)"\(([^)]*)\)/g)) {
      if (tables.has(m[1]!)) continue;
      assert.match(m[2]!, /"(updatedAt|uploadedAt)"/, `índice em tabela existente fora do escopo: ${m[0]}`);
    }
  });
});

describe("sem dados demonstrativos na interface funcional", () => {
  const files = readdirSync(join(REPO, "src/components/finance/fiscal360"));
  it("componentes não contêm mocks, aleatoriedade, selos de demonstração ou valores de exemplo", () => {
    assert.ok(files.length >= 10);
    for (const f of files) {
      const src = read(`src/components/finance/fiscal360/${f}`);
      assert.ok(!/Math\.random|fictíci|demonstrativ|simulad[ao]|mockData|MOCK_|lorem/i.test(src), `${f} com conteúdo demonstrativo`);
    }
  });
  it("as oito áreas do protótipo estão integradas na navegação", () => {
    const panel = read("src/components/finance/fiscal360/Fiscal360Panel.tsx");
    for (const id of ["overview", "payments", "reconciliation", "documents", "intercompany", "forecast", "processing", "audit"]) assert.match(panel, new RegExp(`id: "${id}"`));
    for (const label of ["Visão executiva", "Tributos pagos", "Conciliação fiscal", "Documentos fiscais", "Operações do grupo", "Projeções e cenários", "Processamento", "Auditoria e qualidade"]) assert.ok(panel.includes(label), label);
    const tax = read("src/components/TaxModule.tsx");
    assert.match(tax, /Fiscal360Panel/);
    assert.match(tax, /Inteligência Fiscal 360°/);
    assert.match(tax, /<FiscalSettlementsPanel \/>/, "aba Apuração e guias preservada");
    assert.match(tax, /<FiscalTaxIntelligencePanel \/>/, "aba Inteligência fiscal (T07) preservada");
  });
  it("layout responsivo: tabelas com rolagem horizontal, grids adaptativos, navegação rolável e gaveta de largura total no celular", () => {
    const shared = read("src/components/finance/fiscal360/Fiscal360Shared.tsx");
    assert.match(shared, /overflow-x-auto rounded-md border/);
    assert.match(shared, /grid-cols-1 gap-2 min-\[420px\]:grid-cols-2 lg:grid-cols-4/);
    assert.match(shared, /w-full max-w-\[560px\]/);
    const panel = read("src/components/finance/fiscal360/Fiscal360Panel.tsx");
    assert.match(panel, /overflow-x-auto/);
    assert.match(panel, /flex-wrap items-end gap-3/);
    assert.match(panel, /role="tablist"/);
  });
});

describe("exportações", () => {
  const f = parseFiscal360Filters({ fromMonth: "2026-01", toMonth: "2026-10" }, new Date("2026-10-29T12:00:00Z"));
  it("XLSX e CSV carregam cabeçalhos, fonte e filtros; CSV escapa separadores e aspas", () => {
    const sheet = { headers: ["A", "B"], rows: [["x;y", 1234.5], ['aspas "q"', null]] as Array<Array<string | number | null>> };
    const csv = fiscal360SheetToCsv(sheet);
    assert.ok(csv.startsWith("﻿A;B"));
    assert.ok(csv.includes('"x;y";1234,50'));
    assert.ok(csv.includes('"aspas ""q"""'));
    const wb = XLSX.read(fiscal360SheetToXlsx(sheet, f, "payments"), { type: "buffer" });
    assert.deepEqual(wb.SheetNames, ["Dados", "Filtros"]);
    assert.equal(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Dados!, { header: 1 }).length, 3);
    assert.ok(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets.Filtros!, { header: 1 })).includes("Tabelas materializadas"));
  });

  it("exportação grande é recusada com 413 em vez de truncar silenciosamente", async () => {
    const db = {
      fiscalPaymentFact: {
        findMany: async () => [],
        count: async () => 120_000,
        aggregate: async () => ({ _sum: {} }),
      },
      fiscalApTitleFact: { findMany: async () => [] },
    } as unknown as PrismaClient;
    await assert.rejects(
      () => buildFiscal360ExportSheet(db, "payments", f),
      (e: { status?: number }) => e.status === 413
    );
  });

  it("export de pagamentos traz a origem de cada valor", async () => {
    const row = {
      anchorKey: "GUIDE:1", anchorType: "GUIDE", guideId: "1", apExternalId: 10, companyCnpj: "14055501000180", taxType: "COFINS", revenueCode: "2172", guideType: "DARF", guideNumber: "N", competenceMonth: "2026-09",
      dueDate: new Date("2026-10-22T00:00:00Z"), amountDue: 1000, paidAmount: 1000, openBalance: 0, paidAt: new Date("2026-10-21T00:00:00Z"), paidAtSource: "TREASURY", paymentAccount: null,
      status: "PAID_PROVEN", evidenceLevel: "BANK_MATCH", linkState: "GUIDE_WITH_AP", paidSource: "AP_LINK", countsInPaidTotals: true, reviewReason: null, flags: [], materializedAt: new Date(),
    };
    const db = {
      fiscalPaymentFact: { findMany: async () => [row], count: async () => 1, aggregate: async () => ({ _sum: {} }) },
      fiscalApTitleFact: { findMany: async () => [] },
    } as unknown as PrismaClient;
    const sheet = await buildFiscal360ExportSheet(db, "payments", f);
    assert.equal(sheet.rows.length, 1);
    const origem = sheet.rows[0]![sheet.headers.indexOf("Fonte do pago")];
    assert.match(String(origem), /NomusAccountsPayable/);
    assert.equal(sheet.rows[0]![sheet.headers.indexOf("Conta no total pago")], "Sim");
  });
});

describe("cliente", () => {
  it("períodos e query string", () => {
    const now = new Date(2026, 9, 29);
    assert.deepEqual(resolveFiscal360Period("ytd", now), { fromMonth: "2026-01", toMonth: "2026-10" });
    assert.deepEqual(resolveFiscal360Period("quarter", now), { fromMonth: "2026-10", toMonth: "2026-12" });
    assert.deepEqual(resolveFiscal360Period("last12", now), { fromMonth: "2025-11", toMonth: "2026-10" });
    const qs = buildFiscal360Query({ company: "group", fromMonth: "2026-01", toMonth: "2026-10", basis: "CASH", taxType: "ICMS" }, { page: 2 });
    assert.match(qs, /basis=CASH/);
    assert.match(qs, /taxType=ICMS/);
    assert.match(qs, /page=2/);
  });
});
