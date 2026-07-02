import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  consolidatePersonImportFragments,
  groupCommissionPersonsByIdentity,
  normalizeCommissionPersonName,
  pickCanonicalCommissionPerson,
} from "./commissionPersonIdentity.js";

describe("commissionPersonIdentity", () => {
  it("normaliza nomes equivalentes", () => {
    assert.equal(normalizeCommissionPersonName("  GISLENE   LIMA  "), "gislene lima");
  });

  it("consolida fragmentos com múltiplos IDs Nomus do mesmo vendedor", () => {
    const consolidated = consolidatePersonImportFragments([
      { type: "SELLER", nomusPersonId: 464, name: "GISLENE LIMA" },
      { type: "SELLER", nomusPersonId: 646, name: "GISLENE LIMA" },
      { type: "SELLER", nomusPersonId: 645, name: "GISLENE LIMA" },
    ]);
    assert.equal(consolidated.length, 1);
    assert.equal(consolidated[0]!.nomusPersonId, 464);
    assert.deepEqual(consolidated[0]!.aliasNomusPersonIds, [645, 646]);
  });

  it("Nomus prevalece sobre Manual no registro canônico", () => {
    const canonical = pickCanonicalCommissionPerson([
      {
        id: "manual-1",
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "MANUAL",
        nomusPersonId: null,
        active: true,
      },
      {
        id: "nomus-1",
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "NOMUS",
        nomusPersonId: 464,
        active: true,
      },
    ]);
    assert.equal(canonical?.id, "nomus-1");
  });

  it("agrupa Manual e Nomus pelo nome normalizado", () => {
    const groups = groupCommissionPersonsByIdentity([
      {
        id: "a",
        name: "GISLENE LIMA",
        type: "SELLER",
        source: "MANUAL",
        nomusPersonId: null,
        active: true,
      },
      {
        id: "b",
        name: "Gislene Lima",
        type: "SELLER",
        source: "NOMUS",
        nomusPersonId: 464,
        active: true,
      },
      {
        id: "c",
        name: "Rodrigo Da Silva Ramos",
        type: "SELLER",
        source: "NOMUS",
        nomusPersonId: 1399,
        active: true,
      },
    ]);
    assert.equal(groups.length, 2);
    const gislene = groups.find((g) => g.length === 2);
    assert.ok(gislene);
    assert.equal(pickCanonicalCommissionPerson(gislene!)?.id, "b");
  });

  it("fragmentos sem nomusPersonId com mesmo nome consolidam em um candidato", () => {
    const consolidated = consolidatePersonImportFragments([
      { type: "REPRESENTATIVE", nomusPersonId: 10, name: "Rep A" },
      { type: "REPRESENTATIVE", nomusPersonId: 20, name: "Rep A" },
    ]);
    assert.equal(consolidated.length, 1);
    assert.equal(consolidated[0]!.nomusPersonId, 10);
    assert.deepEqual(consolidated[0]!.aliasNomusPersonIds, [20]);
  });
});

describe("collectCandidatesFromOrders (consolidação)", () => {
  it("módulo de importação usa consolidação CRM para vendedores", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "src/lib/commissions/commissionPersons.server.ts"),
      "utf8"
    );
    assert.match(source, /consolidateSellerRowFragments/);
    assert.match(source, /upsertCommissionPersonFromImport/);
    assert.match(source, /findExistingCommissionPerson/);
  });
});
