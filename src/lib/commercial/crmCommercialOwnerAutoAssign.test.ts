import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  AUTO_ASSIGN_SOURCE,
  assignCommercialOwnerFromSuggestion,
  buildAutoAssignOwnerWrite,
  isAutoAssignBlockedByInactivity,
  isMappableOrderSeller,
  type AutoAssignSellerSuggestion,
} from "./crmCommercialOwnerAutoAssign.js";

describe("crmCommercialOwnerAutoAssign", () => {
  it("mapeia vendedor Nomus válido", () => {
    assert.equal(
      isMappableOrderSeller({
        nomusSellerName: "Gislene Lima",
        responsible: null,
        externalSellerId: 464,
      }),
      true
    );
  });

  it("rejeita rótulos operacionais", () => {
    assert.equal(
      isMappableOrderSeller({
        nomusSellerName: "FINANCEIRO",
        responsible: null,
        externalSellerId: null,      }),
      false
    );
  });

  it("rejeita sem vendedor", () => {
    assert.equal(
      isMappableOrderSeller({
        nomusSellerName: null,
        responsible: null,
        externalSellerId: null,      }),
      false
    );
  });

  it("fonte AUTO_FROM_SALES_ORDER_SELLER", () => {
    assert.equal(AUTO_ASSIGN_SOURCE, "AUTO_FROM_SALES_ORDER_SELLER");
  });

  it("bloqueia restauração automática após INACTIVITY_90_DAYS", () => {
    assert.equal(
      isAutoAssignBlockedByInactivity({ isActive: false, blockAutoAssignUntilManual: true }),
      true
    );
  });
});

describe("autoatribuição × ciclo de 90 dias (POL-COM-001 §11)", () => {
  const suggestion: AutoAssignSellerSuggestion = {
    customerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customerName: "Cliente A",
    salesOrderId: "so-1",
    orderCode: "PD 03000",
    externalSalesOrderId: 3000,
    sellerExternalId: 101,
    sellerName: "Ana Souza",
    sellerIdentityKey: "ana souza",
    distinctSellerCount: 1,
  };

  function fakePrisma(existing: { isActive: boolean; blockAutoAssignUntilManual: boolean; sellerCanonicalName: string } | null) {
    const calls = { upsert: 0 };
    const prisma = {
      crmCustomerCommercialOwner: {
        findUnique: async () => existing,
        upsert: async () => {
          calls.upsert += 1;
        },
      },
    };
    return { prisma: prisma as never, calls };
  }

  it("caso 13: autoatribuição válida inicia o ciclo — assignmentStartedAt = agora na criação e na reativação", () => {
    const now = new Date("2026-08-30T15:00:00.000Z");
    const write = buildAutoAssignOwnerWrite(suggestion, { aliasIds: [101], notes: "source=AUTO", performedBy: "system/auto-assign", now });
    assert.equal(write.create.assignmentStartedAt, now);
    assert.equal(write.update.assignmentStartedAt, now);
    assert.equal(write.create.assignmentSource, AUTO_ASSIGN_SOURCE);
    assert.equal(write.create.isActive, true);
    assert.equal(write.create.customerId, suggestion.customerId);
    // A autoatribuição nunca mexe no bloqueio: só a atribuição manual o libera.
    assert.equal("blockAutoAssignUntilManual" in write.create, false);
    assert.equal("blockAutoAssignUntilManual" in write.update, false);
  });

  it("caso 14: cliente baixado por inatividade (blockAutoAssignUntilManual) não é autoatribuído por novo PV", async () => {
    const blocked = fakePrisma({ isActive: false, blockAutoAssignUntilManual: true, sellerCanonicalName: "Ana Souza" });
    assert.equal(
      await assignCommercialOwnerFromSuggestion(blocked.prisma, suggestion, { dryRun: true }),
      "skipped_inactivity_blocked"
    );
    assert.equal(blocked.calls.upsert, 0);
    const source = readFileSync(join(process.cwd(), "src/lib/commercial/crmCommercialOwnerAutoAssign.ts"), "utf8");
    // A prévia em SQL também exclui clientes bloqueados antes de sugerir vendedor.
    assert.match(source, /blocked\."blockAutoAssignUntilManual" = true/);
  });

  it("nunca substitui responsável ativo", async () => {
    const owned = fakePrisma({ isActive: true, blockAutoAssignUntilManual: false, sellerCanonicalName: "Bruno Dias" });
    assert.equal(await assignCommercialOwnerFromSuggestion(owned.prisma, suggestion, { dryRun: true }), "skipped_owned");
    assert.equal(owned.calls.upsert, 0);
  });
});
