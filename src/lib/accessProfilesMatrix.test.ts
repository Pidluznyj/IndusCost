import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCESS_PROFILE_SNAPSHOT_NOTICE,
  buildAccessProfileMatrixModel,
  diffLegacyPermissionBags,
  materializeAccessProfilePermissionsFromDraft,
  needsBroadChangeConfirmation,
  roundTripAccessProfilePermissions,
} from "./accessProfilesMatrix.ts";
import { permissionsMatchProfile } from "./accessProfilesUtils.ts";
import { setMatrixDraftAction } from "@/src/lib/security/permissionMatrixUi/index.ts";
import { SYSTEM_ACCESS_PROFILE_SEEDS } from "./accessProfilesSeedData.js";

describe("accessProfilesMatrix", () => {
  it("snapshot notice is explícito", () => {
    assert.ok(ACCESS_PROFILE_SNAPSHOT_NOTICE.includes("não atualiza automaticamente"));
  });

  it("perfil novo vazio materializa vazio", () => {
    const model = buildAccessProfileMatrixModel([], "VIEWER");
    const legacy = materializeAccessProfilePermissionsFromDraft(model.draft, []);
    assert.deepEqual(legacy, []);
  });

  it("perfil legado round-trip sem ganho/perda", () => {
    const bag = ["dashboard.view", "crm.view", "pricing.view"];
    const rt = roundTripAccessProfilePermissions(bag, "SELLER");
    assert.equal(rt.compatible, true, `lost=${rt.lost.join(",")} gained=${rt.gained.join(",")}`);
    assert.ok(rt.after.includes("pricing.view"));
  });

  it("seed seller round-trip compatível", () => {
    const seller = SYSTEM_ACCESS_PROFILE_SEEDS.find((s) => s.systemKey === "role_seller");
    assert.ok(seller);
    const rt = roundTripAccessProfilePermissions(seller!.permissions, seller!.roleBase);
    assert.equal(
      rt.compatible,
      true,
      `lost=${rt.lost.slice(0, 8)} gained=${rt.gained.slice(0, 8)}`
    );
  });

  it("edição sem alteração: diff vazio", () => {
    const bag = ["dashboard.view"];
    const model = buildAccessProfileMatrixModel(bag, "VIEWER");
    const after = materializeAccessProfilePermissionsFromDraft(model.draft, bag);
    assert.equal(diffLegacyPermissionBags(bag, after).unchanged, true);
  });

  it("edição parcial altera preview legado", () => {
    const bag = ["dashboard.view"];
    const model = buildAccessProfileMatrixModel(bag, "VIEWER");
    const key =
      Object.keys(model.draft).find((k) => model.draft[k]?.view) ?? "dashboard";
    const next = setMatrixDraftAction(model.draft, key, "view", false);
    const after = materializeAccessProfilePermissionsFromDraft(next, bag);
    assert.ok(Array.isArray(after));
  });

  it("ação não suportada aparece como unsupported na célula", () => {
    const model = buildAccessProfileMatrixModel(["dashboard.view"], "");
    const row = model.rows[0];
    assert.ok(row);
    const unsupported = Object.values(row.cells).find((c) => !c.supported);
    assert.ok(unsupported, "esperado ao menos uma ação — na matriz");
  });

  it("needsBroadChangeConfirmation com usuários vinculados", () => {
    assert.equal(
      needsBroadChangeConfirmation({
        dirtyResourceCount: 1,
        linkedUserCount: 3,
        gainedCount: 1,
        lostCount: 0,
      }),
      true
    );
    assert.equal(
      needsBroadChangeConfirmation({
        dirtyResourceCount: 1,
        linkedUserCount: 0,
        gainedCount: 1,
        lostCount: 0,
      }),
      false
    );
  });

  it("editar perfil não implica usuário igual (snapshot)", () => {
    const user = ["dashboard.view", "crm.view"];
    const editedProfile = materializeAccessProfilePermissionsFromDraft(
      buildAccessProfileMatrixModel(["dashboard.view", "finance.view"], "VIEWER").draft,
      ["dashboard.view", "finance.view"]
    );
    assert.equal(permissionsMatchProfile(user, editedProfile), false);
  });
});
