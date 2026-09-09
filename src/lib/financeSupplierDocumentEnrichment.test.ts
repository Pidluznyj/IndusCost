/**
 * Preenchimento seguro do documento (CNPJ) do FinancialSupplier a partir da
 * evidência oficial — nunca inventa, nunca sobrescreve, nunca por nome.
 * Prisma substituído por duplo em memória; nenhum banco.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION,
  FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT,
} from "./financeSupplierRebuildShared.js";
import { groupAccountsPayableSuppliers } from "./financeSupplierIdentity.js";
import {
  applyFinancialSuppliersFromAccountsPayable,
  buildFinancialSuppliersFromAccountsPayablePreview,
  buildNomusOrderDocumentIndex,
  buildSupplierMatchIndex,
  planSupplierDocumentEnrichment,
  type ExistingFinancialSupplierAliasRow,
  type ExistingFinancialSupplierRow,
  type FinanceSupplierRebuildApRow,
  type FinanceSupplierRebuildDeps,
  type NomusOrderSupplierDocumentRow,
} from "./financeSupplierRebuild.js";

type MockState = {
  apRows: FinanceSupplierRebuildApRow[];
  suppliers: ExistingFinancialSupplierRow[];
  aliases: ExistingFinancialSupplierAliasRow[];
  auditLogs: Array<Record<string, unknown>>;
  nomusDocs?: NomusOrderSupplierDocumentRow[];
};

function supplier(overrides: Partial<ExistingFinancialSupplierRow> = {}): ExistingFinancialSupplierRow {
  return {
    id: overrides.id ?? "supplier-1",
    displayName: overrides.displayName ?? "Fornecedor",
    legalName: overrides.legalName ?? null,
    tradeName: overrides.tradeName ?? null,
    document: overrides.document ?? null,
    normalizedDocument: overrides.normalizedDocument ?? null,
    normalizedName: overrides.normalizedName ?? null,
    source: overrides.source ?? "NOMUS_BOOTSTRAP",
    status: overrides.status ?? "ACTIVE",
    confidence: overrides.confidence ?? null,
    firstSeenAt: overrides.firstSeenAt ?? null,
    lastSeenAt: overrides.lastSeenAt ?? null,
    titlesCount: overrides.titlesCount ?? 0,
    totalAmountSeen: overrides.totalAmountSeen ?? new Prisma.Decimal(0),
    aliases: overrides.aliases ?? [],
  };
}

function alias(
  supplierId: string,
  externalSupplierId: number | null,
  overrides: Partial<ExistingFinancialSupplierAliasRow> = {}
): ExistingFinancialSupplierAliasRow {
  return {
    id: overrides.id ?? `alias-${supplierId}-${externalSupplierId ?? "n"}`,
    supplierId,
    source: overrides.source ?? "AUTO_SYNC",
    externalSupplierId,
    originalName: overrides.originalName ?? null,
    originalDocument: overrides.originalDocument ?? null,
    normalizedName: overrides.normalizedName ?? null,
    normalizedDocument: overrides.normalizedDocument ?? null,
    firstSeenAt: null,
    lastSeenAt: null,
    titlesCount: overrides.titlesCount ?? 1,
  };
}

function withAliases(state: MockState, row: ExistingFinancialSupplierRow): ExistingFinancialSupplierRow {
  return {
    ...row,
    aliases: state.aliases.filter((a) => a.supplierId === row.id).map((a) => ({ ...a })),
  };
}

function createMockDeps(state: MockState): FinanceSupplierRebuildDeps {
  return {
    loadApRows: async () => state.apRows.map((row) => ({ ...row })),
    loadExistingSuppliers: async () => state.suppliers.map((row) => withAliases(state, row)),
    loadNomusOrderSupplierDocuments: async () => (state.nomusDocs ?? []).map((row) => ({ ...row })),
    createSupplier: async (data) => {
      const row = supplier({
        id: `supplier-${state.suppliers.length + 1}`,
        displayName: String(data.displayName),
        legalName: (data.legalName as string | null) ?? null,
        tradeName: (data.tradeName as string | null) ?? null,
        document: (data.document as string | null) ?? null,
        normalizedDocument: (data.normalizedDocument as string | null) ?? null,
        normalizedName: (data.normalizedName as string | null) ?? null,
        source: (data.source as ExistingFinancialSupplierRow["source"]) ?? "NOMUS_BOOTSTRAP",
        status: (data.status as ExistingFinancialSupplierRow["status"]) ?? "ACTIVE",
        titlesCount: (data.titlesCount as number) ?? 0,
      });
      state.suppliers.push(row);
      return withAliases(state, row);
    },
    updateSupplier: async (id, data) => {
      const idx = state.suppliers.findIndex((s) => s.id === id);
      assert.ok(idx >= 0, "supplier not found");
      const current = state.suppliers[idx]!;
      const patch: Partial<ExistingFinancialSupplierRow> = {};
      for (const key of [
        "displayName",
        "legalName",
        "tradeName",
        "document",
        "normalizedDocument",
        "normalizedName",
        "source",
        "status",
        "titlesCount",
        "totalAmountSeen",
        "firstSeenAt",
        "lastSeenAt",
      ] as const) {
        if (key in data) (patch as Record<string, unknown>)[key] = (data as Record<string, unknown>)[key];
      }
      const updated = { ...current, ...patch } as ExistingFinancialSupplierRow;
      state.suppliers[idx] = updated;
      return withAliases(state, updated);
    },
    createAlias: async (data) => {
      const supplierId =
        typeof data.supplier === "object" && data.supplier && "connect" in data.supplier && data.supplier.connect
          ? String(data.supplier.connect.id)
          : "unknown";
      const row = alias(supplierId, (data.externalSupplierId as number | null) ?? null, {
        id: `alias-${state.aliases.length + 1}`,
        originalName: (data.originalName as string | null) ?? null,
        originalDocument: (data.originalDocument as string | null) ?? null,
        normalizedName: (data.normalizedName as string | null) ?? null,
        normalizedDocument: (data.normalizedDocument as string | null) ?? null,
      });
      state.aliases.push(row);
      return row;
    },
    updateAlias: async (id, data) => {
      const idx = state.aliases.findIndex((a) => a.id === id);
      assert.ok(idx >= 0, "alias not found");
      const updated = { ...state.aliases[idx]!, ...(data as Partial<ExistingFinancialSupplierAliasRow>) };
      state.aliases[idx] = updated;
      return updated;
    },
    createAuditLog: async (data) => {
      state.auditLogs.push({ ...data });
    },
  };
}

const USER = { confirmationText: FINANCE_SUPPLIER_REBUILD_CONFIRMATION_TEXT, userId: "u1", userName: "User" };

const AP_A_NO_CNPJ: FinanceSupplierRebuildApRow = { externalId: 1, personId: 10, personName: "Fornecedor Alpha", amountPayable: 100 };
const AP_B_CNPJ: FinanceSupplierRebuildApRow = {
  externalId: 2,
  personId: 10,
  personName: "Fornecedor Alpha LTDA",
  personCnpj: "12.345.678/0001-90",
  amountPayable: 50,
};
const AP_C_OTHER: FinanceSupplierRebuildApRow = { externalId: 3, personId: 10, personName: "Alpha", personCnpj: "98.765.432/0001-10" };

function enrichAudits(state: MockState) {
  return state.auditLogs.filter((log) => log.action === FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.DOCUMENT_ENRICH);
}

describe("preenchimento seguro do documento do fornecedor", () => {
  it("1. AUTO_SYNC sem documento + alias Nomus + [A sem CNPJ, B com CNPJ] → SAFE_FILL na prévia e no apply, com auditoria", async () => {
    const state: MockState = {
      apRows: [AP_A_NO_CNPJ, AP_B_CNPJ],
      suppliers: [supplier({ id: "s1", displayName: "Fornecedor Alpha", source: "AUTO_SYNC", normalizedName: "fornecedor alpha" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    const item = preview.items.find((i) => i.identityKey === "nomus-id:10");
    assert.ok(item);
    assert.equal(item.existingSupplierId, "s1");
    assert.equal(item.documentEnrichment.action, "SAFE_FILL");
    assert.equal(item.documentEnrichment.proposedDocument, "12.345.678/0001-90");
    assert.equal(item.documentEnrichment.proposedNormalizedDocument, "12345678000190");
    assert.ok(item.documentEnrichment.evidence.includes("EXTERNAL_SUPPLIER_ID:10"));
    assert.ok(item.documentEnrichment.evidence.includes("AP_DOCUMENT:12345678000190"));
    assert.equal(preview.documentSafeFills, 1);
    assert.equal(state.suppliers[0]!.document, null, "prévia não grava");

    const result = await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(result.documentSafeFills, 1);
    const updated = state.suppliers.find((s) => s.id === "s1")!;
    assert.equal(updated.document, "12.345.678/0001-90");
    assert.equal(updated.normalizedDocument, "12345678000190");
    assert.equal(enrichAudits(state).length, 1);
    const audit = enrichAudits(state)[0]!;
    assert.deepEqual(audit.beforeJson, { document: null, normalizedDocument: null });
    assert.equal((audit.afterJson as { normalizedDocument: string }).normalizedDocument, "12345678000190");

    // Idempotente: segunda execução é NO_CHANGE e não gera nova auditoria de documento.
    const second = await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(second.documentSafeFills, 0);
    assert.equal(enrichAudits(state).length, 1);
    assert.equal(state.suppliers.find((s) => s.id === "s1")!.document, "12.345.678/0001-90");
  });

  it("2. ordem invertida do AP produz o mesmo preenchimento", async () => {
    const state: MockState = {
      apRows: [AP_B_CNPJ, AP_A_NO_CNPJ],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
    };
    await applyFinancialSuppliersFromAccountsPayable(createMockDeps(state), USER);
    assert.equal(state.suppliers[0]!.normalizedDocument, "12345678000190");
  });

  it("3. documento existente DIFERENTE da evidência → CONFLICT, nada sobrescrito", async () => {
    const state: MockState = {
      apRows: [AP_B_CNPJ],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC", document: "11.111.111/0001-11", normalizedDocument: "11111111000111" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    const plan = preview.items[0]!.documentEnrichment;
    assert.equal(plan.action, "CONFLICT");
    assert.ok(plan.conflicts.some((c) => c.startsWith("EXISTING_DOCUMENT_DIFFERS:")));
    assert.ok(preview.warnings.includes("DOCUMENT_CONFLICTS:1"));
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers[0]!.document, "11.111.111/0001-11");
    assert.equal(enrichAudits(state).length, 0);
  });

  it("4. AP sem documento nunca apaga o documento existente (NO_CHANGE)", async () => {
    const state: MockState = {
      apRows: [AP_A_NO_CNPJ],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC", document: "12345678000190", normalizedDocument: "12345678000190" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    assert.equal(preview.items[0]!.documentEnrichment.action, "NO_CHANGE");
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers[0]!.document, "12345678000190");
    assert.equal(state.suppliers[0]!.status, "ACTIVE");
  });

  it("5. MANUAL sem documento: stats_only continua, mas o documento é preenchido de forma aditiva e auditada", async () => {
    const state: MockState = {
      apRows: [AP_A_NO_CNPJ, AP_B_CNPJ],
      suppliers: [supplier({ id: "m1", displayName: "Nome Manual Preservado", source: "MANUAL" })],
      aliases: [alias("m1", 10, { source: "MANUAL" })],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    assert.equal(preview.items[0]!.action, "stats_only");
    assert.equal(preview.items[0]!.statsOnlyBecauseManual, true);
    assert.equal(preview.items[0]!.documentEnrichment.action, "SAFE_FILL");

    const result = await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(result.statsOnlyUpdates, 1);
    const manual = state.suppliers[0]!;
    assert.equal(manual.displayName, "Nome Manual Preservado");
    assert.equal(manual.source, "MANUAL");
    assert.equal(manual.document, "12.345.678/0001-90");
    assert.equal(manual.normalizedDocument, "12345678000190");
    assert.equal(manual.titlesCount, 2);
    assert.equal(enrichAudits(state).length, 1);
    assert.ok(state.auditLogs.some((log) => log.action === FINANCE_SUPPLIER_REBUILD_AUDIT_ACTION.STATS_UPDATE));
  });

  it("6. MANUAL com documento diferente do AP → CONFLICT, documento manual intocado", async () => {
    const state: MockState = {
      apRows: [AP_B_CNPJ],
      suppliers: [supplier({ id: "m1", source: "MANUAL", document: "11.111.111/0001-11", normalizedDocument: "11111111000111" })],
      aliases: [alias("m1", 10, { source: "MANUAL" })],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    assert.equal(preview.items[0]!.documentEnrichment.action, "CONFLICT");
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers[0]!.document, "11.111.111/0001-11");
  });

  it("7. CNPJ já pertence a OUTRO fornecedor → CONFLICT, sem merge e sem duplicar o documento", async () => {
    const state: MockState = {
      apRows: [AP_B_CNPJ],
      suppliers: [
        supplier({ id: "owner", displayName: "Dono do CNPJ", document: "12345678000190", normalizedDocument: "12345678000190" }),
        supplier({ id: "s2", displayName: "Alias sem doc", source: "AUTO_SYNC" }),
      ],
      aliases: [alias("s2", 10)],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    const item = preview.items[0]!;
    assert.equal(item.existingSupplierId, "s2", "alias tem prioridade no matching");
    assert.equal(item.documentEnrichment.action, "CONFLICT");
    assert.ok(item.documentEnrichment.conflicts.includes("DOCUMENT_OWNED_BY_OTHER_SUPPLIER:owner"));
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers.length, 2, "nenhum merge");
    assert.equal(state.suppliers.find((s) => s.id === "s2")!.document, null);
    assert.equal(state.suppliers.find((s) => s.id === "owner")!.document, "12345678000190");
  });

  it("8. match só por NOME nunca autoriza o preenchimento (UNRESOLVED)", async () => {
    const state: MockState = {
      apRows: [AP_B_CNPJ],
      suppliers: [supplier({ id: "n1", displayName: "Fornecedor Alpha LTDA", source: "AUTO_SYNC", normalizedName: "fornecedor alpha ltda" })],
      aliases: [],
      auditLogs: [],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    const item = preview.items[0]!;
    assert.equal(item.existingSupplierId, "n1");
    assert.equal(item.documentEnrichment.action, "UNRESOLVED");
    assert.ok(item.documentEnrichment.conflicts.some((c) => c.startsWith("EXTERNAL_ID_NOT_LINKED_TO_SUPPLIER:")));
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers[0]!.document, null);
    assert.equal(enrichAudits(state).length, 0);
  });

  it("9. evidência do espelho de Pedidos Nomus (mesmo supplierExternalId) preenche quando o AP não traz CNPJ", async () => {
    const state: MockState = {
      apRows: [AP_A_NO_CNPJ],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
      nomusDocs: [{ supplierExternalId: 10, supplierTaxId: "12.345.678/0001-90" }, { supplierExternalId: 99, supplierTaxId: "00.000.000/0000-00" }],
    };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    const plan = preview.items[0]!.documentEnrichment;
    assert.equal(plan.action, "SAFE_FILL");
    assert.ok(plan.evidence.includes("NOMUS_ORDER_DOCUMENT:12345678000190"));
    assert.equal(plan.proposedDocument, "12345678000190", "sem grafia AP → dígitos canônicos");
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers[0]!.normalizedDocument, "12345678000190");
  });

  it("10. AP e Pedidos Nomus com CNPJs diferentes → CONFLICT", async () => {
    const state: MockState = {
      apRows: [AP_B_CNPJ],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
      nomusDocs: [{ supplierExternalId: 10, supplierTaxId: "98765432000110" }],
    };
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(createMockDeps(state));
    const plan = preview.items[0]!.documentEnrichment;
    assert.equal(plan.action, "CONFLICT");
    assert.deepEqual(plan.documentCandidates, ["12345678000190", "98765432000110"]);
  });

  it("11. grupo com dois CNPJs no AP → CONFLICT; criação sem documento e NEEDS_REVIEW", async () => {
    const state: MockState = { apRows: [AP_B_CNPJ, AP_C_OTHER], suppliers: [], aliases: [], auditLogs: [] };
    const deps = createMockDeps(state);
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(deps);
    assert.equal(preview.items[0]!.documentEnrichment.action, "CONFLICT");
    assert.equal(preview.documentConflicts, 1);
    await applyFinancialSuppliersFromAccountsPayable(deps, USER);
    assert.equal(state.suppliers.length, 1);
    assert.equal(state.suppliers[0]!.document, null);
    assert.equal(state.suppliers[0]!.status, "NEEDS_REVIEW");
  });

  it("12. criação com um único CNPJ continua gravando o documento (sem regressão)", async () => {
    const state: MockState = { apRows: [AP_A_NO_CNPJ, AP_B_CNPJ], suppliers: [], aliases: [], auditLogs: [] };
    const result = await applyFinancialSuppliersFromAccountsPayable(createMockDeps(state), USER);
    assert.equal(result.newSuppliers, 1);
    assert.equal(state.suppliers[0]!.document, "12.345.678/0001-90");
    assert.equal(state.suppliers[0]!.normalizedDocument, "12345678000190");
    assert.equal(state.suppliers[0]!.status, "ACTIVE");
  });

  it("13. documento com tamanho inválido → UNRESOLVED (nunca gravado)", async () => {
    const state: MockState = {
      apRows: [{ externalId: 1, personId: 10, personName: "X", personCnpj: "123" }],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
    };
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(createMockDeps(state));
    const plan = preview.items[0]!.documentEnrichment;
    assert.equal(plan.action, "UNRESOLVED");
    assert.ok(plan.conflicts.includes("INVALID_DOCUMENT:123"));
  });

  it("14. sem índice de matching não há SAFE_FILL (fail closed)", () => {
    const [group] = groupAccountsPayableSuppliers([AP_B_CNPJ]);
    const existing = supplier({ id: "s1", aliases: [alias("s1", 10)] });
    const plan = planSupplierDocumentEnrichment({ existing, group: group!, index: null });
    assert.equal(plan.action, "UNRESOLVED");
    assert.ok(plan.conflicts.includes("OWNERSHIP_INDEX_UNAVAILABLE"));
    const safe = planSupplierDocumentEnrichment({ existing, group: group!, index: buildSupplierMatchIndex([existing]) });
    assert.equal(safe.action, "SAFE_FILL");
  });

  it("15. sem nenhuma evidência e sem documento → UNRESOLVED (contado na prévia)", async () => {
    const state: MockState = {
      apRows: [AP_A_NO_CNPJ],
      suppliers: [supplier({ id: "s1", source: "AUTO_SYNC" })],
      aliases: [alias("s1", 10)],
      auditLogs: [],
    };
    const preview = await buildFinancialSuppliersFromAccountsPayablePreview(createMockDeps(state));
    assert.equal(preview.items[0]!.documentEnrichment.action, "UNRESOLVED");
    assert.equal(preview.documentUnresolved, 1);
    assert.equal(preview.documentSafeFills, 0);
  });

  it("16. índice Nomus ignora linhas sem id/documento e deduplica grafias", () => {
    const index = buildNomusOrderDocumentIndex([
      { supplierExternalId: 10, supplierTaxId: "12.345.678/0001-90" },
      { supplierExternalId: 10, supplierTaxId: "12345678000190" },
      { supplierExternalId: null, supplierTaxId: "1" },
      { supplierExternalId: 11, supplierTaxId: null },
      { supplierExternalId: 11, supplierTaxId: "00000000000000" },
    ]);
    assert.deepEqual(index.get(10), ["12345678000190"]);
    assert.equal(index.has(11), false);
  });

  it("17. o motor de rebuild só escreve documento pelo plano SAFE_FILL (nunca copia o AP às cegas)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/financeSupplierRebuild.ts"), "utf8");
    assert.doesNotMatch(src, /document: extracted\.originalDocument/);
    assert.doesNotMatch(src, /normalizedDocument: extracted\.normalizedDocument,\r?\n\s+normalizedName/);
    assert.match(src, /DOCUMENT_ENRICH/);
    assert.doesNotMatch(src, /nomusPurchaseOrder\.(update|create|delete)/);
  });
});
