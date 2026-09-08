/**
 * Cardinalidade financeira V1 — dono financeiro de um título de Contas a Pagar.
 * Invariante central: sem rateio explícito, um título AP = no máximo um dono
 * financeiro. Nunca 100% em dois pedidos; conflito automático = 0 em todos.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  distributePayableFinancialContribution,
  financialOwnerOf,
  isPayableOwnershipConflict,
  payableCountsForOrder,
  resolvePayableFinancialOwnership,
  type PayableOwnershipClaim,
} from "./nomusPurchaseOrderPayableOwnership.js";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const X = 9001;

const confirmed = (order: string, payable = X): PayableOwnershipClaim => ({
  nomusPurchaseOrderId: order,
  payableExternalId: payable,
  source: "CONFIRMED",
  method: "MANUAL",
});
const auto = (order: string, method = "DIRECT_NOMUS_NFE", payable = X): PayableOwnershipClaim => ({
  nomusPurchaseOrderId: order,
  payableExternalId: payable,
  source: "AUTOMATIC",
  method,
});

describe("resolvePayableFinancialOwnership — precedência", () => {
  it("I. confirmado em A + evidência automática em B → dono = A; B não conta", () => {
    const map = resolvePayableFinancialOwnership([confirmed(A), auto(B)]);
    const entry = map.get(X)!;
    assert.equal(entry.kind, "CONFIRMED_OWNER");
    assert.equal(entry.ownerOrderId, A);
    assert.deepEqual(entry.confirmedOrderIds, [A]);
    assert.deepEqual(entry.automaticOrderIds, [B]);
    assert.equal(payableCountsForOrder(map, X, A), true);
    assert.equal(payableCountsForOrder(map, X, B), false);
  });

  it("J. só evidência automática em A → AUTO_SINGLE_OWNER = A", () => {
    const map = resolvePayableFinancialOwnership([auto(A)]);
    assert.equal(map.get(X)!.kind, "AUTO_SINGLE_OWNER");
    assert.equal(financialOwnerOf(map, X), A);
    assert.equal(payableCountsForOrder(map, X, A), true);
  });

  it("K. evidências automáticas em A e B → AUTO_CONFLICT: ninguém conta, ninguém é escolhido", () => {
    const map = resolvePayableFinancialOwnership([auto(A, "DIRECT_NOMUS_NFE"), auto(B, "AP_DOCUMENT_NUMBER")]);
    const entry = map.get(X)!;
    assert.equal(entry.kind, "AUTO_CONFLICT");
    assert.equal(entry.ownerOrderId, null);
    assert.ok(isPayableOwnershipConflict(entry.kind));
    assert.equal(payableCountsForOrder(map, X, A), false);
    assert.equal(payableCountsForOrder(map, X, B), false);
    // A ordem das evidências não muda o resultado (nada de "primeiro encontrado").
    const reversed = resolvePayableFinancialOwnership([auto(B, "AP_DOCUMENT_NUMBER"), auto(A, "DIRECT_NOMUS_NFE")]);
    assert.deepEqual(reversed.get(X), entry);
  });

  it("L. duas evidências automáticas diferentes apontando só para A → um único dono, contado uma vez", () => {
    const map = resolvePayableFinancialOwnership([
      auto(A, "DIRECT_NOMUS_NFE"),
      auto(A, "STOCK_DOCUMENT_PURCHASE_ORDER"),
      auto(A, "AP_DOCUMENT_NUMBER"),
    ]);
    const entry = map.get(X)!;
    assert.equal(entry.kind, "AUTO_SINGLE_OWNER");
    assert.deepEqual(entry.automaticOrderIds, [A]);
  });

  it("M. confirmado + automático no MESMO pedido A → dono A, uma única entrada (nunca 2x)", () => {
    const map = resolvePayableFinancialOwnership([confirmed(A), auto(A)]);
    const entry = map.get(X)!;
    assert.equal(entry.kind, "CONFIRMED_OWNER");
    assert.equal(entry.ownerOrderId, A);
    assert.equal(map.size, 1);
  });

  it("sem evidência → UNOWNED; título ausente do mapa não bloqueia o pedido que o apresenta", () => {
    assert.equal(resolvePayableFinancialOwnership([]).size, 0);
    assert.equal(payableCountsForOrder(new Map(), X, A), true);
    assert.equal(payableCountsForOrder(undefined, X, A), true);
    assert.equal(financialOwnerOf(undefined, X), null);
  });

  it("defensivo: confirmado em A e B (impossível após a unique global) → CONFIRMED_CONFLICT, ninguém conta", () => {
    const map = resolvePayableFinancialOwnership([confirmed(A), confirmed(B), auto(C)]);
    const entry = map.get(X)!;
    assert.equal(entry.kind, "CONFIRMED_CONFLICT");
    assert.equal(entry.ownerOrderId, null);
    assert.equal(payableCountsForOrder(map, X, A), false);
    assert.equal(payableCountsForOrder(map, X, B), false);
    assert.equal(payableCountsForOrder(map, X, C), false);
  });

  it("vários títulos são resolvidos de forma independente", () => {
    const map = resolvePayableFinancialOwnership([confirmed(A, 1), auto(B, "DIRECT_NOMUS_NFE", 2), auto(A, "DIRECT_NOMUS_NFE", 3), auto(B, "DIRECT_NOMUS_NFE", 3)]);
    assert.equal(map.get(1)!.ownerOrderId, A);
    assert.equal(map.get(2)!.ownerOrderId, B);
    assert.equal(map.get(3)!.kind, "AUTO_CONFLICT");
  });
});

describe("invariante matemático — SUM(contribuição em todos os pedidos) <= valor do título", () => {
  const AMOUNT = 10_000;
  const total = (claims: PayableOwnershipClaim[]) => {
    const map = resolvePayableFinancialOwnership(claims);
    const contribution = distributePayableFinancialContribution({
      ownership: map,
      payableExternalId: X,
      amount: AMOUNT,
      orderIds: [A, B],
    });
    return { a: contribution.get(A)!, b: contribution.get(B)!, sum: contribution.get(A)! + contribution.get(B)! };
  };

  it("N. R$ 10.000 nunca vira R$ 20.000 em A + B, em nenhuma combinação de evidências", () => {
    const scenarios: Array<[string, PayableOwnershipClaim[]]> = [
      ["confirmado A + auto B", [confirmed(A), auto(B)]],
      ["confirmado B + auto A", [confirmed(B), auto(A)]],
      ["auto A", [auto(A)]],
      ["auto B", [auto(B)]],
      ["auto A + auto B (conflito)", [auto(A), auto(B)]],
      ["confirmado A + auto A", [confirmed(A), auto(A)]],
      ["nada", []],
    ];
    for (const [label, claims] of scenarios) {
      const { a, b, sum } = total(claims);
      assert.ok(sum <= AMOUNT, `${label}: soma ${sum} > ${AMOUNT}`);
      assert.ok(a === 0 || a === AMOUNT, `${label}: A parcial (${a}) sem rateio`);
      assert.ok(b === 0 || b === AMOUNT, `${label}: B parcial (${b}) sem rateio`);
      assert.ok(!(a === AMOUNT && b === AMOUNT), `${label}: 100% em dois pedidos`);
    }
  });

  it("O. resultado válido é A=10.000/B=0, A=0/B=10.000 ou A=0/B=0 em conflito", () => {
    assert.deepEqual(total([confirmed(A), auto(B)]), { a: AMOUNT, b: 0, sum: AMOUNT });
    assert.deepEqual(total([auto(B)]), { a: 0, b: AMOUNT, sum: AMOUNT });
    assert.deepEqual(total([auto(A), auto(B)]), { a: 0, b: 0, sum: 0 });
  });
});
