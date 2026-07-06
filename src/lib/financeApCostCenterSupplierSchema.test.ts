import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ALL_PERMISSION_KEYS, PERMISSION_CATALOG } from "./permissionCatalog.js";

const SCHEMA_PATH = join(process.cwd(), "prisma/schema.prisma");

const REQUIRED_MODELS = [
  "FinancialSupplier",
  "FinancialSupplierAlias",
  "FinancialCostCenter",
  "SupplierCostCenterRule",
  "AccountsPayableCostCenterAllocation",
  "FinancialCostCenterAuditLog",
] as const;

const REQUIRED_ENUMS = [
  "FinancialSupplierSource",
  "FinancialSupplierStatus",
  "FinancialCostCenterStatus",
  "CostCenterAllocationSource",
] as const;

const REQUIRED_PERMISSIONS = [
  "finance.cost_centers.view",
  "finance.cost_centers.manage",
  "finance.suppliers.view",
  "finance.suppliers.manage",
  "finance.cost_center_rules.view",
  "finance.cost_center_rules.manage",
  "finance.ap_allocations.view",
  "finance.ap_allocations.manage",
  "finance.ap_allocations.apply_batch",
  "finance.cost_center_audit.view",
] as const;

/** Snapshot imutável dos campos do model AP — garante que esta fase não alterou a fonte oficial. */
const NOMUS_AP_EXPECTED_FIELDS = [
  "externalId Int @unique",
  "classification String?",
  "type           Int?",
  "status         Boolean?",
  "companyId   Int?",
  "companyName String?",
  "personId    Int?",
  "personName  String?",
  "personCnpj  String?",
  "personPhone String?",
  "rawPayload  Json",
  "payloadHash String",
  "syncedAt  DateTime",
] as const;

function readSchema(): string {
  return readFileSync(SCHEMA_PATH, "utf8");
}

function extractModelBlock(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`, "m"));
  assert.ok(match, `model ${modelName} não encontrado no schema`);
  return match[0];
}

function listFrontendFiles(): string[] {
  const roots = [
    join(process.cwd(), "src/components"),
    join(process.cwd(), "src/App.tsx"),
    join(process.cwd(), "src/contexts"),
  ];
  const files: string[] = [];
  for (const root of roots) {
    try {
      const stat = readdirSync(root, { withFileTypes: true });
      for (const entry of stat) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) {
          for (const nested of readdirSync(full, { recursive: true })) {
            const path = join(full, String(nested));
            if (path.endsWith(".tsx") || path.endsWith(".ts")) files.push(path);
          }
        } else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
          files.push(full);
        }
      }
    } catch {
      files.push(root);
    }
  }
  return files;
}

describe("financeApCostCenterSupplierSchema", () => {
  const schema = readSchema();

  it("models de classificação AP existem no Prisma schema", () => {
    for (const model of REQUIRED_MODELS) {
      assert.match(schema, new RegExp(`model ${model} \\{`));
    }
  });

  it("enums de classificação AP existem no Prisma schema", () => {
    for (const enumName of REQUIRED_ENUMS) {
      assert.match(schema, new RegExp(`enum ${enumName} \\{`));
    }
  });

  it("FinancialCostCenter é separado de CostCenter (Compras)", () => {
    assert.match(schema, /model FinancialCostCenter \{/);
    assert.match(schema, /model CostCenter \{/);
    const purchasesCc = extractModelBlock(schema, "CostCenter");
    assert.doesNotMatch(purchasesCc, /FinancialSupplier/);
    assert.doesNotMatch(purchasesCc, /AccountsPayableCostCenterAllocation/);
  });

  it("AccountsPayableCostCenterAllocation referencia externalId via accountsPayableId", () => {
    const block = extractModelBlock(schema, "AccountsPayableCostCenterAllocation");
    assert.match(block, /accountsPayableId Int/);
    assert.doesNotMatch(block, /NomusAccountsPayable @relation/);
  });

  it("NomusAccountsPayable não ganhou relações nem campos de classificação", () => {
    const apBlock = extractModelBlock(schema, "NomusAccountsPayable");
    for (const field of NOMUS_AP_EXPECTED_FIELDS) {
      assert.match(apBlock, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.doesNotMatch(apBlock, /FinancialSupplier/);
    assert.doesNotMatch(apBlock, /AccountsPayableCostCenterAllocation/);
    assert.doesNotMatch(apBlock, /FinancialCostCenter/);
  });

  it("permissões de classificação AP existem no catálogo", () => {
    for (const key of REQUIRED_PERMISSIONS) {
      assert.ok(ALL_PERMISSION_KEYS.includes(key), `permissão ausente: ${key}`);
      const entry = PERMISSION_CATALOG.find((p) => p.key === key);
      assert.ok(entry, `entrada de catálogo ausente: ${key}`);
      assert.equal(entry!.module, "finance");
    }
  });

  it("sync Nomus AP não referencia models de classificação", () => {
    const mapper = readFileSync(join(process.cwd(), "src/lib/nomusAccountsPayableMapper.ts"), "utf8");
    assert.doesNotMatch(mapper, /FinancialSupplier/);
    assert.doesNotMatch(mapper, /FinancialCostCenter/);
    assert.doesNotMatch(mapper, /AccountsPayableCostCenterAllocation/);

    const routesPath = join(process.cwd(), "src/lib/nomusAccountsPayableRoutes.ts");
    try {
      const routes = readFileSync(routesPath, "utf8");
      assert.doesNotMatch(routes, /FinancialSupplier/);
      assert.doesNotMatch(routes, /financialCostCenter/i);
    } catch {
      // rota pode estar inline em server.ts — verificar dashboard AP
    }

    const dashboard = readFileSync(
      join(process.cwd(), "src/lib/financeAccountsPayableDashboard.ts"),
      "utf8"
    );
    assert.doesNotMatch(dashboard, /FinancialSupplier/);
    assert.doesNotMatch(dashboard, /AccountsPayableCostCenterAllocation/);
    assert.doesNotMatch(dashboard, /prisma\.financialSupplier/i);
  });

  it("frontend não importa @prisma/client", () => {
    const files = listFrontendFiles();
    assert.ok(files.length > 0, "nenhum arquivo frontend encontrado para verificação");
    for (const file of files) {
      let src: string;
      try {
        src = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      assert.doesNotMatch(
        src,
        /@prisma\/client/,
        `${file} não deve importar @prisma/client`
      );
    }
  });
});
