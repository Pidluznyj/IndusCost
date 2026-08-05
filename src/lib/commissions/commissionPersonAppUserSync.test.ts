import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { syncCommissionPersonFromAppUserSellerLink } from "./commissionPersonAppUserSync.server.js";

/**
 * `db` nunca deve ser tocado quando o link é inválido/incompleto — usar um
 * objeto que lança em qualquer acesso prova que os guards curto-circuitam
 * antes de qualquer chamada ao Prisma (sem precisar de banco real).
 */
const untouchableDb = new Proxy(
  {},
  {
    get() {
      throw new Error("db não deveria ser acessado neste caminho");
    },
  }
) as never;

describe("syncCommissionPersonFromAppUserSellerLink — guards", () => {
  it("role diferente de SELLER é ignorado sem tocar no banco", async () => {
    const result = await syncCommissionPersonFromAppUserSellerLink(untouchableDb, {
      role: "COMMERCIAL_MANAGER",
      primaryExternalSellerId: 1519,
      sellerResponsibleName: "Joseane Aparecida Correa",
    });
    assert.deepEqual(result, { action: "skipped", reason: "NOT_SELLER_ROLE" });
  });

  it("role SELLER sem ID Nomus é ignorado sem tocar no banco", async () => {
    const result = await syncCommissionPersonFromAppUserSellerLink(untouchableDb, {
      role: "SELLER",
      primaryExternalSellerId: null,
      sellerResponsibleName: "Joseane Aparecida Correa",
    });
    assert.deepEqual(result, { action: "skipped", reason: "MISSING_SELLER_ID" });
  });

  it("ID Nomus zero/negativo é tratado como ausente", async () => {
    const result = await syncCommissionPersonFromAppUserSellerLink(untouchableDb, {
      role: "SELLER",
      primaryExternalSellerId: 0,
      sellerResponsibleName: "Joseane Aparecida Correa",
    });
    assert.deepEqual(result, { action: "skipped", reason: "MISSING_SELLER_ID" });
  });

  it("role SELLER com ID mas sem nome (ou só espaços) é ignorado sem tocar no banco", async () => {
    const result = await syncCommissionPersonFromAppUserSellerLink(untouchableDb, {
      role: "SELLER",
      primaryExternalSellerId: 1519,
      sellerResponsibleName: "   ",
    });
    assert.deepEqual(result, { action: "skipped", reason: "MISSING_NAME" });
  });
});

describe("syncCommissionPersonFromAppUserSellerLink — chamada ao upsert canônico", () => {
  const src = readFileSync(
    join(process.cwd(), "src", "lib", "commissions", "commissionPersonAppUserSync.server.ts"),
    "utf8"
  );

  it("reusa upsertCommissionPersonFromImport — não reimplementa a resolução canônica", () => {
    assert.match(src, /import \{ upsertCommissionPersonFromImport \} from "\.\/commissionPersonResolution\.server\.js"/);
    assert.match(src, /upsertCommissionPersonFromImport\(db, \{/);
  });

  it("cria a pessoa comissionada como SELLER com o nomusPersonId primário", () => {
    assert.match(src, /type:\s*"SELLER"/);
    assert.match(src, /nomusPersonId:\s*input\.primaryExternalSellerId/);
    assert.match(src, /name,?\s*$/m);
  });
});

describe("PATCH /api/admin/users/:id — sincroniza CommissionPerson dentro da mesma transação", () => {
  const src = readFileSync(join(process.cwd(), "server.ts"), "utf8");
  const start = src.indexOf('app.patch("/api/admin/users/:id"');
  const end = src.indexOf('app.post("/api/admin/users/:id/reset-password"');
  const route = src.slice(start, end);

  it("a rota existe e chama o sync dentro do prisma.$transaction", () => {
    assert.ok(start >= 0 && end > start, "não achei o handler PATCH /api/admin/users/:id");
    assert.match(route, /syncCommissionPersonFromAppUserSellerLink\(tx, \{/);
  });

  it("usa os valores JÁ persistidos (updated.*), não o body cru da request", () => {
    assert.match(route, /role:\s*updated\.role/);
    assert.match(route, /primaryExternalSellerId:\s*updated\.externalSellerId/);
    assert.match(route, /sellerResponsibleName:\s*updated\.sellerResponsibleName/);
  });

  it("o sync roda depois do appUser.update e antes do return updated (dentro da mesma transação)", () => {
    const updateIdx = route.indexOf("tx.appUser.update(");
    const syncIdx = route.indexOf("syncCommissionPersonFromAppUserSellerLink(tx");
    const returnIdx = route.indexOf("return updated;");
    assert.ok(updateIdx >= 0 && syncIdx > updateIdx, "sync deveria vir depois do appUser.update");
    assert.ok(returnIdx > syncIdx, "sync deveria vir antes do return updated (mesma transação)");
  });
});
