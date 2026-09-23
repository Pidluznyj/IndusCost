import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEmployeePermissionBag,
  buildEmployeeSystemLinksCapsFromPermissions,
  resolveEmployeesEditorClientGate,
  canCreateEmployees,
  canDeleteEmployee,
  canListEmployees,
  canManageEmployeeEpi,
  canManageEmployeeLinks,
  canManageEmployeeUserLink,
  canUpdateEmployees,
  canViewEmployeeAdministrativeData,
  canViewEmployeeLinks,
  canViewEmployeePersonalData,
  canViewEmployeeSensitiveData,
  canViewEmployeesDashboard,
  assertEmployeesDeleteSuperAdmin,
  EmployeesAccessError,
} from "./employeesPermissions.ts";
import {
  buildPeopleProfileCapabilities,
  canViewCompensationValues,
} from "./peopleProfileCapabilities.ts";
import {
  buildCanonicalAccessSnapshot,
  buildRequireResourceInput,
} from "./security/requireResource.ts";
import { resolveCanonicalEffectiveAccess } from "./security/effectiveAccess/index.ts";
import { projectAccessProfilePermissionsToSnapshot } from "./security/effectiveAccess/canonicalEffectiveAccess.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function check(perms: string[]) {
  const set = new Set(perms);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (list: readonly string[]) => list.some((p) => set.has(p)),
  };
}

describe("employeesPermissions — acesso efetivo legado", () => {
  it("employees.edit cobre create/update/facetas", () => {
    const c = check(["employees.edit"]);
    assert.equal(canCreateEmployees(c), true);
    assert.equal(canUpdateEmployees(c), true);
    assert.equal(canViewEmployeePersonalData(c), true);
    assert.equal(canViewEmployeeSensitiveData(c), true);
    assert.equal(canViewEmployeeAdministrativeData(c), true);
    assert.equal(canViewEmployeeLinks(c), true);
    assert.equal(canManageEmployeeLinks(c), true);
    assert.equal(canManageEmployeeUserLink(c), true);
    assert.equal(canManageEmployeeEpi(c), true);
  });

  it("somente leitura: lista sem PII/salário/vínculo manage", () => {
    const c = check(["employees.view"]);
    assert.equal(canListEmployees(c), true);
    assert.equal(canCreateEmployees(c), false);
    assert.equal(canViewEmployeePersonalData(c), false);
    assert.equal(canViewEmployeeSensitiveData(c), false);
    assert.equal(canManageEmployeeLinks(c), false);
    assert.equal(canViewEmployeeLinks(c), true);
    assert.equal(canViewEmployeesDashboard(c), false);
  });

  it("dashboard.view libera painel sem sensitive; edit também libera", () => {
    assert.equal(
      canViewEmployeesDashboard(check(["employees.dashboard.view"])),
      true
    );
    assert.equal(canViewEmployeesDashboard(check(["employees.edit"])), true);
    assert.equal(
      canViewEmployeeSensitiveData(check(["employees.dashboard.view"])),
      false
    );
  });

  it("deny específico de vínculos mantém view e barra manage", () => {
    const c = check(["employees.view", "employees.links.view"]);
    assert.equal(canViewEmployeeLinks(c), true);
    assert.equal(canManageEmployeeLinks(c), false);
  });

  it("faceta fina sem edit", () => {
    const c = check(["employees.view", "employees.personal_data.view"]);
    assert.equal(canViewEmployeePersonalData(c), true);
    assert.equal(canViewEmployeeSensitiveData(c), false);
  });

  it("P09: costs.view NÃO lista RH", () => {
    assert.equal(canListEmployees(check(["costs.view"])), false);
    assert.equal(canListEmployees(check(["employees.view"])), true);
  });
});

describe("employeesPermissions — caps system-links", () => {
  it("sem commissions.view não vê comercial", () => {
    const caps = buildEmployeeSystemLinksCapsFromPermissions(["employees.view"]);
    assert.equal(caps.canViewCommissions, false);
    assert.equal(caps.canViewCustomers, false);
    assert.equal(caps.canManagePersonLink, false);
  });

  it("ADMIN bypass", () => {
    const caps = buildEmployeeSystemLinksCapsFromPermissions([], "ADMIN");
    assert.equal(caps.canViewPii, true);
    assert.equal(caps.canViewEmployees, true);
  });
});

describe("employeesPermissions — exclusão SUPER_ADMIN", () => {
  it("canDeleteEmployee só para super admin", () => {
    assert.equal(canDeleteEmployee({ isSuperAdmin: () => true }), true);
    assert.equal(canDeleteEmployee({ isSuperAdmin: () => false }), false);
  });

  it("assertEmployeesDeleteSuperAdmin bloqueia não-super-admin", () => {
    assert.throws(
      () => assertEmployeesDeleteSuperAdmin({ role: "ADMIN" }),
      (err: unknown) =>
        err instanceof EmployeesAccessError &&
        /super administrador/i.test((err as Error).message)
    );
    assert.throws(() => assertEmployeesDeleteSuperAdmin(null), EmployeesAccessError);
    assert.doesNotThrow(() =>
      assertEmployeesDeleteSuperAdmin({ role: "SUPER_ADMIN" })
    );
  });
});

describe("employeesPermissions — bag do servidor (editor de RH)", () => {
  const legacy = (perms: string[]) => {
    const set = new Set(perms);
    return (p: string) => set.has(p);
  };
  const VALUES = "admin.employees.compensation_values";
  const MANAGE_CAPS = [
    "canManageProfessional",
    "canManageCareer",
    "canManageCompensation",
    "canManageBenefits",
    "canManagePersonal",
    "canManageEmergency",
    "canManageEpi",
    "canManageDocuments",
    "canManageAbsences",
    "canManageNotes",
  ] as const;

  it("editor só pelo canônico (admin.employees:update) recebe tudo, inclusive valores", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view", "employees.create"]),
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: ["admin.employees"],
        overrideDenied: [],
      },
    });
    assert.equal(bag.isHrEditor, true);
    assert.equal(bag.hasPermission("employees.edit"), true);
    assert.equal(bag.hasAnyPermission?.(["employees.career.manage", "employees.edit"]), true);
    assert.equal(bag.isDenied?.("employees.compensation.values.view"), false);
    assert.ok(bag.canonicalViewResources?.includes(VALUES));

    const caps = buildPeopleProfileCapabilities(bag);
    for (const key of MANAGE_CAPS) assert.equal(caps[key], true, key);
    assert.equal(caps.canViewCompensationValues, true);
    assert.equal(caps.canViewPersonal, true);
    assert.equal(caps.canViewEmergency, true);
    assert.equal(caps.canViewRestrictedNotes, true);
    assert.equal(caps.canViewAudit, true);
    assert.equal(caps.accessScope, "ALL");

    // Listagem (GET /api/employees): nada redigido para o editor.
    assert.equal(canUpdateEmployees(bag), true);
    assert.equal(canViewEmployeePersonalData(bag), true);
    assert.equal(canViewEmployeeSensitiveData(bag), true);
    assert.equal(canViewEmployeeAdministrativeData(bag), true);
    assert.equal(canViewCompensationValues(bag), true);
  });

  it("editor sem NENHUMA chave legada ainda vira editor pelo canônico", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: () => false,
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: ["admin.employees"],
      },
    });
    const caps = buildPeopleProfileCapabilities(bag);
    assert.equal(bag.isHrEditor, true);
    assert.equal(caps.canViewProfile, true);
    assert.equal(caps.canManageCompensation, true);
    assert.equal(caps.canViewCompensationValues, true);
  });

  it("deny individual explícito de valores vence o editor; demais manage continuam", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view"]),
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: ["admin.employees"],
        overrideDenied: [`${VALUES}:view`],
      },
    });
    assert.equal(bag.isHrEditor, true);
    assert.equal(bag.isDenied?.("employees.compensation.values.view"), true);
    assert.equal(bag.canonicalViewResources?.includes(VALUES), false);

    const caps = buildPeopleProfileCapabilities(bag);
    assert.equal(caps.canViewCompensationValues, false);
    assert.equal(caps.canManageCompensation, false);
    for (const key of MANAGE_CAPS) {
      if (key === "canManageCompensation") continue;
      assert.equal(caps[key], true, key);
    }
  });

  it("deny explícito vence também o employees.edit legado", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.edit"]),
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: [],
        overrideDenied: [`${VALUES}:view`],
      },
    });
    assert.equal(bag.isHrEditor, true);
    assert.equal(canViewCompensationValues(bag), false);
  });

  it("employees.edit legado sem view canônico de valores → agora vê valores", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.edit"]),
      canonicalAccess: { viewResources: ["admin.employees"] },
    });
    assert.equal(bag.isHrEditor, true);
    assert.equal(bag.isDenied?.("employees.compensation.values.view"), false);
    const caps = buildPeopleProfileCapabilities(bag);
    assert.equal(caps.canViewCompensationValues, true);
    assert.equal(caps.canManageCompensation, true);
  });

  it("deny de OUTRO recurso/ação não bloqueia valores do editor", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: () => false,
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: ["admin.employees"],
        overrideDenied: [`${VALUES}:manage`, "admin.employees.links:view"],
      },
    });
    assert.equal(canViewCompensationValues(bag), true);
  });

  it("leitor comum (sem update) permanece como antes", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view"]),
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: [],
        overrideDenied: [],
      },
    });
    assert.equal(bag.isHrEditor, false);
    assert.equal(bag.hasPermission("employees.edit"), false);
    assert.deepEqual(bag.canonicalViewResources, ["admin.employees"]);
    assert.equal(bag.isDenied?.("employees.compensation.values.view"), true);
    assert.equal(bag.isDenied?.("employees.view"), false);

    const caps = buildPeopleProfileCapabilities(bag);
    assert.equal(caps.canViewProfile, true);
    assert.equal(caps.canViewCompensationValues, false);
    for (const key of MANAGE_CAPS) assert.equal(caps[key], false, key);
    assert.equal(canViewEmployeePersonalData(bag), false);
    assert.equal(canViewEmployeeSensitiveData(bag), false);
  });

  it("update em OUTRO recurso não cria editor de RH", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view"]),
      canonicalAccess: {
        viewResources: ["admin.employees"],
        updateResources: ["admin.employees.dashboard", "admin.goals"],
      },
    });
    assert.equal(bag.isHrEditor, false);
    assert.equal(bag.hasPermission("employees.edit"), false);
  });

  it("leitor com view canônico de valores continua vendo valores sem manage", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view"]),
      canonicalAccess: { viewResources: ["admin.employees", VALUES] },
    });
    const caps = buildPeopleProfileCapabilities(bag);
    assert.equal(caps.canViewCompensationValues, true);
    assert.equal(caps.canManageCompensation, false);
  });

  it("sem fotografia canônica: comportamento legado inalterado", () => {
    const viewer = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view"]),
    });
    assert.equal(viewer.isHrEditor, false);
    assert.equal(viewer.canonicalViewResources, undefined);
    assert.equal(viewer.isDenied?.("employees.compensation.values.view"), false);
    assert.equal(canViewCompensationValues(viewer), false);

    const sensitive = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.view", "employees.sensitive_data.view"]),
      canonicalAccess: null,
    });
    assert.equal(canViewCompensationValues(sensitive), true);

    const editor = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.edit"]),
      canonicalAccess: null,
    });
    assert.equal(editor.isHrEditor, true);
    assert.equal(editor.canonicalViewResources, undefined);
    assert.equal(canViewCompensationValues(editor), true);
  });

  it("não muta a fotografia recebida", () => {
    const viewResources: readonly string[] = Object.freeze(["admin.employees"]);
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: () => false,
      canonicalAccess: { viewResources, updateResources: ["admin.employees"] },
    });
    assert.deepEqual(viewResources, ["admin.employees"]);
    assert.deepEqual(bag.canonicalViewResources, ["admin.employees", VALUES]);
  });
});

describe("requireResource — fotografia canônica (buildCanonicalAccessSnapshot)", () => {
  it("separa view/update e só lista denies individuais explícitos", () => {
    const snapshot = buildCanonicalAccessSnapshot({
      allowed: [
        { resourceKey: "admin.employees", action: "view", source: "PROFILE" },
        { resourceKey: "admin.employees", action: "update", source: "OVERRIDE_ALLOW" },
        { resourceKey: "admin.employees", action: "create", source: "PROFILE" },
        { resourceKey: "admin", action: "view", source: "ROLE" },
      ],
      denied: [
        {
          resourceKey: "admin.employees.compensation_values",
          action: "view",
          source: "OVERRIDE_DENY",
        },
        { resourceKey: "admin.employees.links", action: "view", source: "ANCESTOR_VIEW_DENY" },
        { resourceKey: "admin.employees.links", action: "manage", source: "DENY_DEFAULT" },
        { resourceKey: "admin.employees.user_link", action: "manage", source: "DENY_DEFAULT" },
      ],
    });
    assert.deepEqual(snapshot.viewResources, ["admin", "admin.employees"]);
    assert.deepEqual(snapshot.updateResources, ["admin.employees"]);
    assert.deepEqual(snapshot.overrideDenied, [
      "admin.employees.compensation_values:view",
      "admin.employees.links:view",
    ]);
  });

  it("motor real: override update em admin.employees + deny de valores → editor sem R$", () => {
    const result = resolveCanonicalEffectiveAccess(
      buildRequireResourceInput(
        { id: "u1", role: "USER" },
        {
          profileSnapshot: { "admin.employees": { view: true } },
          overrides: {
            "admin.employees": { update: "allow" },
            "admin.employees.compensation_values": { view: "deny" },
          },
        }
      )
    );
    const snapshot = buildCanonicalAccessSnapshot(result);
    assert.ok(snapshot.updateResources?.includes("admin.employees"));
    assert.ok(snapshot.overrideDenied?.includes("admin.employees.compensation_values:view"));
    // DENY_DEFAULT (ausência de grant) não é deny explícito.
    assert.equal(snapshot.overrideDenied?.includes("admin.employees.links:manage"), false);

    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: () => false,
      canonicalAccess: snapshot,
    });
    const caps = buildPeopleProfileCapabilities(bag);
    assert.equal(bag.isHrEditor, true);
    assert.equal(caps.canManageCareer, true);
    assert.equal(caps.canViewCompensationValues, false);
  });

  it("motor real: SUPER_ADMIN é editor com valores", () => {
    const snapshot = buildCanonicalAccessSnapshot(
      resolveCanonicalEffectiveAccess(
        buildRequireResourceInput({ id: "root", role: "SUPER_ADMIN" })
      )
    );
    assert.deepEqual(snapshot.overrideDenied, []);
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: () => false,
      canonicalAccess: snapshot,
    });
    assert.equal(bag.isHrEditor, true);
    assert.equal(canViewCompensationValues(bag), true);
  });
});
describe("employeesPermissions — bags gravados antes do pin de employees.edit", () => {
  const legacy = (perms: string[]) => {
    const set = new Set(perms);
    return (p: string) => set.has(p);
  };

  it("motor real: perfil com employees.create sem employees.edit não tem update canônico, mas é editor", () => {
    // Bag típico de "editar" marcado em Pessoas/RH antes do pin (matriz mostrava editar ✓).
    const profileBag = ["employees.view", "employees.profile.view", "employees.create"];
    const snapshot = buildCanonicalAccessSnapshot(
      resolveCanonicalEffectiveAccess(
        buildRequireResourceInput(
          { id: "u1", role: "USER" },
          { profileSnapshot: projectAccessProfilePermissionsToSnapshot(profileBag) }
        )
      )
    );
    assert.ok(snapshot.createResources?.includes("admin.employees"));
    assert.equal(snapshot.updateResources?.includes("admin.employees"), false);

    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(profileBag),
      canonicalAccess: snapshot,
    });
    assert.equal(bag.isHrEditor, true);
    assert.equal(canUpdateEmployees(bag), true);
    assert.equal(canViewEmployeePersonalData(bag), true);
    assert.equal(buildPeopleProfileCapabilities(bag).canManageCompensation, true);
  });

  it("só 'ver' no Dashboard de Pessoas (ou view no módulo) não vira editor", () => {
    const bag = buildEmployeePermissionBag({
      hasLegacyPermission: legacy(["employees.dashboard.view", "employees.view"]),
      canonicalAccess: {
        viewResources: ["admin.employees", "admin.employees.dashboard"],
        updateResources: [],
        createResources: [],
      },
    });
    assert.equal(bag.isHrEditor, false);
    assert.equal(canUpdateEmployees(bag), false);
    assert.equal(canViewEmployeePersonalData(bag), false);
  });

  it("gate do cliente (botão Editar/Novo) segue a mesma regra", () => {
    const gate = (dto: Record<string, boolean>, hasCanonicalDto = true) =>
      resolveEmployeesEditorClientGate({
        isSuperAdmin: false,
        hasCanonicalDto,
        canPerformAction: (k, a) => dto[`${k}:${a}`] === true,
        legacyCanEdit: () => dto.legacyEdit === true,
        legacyCanCreate: () => dto.legacyCreate === true,
      });
    assert.deepEqual(gate({ "admin.employees:update": true }), { canEdit: true, canCreate: true });
    assert.deepEqual(gate({ "admin.employees:create": true }), { canEdit: true, canCreate: true });
    // DTO presente: "ver" no dashboard (que no legado responderia employees.edit) não basta.
    assert.deepEqual(gate({ "admin.employees.dashboard:view": true, legacyEdit: true }), {
      canEdit: false,
      canCreate: false,
    });
    // Sem DTO: cai no bag legado.
    assert.deepEqual(gate({ legacyEdit: true }, false), { canEdit: true, canCreate: true });
    assert.deepEqual(gate({ legacyCreate: true }, false), { canEdit: false, canCreate: true });
    assert.deepEqual(
      resolveEmployeesEditorClientGate({
        isSuperAdmin: true,
        hasCanonicalDto: true,
        canPerformAction: () => false,
        legacyCanEdit: () => false,
        legacyCanCreate: () => false,
      }),
      { canEdit: true, canCreate: true }
    );
  });

  it("server.ts: escritas do cadastro passam pelo guard que reconhece o editor", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "server.ts"),
      "utf8"
    );
    assert.ok(
      src.includes(
        'app.post("/api/employees", requireAppAuth, requireResourceOrHrEditor(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.create)'
      )
    );
    assert.ok(
      src.includes(
        'app.put("/api/employees/:id", requireAppAuth, requireResourceOrHrEditor(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.update)'
      )
    );
    assert.ok(
      src.includes(
        'app.patch("/api/employees/:id/status", requireAppAuth, requireResourceOrHrEditor(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.update)'
      )
    );
    assert.ok(src.includes("action === EMPLOYEES_ACTIONS.create || action === EMPLOYEES_ACTIONS.update"));
    // Listagem continua no guard canônico puro.
    assert.ok(
      src.includes(
        'app.get("/api/employees", requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view)'
      )
    );
  });
});
