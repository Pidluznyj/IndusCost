/**
 * OP-03 — Barreiras técnicas: SC não escreve nos motores oficiais.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS,
  OFFICIAL_ENGINE_MUTATION_FORBIDDEN_API_PREFIXES,
  OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS,
  OfficialEngineWriteForbiddenError,
  isOfficialEngineProtectedModel,
} from "./officialEngineBoundary.js";
import {
  listSupplyChainDomainFiles,
  scanSourceForForbiddenMutableImports,
  scanSourceForOfficialEngineBoundary,
  scanSourceForProtectedModelWrites,
  scanSupplyChainDomainForOfficialEngineBoundary,
  stripCommentsAndStringLiterals,
} from "./officialEngineBoundaryScan.js";
import { createOfficialEngineReadAdapters } from "./officialEngineReadAdapters.server.js";
import {
  findForbiddenOfficialEngineHttpMutations,
  isOfficialEngineHttpMutationForbidden,
} from "./officialEngineRoutesPolicy.js";
import {
  assertOfficialEngineReadOnlyAccess,
  createOfficialEngineReadOnlyDelegateProxy,
} from "./officialEngineWriteGuard.js";

const REPO_ROOT = process.cwd();

describe("officialEngineBoundary — registro", () => {
  it("cobre MP, produto/BOM, custos/preço, PV, OP e financeiro", () => {
    const models = new Set(OFFICIAL_ENGINE_PROTECTED_PRISMA_MODELS);
    assert.ok(models.has("material"));
    assert.ok(models.has("product"));
    assert.ok(models.has("productBOM"));
    assert.ok(models.has("productPricing"));
    assert.ok(models.has("priceTable"));
    assert.ok(models.has("productionCostTableItem"));
    assert.ok(models.has("materialCostTableItem"));
    assert.ok(models.has("materialMarketQuote"));
    assert.ok(models.has("salesOrder"));
    assert.ok(models.has("nomusProductionOrder"));
    assert.ok(models.has("financialSupplier"));
    assert.ok(models.has("financialCostCenter"));
    assert.ok(models.has("nomusAccountsPayable"));
    assert.ok(models.has("commissionOrderSnapshot"));
    assert.ok(OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS.includes("create"));
    assert.ok(OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS.includes("upsert"));
    assert.ok(OFFICIAL_ENGINE_FORBIDDEN_WRITE_METHODS.includes("delete"));
  });

  it("não trata Inventory* / PurchaseRequest / CostCenter ops como oficiais protegidos", () => {
    assert.equal(isOfficialEngineProtectedModel("inventoryItem"), false);
    assert.equal(isOfficialEngineProtectedModel("purchaseRequest"), false);
    assert.equal(isOfficialEngineProtectedModel("costCenter"), false);
    assert.equal(isOfficialEngineProtectedModel("inventoryMovement"), false);
  });
});

describe("officialEngineWriteGuard — rejeita writes", () => {
  it("rejeita create/update/delete/upsert em cada modelo protegido amostrado", () => {
    const samples = [
      "material",
      "product",
      "productBOM",
      "salesOrder",
      "nomusProductionOrder",
      "financialSupplier",
      "productPricing",
      "materialMarketQuote",
    ] as const;

    for (const model of samples) {
      for (const method of ["create", "update", "upsert", "delete"] as const) {
        assert.throws(
          () => assertOfficialEngineReadOnlyAccess(model, method),
          (err: unknown) =>
            err instanceof OfficialEngineWriteForbiddenError &&
            err.model === model &&
            err.method === method
        );
      }
    }
  });

  it("permite findUnique/findMany/count em modelo protegido", () => {
    assert.doesNotThrow(() => assertOfficialEngineReadOnlyAccess("material", "findUnique"));
    assert.doesNotThrow(() => assertOfficialEngineReadOnlyAccess("product", "findMany"));
    assert.doesNotThrow(() => assertOfficialEngineReadOnlyAccess("salesOrder", "count"));
  });

  it("proxy de delegate bloqueia create e permite findUnique", async () => {
    const calls: string[] = [];
    const fakeDelegate = {
      findUnique: async () => {
        calls.push("findUnique");
        return { id: "1" };
      },
      create: async () => {
        calls.push("create");
        return { id: "2" };
      },
    };
    const proxy = createOfficialEngineReadOnlyDelegateProxy("material", fakeDelegate);
    await proxy.findUnique();
    assert.deepEqual(calls, ["findUnique"]);
    await assert.rejects(
      async () => proxy.create(),
      (err: unknown) =>
        err instanceof OfficialEngineWriteForbiddenError && err.method === "create"
    );
    assert.deepEqual(calls, ["findUnique"]);
  });
});

describe("officialEngineBoundaryScan — writes e imports", () => {
  it("detecta prisma/tx writes em modelos protegidos", () => {
    const dirty = `
      await prisma.material.create({ data: {} });
      await tx.product.update({ where: { id }, data: {} });
      await db.productBOM.upsert({ where: { id }, create: {}, update: {} });
      await client.salesOrder.delete({ where: { id } });
      await prisma.nomusProductionOrder.deleteMany({});
      await prisma.financialSupplier.createMany({ data: [] });
    `;
    const hits = scanSourceForProtectedModelWrites("dirty.ts", dirty);
    const ids = hits.map((h) => h.ruleId);
    assert.ok(ids.some((id) => id.includes("material")));
    assert.ok(ids.some((id) => id.includes("product")));
    assert.ok(ids.some((id) => id.includes("productBOM")));
    assert.ok(ids.some((id) => id.includes("salesOrder")));
    assert.ok(ids.some((id) => id.includes("nomusProductionOrder")));
    assert.ok(ids.some((id) => id.includes("financialSupplier")));
  });

  it("não marca prosa/comentário como write", () => {
    const clean = `
      // não executar material.create(
      /* product.update( */
      const note = "prisma.salesOrder.delete(";
      await prisma.inventoryItem.create({ data: {} });
      await prisma.purchaseRequest.update({ where: { id }, data: {} });
    `;
    assert.deepEqual(scanSourceForProtectedModelWrites("clean.ts", clean), []);
  });

  it("stripCommentsAndStringLiterals remove literais", () => {
    const stripped = stripCommentsAndStringLiterals(`const x = "create("; // update(`);
    assert.equal(/create\(/.test(stripped), false);
    assert.equal(/update\(/.test(stripped), false);
  });

  it("detecta imports de repositórios oficiais mutáveis", () => {
    const dirty = `
      import { publish } from "@/src/lib/productionCostPublication.server.js";
      import { sync } from "../salesOrderNomusSync.js";
      import { routes } from "@/src/lib/financeSuppliersRoutes.js";
    `;
    const hits = scanSourceForForbiddenMutableImports("dirty-import.ts", dirty);
    assert.ok(hits.length >= 3);
  });

  it("permite import dos adaptadores/contratos SC", () => {
    const ok = `
      import { createOfficialEngineReadAdapters } from "@/src/lib/supply-chain/officialEngineReadAdapters.server.js";
      import type { OfficialMaterialReader } from "@/src/lib/supply-chain/officialEngineReadOnlyContracts.js";
    `;
    assert.deepEqual(scanSourceForForbiddenMutableImports("ok.ts", ok), []);
  });
});

describe("domínio SC real — sem writes/imports indevidos", () => {
  it("lista arquivos do domínio SC", () => {
    const files = listSupplyChainDomainFiles(REPO_ROOT);
    assert.ok(files.some((f) => /inventoryRoutes\.ts$/.test(f)));
    assert.ok(files.some((f) => /supply-chain[/\\]officialEngineBoundary\.ts$/.test(f)));
    assert.ok(files.some((f) => /PurchaseModule\.tsx$/.test(f)));
  });

  it("varredura estática do domínio SC sem violações", () => {
    const violations = scanSupplyChainDomainForOfficialEngineBoundary(REPO_ROOT);
    assert.deepEqual(
      violations,
      [],
      violations.map((v) => `${v.file}:${v.ruleId}:${v.snippet}`).join("\n")
    );
  });

  it("adaptador read-only não contém métodos de escrita no source", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/lib/supply-chain/officialEngineReadAdapters.server.ts"),
      "utf8"
    );
    const hits = scanSourceForProtectedModelWrites("adapters.ts", src);
    assert.deepEqual(hits, []);
    assert.match(src, /findUnique/);
    assert.match(src, /findMany/);
    assert.doesNotMatch(src, /\.create\s*\(/);
    assert.doesNotMatch(src, /\.update\s*\(/);
    assert.doesNotMatch(src, /\.upsert\s*\(/);
    assert.doesNotMatch(src, /\.delete\s*\(/);
  });

  it("contratos read-only não importam Prisma nem repositories mutáveis", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/lib/supply-chain/officialEngineReadOnlyContracts.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /PrismaClient/);
    assert.deepEqual(scanSourceForOfficialEngineBoundary("contracts.ts", src), []);
  });
});

describe("officialEngineRoutesPolicy — rotas oficiais", () => {
  it("bloqueia mutação HTTP em prefixos oficiais", () => {
    assert.equal(isOfficialEngineHttpMutationForbidden("POST", "/api/materials"), true);
    assert.equal(isOfficialEngineHttpMutationForbidden("PUT", "/api/products/1"), true);
    assert.equal(isOfficialEngineHttpMutationForbidden("DELETE", "/api/sales-orders/1"), true);
    assert.equal(
      isOfficialEngineHttpMutationForbidden("PATCH", "/api/finance/suppliers/1"),
      true
    );
    assert.equal(
      isOfficialEngineHttpMutationForbidden("POST", "/api/operations/production-orders/sync"),
      true
    );
    assert.equal(isOfficialEngineHttpMutationForbidden("GET", "/api/materials"), false);
    assert.equal(isOfficialEngineHttpMutationForbidden("POST", "/api/purchase-requests"), false);
    assert.equal(isOfficialEngineHttpMutationForbidden("POST", "/api/inventory/movements"), false);
    assert.ok(OFFICIAL_ENGINE_MUTATION_FORBIDDEN_API_PREFIXES.length >= 8);
  });

  it("PurchaseModule e inventory UI não mutam APIs oficiais", () => {
    const uiFiles = [
      "src/components/PurchaseModule.tsx",
      "src/components/contextual/PurchaseIndicatorsDashboard.tsx",
      "src/components/inventory/InventoryItemsTab.tsx",
      "src/components/inventory/InventoryMovementsTab.tsx",
    ];
    for (const rel of uiFiles) {
      const src = readFileSync(join(REPO_ROOT, rel), "utf8");
      const forbidden = findForbiddenOfficialEngineHttpMutations(src);
      assert.deepEqual(
        forbidden,
        [],
        `${rel}: ${forbidden.map((f) => `${f.method} ${f.path}`).join(", ")}`
      );
    }
  });

  it("PurchaseModule pode ler /api/materials (GET)", () => {
    const src = readFileSync(join(REPO_ROOT, "src/components/PurchaseModule.tsx"), "utf8");
    assert.match(src, /\/api\/materials/);
    assert.equal(isOfficialEngineHttpMutationForbidden("GET", "/api/materials"), false);
  });
});

describe("createOfficialEngineReadAdapters — superfície só leitura", () => {
  it("expõe readers e usa proxy que rejeita create no delegate", async () => {
    let materialCreateCalled = false;
    const prismaStub = {
      material: {
        findUnique: async () => ({
          id: "m1",
          code: "MP-1",
          description: "Aço",
          unit: "KG",
          status: "ACTIVE",
        }),
        create: async () => {
          materialCreateCalled = true;
          return {};
        },
      },
      product: {
        findUnique: async () => null,
      },
      productBOM: {
        findMany: async () => [],
      },
      financialSupplier: {
        findUnique: async () => null,
      },
      salesOrder: {
        findUnique: async () => null,
      },
      nomusProductionOrder: {
        findUnique: async () => null,
      },
      financialCostCenter: {
        findUnique: async () => null,
      },
    };

    const adapters = createOfficialEngineReadAdapters(prismaStub as never);
    const mat = await adapters.materials.findById("m1");
    assert.equal(mat?.code, "MP-1");
    assert.equal(materialCreateCalled, false);

    // Acesso direto ao create no stub original ainda existiria; a superfície
    // pública dos adapters não expõe create — só find*.
    assert.equal("create" in adapters.materials, false);
    assert.equal("update" in adapters.materials, false);
    assert.equal("delete" in adapters.productsBom, false);
  });
});
