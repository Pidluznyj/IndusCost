import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSupplierAliasKey,
  buildSupplierIdentityKey,
  detectPotentialSupplierDuplicates,
  extractSupplierFromAccountsPayable,
  groupAccountsPayableSuppliers,
  normalizeSupplierDocument,
  normalizeSupplierName,
  resolveSupplierConfidence,
  type ExtractedFinanceSupplier,
} from "./financeSupplierIdentity.js";

function assertNoNaNOrUndefined(extracted: ExtractedFinanceSupplier): void {
  assert.notEqual(extracted.confidence, undefined);
  if (extracted.externalSupplierId != null) {
    assert.ok(!Number.isNaN(extracted.externalSupplierId));
  }
  for (const warning of extracted.warnings) {
    assert.notEqual(warning, undefined);
  }
}

function confidenceRank(level: "HIGH" | "MEDIUM" | "LOW"): number {
  if (level === "HIGH") return 3;
  if (level === "MEDIUM") return 2;
  return 1;
}

describe("financeSupplierIdentity", () => {
  it("1. documento com máscara é normalizado", () => {
    assert.equal(normalizeSupplierDocument("12.345.678/0001-90"), "12345678000190");
    assert.equal(normalizeSupplierDocument("123.456.789-09"), "12345678909");
  });

  it("2. CNPJ/CPF vazio vira null", () => {
    assert.equal(normalizeSupplierDocument(""), null);
    assert.equal(normalizeSupplierDocument("   "), null);
    assert.equal(normalizeSupplierDocument(null), null);
    assert.equal(normalizeSupplierDocument("..---"), null);
  });

  it("3. nome com acento/caixa/espaço é normalizado", () => {
    assert.equal(normalizeSupplierName("  ÁCME  COMÉRCIO  "), "acme comercio");
    assert.equal(normalizeSupplierName("Fornecedor Y"), "fornecedor y");
  });

  it("4. mesmo documento agrupa nomes diferentes", () => {
    const groups = groupAccountsPayableSuppliers([
      {
        externalId: 100,
        personCnpj: "12.345.678/0001-90",
        personName: "Fornecedor A",
      },
      {
        externalId: 101,
        personCnpj: "12345678000190",
        personName: "Fornecedor B LTDA",
      },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.identityKey, "doc:12345678000190");
    assert.equal(groups[0]!.recordCount, 2);
  });

  it("5. mesmo nome exato agrupa registros sem documento", () => {
    const groups = groupAccountsPayableSuppliers([
      { externalId: 200, personName: "  ÁCME  " },
      { externalId: 201, personName: "acme" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.identityKey, "name:acme");
  });

  it("6. nome parecido não agrupa", () => {
    const groups = groupAccountsPayableSuppliers([
      { externalId: 300, personName: "FORNECEDOR ALPHA" },
      { externalId: 301, personName: "FORNECEDOR ALPHA LTDA" },
    ]);
    assert.equal(groups.length, 2);
    assert.notEqual(groups[0]!.identityKey, groups[1]!.identityKey);
  });

  it("7. externalSupplierId tem prioridade sobre documento compartilhado", () => {
    const groups = groupAccountsPayableSuppliers([
      {
        externalId: 400,
        personId: 10,
        personCnpj: "12345678000190",
        personName: "A",
      },
      {
        externalId: 401,
        personId: 20,
        personCnpj: "12345678000190",
        personName: "B",
      },
    ]);
    assert.equal(groups.length, 2);
    assert.ok(groups.some((g) => g.identityKey === "nomus-id:10"));
    assert.ok(groups.some((g) => g.identityKey === "nomus-id:20"));

    const key = buildSupplierIdentityKey({
      externalSupplierId: 10,
      normalizedDocument: "12345678000190",
      normalizedName: "a",
    });
    assert.equal(key, "nomus-id:10");
  });

  it("8. nomusRawResponse é lido com segurança quando campos AP estão vazios", () => {
    const extracted = extractSupplierFromAccountsPayable({
      externalId: 500,
      nomusRawResponse: {
        idPessoa: 77,
        nomePessoa: "PIZZA PACK COMERCIO DE EMBALAGENS LTDA",
        cnpjPessoa: "11.222.333/0001-44",
      },
    });
    assert.equal(extracted.externalSupplierId, 77);
    assert.equal(extracted.originalName, "PIZZA PACK COMERCIO DE EMBALAGENS LTDA");
    assert.equal(extracted.normalizedDocument, "11222333000144");
    assert.equal(extracted.source, "RAW_PAYLOAD");
    assertNoNaNOrUndefined(extracted);
  });

  it("9. payload inválido não quebra", () => {
    const cases = [
      { externalId: 600, rawPayload: null },
      { externalId: 601, rawPayload: "invalid" },
      { externalId: 602, rawPayload: [1, 2, 3] },
      { externalId: 603, nomusRawResponse: 42 },
    ] as const;

    for (const record of cases) {
      const extracted = extractSupplierFromAccountsPayable(record);
      assert.ok(Array.isArray(extracted.warnings));
      assert.equal(extracted.source, "FALLBACK");
      assertNoNaNOrUndefined(extracted);
    }
  });

  it("10. confiança menor para fornecedor sem documento", () => {
    const withDoc = resolveSupplierConfidence({
      externalSupplierId: null,
      normalizedDocument: "12345678000190",
      normalizedName: "acme",
      source: "AP_FIELDS",
      warnings: [],
    });
    const nameOnly = resolveSupplierConfidence({
      externalSupplierId: null,
      normalizedDocument: null,
      normalizedName: "acme",
      source: "AP_FIELDS",
      warnings: [],
    });
    const fallback = resolveSupplierConfidence({
      externalSupplierId: null,
      normalizedDocument: null,
      normalizedName: null,
      source: "FALLBACK",
      warnings: ["MISSING_SUPPLIER_IDENTITY"],
    });

    assert.equal(withDoc, "MEDIUM");
    assert.equal(nameOnly, "LOW");
    assert.equal(fallback, "LOW");
    assert.ok(confidenceRank(withDoc) > confidenceRank(nameOnly));
  });

  it("11. não retorna NaN/undefined nos campos extraídos", () => {
    const extracted = extractSupplierFromAccountsPayable({
      externalId: 700,
      personName: "Teste",
      personCnpj: "98.765.432/0001-10",
      rawPayload: { idPessoa: "não-numérico" },
    });
    assert.equal(extracted.externalSupplierId, null);
    assert.equal(extracted.normalizedDocument, "98765432000110");
    assert.notEqual(extracted.confidence, undefined);
    assertNoNaNOrUndefined(extracted);

    const aliasKey = buildSupplierAliasKey(extracted, 700);
    assert.ok(typeof aliasKey === "string" && aliasKey.length > 0);
  });

  it("detectPotentialSupplierDuplicates sinaliza documento com IDs Nomus conflitantes", () => {
    const groups = groupAccountsPayableSuppliers([
      { externalId: 800, personId: 1, personName: "Nome Um" },
      { externalId: 801, personId: 2, personName: "Nome Dois" },
    ]);
    assert.equal(detectPotentialSupplierDuplicates(groups).length, 0);

    const docGroups = groupAccountsPayableSuppliers([
      { externalId: 810, personId: 10, personCnpj: "11111111000191", personName: "Alpha" },
      { externalId: 811, personId: 20, personCnpj: "11111111000191", personName: "Beta" },
    ]);
    const docHints = detectPotentialSupplierDuplicates(docGroups);
    assert.ok(
      docHints.some((h) => h.kind === "SAME_DOCUMENT_CONFLICTING_EXTERNAL_IDS")
    );
  });

  it("extractSupplierFromAccountsPayable prioriza campos materializados do AP", () => {
    const extracted = extractSupplierFromAccountsPayable({
      externalId: 900,
      personId: 5,
      personName: "Do Model",
      personCnpj: "12345678000190",
      rawPayload: {
        idPessoa: 999,
        nomePessoa: "Do Payload",
        cnpjPessoa: "00000000000000",
      },
    });
    assert.equal(extracted.source, "AP_FIELDS");
    assert.equal(extracted.externalSupplierId, 5);
    assert.equal(extracted.originalName, "Do Model");
    assert.equal(extracted.originalDocument, "12345678000190");
  });

  it("12. financeSupplierIdentity não importa Prisma; frontend não importa @prisma/client", () => {
    const libSrc = readFileSync(join(process.cwd(), "src/lib/financeSupplierIdentity.ts"), "utf8");
    assert.doesNotMatch(libSrc, /@prisma\/client/);

    const componentsDir = join(process.cwd(), "src/components");
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (full.endsWith(".tsx") || full.endsWith(".ts")) {
          const src = readFileSync(full, "utf8");
          assert.doesNotMatch(src, /@prisma\/client/, `${full} não deve importar Prisma`);
        }
      }
    };
    walk(componentsDir);
  });
});
