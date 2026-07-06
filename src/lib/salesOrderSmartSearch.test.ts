import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderSearchCodeTokens,
  hasSalesOrderSearchTerm,
  normalizeSalesOrderSearchTerm,
  removeSearchAccents,
} from "./salesOrderSmartSearch.js";

describe("salesOrderSmartSearch — normalização", () => {
  it("remove espaços nas pontas e colapsa internos", () => {
    assert.equal(normalizeSalesOrderSearchTerm("  PD   02682  "), "PD 02682");
    assert.equal(normalizeSalesOrderSearchTerm("Maria   Eliana"), "Maria Eliana");
  });

  it("retorna vazio para entradas não-string ou em branco", () => {
    assert.equal(normalizeSalesOrderSearchTerm("   "), "");
    assert.equal(normalizeSalesOrderSearchTerm(undefined), "");
    assert.equal(normalizeSalesOrderSearchTerm(123 as unknown), "");
  });

  it("remove acentos (best-effort cliente/vendedor)", () => {
    assert.equal(removeSearchAccents("Gislene Lóima"), "Gislene Loima");
    assert.equal(removeSearchAccents("José"), "Jose");
  });

  it("hasSalesOrderSearchTerm detecta termo utilizável", () => {
    assert.equal(hasSalesOrderSearchTerm("02682"), true);
    assert.equal(hasSalesOrderSearchTerm("   "), false);
  });
});

describe("salesOrderSmartSearch — tokens de código", () => {
  it("PD 02682 gera tokens com e sem espaço/prefixo e sem zeros", () => {
    const tokens = buildSalesOrderSearchCodeTokens("PD 02682");
    assert.ok(tokens.includes("pd 02682"));
    assert.ok(tokens.includes("pd02682"));
    assert.ok(tokens.includes("02682"));
    assert.ok(tokens.includes("2682"));
  });

  it("PD02682 (sem espaço) também gera 02682 e 2682", () => {
    const tokens = buildSalesOrderSearchCodeTokens("PD02682");
    assert.ok(tokens.includes("pd02682"));
    assert.ok(tokens.includes("02682"));
    assert.ok(tokens.includes("2682"));
  });

  it("número puro 02682 gera 02682 e 2682", () => {
    const tokens = buildSalesOrderSearchCodeTokens("02682");
    assert.ok(tokens.includes("02682"));
    assert.ok(tokens.includes("2682"));
  });

  it("texto puro (cliente) não gera tokens numéricos", () => {
    const tokens = buildSalesOrderSearchCodeTokens("Maria Eliana");
    assert.ok(tokens.includes("maria eliana"));
    assert.ok(tokens.includes("mariaeliana"));
    assert.ok(!tokens.some((t) => /\d/.test(t)));
  });

  it("entrada vazia → nenhum token", () => {
    assert.deepEqual(buildSalesOrderSearchCodeTokens("   "), []);
  });
});
