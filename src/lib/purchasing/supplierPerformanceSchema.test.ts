/**
 * OP-26 — Contrato estrutural da avaliação de fornecedor.
 * Schema/migration aditivos, flag fail-closed, permissões no backend,
 * integração de UI e proteção dos motores oficiais.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { scanSourceForOfficialEngineBoundary } from "@/src/lib/supply-chain/officialEngineBoundaryScan.js";
import { SUPPLIER_PERFORMANCE_SUPPLIER_STATUSES } from "./supplierPerformance.js";

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

const MIGRATION_DIR = "prisma/migrations/20260918120000_purchase_order_supplier_evaluation";

const SCHEMA = read("prisma/schema.prisma");
const MIGRATION = read(`${MIGRATION_DIR}/migration.sql`);
const ENGINE = read("src/lib/purchasing/supplierPerformance.ts");
const SERVICE = read("src/lib/purchasing/supplierPerformance.server.ts");
const ROUTES = read("src/lib/purchasing/supplierPerformanceRoutes.ts");
const CSV = read("src/lib/purchasing/supplierPerformanceCsv.ts");
const FLAGS = read("src/lib/supply-chain/supplyChainFeatureFlags.ts");
const SERVER = read("server.ts");
const APP = read("src/App.tsx");
const PO_UI = read("src/components/PurchaseOrderModule.tsx");
const DRAWER = read(
  "src/components/finance/cost-centers/FinanceSupplierCadastroDrawer.tsx"
);
const TAB = read(
  "src/components/supply-chain/supplier-performance/SupplierPerformanceTab.tsx"
);
const FORM = read(
  "src/components/supply-chain/supplier-performance/PurchaseOrderSupplierEvaluationForm.tsx"
);
const CARD = read(
  "src/components/supply-chain/supplier-performance/PurchaseOrderSupplierEvaluationCard.tsx"
);
const REPORT = read(
  "src/components/supply-chain/supplier-performance/SupplierPerformanceReportPage.tsx"
);
const SUPPLIERS_PAGE = read("src/components/finance/FinanceSuppliersPage.tsx");
const ENV_EXAMPLE = read(".env.example");
const DOC = read("docs/supply-chain/supplier-performance.md");

/** Remove comentários SQL para auditar só o que executa. */
function sqlStatements(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("schema — aditivo e sem nota no cadastro do fornecedor", () => {
  it("cria PurchaseOrderSupplierEvaluation com UNIQUE por pedido", () => {
    assert.match(SCHEMA, /model PurchaseOrderSupplierEvaluation \{/);
    assert.match(SCHEMA, /purchaseOrderId\s+String\s+@unique @db\.Uuid/);
    assert.match(SCHEMA, /qualityScore\s+Decimal\s+@db\.Decimal\(4, 2\)/);
    assert.match(SCHEMA, /overallScore\s+Decimal\s+@db\.Decimal\(4, 2\)/);
    assert.match(SCHEMA, /methodologyVersion Int\s+@default\(1\)/);
    assert.match(SCHEMA, /revision\s+Int\s+@default\(1\)/);
    assert.match(SCHEMA, /supplierEvaluation PurchaseOrderSupplierEvaluation\?/);
  });

  it("não usa Float para nota persistida", () => {
    const model = /model PurchaseOrderSupplierEvaluation \{[\s\S]*?\n\}/.exec(SCHEMA);
    assert.ok(model);
    assert.doesNotMatch(model[0], /Float/);
  });

  it("avaliação é evidência: FK Restrict, nunca Cascade", () => {
    const model = /model PurchaseOrderSupplierEvaluation \{[\s\S]*?\n\}/.exec(SCHEMA);
    assert.ok(model);
    assert.match(model[0], /onDelete: Restrict/);
    assert.doesNotMatch(model[0], /onDelete: Cascade/);
    assert.match(model[0], /onUpdate: NoAction/);
  });

  it("a lista de status de fornecedor espelha o enum canônico do Prisma", () => {
    const block = /enum FinancialSupplierStatus \{([\s\S]*?)\n\}/.exec(SCHEMA);
    assert.ok(block);
    const fromSchema = block[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("/"));
    assert.deepEqual([...SUPPLIER_PERFORMANCE_SUPPLIER_STATUSES].sort(), fromSchema.sort());
  });

  it("FinancialSupplier continua sem coluna de score/rating", () => {
    const model = /model FinancialSupplier \{[\s\S]*?\n\}/.exec(SCHEMA);
    assert.ok(model);
    assert.doesNotMatch(model[0], /\b(score|rating|qualityScore|performanceScore)\b/i);
  });
});

describe("migration — 100% aditiva e ordenada", () => {
  it("fica depois da última migration existente", () => {
    const all = readdirSync(join(ROOT, "prisma/migrations"))
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    assert.equal(all[all.length - 1], "20260918120000_purchase_order_supplier_evaluation");
  });

  it("só CREATE TABLE + índice único + FK", () => {
    const sql = sqlStatements(MIGRATION);
    assert.match(sql, /CREATE TABLE "PurchaseOrderSupplierEvaluation"/);
    assert.match(
      sql,
      /CREATE UNIQUE INDEX "PurchaseOrderSupplierEvaluation_purchaseOrderId_key"/
    );
    assert.match(sql, /FOREIGN KEY \("purchaseOrderId"\) REFERENCES "PurchaseOrder"\("id"\)/);
    assert.match(sql, /DECIMAL\(4,2\)/);
  });

  it("DDL determinístico: sem IF NOT EXISTS nem silenciamento de erro", () => {
    const sql = sqlStatements(MIGRATION);
    // Migration versionada não pode mascarar drift: conflito inesperado DEVE falhar.
    assert.doesNotMatch(sql, /IF NOT EXISTS/i);
    assert.doesNotMatch(sql, /IF EXISTS/i);
    assert.doesNotMatch(sql, /duplicate_object/i);
    assert.doesNotMatch(sql, /EXCEPTION\s+WHEN/i);
    assert.doesNotMatch(sql, /DO \$\$/);
  });

  it("FK preserva a avaliação: ON DELETE RESTRICT, nunca CASCADE", () => {
    const sql = sqlStatements(MIGRATION);
    assert.match(sql, /ON DELETE RESTRICT ON UPDATE NO ACTION/);
    assert.doesNotMatch(sql, /ON DELETE CASCADE/i);
  });

  it("zero DROP / TRUNCATE / RENAME / DELETE FROM", () => {
    const sql = sqlStatements(MIGRATION);
    assert.doesNotMatch(sql, /\bDROP\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /\bRENAME\b/i);
    // DML apenas: `ON DELETE RESTRICT` é referential action e é esperado aqui.
    assert.doesNotMatch(sql, /DELETE\s+FROM/i);
    assert.match(sql, /ON DELETE/);
  });

  it("não altera nenhuma tabela existente", () => {
    const sql = sqlStatements(MIGRATION);
    for (const match of sql.matchAll(/ALTER TABLE\s+"([^"]+)"/g)) {
      assert.equal(match[1], "PurchaseOrderSupplierEvaluation");
    }
  });
});

describe("motor puro — fonte única da regra", () => {
  it("não importa Prisma nem Node", () => {
    // Import real, não menção em comentário.
    const IMPORT_PRISMA = /(?:from|import)\s*\(?\s*["']@prisma\/client["']/;
    assert.doesNotMatch(ENGINE, IMPORT_PRISMA);
    assert.doesNotMatch(ENGINE, /from "node:/);
    assert.doesNotMatch(CSV, IMPORT_PRISMA);
    assert.doesNotMatch(CSV, /from "node:/);
  });

  it("elegibilidade centralizada em uma função", () => {
    assert.match(ENGINE, /export function isPurchaseOrderSupplierEvaluationEligible/);
    assert.match(ENGINE, /SUPPLIER_EVALUATION_ELIGIBLE_STATUSES/);
  });

  it("UI e serviço consomem o motor, sem fórmula paralela", () => {
    assert.match(SERVICE, /computeSupplierOrderEvaluation/);
    assert.match(FORM, /computeSupplierOrderEvaluation/);
    for (const source of [SERVICE, ROUTES, TAB, CARD, REPORT]) {
      assert.doesNotMatch(source, /\/\s*4\b/);
    }
  });
});

describe("serviço — escrita restrita e auditoria transacional", () => {
  it("não escreve em nenhum motor oficial protegido", () => {
    const violations = scanSourceForOfficialEngineBoundary(
      "src/lib/purchasing/supplierPerformance.server.ts",
      SERVICE
    );
    assert.deepEqual(violations, []);
  });

  it("escreve apenas na avaliação e no histórico do pedido", () => {
    const writes = [
      ...SERVICE.matchAll(
        /\b(?:tx|db|prisma)\.([A-Za-z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g
      ),
    ].map((m) => m[1]);
    assert.ok(writes.length > 0);
    for (const model of writes) {
      assert.ok(
        model === "purchaseOrderSupplierEvaluation" || model === "purchaseOrderHistoryEvent",
        `escrita inesperada em ${model}`
      );
    }
  });

  it("avaliação e histórico na MESMA transação", () => {
    assert.match(SERVICE, /prisma\.\$transaction\(async \(tx\) =>/);
    const tx = /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*?\n  \}\);/.exec(SERVICE);
    assert.ok(tx);
    assert.match(tx[0], /purchaseOrderSupplierEvaluation\.create/);
    assert.match(tx[0], /purchaseOrderSupplierEvaluation\.updateMany/);
    assert.match(tx[0], /writeEvaluationHistory/);
  });

  it("optimistic locking por compare-and-swap na revisão", () => {
    assert.match(SERVICE, /where: \{ id: current\.id, revision: expectedRevision \}/);
    assert.match(SERVICE, /revision: expectedRevision \+ 1/);
    assert.match(SERVICE, /SUPPLIER_EVALUATION_REVISION_CONFLICT/);
    assert.match(SERVICE, /error\.code === "P2002"/);
  });

  it("registra as ações de histórico do OP-26", () => {
    assert.match(ENGINE, /SUPPLIER_EVALUATION_CREATED/);
    assert.match(ENGINE, /SUPPLIER_EVALUATION_REVISED/);
    assert.match(SERVICE, /before: \{/);
    assert.match(SERVICE, /after: \{/);
  });

  it("agrega em lote — sem query por fornecedor/pedido", () => {
    assert.match(SERVICE, /groupBy\(\{/);
    assert.doesNotMatch(SERVICE, /for \(const [\s\S]{0,120}await prisma\./);
    assert.doesNotMatch(SERVICE, /rawJson|nomusRawResponse/);
  });
});

describe("rotas — flag + permissões no backend", () => {
  it("flag dedicada fail closed antes de tudo", () => {
    assert.match(FLAGS, /supplierPerformance: "SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED"/);
    assert.match(
      FLAGS,
      /supplierPerformance: "operations\.supply_chain\.supplier_performance\.enabled"/
    );
    assert.match(ROUTES, /requireEnvFlagEnabled\(SUPPLY_CHAIN_FEATURE_ENV\.supplierPerformance\)/);
  });

  it("leitura/escrita do pedido usam operations.purchases", () => {
    assert.match(ROUTES, /OPERATIONS_RESOURCE_KEYS\.purchases, OPERATIONS_ACTIONS\.view/);
    assert.match(ROUTES, /OPERATIONS_RESOURCE_KEYS\.purchases, OPERATIONS_ACTIONS\.update/);
  });

  it("consolidado exige fornecedor E pedidos (AND de guards)", () => {
    const guard = /const performanceView = \[[\s\S]*?\] as const;/.exec(ROUTES);
    assert.ok(guard);
    assert.match(guard[0], /FINANCE_MODULE_RESOURCE_KEYS\.suppliers, FINANCE_MODULE_ACTIONS\.view/);
    assert.match(guard[0], /OPERATIONS_RESOURCE_KEYS\.purchases, OPERATIONS_ACTIONS\.view/);
    assert.match(guard[0], /flag/);
  });

  it("não cria resource novo de permissão", () => {
    assert.doesNotMatch(ROUTES, /supplierEvaluation\.|quality\.|supplierPerformance\.view/);
  });

  it("não pendura rota nova sob o prefixo oficial de fornecedores", () => {
    assert.doesNotMatch(ROUTES, /"\/api\/finance\/suppliers/);
    assert.match(ROUTES, /"\/api\/supplier-performance\/suppliers\/:supplierId"/);
    assert.match(ROUTES, /"\/api\/purchase-orders\/:id\/supplier-evaluation"/);
  });

  it("não confia em nota geral, fornecedor, metodologia ou autor do cliente", () => {
    // `\b` evita casar `body.revisionReason`, que é legítimo.
    assert.doesNotMatch(
      ROUTES,
      /body\.(overallScore|supplierId|methodologyVersion|revision)\b/
    );
    assert.doesNotMatch(ROUTES, /body\.(userId|userName|evaluatedBy)\b/);
    assert.match(ROUTES, /await auth\.getCurrentAppUser\(req\)/);
    assert.match(SERVICE, /methodologyVersion: SUPPLIER_EVALUATION_METHODOLOGY_VERSION/);
  });

  it("valida UUID e limita pageSize", () => {
    assert.match(ROUTES, /isUuid\(id\)/);
    assert.match(ROUTES, /isUuid\(supplierId\)/);
    assert.match(ROUTES, /normalizeSupplierPerformancePageSize/);
  });

  it("filtros do boundary usam os parsers ESTRITOS, não os tolerantes da UI", () => {
    assert.match(ROUTES, /parseSupplierPerformanceApiPeriod/);
    assert.match(ROUTES, /parseSupplierPerformanceApiEvaluationStatus/);
    assert.match(ROUTES, /parseSupplierPerformanceApiSort/);
    assert.match(ROUTES, /parseSupplierPerformanceApiSupplierStatus/);
    // Nenhum parser tolerante pode voltar a mascarar filtro inválido na API.
    assert.doesNotMatch(ROUTES, /parseSupplierPerformanceCivilDateParam/);
    assert.doesNotMatch(ROUTES, /parseSupplierPerformanceEvaluationStatusFilter/);
    assert.doesNotMatch(ROUTES, /parseSupplierPerformanceReportSort\b/);
  });

  it("erro de filtro é 400 de domínio, não 500", () => {
    assert.match(ENGINE, /INVALID_SUPPLIER_PERFORMANCE_FILTER/);
    assert.match(ENGINE, /INVALID_SUPPLIER_PERFORMANCE_FILTER: 400/);
    assert.match(ROUTES, /INVALID_SUPPLIER_PERFORMANCE_FILTER/);
  });

  it("registrada no server.ts", () => {
    assert.match(SERVER, /registerSupplierPerformanceRoutes/);
  });
});

describe("UI — integrada, fail closed e em pt-BR", () => {
  it("card de avaliação no detalhe do Pedido de Compra", () => {
    assert.match(PO_UI, /PurchaseOrderSupplierEvaluationCard/);
    assert.match(CARD, /Avaliação do fornecedor/);
    assert.match(CARD, /Avaliação disponível após o pedido ser recebido ou encerrado\./);
    assert.match(CARD, /if \(featureEnabled !== true\) return null;/);
  });

  it("um único formulário reutilizado no pedido e no fornecedor", () => {
    assert.match(CARD, /PurchaseOrderSupplierEvaluationForm/);
    assert.match(TAB, /PurchaseOrderSupplierEvaluationForm/);
    assert.match(FORM, /Revisar avaliação/);
    assert.match(FORM, /Motivo da revisão \(obrigatório\)/);
  });

  it("aba Desempenho só em edição, com flag e permissão", () => {
    assert.match(DRAWER, /finance-supplier-tab-desempenho/);
    assert.match(DRAWER, /supplierPerformanceEnabled === true/);
    assert.match(DRAWER, /canViewPurchaseOrders/);
    assert.match(DRAWER, /!isCreate &&/);
    assert.match(DRAWER, /SupplierPerformanceTab/);
  });

  it("lista de pedidos paginada no servidor com filtros pt-BR", () => {
    // Os chips saem da lista canônica do motor (inclui "Pendentes").
    assert.match(TAB, /SUPPLIER_PERFORMANCE_EVALUATION_STATUS_FILTERS\.map/);
    assert.match(ENGINE, /\{ id: "pending", label: "Pendentes" \}/);
    assert.match(TAB, /Não avaliado/);
    assert.match(TAB, /Não elegível/);
    assert.match(TAB, /pageSize: SUPPLIER_PERFORMANCE_PAGE_SIZE_DEFAULT/);
    assert.match(TAB, /\/purchases\/orders\/\$\{order\.id\}/);
  });

  it("valor do pedido usa a moeda do pedido, nunca BRL presumido", () => {
    assert.match(TAB, /formatPurchaseOrderAmount\(order\.totalAmount, order\.currency\)/);
    assert.doesNotMatch(TAB, /formatFinanceCurrency/);
    assert.match(ENGINE, /export function formatPurchaseOrderAmount/);
    // O relatório consolidado não soma valores de moedas diferentes.
    assert.doesNotMatch(REPORT, /totalAmount/);
  });

  it("relatório declara metodologia interna e exporta pelo backend", () => {
    assert.match(APP, /finance\/suppliers\/performance/);
    assert.match(SUPPLIERS_PAGE, /Desempenho dos fornecedores/);
    assert.match(REPORT, /Metodologia de avaliação/);
    assert.match(REPORT, /buildSupplierPerformanceSummaryCsvUrl/);
    assert.match(REPORT, /buildSupplierPerformanceDetailCsvUrl/);
    assert.match(REPORT, /triggerBrowserPrint/);
  });

  it("não renderiza observações como HTML", () => {
    for (const source of [FORM, CARD, TAB, REPORT]) {
      assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
    }
  });

  it("não classifica A/B/C/D nem aprova/reprova automaticamente", () => {
    for (const source of [ENGINE, SERVICE, TAB, REPORT, CARD]) {
      assert.doesNotMatch(source, /\b(Excelente|Regular|Reprovado|Ranking)\b/);
    }
  });
});

describe("CSV — backend, mesma fonte, anti formula injection", () => {
  it("cabeçalhos exigidos e proteção de fórmula", () => {
    assert.match(CSV, /supplier_id/);
    assert.match(CSV, /purchase_order_code/);
    assert.match(CSV, /overall_score/);
    assert.match(CSV, /methodology_version/);
    assert.match(CSV, /evaluation_revision/);
    assert.match(CSV, /\^\[=\+\\-@\\t\\r\]/);
  });

  it("valor exportado é rastreável: traz a moeda do pedido", () => {
    assert.match(CSV, /"purchase_order_amount"/);
    assert.match(CSV, /"purchase_order_currency"/);
    assert.match(CSV, /purchaseOrderCurrency/);
    assert.match(SERVICE, /purchaseOrderCurrency: order\.currency \?\? null/);
    // Formatação apenas — nenhuma conversão cambial na feature.
    for (const source of [CSV, SERVICE, ENGINE, TAB, REPORT]) {
      assert.doesNotMatch(source, /\b(ptax|exchangeRate|convertCurrency|cambio|câmbio)\b/i);
    }
  });

  it("relatório detalhado reutiliza a mesma função do CSV", () => {
    assert.match(ROUTES, /buildSupplierPerformanceDetailCsvRows/);
  });
});

describe("documentação e configuração", () => {
  it(".env.example documenta a flag desligada", () => {
    assert.match(ENV_EXAMPLE, /SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED/);
    assert.match(ENV_EXAMPLE, /Fail closed/i);
  });

  it("documento de domínio existe e não atribui a fórmula ao Inmetro", () => {
    assert.match(DOC, /PurchaseOrderSupplierEvaluation/);
    assert.match(DOC, /metodologia interna/i);
    assert.match(DOC, /SUPPLY_CHAIN_SUPPLIER_PERFORMANCE_ENABLED/);
    assert.match(DOC, /Fora do MVP/i);
    assert.doesNotMatch(DOC, /fórmula (do|exigida pelo) Inmetro/i);
  });
});
