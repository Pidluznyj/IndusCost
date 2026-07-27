/**
 * Integridade do complemento operacional: unicidade, anti-cópia e versionamento.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { toTreasuryTitleOperationalComplementDto } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  createEmptyTreasuryTitleComplementMemoryStore,
  createMemoryTreasuryTitleOperationalComplementRepository,
} from "./treasuryTitleOperationalComplementRepository.memory.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260807120000_treasury_title_operational_complement/migration.sql"
);

describe("treasuryTitleOperationalComplement — schema/migration", () => {
  it("declara model, enums, unicidade e FKs sem alterar Nomus", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryTitleOperationalComplement \{/);
    assert.match(schema, /enum TreasuryOfficialTitleKind \{/);
    assert.match(schema, /RECEIVABLE/);
    assert.match(schema, /PAYABLE/);
    assert.match(schema, /officialTitleId\s+String/);
    assert.match(schema, /officialExternalId\s+Int/);
    assert.match(schema, /expectedDate\s+DateTime\?/);
    assert.match(schema, /confirmedDate\s+DateTime\?/);
    assert.match(schema, /scheduledDate\s+DateTime\?/);
    assert.match(schema, /expectedAmount\s+Decimal\?/);
    assert.match(schema, /confirmedAmount\s+Decimal\?/);
    assert.match(schema, /scheduledAmount\s+Decimal\?/);
    assert.match(schema, /plannedAccountId\s+String\?/);
    assert.match(schema, /responsibleUserId\s+String\?/);
    assert.match(schema, /nextAction\s+String\?/);
    assert.match(schema, /version\s+Int/);
    assert.match(schema, /cancelledAt\s+DateTime\?/);
    assert.match(schema, /cancellationReason\s+String\?/);
    assert.match(schema, /@@unique\(\[titleType, officialTitleId\]\)/);
    assert.match(schema, /@@unique\(\[titleType, officialExternalId\]\)/);

    // Anti-cópia: não persistir dados oficiais do título.
    const modelBlock = schema.slice(
      schema.indexOf("model TreasuryTitleOperationalComplement {"),
      schema.indexOf(
        "@@unique([titleType, officialTitleId])",
        schema.indexOf("model TreasuryTitleOperationalComplement {")
      )
    );
    assert.doesNotMatch(modelBlock, /\bpersonId\b|\bpersonName\b|\bpersonCnpj\b/);
    assert.doesNotMatch(modelBlock, /\bdueDate\b/);
    assert.doesNotMatch(
      modelBlock,
      /\bamountReceivable\b|\bamountPayable\b|\boriginalAmount\b|\bopenBalance\b/
    );
    assert.doesNotMatch(modelBlock, /\bcounterparty\b|\bcustomer\b|\bsupplier\b/i);

    assert.ok(existsSync(migrationPath), migrationPath);
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryTitleOperationalComplement"/);
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryTitleOperationalComplement_titleType_officialTitleId_key"/
    );
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryTitleOperationalComplement_titleType_officialExternalId_key"/
    );
    assert.match(sql, /REFERENCES "AppUser"/);
    assert.match(sql, /REFERENCES "TreasuryFinancialAccount"/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
  });
});

describe("treasuryTitleOperationalComplementRepository — integridade", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const titleId = "a1111111-1111-4111-8111-111111111111";

  it("cria complemento RECEIVABLE com campos operacionais e DTO sem dados oficiais duplicados", async () => {
    const store = createEmptyTreasuryTitleComplementMemoryStore();
    const repo = createMemoryTreasuryTitleOperationalComplementRepository(store);

    const created = await repo.create({
      titleType: "RECEIVABLE",
      officialTitleId: titleId,
      officialExternalId: 88421,
      expectedDate: "2026-07-28",
      confirmedDate: null,
      scheduledDate: "2026-07-30",
      expectedAmount: "4252.80",
      scheduledAmount: "2000.00",
      status: "ACTIVE",
      priority: "HIGH",
      plannedAccountId: "22222222-2222-4222-8222-222222222222",
      responsibleUserId: userId,
      nextAction: "Ligar para financeiro",
      reason: "Cliente pediu prorrogação",
      notes: "Combinado com comercial",
      createdByUserId: userId,
    });

    assert.equal(created.version, 1);
    assert.equal(created.titleType, "RECEIVABLE");
    assert.equal(created.officialExternalId, 88421);

    const dto = toTreasuryTitleOperationalComplementDto(created);
    assert.equal(dto.expectedDate, "2026-07-28");
    assert.equal(dto.scheduledDate, "2026-07-30");
    assert.equal(dto.expectedAmount, "4252.80");
    assert.equal(dto.scheduledAmount, "2000.00");
    assert.equal(dto.priority, "HIGH");
    assert.equal(dto.nextAction, "Ligar para financeiro");
    assert.equal(
      Object.prototype.hasOwnProperty.call(dto, "dueDate"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(dto, "personName"),
      false
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(dto, "originalAmount"),
      false
    );
  });

  it("garante unicidade por tipo + título oficial (id e externalId)", async () => {
    const store = createEmptyTreasuryTitleComplementMemoryStore();
    const repo = createMemoryTreasuryTitleOperationalComplementRepository(store);

    await repo.create({
      titleType: "PAYABLE",
      officialTitleId: titleId,
      officialExternalId: 33110,
      createdByUserId: userId,
    });

    await assert.rejects(
      () =>
        repo.create({
          titleType: "PAYABLE",
          officialTitleId: titleId,
          officialExternalId: 99999,
          createdByUserId: userId,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    await assert.rejects(
      () =>
        repo.create({
          titleType: "PAYABLE",
          officialTitleId: "b2222222-2222-4222-8222-222222222222",
          officialExternalId: 33110,
          createdByUserId: userId,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    // Mesmo externalId em outro tipo é permitido.
    const other = await repo.create({
      titleType: "RECEIVABLE",
      officialTitleId: "c3333333-3333-4333-8333-333333333333",
      officialExternalId: 33110,
      createdByUserId: userId,
    });
    assert.equal(other.titleType, "RECEIVABLE");
  });

  it("incrementa versão no update e bloqueia conflito de versão", async () => {
    const store = createEmptyTreasuryTitleComplementMemoryStore();
    const repo = createMemoryTreasuryTitleOperationalComplementRepository(store);
    const created = await repo.create({
      titleType: "RECEIVABLE",
      officialTitleId: titleId,
      officialExternalId: 1,
      expectedDate: "2026-08-01",
      createdByUserId: userId,
    });

    const updated = await repo.update(created.id, {
      expectedDate: "2026-08-05",
      confirmedDate: "2026-08-04",
      confirmedAmount: "100.00",
      updatedByUserId: userId,
      expectedVersion: 1,
    });
    assert.equal(updated.version, 2);
    assert.equal(
      toTreasuryTitleOperationalComplementDto(updated).expectedDate,
      "2026-08-05"
    );

    await assert.rejects(
      () =>
        repo.update(created.id, {
          notes: "stale",
          updatedByUserId: userId,
          expectedVersion: 1,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("cancela logicamente sem exclusão física e impede nova alteração", async () => {
    const store = createEmptyTreasuryTitleComplementMemoryStore();
    const repo = createMemoryTreasuryTitleOperationalComplementRepository(store);
    const created = await repo.create({
      titleType: "PAYABLE",
      officialTitleId: titleId,
      officialExternalId: 2,
      createdByUserId: userId,
    });

    const cancelled = await repo.cancel(created.id, {
      cancelledByUserId: userId,
      cancellationReason: "Programação revogada",
      expectedVersion: 1,
    });
    assert.equal(cancelled.status, "CANCELLED");
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancellationReason, "Programação revogada");
    assert.equal(cancelled.version, 2);
    assert.equal(store.rows.length, 1);

    await assert.rejects(
      () =>
        repo.update(created.id, {
          notes: "x",
          updatedByUserId: userId,
          expectedVersion: 2,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("lookup por officialTitleId e officialExternalId", async () => {
    const store = createEmptyTreasuryTitleComplementMemoryStore();
    const repo = createMemoryTreasuryTitleOperationalComplementRepository(store);
    await repo.create({
      titleType: "RECEIVABLE",
      officialTitleId: titleId,
      officialExternalId: 42,
      createdByUserId: userId,
    });
    const byTitle = await repo.findByOfficialTitle("RECEIVABLE", titleId);
    const byExt = await repo.findByOfficialExternalId("RECEIVABLE", 42);
    assert.equal(byTitle?.officialExternalId, 42);
    assert.equal(byExt?.officialTitleId, titleId);
  });
});
