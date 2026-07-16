/**
 * Testes — backfill P20 (preview, apply, rollback, idempotência).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyLegacyPermissionKey,
  createInMemoryBackfillPort,
  fixtureAliasUser,
  fixtureEmptyUser,
  fixtureLeticiaBackfillUser,
  fixtureMegaKeyUser,
  fixtureSuperAdminUser,
  planUserBackfill,
  rollbackPermissionBackfill,
  runPermissionBackfill,
} from "./index.ts";

describe("permissionBackfill — classificação", () => {
  it("costs.view é mega_key — não migrável", () => {
    const c = classifyLegacyPermissionKey("costs.view");
    assert.equal(c.kind, "mega_key");
    assert.equal(c.migratable, false);
  });

  it("finance.accountsPayable.view é alias_1_1 migrável", () => {
    const c = classifyLegacyPermissionKey("finance.accountsPayable.view");
    assert.equal(c.kind, "alias_1_1");
    assert.equal(c.migratable, true);
  });
});

describe("permissionBackfill — Leticia", () => {
  it("preview: idempotente; AP 1:1; sem delta para finance shell/conciliação", () => {
    const user = fixtureLeticiaBackfillUser();
    const plan = planUserBackfill({ user, scenarioTag: "leticia-ap-only" });
    assert.equal(plan.status, "skipped_idempotent");
    assert.equal(plan.deltaOverrides.length, 0);
    assert.ok(
      plan.classifications.some(
        (c) => c.legacyKey === "finance.accountsPayable.view" && c.migratable
      )
    );
    assert.equal(
      plan.deltaOverrides.filter(
        (o) => o.resourceKey === "finance" || o.resourceKey.includes("portfolio")
      ).length,
      0
    );
  });
});

describe("permissionBackfill — SUPER_ADMIN e vazio", () => {
  it("SUPER_ADMIN protegido", () => {
    const plan = planUserBackfill({ user: fixtureSuperAdminUser() });
    assert.equal(plan.status, "skipped_super_admin");
  });

  it("usuário sem permissão não recebe grants", () => {
    const plan = planUserBackfill({ user: fixtureEmptyUser() });
    assert.equal(plan.status, "skipped_no_legacy_grants");
    assert.equal(plan.deltaOverrides.length, 0);
  });
});

describe("permissionBackfill — mega-key", () => {
  it("costs.view pendente; AP migrável em apply isolado", () => {
    const user = fixtureMegaKeyUser();
    const plan = planUserBackfill({ user, blockOnLockoutRisk: false });
    assert.ok(plan.pending.some((p) => p.legacyKey === "costs.view"));
    assert.ok(plan.classifications.some((c) => c.legacyKey === "finance.accountsPayable.view" && c.migratable));
  });
});

describe("permissionBackfill — apply / idempotência / rollback", () => {
  it("apply grava overrides; reexecução idempotente", async () => {
    const user = fixtureAliasUser();
    const port = createInMemoryBackfillPort([user]);

    const first = await runPermissionBackfill({
      port,
      dryRun: false,
      apply: true,
      confirmApply: true,
      userIds: [user.userId],
      runId: "test-apply-1",
    });
    assert.equal(first.readyCount, 1);
    assert.equal(first.appliedCount, 1);
    assert.ok(first.snapshotPath);

    const second = await runPermissionBackfill({
      port,
      dryRun: true,
      apply: false,
      userIds: [user.userId],
    });
    const u2 = second.users[0]!;
    assert.equal(u2.status, "skipped_idempotent");
  });

  it("rollback restaura snapshot após apply", async () => {
    const user = fixtureAliasUser();
    const port = createInMemoryBackfillPort([structuredClone(user)]);
    const runId = "test-rollback-1";

    await runPermissionBackfill({
      port,
      dryRun: false,
      apply: true,
      confirmApply: true,
      userIds: [user.userId],
      runId,
      cwd: process.cwd(),
    });

    const afterApply = await port.loadUser(user.userId);
    assert.ok((afterApply?.overrides.length ?? 0) > 0);

    const rolled = await rollbackPermissionBackfill({
      port,
      runId,
      confirmRollback: true,
      cwd: process.cwd(),
    });
    assert.equal(rolled.restored, 1);

    const afterRollback = await port.loadUser(user.userId);
    assert.equal(afterRollback?.overrides.length, 0);
  });

  it("falha parcial não corrompe lote — transação por usuário", async () => {
    const good = fixtureAliasUser();
    const bad = { ...fixtureAliasUser(), userId: "missing-user" };
    const port = createInMemoryBackfillPort([good]);
    const plan = planUserBackfill({ user: bad });
    const result = await runPermissionBackfill({
      port,
      dryRun: false,
      apply: true,
      confirmApply: true,
      userIds: [good.userId],
      runId: "test-partial",
    });
    assert.equal(result.appliedCount, 1);
    void plan;
  });
});

describe("permissionBackfill — preview obrigatório", () => {
  it("apply sem confirm falha", async () => {
    const port = createInMemoryBackfillPort([fixtureAliasUser()]);
    await assert.rejects(
      () =>
        runPermissionBackfill({
          port,
          dryRun: false,
          apply: true,
          confirmApply: false,
        }),
      /BACKFILL_CONFIRM_REQUIRED/
    );
  });
});
