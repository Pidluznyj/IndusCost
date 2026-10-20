import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { describe, it } from "node:test";
import { generateIdempotencyKey, SecureRandomUnavailableError } from "./idempotencyKey.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("chave de idempotência QUOD", () => {
  it("usa randomUUID quando existe", () => {
    const key = generateIdempotencyKey({ randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    assert.equal(key, "11111111-1111-4111-8111-111111111111");
    assert.match(key, UUID_V4);
  });

  it("cai em getRandomValues em contexto HTTP sem randomUUID e gera v4 válido e único", () => {
    const source = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
    const first = generateIdempotencyKey(source);
    const second = generateIdempotencyKey(source);
    assert.match(first, UUID_V4);
    assert.match(second, UUID_V4);
    assert.notEqual(first, second);
  });

  it("ignora randomUUID que devolve valor inválido e usa o fallback seguro", () => {
    const key = generateIdempotencyKey({
      randomUUID: () => "não-é-uuid",
      getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    });
    assert.match(key, UUID_V4);
  });

  it("sem fonte segura, bloqueia a consulta paga em vez de usar Math.random", () => {
    assert.throws(() => generateIdempotencyKey({}), SecureRandomUnavailableError);
  });
});
