import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
} from "./financeSupplierRebuildShared.js";
import {
  applyFinancialSuppliersFromAccountsPayable,
  assertFinanceSupplierRebuildConfirmation,
  buildFinancialSuppliersFromAccountsPayablePreview,
  FinanceSupplierRebuildError,
  type ExistingFinancialSupplierAliasRow,
  type ExistingFinancialSupplierRow,
  type FinanceSupplierRebuildApRow,
  type FinanceSupplierRebuildDeps,
} from "./financeSupplierRebuild.js";

type MockState = {
  apRows: FinanceSupplierRebuildApRow[];
  suppliers: ExistingFinancialSupplierRow[];
  aliases: ExistingFinancialSupplierAliasRow[];
  auditLogs: Array<Record<string, unknown>>;
  apWrites: number;
};

function emptySupplier(overrides: Partial<ExistingFinancialSupplierRow> = {}): ExistingFinancialSupplierRow {
  return {
    id: overrides.id ?? "supplier-1",
    displayName: overrides.displayName ?? "Manual Supplier",
    legalName: overrides.legalName ?? "Manual Supplier",
    tradeName: overrides.tradeName ?? null,
    document: overrides.document ?? null,
    normalizedDocument: overrides.normalizedDocument ?? null,
    normalizedName: overrides.normalizedName ?? null,
    source: overrides.source ?? "MANUAL",
    status: overrides.status ?? "ACTIVE",
    confidence: overrides.confidence ?? null,
    firstSeenAt: overrides.firstSeenAt ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    titlesCount: overrides.titlesCount ?? 0,
    totalAmountSeen: overrides.totalAmountSeen ?? new Prisma.Decimal(0),
    aliases: overrides.aliases ?? [],
  };
}

function createMockDeps(state: MockState): FinanceSupplierRebuildDeps {
  return {
    loadApRows: async () => state.apRows.map((row) => ({ ...row })),
    loadExistingSuppliers: async () =>
      state.suppliers.map((supplier) => ({
        ...supplier,
        aliases: state.aliases
          .filter((alias) => alias.supplierId === supplier.id)
          .map((alias) => ({ ...alias })),
      })),
    createSupplier: async (data) => {
      const id = `supplier-${state.suppliers.length + 1}`;
      const row = emptySupplier({
        id,
        displayName: String(data.displayName),
        legalName: (data.legalName as string | null) ?? null,
        tradeName: (data.tradeName as string | null) ?? null,
        document: (data.document as string | null) ?? null,
        normalizedDocument: (data.normalizedDocument as string | null) ?? null,
        normalizedName: (data.normalizedName as string | null) ?? null,
        source: (data.source as ExistingFinancialSupplierRow["source"]) ?? "NOMUS_BOOTSTRAP",
        status: (data.status as ExistingFinancialSupplierRow["status"]) ?? "ACTIVE",
        confidence: (data.confidence as Prisma.Decimal | null) ?? null,
        titlesCount: (data.titlesCount as number) ?? 0,
        totalAmountSeen: (data.totalAmountSeen as Prisma.Decimal) ?? new Prisma.Decimal(0),
        aliases: [],
      });
      state.suppliers.push(row);
      return row;
    },
    updateSupplier: async (id, data) => {
      const idx = state.suppliers.findIndex((s) => s.id === id);
      assert.ok(idx >= 0, "supplier not found");
      const current = state.suppliers[idx]!;
      const updated = {
        ...current,
        displayName: (data.displayName as string | undefined) ?? current.displayName,
        legalName: (data.legalName as string | null | undefined) ?? current.legalName,
        tradeName: (data.tradeName as string | null | undefined) ?? current.tradeName,
        document: (data.document as string | null | undefined) ?? current.document,
        normalizedDocument:
          (data.normalizedDocument as string | null | undefined) ?? current.normalizedDocument,
        normalizedName: (data.normalizedName as string | null | undefined) ?? current.normalizedName,
        source: (data.source as ExistingFinancialSupplierRow["source"] | undefined) ?? current.source,
        status: (data.status as ExistingFinancialSupplierRow["status"] | undefined) ?? current.status,
        confidence: (data.confidence as Prisma.Decimal | null | undefined) ?? current.confidence,
        titlesCount: (data.titlesCount as number | undefined) ?? current.titlesCount,
        totalAmountSeen:
          (data.totalAmountSeen as Prisma.Decimal | undefined) ?? current.totalAmountSeen,
        firstSeenAt: (data.firstSeenAt as Date | null | undefined) ?? current.firstSeenAt,
        lastSeenAt: (data.lastSeenAt as Date | null | undefined) ?? current.lastSeenAt,
      };
      state.suppliers[idx] = updated;
      return {
        ...updated,
        aliases: state.aliases.filter((alias) => alias.supplierId === id).map((a) => ({ ...a })),
      };
    },
    createAlias: async (data) => {
      const supplierId =
        typeof data.supplier === "object" &&
        data.supplier != null &&
        "connect" in data.supplier &&
        data.supplier.connect &&
        typeof data.supplier.connect.id === "string"
          ? data.supplier.connect.id
          : "unknown";
      const alias: ExistingFinancialSupplierAliasRow = {
        id: `alias-${state.aliases.length + 1}`,
        supplierId,
        source: (data.source as ExistingFinancialSupplierAliasRow["source"]) ?? "AUTO_SYNC",
        externalSupplierId: (data.externalSupplierId as number | null) ?? null,
        originalName: (data.originalName as string | null) ?? null,
        originalDocument: (data.originalDocument as string | null) ?? null,
        normalizedName: (data.normalizedName as string | null) ?? null,
        normalizedDocument: (data.normalizedDocument as string | null) ?? null,
        firstSeenAt: (data.firstSeenAt as Date | null) ?? null,
        lastSeenAt: (data.lastSeenAt as Date | null) ?? null,
        titlesCount: (data.titlesCount as number) ?? 1,
      };
      state.aliases.push(alias);
      return alias;
    },
    updateAlias: async (id, data) => {
      const idx = state.aliases.findIndex((alias) => alias.id === id);
      assert.ok(idx >= 0, "alias not found");
      const current = state.aliases[idx]!;
      const updated = {
        ...current,
        originalName: (data.originalName as string | null | undefined) ?? current.originalName,
        originalDocument:
          (data.originalDocument as string | null | undefined) ?? current.originalDocument,
        normalizedName: (data.normalizedName as string | null | undefined) ?? current.normalizedName,
        normalizedDocument:
          (data.normalizedDocument as string | null | undefined) ?? current.normalizedDocument,
        externalSupplierId:
          (data.externalSupplierId as number | null | undefined) ?? current.externalSupplierId,
        source: (data.source as ExistingFinancialSupplierAliasRow["source"] | undefined) ?? current.source,
        titlesCount: (data.titlesCount as number | undefined) ?? current.titlesCount,
        lastSeenAt: (data.lastSeenAt as Date | null | undefined) ?? current.lastSeenAt,
      };
      state.aliases[idx] = updated;
      return updated;
    },
    createAuditLog: async (data) => {
      state.auditLogs.push({ ...data });
    },
  };
}

const sampleApRows: FinanceSupplierRebuildApRow[] = [
  {
    externalId: 1,
    personId: 10,
    personName: "Fornecedor Alpha",
    personCnpj: "12.345.678/0001-90",
    amountPayable: 1000,
  },
  {
    externalId: 2,
    personId: 10,
    personName: "Fornecedor Alpha LTDA",
    personCnpj: "12345678000190",
    amountPayable: 500,
  },
];

describe("financeSupplierRebuild", () => {
  it("1. preview não grava dados", async () => {
    const state: MockState = {
      apRows: sampleApRows,
      suppliers: [],
      aliases: [],
      auditLogs: [],
      apWrites: 0,
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    assert.equal(state.suppliers.length, 0);
    assert.equal(state.aliases.length, 0);
    assert.equal(state.auditLogs.length, 0);
    assert.equal(preview.totalTitlesAnalyzed, 2);
    assert.equal(preview.suppliersDetected, 1);
    assert.equal(preview.newSuppliers, 1);
  });

  it("2. apply exige confirmação correta", () => {
    assert.doesNotThrow(() =>
      assertFinanceSupplierRebuildConfirmation(FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT)
    );
  });

  it("3. apply com confirmação errada falha", async () => {
    const deps = createMockDeps({
      apRows: sampleApRows,
      suppliers: [],
      aliases: [],
      auditLogs: [],
      apWrites: 0,
    });
    await assert.rejects(
      () =>
        applyFinancialSuppliersFromAccountsPayable(deps, {
          confirmationText: "CONFIRMAR",
          userId: "u1",
          userName: "User",
        }),
      (error: unknown) =>
        error instanceof FinanceSupplierRebuildError && error.code === "INVALID_CONFIRMATION"
    );
  });

  it("4. apply cria fornecedores", async () => {
    const state: MockState = {
      apRows: sampleApRows,
      suppliers: [],
      aliases: [],
      auditLogs: [],
      apWrites: 0,
    };
    const deps = createMockDeps(state);
    const result = await applyFinancialSuppliersFromAccountsPayable(deps, {
      confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
      userId: "u1",
      userName: "User",
    });
    assert.equal(result.newSuppliers, 1);
    assert.equal(state.suppliers.length, 1);
    assert.equal(state.suppliers[0]!.displayName, "Fornecedor Alpha LTDA");
  });

  it("5. apply cria aliases", async () => {
    const state: MockState = {
      apRows: sampleApRows,
      suppliers: [],
      aliases: [],
      auditLogs: [],
      apWrites: 0,
    };
    const deps = createMockDeps(state);
    await applyFinancialSuppliersFromAccountsPayable(deps, {
      confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
      userId: "u1",
      userName: "User",
    });
    assert.equal(state.aliases.length, 2);
  });

  it("6. apply é idempotente", async () => {
    const state: MockState = {
      apRows: sampleApRows,
      suppliers: [],
      aliases: [],
      auditLogs: [],
      apWrites: 0,
    };
    const deps = createMockDeps(state);
    await applyFinancialSuppliersFromAccountsPayable(deps, {
      confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
      userId: "u1",
      userName: "User",
    });
    const firstSupplierCount = state.suppliers.length;
    const firstAliasCount = state.aliases.length;

    const second = await applyFinancialSuppliersFromAccountsPayable(deps, {
      confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
      userId: "u1",
      userName: "User",
    });

    assert.equal(second.newSuppliers, 0);
    assert.equal(state.suppliers.length, firstSupplierCount);
    assert.equal(state.aliases.length, firstAliasCount);
  });

  it("7. fornecedor manual não é sobrescrito indevidamente", async () => {
    const manual = emptySupplier({
      id: "manual-1",
      displayName: "Nome Manual Preservado",
      legalName: "Nome Manual Preservado",
      normalizedDocument: "12345678000190",
      document: "12.345.678/0001-90",
      source: "MANUAL",
      aliases: [
        {
          id: "alias-manual-1",
          supplierId: "manual-1",
          source: "MANUAL",
          externalSupplierId: 10,
          originalName: "Nome Manual Preservado",
          originalDocument: "12.345.678/0001-90",
          normalizedName: null,
          normalizedDocument: "12345678000190",
          firstSeenAt: null,
          lastSeenAt: null,
          titlesCount: 0,
        },
      ],
    });

    const state: MockState = {
      apRows: sampleApRows,
      suppliers: [manual],
      aliases: [...manual.aliases],
      auditLogs: [],
      apWrites: 0,
    };
    const deps = createMockDeps(state);
    await applyFinancialSuppliersFromAccountsPayable(deps, {
      confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
      userId: "u1",
      userName: "User",
    });

    const updated = state.suppliers.find((s) => s.id === "manual-1");
    assert.ok(updated);
    assert.equal(updated!.displayName, "Nome Manual Preservado");
    assert.equal(updated!.source, "MANUAL");
    assert.equal(updated!.titlesCount, 2);
  });

  it("8. AP não é alterado", () => {
    const rebuildSrc = readFileSync(join(process.cwd(), "src/lib/financeSupplierRebuild.ts"), "utf8");
    assert.doesNotMatch(rebuildSrc, /nomusAccountsPayable\.update/);
    assert.doesNotMatch(rebuildSrc, /nomusAccountsPayable\.delete/);
    assert.doesNotMatch(rebuildSrc, /nomusAccountsPayable\.create/);
    assert.match(rebuildSrc, /nomusAccountsPayable\.findMany/);
  });

  it("9. auditoria é criada", async () => {
    const state: MockState = {
      apRows: [sampleApRows[0]!],
      suppliers: [],
      aliases: [],
      auditLogs: [],
      apWrites: 0,
    };
    const deps = createMockDeps(state);
    await applyFinancialSuppliersFromAccountsPayable(deps, {
      confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
      userId: "u1",
      userName: "User",
    });
    assert.ok(state.auditLogs.length >= 2);
    assert.ok(state.auditLogs.some((log) => log.action === "CREATE"));
    assert.ok(state.auditLogs.some((log) => log.action === "BATCH_APPLY"));
  });

  it("10. endpoint usa permissões corretas", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/financeSuppliersRoutes.ts"), "utf8");
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(routes, /\/api\/finance\/suppliers\/rebuild-from-ap-preview/);
    assert.match(routes, /\/api\/finance\/suppliers\/rebuild-from-ap-apply/);
    assert.match(routes, /FINANCE_SUPPLIERS_PREVIEW_PERMISSIONS/);
    assert.match(routes, /finance\.suppliers\.view/);
    assert.match(routes, /FINANCE_SUPPLIERS_APPLY_PERMISSIONS/);
    assert.match(routes, /finance\.suppliers\.manage/);
    assert.match(server, /registerFinanceSuppliersRoutes/);
  });
});
