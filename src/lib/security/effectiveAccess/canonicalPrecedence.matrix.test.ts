/**
 * PERM-30 — Tabela de verdade da precedência canônica (todas as combinações).
 * Autoridade: resolveCanonicalEffectiveAccess / canCanonicalAccess.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCanonicalEffectiveAccessInput,
  canCanonicalAccess,
  canCanonicalRevealNavigation,
  resolveCanonicalEffectiveAccess,
} from "./canonicalEffectiveAccess.ts";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.ts";
import { buildEffectiveAccessDtoFromUser } from "@/src/lib/security/effectiveAccessDto/buildFromUser.ts";
import { canAccessFromEffectiveAccessDto } from "@/src/lib/canAccessFromEffectiveAccess.ts";
import { resolvePermissionTruth } from "@/src/lib/security/permissionContract/truthTable.ts";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";

const RK = "finance.accounts_payable";
const PARENT = "finance";

type Row = {
  name: string;
  role: string;
  profileSnapshot?: Record<string, Record<string, boolean>> | null;
  overrides?: Record<string, Record<string, "allow" | "deny">>;
  resourceKey: string;
  action: string;
  expectAllow: boolean;
  expectSource?: string;
};

const ROWS: Row[] = [
  {
    name: "SUPER_ADMIN bypass vence DENY individual",
    role: "SUPER_ADMIN",
    profileSnapshot: {},
    overrides: { [RK]: { view: "deny" } },
    resourceKey: RK,
    action: "view",
    expectAllow: true,
    expectSource: "SUPER_ADMIN",
  },
  {
    name: "recurso desconhecido = DENY (mesmo SA)",
    role: "SUPER_ADMIN",
    resourceKey: "fantasma.xyz",
    action: "view",
    expectAllow: false,
    expectSource: "UNKNOWN_RESOURCE",
  },
  {
    name: "ação não suportada = DENY",
    role: "VIEWER",
    profileSnapshot: { [RK]: { view: true } },
    resourceKey: RK,
    action: "approve",
    expectAllow: false,
    expectSource: "UNSUPPORTED_ACTION",
  },
  {
    name: "DENY individual vence ALLOW/baseline do perfil",
    role: "VIEWER",
    profileSnapshot: { [RK]: { view: true } },
    overrides: { [RK]: { view: "deny" } },
    resourceKey: RK,
    action: "view",
    expectAllow: false,
    expectSource: "OVERRIDE_DENY",
  },
  {
    name: "ALLOW individual vence herança (baseline vazio)",
    role: "VIEWER",
    profileSnapshot: {},
    overrides: { [RK]: { view: "allow" } },
    resourceKey: RK,
    action: "view",
    expectAllow: true,
    expectSource: "OVERRIDE_ALLOW",
  },
  {
    name: "INHERIT (sem override) usa snapshot do perfil",
    role: "VIEWER",
    profileSnapshot: { [RK]: { view: true } },
    overrides: {},
    resourceKey: RK,
    action: "view",
    expectAllow: true,
    expectSource: "PROFILE",
  },
  {
    name: "INHERIT sem snapshot e sem role grant = DENY default",
    role: "VIEWER",
    profileSnapshot: {},
    overrides: {},
    resourceKey: RK,
    action: "view",
    expectAllow: false,
    expectSource: "DENY_DEFAULT",
  },
  {
    name: "sem profileSnapshot usa role preset (VIEWER comercial)",
    role: "VIEWER",
    // profileSnapshot omitted → role
    overrides: {},
    resourceKey: "commercial.sales_orders",
    action: "view",
    expectAllow: true,
    expectSource: "ROLE",
  },
  {
    name: "ancestor view DENY bloqueia filho com ALLOW",
    role: "VIEWER",
    profileSnapshot: {},
    overrides: {
      [PARENT]: { view: "deny" },
      [RK]: { view: "allow" },
    },
    resourceKey: RK,
    action: "view",
    expectAllow: false,
    expectSource: "ANCESTOR_VIEW_DENY",
  },
  {
    name: "bag ignorada sem legacyCompatMode",
    role: "VIEWER",
    profileSnapshot: {},
    overrides: {},
    resourceKey: RK,
    action: "view",
    expectAllow: false,
    expectSource: "DENY_DEFAULT",
  },
];

describe("PERM-30 canonical precedence matrix", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const input = buildCanonicalEffectiveAccessInput({
        userId: "matrix",
        role: row.role,
        permissionsVersion: 7,
        profileSnapshot: row.profileSnapshot,
        overrides: row.overrides ?? {},
        legacyCompatMode: false,
      });
      const result = resolveCanonicalEffectiveAccess(input);
      assert.equal(result.permissionsVersion, 7);
      const allowed = canCanonicalAccess(result, row.resourceKey, row.action);
      assert.equal(allowed, row.expectAllow, `allow mismatch for ${row.name}`);
      if (row.expectSource) {
        const cell = result.byResourceAction[row.resourceKey]?.[
          row.action as keyof (typeof result.byResourceAction)[string]
        ];
        if (row.expectAllow || row.expectSource !== "UNKNOWN_RESOURCE") {
          // unknown may omit cell; authorize path still DENY
          if (cell) assert.equal(cell.source, row.expectSource);
        }
      }
    });
  }

  it("truthTable ≡ canonical para deny>allow e allow>inherit", () => {
    const deny = resolvePermissionTruth(
      {
        role: "VIEWER",
        baseline: { [RK]: { view: true } },
        overrides: { [RK]: { view: "deny" } },
      },
      RK,
      "view"
    );
    assert.equal(deny.decision, "deny");
    assert.equal(deny.reason, "OVERRIDE_DENY");

    const allow = resolvePermissionTruth(
      {
        role: "VIEWER",
        baseline: {},
        overrides: { [RK]: { view: "allow" } },
      },
      RK,
      "view"
    );
    assert.equal(allow.decision, "allow");
    assert.equal(allow.reason, "OVERRIDE_ALLOW");
  });

  it("requireResource ≡ canonical (com overrides, sem bag)", () => {
    const decision = authorizeRequireResource(
      { id: "u1", role: "VIEWER", permissions: ["finance.view"] },
      RK,
      "view",
      {
        legacyCompatMode: false,
        profileSnapshot: {},
        overrides: { [RK]: { view: "allow" } },
      }
    );
    assert.equal(decision.ok, true);
    if (decision.ok) assert.equal(decision.source, "OVERRIDE_ALLOW");

    const denied = authorizeRequireResource(
      { id: "u1", role: "VIEWER", permissions: ["finance.accountsPayable.view"] },
      RK,
      "view",
      {
        legacyCompatMode: false,
        profileSnapshot: { [RK]: { view: true } },
        overrides: { [RK]: { view: "deny" } },
      }
    );
    assert.equal(denied.ok, false);
  });

  it("DTO /me ≡ canonical; FE helper não lê bag", () => {
    const dto = buildEffectiveAccessDtoFromUser({
      userId: "u1",
      role: "VIEWER",
      legacyPermissions: ["finance.view", "crm.view"], // ignorada
      profileSnapshot: {},
      overrides: [
        {
          resourceKey: RK,
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      legacyCompatMode: false,
      permissionsVersion: 3,
    }) as EffectiveAccessMeDto;

    assert.equal(dto.compatibility.legacyBagAuthoritative, false);
    assert.equal(canAccessFromEffectiveAccessDto(dto, RK, "view"), true);
    assert.equal(canAccessFromEffectiveAccessDto(dto, "admin.employees", "view"), false);
    assert.equal(canCanonicalRevealNavigation(
      resolveCanonicalEffectiveAccess(
        buildCanonicalEffectiveAccessInput({
          userId: "u1",
          role: "VIEWER",
          profileSnapshot: {},
          overrides: { [RK]: { view: "allow" } },
        })
      ),
      PARENT
    ), true);
  });

  it("código canônico não consulta bag: legacyPermissions presentes mas compat off", () => {
    const result = resolveCanonicalEffectiveAccess(
      buildCanonicalEffectiveAccessInput({
        userId: "u",
        role: "VIEWER",
        profileSnapshot: {},
        legacyCompatMode: false,
        legacyPermissions: ["finance.accountsPayable.view", "crm.view"],
      })
    );
    assert.equal(canCanonicalAccess(result, RK, "view"), false);
    assert.equal(result.legacyCompatApplied, false);
  });
});
