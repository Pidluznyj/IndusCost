import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { scanSourceForOfficialEngineBoundary } from "@/src/lib/supply-chain/officialEngineBoundaryScan.js";

const read = (relative: string) => readFileSync(relative, "utf8");

describe("identidade Nomus × PurchaseOrder interno", () => {
  it("avaliação Nomus referencia NomusPurchaseOrder.id, não PurchaseOrder", () => {
    const schema = read("prisma/schema.prisma");
    const model = /model NomusPurchaseOrderSupplierEvaluation \{[\s\S]*?\n\}/.exec(schema);
    assert.ok(model);
    assert.match(model[0], /nomusPurchaseOrderId\s+String\s+@unique/);
    assert.doesNotMatch(model[0], /purchaseOrderId/);
    assert.match(model[0], /onDelete: Restrict/);
    assert.doesNotMatch(model[0], /onDelete: Cascade/);
    assert.doesNotMatch(model[0], /Float/);
  });

  it("FinancialSupplier continua sem coluna de nota", () => {
    const schema = read("prisma/schema.prisma");
    const model = /model FinancialSupplier \{[\s\S]*?\n\}/.exec(schema);
    assert.ok(model);
    assert.doesNotMatch(model[0], /\b(score|rating|qualityScore|performanceScore)\b/i);
    assert.match(model[0], /nomusPurchaseOrderEvaluations/);
  });

  it("migration é aditiva e não reconstrói histórico interno", () => {
    const sql = read(
      "prisma/migrations/20260923120000_nomus_purchase_order_supplier_evaluation/migration.sql"
    );
    assert.match(sql, /CREATE TABLE "NomusPurchaseOrderSupplierEvaluation"/);
    assert.match(sql, /CREATE TABLE "NomusPurchaseOrderSupplierEvaluationHistory"/);
    assert.match(sql, /REFERENCES "NomusPurchaseOrder"\("id"\)/);
    assert.doesNotMatch(sql, /"PurchaseOrderSupplierEvaluation"/);
    assert.doesNotMatch(sql, /\bDROP\b/i);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(sql, /IF NOT EXISTS/i);
  });

  it("serviço não mistura PurchaseOrder interno e não escreve no Nomus", () => {
    const service = read("src/lib/purchasing/nomusPurchaseOrderEvaluation.server.ts");
    assert.match(service, /nomusPurchaseOrderSupplierEvaluation\.create/);
    assert.match(service, /computeSupplierOrderEvaluation/);
    assert.doesNotMatch(service, /prisma\.purchaseOrder\./);
    assert.doesNotMatch(service, /prisma\.purchaseOrderSupplierEvaluation/);
    assert.doesNotMatch(service, /fetch\(|axios|NOMUS_TOKEN|Authorization/);
    const writes = [
      ...service.matchAll(
        /\b(?:tx|db|prisma)\.([A-Za-z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g
      ),
    ].map((m) => m[1]);
    for (const model of writes) {
      assert.ok(
        model === "nomusPurchaseOrderSupplierEvaluation" ||
          model === "nomusPurchaseOrderSupplierEvaluationHistory",
        `escrita inesperada em ${model}`
      );
    }
    const violations = scanSourceForOfficialEngineBoundary(
      "src/lib/purchasing/nomusPurchaseOrderEvaluation.server.ts",
      service
    );
    assert.deepEqual(violations, []);
  });

  it("batch chama o mesmo save unitário", () => {
    const service = read("src/lib/purchasing/nomusPurchaseOrderEvaluation.server.ts");
    assert.match(service, /saveNomusPurchaseOrderSupplierEvaluationsBatch/);
    assert.match(
      service,
      /await saveNomusPurchaseOrderSupplierEvaluation\(\s*prisma,\s*nomusPurchaseOrderId/
    );
  });
});

describe("navegação Compras — contexto Nomus", () => {
  it(" Pedidos Nomus e Avaliação Fornecedor aparecem; as demais abas não neste contexto", () => {
    const nav = read("src/components/supply-chain/PurchaseChainViewNav.tsx");
    const moduleSrc = read("src/components/NomusPurchaseOrderModule.tsx");
    const page = read(
      "src/components/supply-chain/supplier-performance/NomusSupplierEvaluationWorklistPage.tsx"
    );
    assert.match(nav, /label: "Pedidos Nomus"/);
    assert.match(nav, /label: "Avaliação Fornecedor"/);
    assert.match(nav, /variant === "nomus"/);
    assert.match(moduleSrc, /variant="nomus"/);
    assert.match(page, /variant="nomus"/);
    const nomusBlock = /const NOMUS_CONTEXT_VIEWS[\s\S]*?];/.exec(nav);
    assert.ok(nomusBlock);
    assert.doesNotMatch(nomusBlock[0], /Solicitações/);
    assert.doesNotMatch(nomusBlock[0], /Cotações/);
    assert.doesNotMatch(nomusBlock[0], /Recebimento/);
    assert.doesNotMatch(nomusBlock[0], /Estação/);
    assert.doesNotMatch(nomusBlock[0], /to: "\/purchases\/orders"/);
  });

  it("rotas legadas da cadeia continuam no nav completo", () => {
    const nav = read("src/components/supply-chain/PurchaseChainViewNav.tsx");
    const app = read("src/App.tsx");
    assert.match(nav, /to: "\/purchases"/);
    assert.match(nav, /to: "\/purchases\/quotations"/);
    assert.match(nav, /to: "\/purchases\/orders"/);
    assert.match(nav, /to: "\/purchases\/receiving"/);
    assert.match(nav, /to: "\/purchases\/workstation"/);
    assert.match(app, /path="purchases"/);
    assert.match(app, /path="purchases\/quotations"/);
    assert.match(app, /path="purchases\/orders"/);
    assert.match(app, /path="purchases\/receiving"/);
    assert.match(app, /path="purchases\/workstation"/);
    assert.match(app, /path="purchases\/supplier-evaluation"/);
    assert.match(app, /NomusSupplierEvaluationWorklistPage/);
  });
});

describe("worklist UI", () => {
  it("grade inline com quatro critérios e lote sem nota única para todos", () => {
    const page = read(
      "src/components/supply-chain/supplier-performance/NomusSupplierEvaluationWorklistPage.tsx"
    );
    const client = read("src/lib/purchasing/nomusPurchaseOrderEvaluationClient.ts");
    assert.match(page, /SUPPLIER_EVALUATION_CRITERIA/);
    assert.match(page, /computeSupplierOrderEvaluation/);
    assert.match(page, /nse-filter-period/);
    assert.match(page, /usePermissions/);
    assert.doesNotMatch(page, /const \{ permissions \} = useAuth\(\)/);
    assert.match(page, /nse-save-selected/);
    assert.match(page, /não há “aplicar a mesma nota a todos”/i);
    assert.doesNotMatch(page, /Aplicar esta nota a todos/);
    assert.doesNotMatch(page, /overallScore:/);
    assert.match(client, /\/api\/supplier-performance\/nomus-orders\/worklist/);
    assert.match(client, /\/api\/supplier-performance\/nomus-orders\/batch/);
    assert.doesNotMatch(client, /nomusPurchaseOrderEvaluation\.server/);
  });
});
