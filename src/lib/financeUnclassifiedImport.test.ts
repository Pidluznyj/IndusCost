import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  applyUnclassifiedImport,
  buildUnclassifiedExportGroups,
  buildUnclassifiedExportRows,
  buildUnclassifiedExportWorkbook,
  buildUnclassifiedImportPreview,
  detectSensitiveCounterparty,
  FINANCE_UNCLASSIFIED_IMPORT_COLUMNS,
  FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT,
  parsePercentual,
  parseSimNao,
  parseSupplierAction,
  parseUnclassifiedImportWorkbook,
  type FinanceUnclassifiedImportApplyDeps,
  type FinanceUnclassifiedRawRow,
  type FinanceUnclassifiedValidationContext,
} from "./financeUnclassifiedImport.js";
import type { UnclassifiedItem } from "./financeAccountsPayableCostCenterAllocation.js";

function buildContext(
  overrides?: Partial<FinanceUnclassifiedValidationContext>
): FinanceUnclassifiedValidationContext {
  const costCentersByCode = new Map([
    ["CC-001", { id: "cc-1", name: "Produção", status: "ACTIVE" }],
    ["CC-INATIVO", { id: "cc-2", name: "Antigo", status: "INACTIVE" }],
  ]);
  const suppliersById = new Map([
    ["sup-1", { id: "sup-1", displayName: "Fornecedor A", status: "ACTIVE" }],
  ]);
  return { costCentersByCode, suppliersById, ...overrides };
}

function baseRow(over: Partial<FinanceUnclassifiedRawRow>): FinanceUnclassifiedRawRow {
  return {
    causa: "Fornecedor sem regra ativa",
    personIdNomus: "101",
    personNameNomus: "Fornecedor A",
    documentoNomus: "11.222.333/0001-44",
    titulosQuantidade: "3",
    valorTotal: "1000",
    financialSupplierId: "sup-1",
    financialSupplierName: "Fornecedor A",
    financialSupplierDocument: "11222333000144",
    acaoFornecedor: "USAR_EXISTENTE",
    centroCustoCodigo: "CC-001",
    centroCustoNome: "",
    percentual: "100",
    autoApply: "SIM",
    observacao: "",
    aplicar: "SIM",
    ...over,
  };
}

describe("financeUnclassifiedImport — helpers puros", () => {
  it("parseSimNao normaliza variações", () => {
    assert.equal(parseSimNao("Sim"), "SIM");
    assert.equal(parseSimNao("x"), "SIM");
    assert.equal(parseSimNao("NÃO"), "NAO");
    assert.equal(parseSimNao(""), null);
    assert.equal(parseSimNao("talvez"), null);
  });

  it("parsePercentual aceita vírgula e %", () => {
    assert.equal(parsePercentual("100"), 100);
    assert.equal(parsePercentual("50,5"), 50.5);
    assert.equal(parsePercentual("30%"), 30);
    assert.equal(parsePercentual(""), null);
    assert.equal(parsePercentual("abc"), null);
  });

  it("parseSupplierAction valida domínio", () => {
    assert.equal(parseSupplierAction("usar_existente"), "USAR_EXISTENTE");
    assert.equal(parseSupplierAction("CRIAR NOVO"), "CRIAR_NOVO");
    assert.equal(parseSupplierAction("IGNORAR"), "IGNORAR");
    assert.equal(parseSupplierAction("xpto"), null);
  });

  it("detectSensitiveCounterparty sinaliza casos sensíveis", () => {
    assert.equal(detectSensitiveCounterparty({ personName: "RECEITA FEDERAL" }).sensitive, true);
    assert.equal(detectSensitiveCounterparty({ personName: "Conta Administrativa Geral" }).sensitive, true);
    assert.equal(detectSensitiveCounterparty({ personName: "Sócio João" }).sensitive, true);
    assert.equal(detectSensitiveCounterparty({ personName: "Fornecedor Comum Ltda" }).sensitive, false);
  });
});

describe("financeUnclassifiedImport — export", () => {
  it("gera colunas esperadas na planilha", () => {
    const items: UnclassifiedItem[] = [
      {
        externalId: 1,
        titleAmount: 100,
        companyName: "Empresa",
        personName: "Fornecedor A",
        cause: "SUPPLIER_NO_RULE",
        supplierId: "sup-1",
        supplierName: "Fornecedor A",
      },
      {
        externalId: 2,
        titleAmount: 50,
        companyName: "Empresa",
        personName: "Fornecedor A",
        cause: "SUPPLIER_NO_RULE",
        supplierId: "sup-1",
        supplierName: "Fornecedor A",
      },
    ];
    const personInfo = new Map([
      [1, { personId: 101, personCnpj: "11222333000144" }],
      [2, { personId: 101, personCnpj: "11222333000144" }],
    ]);
    const supplierDocs = new Map([["sup-1", "11222333000144"]]);

    const groups = buildUnclassifiedExportGroups(items, personInfo, supplierDocs);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].titulosQuantidade, 2);
    assert.equal(groups[0].valorTotal, 150);
    assert.equal(groups[0].personIdNomus, 101);

    const rows = buildUnclassifiedExportRows(groups);
    const wb = buildUnclassifiedExportWorkbook(rows);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);
    const headers = Object.keys(json[0]);
    for (const column of FINANCE_UNCLASSIFIED_IMPORT_COLUMNS) {
      assert.ok(headers.includes(column), `coluna ${column} ausente`);
    }
  });

  it("planilha exportada pode ser reaberta no parser", () => {
    const items: UnclassifiedItem[] = [
      {
        externalId: 1,
        titleAmount: 100,
        companyName: null,
        personName: "Fornecedor A",
        cause: "NO_SUPPLIER",
        supplierId: null,
        supplierName: null,
      },
    ];
    const groups = buildUnclassifiedExportGroups(items, new Map(), new Map());
    const rows = buildUnclassifiedExportRows(groups);
    const wb = buildUnclassifiedExportWorkbook(rows);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
    const parsed = parseUnclassifiedImportWorkbook(bytes);
    assert.equal(parsed.rows.length, 1);
    assert.equal(String(parsed.rows[0].causa), "Fornecedor não casado");
  });
});

describe("financeUnclassifiedImport — preview", () => {
  it("valida centro de custo inexistente", () => {
    const preview = buildUnclassifiedImportPreview(
      [baseRow({ centroCustoCodigo: "NAO-EXISTE" })],
      buildContext()
    );
    assert.equal(preview.invalidLines, 1);
    assert.ok(preview.lines[0].errors.some((e) => e.includes("não encontrado")));
  });

  it("valida centro de custo inativo", () => {
    const preview = buildUnclassifiedImportPreview(
      [baseRow({ centroCustoCodigo: "CC-INATIVO" })],
      buildContext()
    );
    assert.equal(preview.invalidLines, 1);
    assert.ok(preview.lines[0].errors.some((e) => e.includes("inativo")));
  });

  it("valida percentual inválido", () => {
    const preview = buildUnclassifiedImportPreview(
      [baseRow({ percentual: "150" })],
      buildContext()
    );
    assert.equal(preview.invalidLines, 1);
    assert.ok(preview.lines[0].errors.some((e) => e.includes("entre 0 e 100")));
  });

  it("USAR_EXISTENTE exige fornecedor existente", () => {
    const preview = buildUnclassifiedImportPreview(
      [baseRow({ financialSupplierId: "inexistente" })],
      buildContext()
    );
    assert.equal(preview.invalidLines, 1);
    assert.ok(preview.lines[0].errors.some((e) => e.includes("não existe")));
  });

  it("linha válida sem caso sensível conta como válida", () => {
    const preview = buildUnclassifiedImportPreview([baseRow({})], buildContext());
    assert.equal(preview.validLines, 1);
    assert.equal(preview.rulesToCreate, 1);
    assert.equal(preview.suppliersToLink, 1);
    assert.equal(preview.requiredConfirmationText, FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT);
  });

  it("aplicar = NAO marca a linha como ignorada", () => {
    const preview = buildUnclassifiedImportPreview([baseRow({ aplicar: "NAO" })], buildContext());
    assert.equal(preview.skippedLines, 1);
    assert.equal(preview.validLines, 0);
  });

  it("caso sensível exige confirmação (NEEDS_CONFIRMATION)", () => {
    const preview = buildUnclassifiedImportPreview(
      [baseRow({ personNameNomus: "RECEITA FEDERAL DO BRASIL", financialSupplierId: "sup-1" })],
      buildContext()
    );
    assert.equal(preview.sensitiveRequiringConfirmation, 1);
    assert.equal(preview.lines[0].status, "NEEDS_CONFIRMATION");
  });

  it("CRIAR_NOVO exige nome ou documento", () => {
    const preview = buildUnclassifiedImportPreview(
      [
        baseRow({
          acaoFornecedor: "CRIAR_NOVO",
          financialSupplierId: "",
          personNameNomus: "",
          documentoNomus: "",
        }),
      ],
      buildContext()
    );
    assert.equal(preview.invalidLines, 1);
  });
});

describe("financeUnclassifiedImport — apply", () => {
  function buildApplyDeps(
    overrides?: Partial<FinanceUnclassifiedImportApplyDeps>
  ): {
    deps: FinanceUnclassifiedImportApplyDeps;
    calls: {
      rules: Array<{ supplierId: string; costCenterId: string; percentage: number }>;
      created: string[];
      applied: string[];
    };
  } {
    const calls = {
      rules: [] as Array<{ supplierId: string; costCenterId: string; percentage: number }>,
      created: [] as string[],
      applied: [] as string[],
    };
    const deps: FinanceUnclassifiedImportApplyDeps = {
      resolveCostCenterByCode: async (code) =>
        code === "CC-001" ? { id: "cc-1", name: "Produção", status: "ACTIVE" } : null,
      findSupplierById: async (id) =>
        id === "sup-1" ? { id: "sup-1", displayName: "Fornecedor A", status: "ACTIVE" } : null,
      createSupplierForPerson: async (person) => {
        const id = `new-${person.personId ?? person.personName}`;
        calls.created.push(id);
        return { id, displayName: person.personName ?? "Novo" };
      },
      createRule: async (input) => {
        calls.rules.push({
          supplierId: input.supplierId,
          costCenterId: input.costCenterId,
          percentage: input.percentage,
        });
      },
      applyAllocationsForSupplier: async (supplierId) => {
        calls.applied.push(supplierId);
        return { created: 3, replaced: 0, skippedManualLocked: 1 };
      },
      ...overrides,
    };
    return { deps, calls };
  }

  const user = { userId: "u1", userName: "Tester" };

  it("rejeita confirmação inválida", async () => {
    const { deps } = buildApplyDeps();
    await assert.rejects(
      () =>
        applyUnclassifiedImport(deps, [baseRow({})], buildContext(), { confirmationText: "x" }, user),
      /Confirmação inválida/
    );
  });

  it("cria regra para fornecedor existente e aplica alocações", async () => {
    const { deps, calls } = buildApplyDeps();
    const result = await applyUnclassifiedImport(
      deps,
      [baseRow({})],
      buildContext(),
      { confirmationText: FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT },
      user
    );
    assert.equal(result.rulesCreated, 1);
    assert.equal(calls.rules[0].supplierId, "sup-1");
    assert.equal(calls.rules[0].costCenterId, "cc-1");
    assert.equal(result.titlesAllocated, 3);
    // respeita manual locked: contabiliza ignorados, não sobrescreve
    assert.equal(result.titlesIgnoredManualLocked, 1);
  });

  it("casa/cria fornecedor quando CRIAR_NOVO", async () => {
    const { deps, calls } = buildApplyDeps();
    const result = await applyUnclassifiedImport(
      deps,
      [
        baseRow({
          acaoFornecedor: "CRIAR_NOVO",
          financialSupplierId: "",
          personNameNomus: "Fornecedor Novo Ltda",
          documentoNomus: "99888777000166",
        }),
      ],
      buildContext(),
      { confirmationText: FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT },
      user
    );
    assert.equal(result.suppliersCreated, 1);
    assert.equal(calls.created.length, 1);
    assert.equal(result.rulesCreated, 1);
  });

  it("não aplica linhas sensíveis sem confirmação e não cria regra", async () => {
    const { deps, calls } = buildApplyDeps();
    const result = await applyUnclassifiedImport(
      deps,
      [baseRow({ personNameNomus: "RECEITA FEDERAL" })],
      buildContext(),
      { confirmationText: FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT },
      user
    );
    assert.equal(result.skippedSensitiveUnconfirmed, 1);
    assert.equal(result.rulesCreated, 0);
    assert.equal(calls.rules.length, 0);
  });

  it("aplica linhas sensíveis quando confirmSensitive = true", async () => {
    const { deps } = buildApplyDeps();
    const result = await applyUnclassifiedImport(
      deps,
      [baseRow({ personNameNomus: "RECEITA FEDERAL" })],
      buildContext(),
      { confirmationText: FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT, confirmSensitive: true },
      user
    );
    assert.equal(result.rulesCreated, 1);
  });

  it("não aplica linhas inválidas (centro de custo inexistente)", async () => {
    const { deps, calls } = buildApplyDeps();
    const result = await applyUnclassifiedImport(
      deps,
      [baseRow({ centroCustoCodigo: "NAO-EXISTE" })],
      buildContext(),
      { confirmationText: FINANCE_UNCLASSIFIED_IMPORT_CONFIRMATION_TEXT },
      user
    );
    assert.equal(result.rulesCreated, 0);
    assert.equal(calls.applied.length, 0);
    assert.equal(result.lineErrors.length, 1);
  });
});
