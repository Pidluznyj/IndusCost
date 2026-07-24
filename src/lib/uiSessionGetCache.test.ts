import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  clearUiSessionGetCacheForTests,
  invalidateUiSessionGetCache,
  readUiSessionGetCache,
  writeUiSessionGetCache,
  uiSessionGetCacheSizeForTests,
} from "@/src/lib/uiSessionGetCache.js";

describe("uiSessionGetCache", () => {
  beforeEach(() => clearUiSessionGetCacheForTests());

  it("grava e le pela mesma chave", () => {
    writeUiSessionGetCache("k1", { a: 1 }, 60_000);
    assert.deepEqual(readUiSessionGetCache<{ a: number }>("k1"), { a: 1 });
  });

  it("nao reutiliza chave diferente", () => {
    writeUiSessionGetCache("/api/a?x=1", { v: 1 }, 60_000);
    assert.equal(readUiSessionGetCache("/api/a?x=2"), null);
  });

  it("expira por TTL", async () => {
    writeUiSessionGetCache("ttl", { v: 1 }, 20);
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(readUiSessionGetCache("ttl"), null);
  });

  it("invalida por prefixo", () => {
    writeUiSessionGetCache("/api/finance/ar/overdue?a=1", {}, 60_000);
    writeUiSessionGetCache("/api/finance/ap/titles?a=1", {}, 60_000);
    invalidateUiSessionGetCache("/api/finance/ar/");
    assert.equal(readUiSessionGetCache("/api/finance/ar/overdue?a=1"), null);
    assert.ok(readUiSessionGetCache("/api/finance/ap/titles?a=1"));
    assert.equal(uiSessionGetCacheSizeForTests(), 1);
  });
});
