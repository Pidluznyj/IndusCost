/**
 * Identidade consolidada do grupo AP — independência da ordem de leitura.
 *
 * Bug corrigido: groupAccountsPayableSuppliers preservava `extracted` do
 * PRIMEIRO título lido; se ele não tinha CNPJ, o fornecedor ficava sem
 * documento mesmo com títulos posteriores trazendo o CNPJ.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FINANCE_SUPPLIER_IDENTITY_WARNINGS,
  extractSupplierFromAccountsPayable,
  groupAccountsPayableSuppliers,
  reconcileSupplierGroupIdentity,
  type AccountsPayableSupplierRecord,
} from "./financeSupplierIdentity.js";

const A_NO_CNPJ: AccountsPayableSupplierRecord = {
  externalId: 1,
  personId: 10,
  personName: "Fornecedor Alpha",
};
const B_CNPJ: AccountsPayableSupplierRecord = {
  externalId: 2,
  personId: 10,
  personName: "Fornecedor Alpha LTDA",
  personCnpj: "12.345.678/0001-90",
};
const C_OTHER_CNPJ: AccountsPayableSupplierRecord = {
  externalId: 3,
  personId: 10,
  personName: "Alpha",
  personCnpj: "98.765.432/0001-10",
};

function stripRecords(groups: ReturnType<typeof groupAccountsPayableSuppliers>) {
  return groups.map(({ records, ...rest }) => ({ ...rest, recordIds: [...records.map((r) => r.externalId)].sort() }));
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
  );
}

describe("reconciliação da identidade do grupo AP (ordem independente)", () => {
  it("7. [A sem CNPJ, B com CNPJ] → o grupo adota o CNPJ de B", () => {
    const [group] = groupAccountsPayableSuppliers([A_NO_CNPJ, B_CNPJ]);
    assert.ok(group);
    assert.equal(group.identityKey, "nomus-id:10");
    assert.equal(group.extracted.normalizedDocument, "12345678000190");
    assert.equal(group.extracted.originalDocument, "12.345.678/0001-90");
    assert.equal(group.extracted.externalSupplierId, 10);
    assert.equal(group.extracted.confidence, "HIGH");
    assert.deepEqual(group.documentCandidates, ["12345678000190"]);
    assert.equal(group.documentConflict, false);
    assert.equal(group.recordCount, 2);
  });

  it("8. [B com CNPJ, A sem CNPJ] → resultado IDÊNTICO ao teste 7", () => {
    const forward = stripRecords(groupAccountsPayableSuppliers([A_NO_CNPJ, B_CNPJ]));
    const reversed = stripRecords(groupAccountsPayableSuppliers([B_CNPJ, A_NO_CNPJ]));
    assert.deepEqual(reversed, forward);
    assert.equal(forward[0]!.extracted.normalizedDocument, "12345678000190");
  });

  it("9. dois documentos distintos no mesmo Nomus ID → conflito determinístico, sem documento adotado", () => {
    for (const input of [
      [B_CNPJ, C_OTHER_CNPJ],
      [C_OTHER_CNPJ, B_CNPJ],
      [A_NO_CNPJ, C_OTHER_CNPJ, B_CNPJ],
    ]) {
      const [group] = groupAccountsPayableSuppliers(input);
      assert.ok(group);
      assert.equal(group.extracted.normalizedDocument, null, "nenhum documento é inventado/escolhido");
      assert.equal(group.extracted.originalDocument, null);
      assert.equal(group.documentConflict, true);
      assert.deepEqual(group.documentCandidates, ["12345678000190", "98765432000110"]);
      assert.ok(group.extracted.warnings.includes(FINANCE_SUPPLIER_IDENTITY_WARNINGS.CONFLICTING_DOCUMENTS));
      assert.equal(group.extracted.externalSupplierId, 10);
      assert.equal(group.extracted.confidence, "MEDIUM", "id sem documento → MEDIUM");
    }
  });

  it("mesmo CNPJ com e sem máscara é UM candidato; grafia canônica = dígitos", () => {
    const masked: AccountsPayableSupplierRecord = { externalId: 5, personId: 20, personCnpj: "12.345.678/0001-90", personName: "X" };
    const digits: AccountsPayableSupplierRecord = { externalId: 4, personId: 20, personCnpj: "12345678000190", personName: "X Comercio" };
    for (const input of [[masked, digits], [digits, masked]]) {
      const [group] = groupAccountsPayableSuppliers(input);
      assert.deepEqual(group!.documentCandidates, ["12345678000190"]);
      assert.equal(group!.extracted.originalDocument, "12345678000190");
      assert.equal(group!.extracted.originalName, "X Comercio", "nome mais longo vence");
    }
  });

  it("qualquer permutação de 3 títulos produz o mesmo grupo (JSON idêntico)", () => {
    const base = JSON.stringify(stripRecords(groupAccountsPayableSuppliers([A_NO_CNPJ, B_CNPJ, C_OTHER_CNPJ])));
    for (const permutation of permutations([A_NO_CNPJ, B_CNPJ, C_OTHER_CNPJ])) {
      assert.equal(JSON.stringify(stripRecords(groupAccountsPayableSuppliers(permutation))), base);
    }
  });

  it("grupo de um único título é igual à extração individual (sem regressão)", () => {
    for (const record of [A_NO_CNPJ, B_CNPJ, { externalId: 9, rawPayload: "invalid" } as AccountsPayableSupplierRecord]) {
      const [group] = groupAccountsPayableSuppliers([record]);
      assert.deepEqual(group!.extracted, extractSupplierFromAccountsPayable(record));
    }
  });

  it("reconcileSupplierGroupIdentity expõe candidatos de id e documento", () => {
    const reconciled = reconcileSupplierGroupIdentity([A_NO_CNPJ, B_CNPJ]);
    assert.deepEqual(reconciled.externalIdCandidates, [10]);
    assert.equal(reconciled.externalIdConflict, false);
    assert.deepEqual(reconciled.documentCandidates, ["12345678000190"]);
    assert.equal(reconciled.documentConflict, false);
    assert.equal(reconciled.extracted.source, "AP_FIELDS");
  });

  it("ids Nomus distintos no mesmo grupo (defensivo) → CONFLICTING_EXTERNAL_IDS e id nulo", () => {
    const reconciled = reconcileSupplierGroupIdentity([
      { externalId: 1, personId: 1, personName: "Um" },
      { externalId: 2, personId: 2, personName: "Dois" },
    ]);
    assert.equal(reconciled.externalIdConflict, true);
    assert.equal(reconciled.extracted.externalSupplierId, null);
    assert.ok(reconciled.extracted.warnings.includes(FINANCE_SUPPLIER_IDENTITY_WARNINGS.CONFLICTING_EXTERNAL_IDS));
  });

  it("grupo por documento (sem Nomus ID) continua agrupando nomes diferentes", () => {
    const groups = groupAccountsPayableSuppliers([
      { externalId: 100, personCnpj: "12.345.678/0001-90", personName: "Fornecedor A" },
      { externalId: 101, personCnpj: "12345678000190", personName: "Fornecedor B LTDA" },
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]!.identityKey, "doc:12345678000190");
    assert.equal(groups[0]!.extracted.normalizedDocument, "12345678000190");
    assert.equal(groups[0]!.extracted.originalName, "Fornecedor B LTDA");
  });
});
