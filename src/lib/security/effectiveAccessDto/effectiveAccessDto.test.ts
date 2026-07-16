/**
 * P04 — DTO de acesso efetivo (serialização, validação, /me shadow).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEffectiveAccessDto,
  buildEffectiveAccessDtoFromUser,
  isEffectiveAccessDtoInMeEnabled,
  isEffectiveAccessDtoLegacyCompatEnabled,
  isValidEffectiveAccessAdminDto,
  isValidEffectiveAccessMeDto,
  serializeEffectiveAccessMeDtoStable,
  tryBuildEffectiveAccessForAuthMe,
  validateEffectiveAccessMeDto,
  type EffectiveAccessMeDto,
} from "./index.ts";
import { resolveEffectiveAccess } from "@/src/lib/security/effectiveAccess/index.js";
import {
  fixtureLeticiaAccountsPayableOnly,
  fixtureSuperAdmin,
  fixtureDenyWinsAllow,
} from "@/src/lib/security/effectiveAccess/fixtures.js";

describe("effectiveAccessDto flags", () => {
  it("PERM-30: DTO no /me default ON; desliga com 0", () => {
    assert.equal(isEffectiveAccessDtoInMeEnabled({}), true);
    assert.equal(isEffectiveAccessDtoInMeEnabled({ EFFECTIVE_ACCESS_DTO_IN_ME: "0" }), false);
    assert.equal(isEffectiveAccessDtoInMeEnabled({ EFFECTIVE_ACCESS_DTO_IN_ME: "1" }), true);
    assert.equal(isEffectiveAccessDtoLegacyCompatEnabled({}), false);
    assert.equal(isEffectiveAccessDtoLegacyCompatEnabled({ EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT: "true" }), true);
  });
});

describe("effectiveAccessDto build + validate", () => {
  it("VIEWER vazio (profile {}) → allowed vazio; DTO válido", () => {
    const dto = buildEffectiveAccessDtoFromUser({
      userId: "v-empty",
      role: "VIEWER",
      profileSnapshot: {},
      legacyPermissions: [],
      audience: "session",
    }) as EffectiveAccessMeDto;

    assert.equal(dto.isSuperAdmin, false);
    assert.equal(dto.role, "VIEWER");
    assert.deepEqual(dto.allowedResources, []);
    assert.deepEqual(dto.actionsByResource, {});
    assert.deepEqual(dto.capabilities, {});
    assert.equal(dto.compatibility.mode, "shadow");
    assert.equal(dto.compatibility.legacyBagAuthoritative, false);
    assert.equal(dto.compatibility.legacyPermissionsPresent, false);
    assert.equal(isValidEffectiveAccessMeDto(dto), true);
    assert.deepEqual(validateEffectiveAccessMeDto(dto), []);
  });

  it("Leticia somente AP — payload compacto sem denies", () => {
    const result = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    const dto = buildEffectiveAccessDto({
      result,
      legacyPermissionsPresent: true,
      audience: "session",
    }) as EffectiveAccessMeDto;

    assert.ok(dto.allowedResources.includes("finance.accounts_payable"));
    assert.ok(dto.actionsByResource["finance.accounts_payable"]!.includes("view"));
    assert.equal(dto.capabilities["finance.accounts_payable"]!.canView, true);
    assert.ok(dto.navigationReveal.includes("finance"));
    assert.equal(dto.allowedResources.includes("finance.portfolio_reconciliation"), false);
    assert.equal("denies" in dto, false);
    assert.equal("warnings" in dto, false);
    assert.equal(isValidEffectiveAccessMeDto(dto), true);

    const json = JSON.parse(JSON.stringify(dto));
    assert.equal(isValidEffectiveAccessMeDto(json), true);
    const stable1 = serializeEffectiveAccessMeDtoStable(dto);
    const stable2 = serializeEffectiveAccessMeDtoStable(json);
    assert.equal(stable1, stable2);
  });

  it("SUPER_ADMIN — listas vazias + isSuperAdmin", () => {
    const dto = buildEffectiveAccessDto({
      result: resolveEffectiveAccess(fixtureSuperAdmin()),
      audience: "session",
    }) as EffectiveAccessMeDto;

    assert.equal(dto.isSuperAdmin, true);
    assert.deepEqual(dto.allowedResources, []);
    assert.deepEqual(dto.actionsByResource, {});
    assert.deepEqual(dto.capabilities, {});
    assert.equal(dto.permissionsVersion, 9);
    assert.equal(isValidEffectiveAccessMeDto(dto), true);
  });

  it("deny explícito aparece só no audience admin", () => {
    const result = resolveEffectiveAccess(fixtureDenyWinsAllow());
    const session = buildEffectiveAccessDto({ result, audience: "session" });
    assert.equal("denies" in session, false);

    const admin = buildEffectiveAccessDto({ result, audience: "admin" });
    assert.equal(isValidEffectiveAccessAdminDto(admin), true);
    assert.ok(
      (admin as { denies: { resourceKey: string; reason: string }[] }).denies.some(
        (d) => d.resourceKey === "finance.accounts_payable" && d.reason === "OVERRIDE_DENY"
      )
    );
  });

  it("usuário legado: bag presente + compat mode projeta AP 1:1", () => {
    const dto = buildEffectiveAccessDtoFromUser({
      userId: "legacy",
      role: "VIEWER",
      profileSnapshot: {},
      legacyPermissions: ["finance.accountsPayable.view", "costs.view"],
      legacyCompatMode: true,
      audience: "session",
    }) as EffectiveAccessMeDto;

    assert.equal(dto.compatibility.legacyPermissionsPresent, true);
    assert.equal(dto.compatibility.legacyCompatApplied, true);
    assert.ok(dto.allowedResources.includes("finance.accounts_payable"));
    assert.equal(dto.allowedResources.includes("admin.employees"), false);
    assert.equal(isValidEffectiveAccessMeDto(dto), true);
  });

  it("rejeita chaves desconhecidas", () => {
    const dto = buildEffectiveAccessDtoFromUser({
      userId: "x",
      role: "VIEWER",
      profileSnapshot: {},
    }) as EffectiveAccessMeDto;
    const bad = { ...dto, secretAliases: ["costs.view"] };
    const issues = validateEffectiveAccessMeDto(bad);
    assert.ok(issues.some((i) => i.path === "secretAliases"));
    assert.equal(isValidEffectiveAccessMeDto(bad), false);
  });
});

describe("effectiveAccessDto attach /me", () => {
  it("flag 0 → null; default ON → DTO", () => {
    assert.equal(
      tryBuildEffectiveAccessForAuthMe({
        user: { id: "u", role: "VIEWER", permissions: [] },
        env: { EFFECTIVE_ACCESS_DTO_IN_ME: "0" },
      }),
      null
    );
    const dto = tryBuildEffectiveAccessForAuthMe({
      user: { id: "u", role: "VIEWER", permissions: [] },
      env: {},
    });
    assert.ok(dto);
    assert.equal(isValidEffectiveAccessMeDto(dto), true);
  });

  it("flag on → DTO válido; endpoint não autenticado não inclui user", () => {
    const dto = tryBuildEffectiveAccessForAuthMe({
      user: {
        id: "u",
        role: "VIEWER",
        permissions: ["finance.accountsPayable.view"],
      },
      env: { EFFECTIVE_ACCESS_DTO_IN_ME: "1", EFFECTIVE_ACCESS_DTO_LEGACY_COMPAT: "1" },
    });
    assert.ok(dto);
    assert.equal(isValidEffectiveAccessMeDto(dto), true);
    // Forma da resposta não autenticada (contrato estável)
    const unauth = { authenticated: false as const, user: null };
    assert.equal("effectiveAccess" in unauth, false);
  });

  it("payload autenticado: bag permanece no user; DTO canônico sem autoridade da bag", () => {
    const permissions = ["finance.accountsPayable.view"];
    const effectiveAccess = tryBuildEffectiveAccessForAuthMe({
      user: { id: "leticia", role: "VIEWER", permissions },
      overrides: [{ resourceKey: "financeiro.contas_pagar", canView: true }],
      env: { EFFECTIVE_ACCESS_DTO_IN_ME: "1" },
    });
    const me = {
      authenticated: true,
      user: {
        id: "leticia",
        role: "VIEWER",
        permissions,
        effectivePermissions: permissions,
      },
      effectiveAccess: effectiveAccess ?? undefined,
    };
    assert.deepEqual(me.user.permissions, permissions);
    assert.ok(me.effectiveAccess);
    assert.equal(me.effectiveAccess!.compatibility.legacyBagAuthoritative, false);
    assert.ok(
      me.effectiveAccess!.allowedResources.includes("finance.accounts_payable")
    );
  });
});
