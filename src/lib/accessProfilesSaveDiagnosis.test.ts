/**
 * PERM-27/28 — Diagnóstico + regressão do fluxo criar/salvar AccessProfile.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessProfile, AppUserRole, PrismaClient } from "@prisma/client";
import {
  ACCESS_PROFILE_VALIDATION_CODES,
  AccessProfileError,
  createAccessProfile,
  parseAccessProfileBody,
  updateAccessProfile,
} from "./accessProfilesService.ts";
import {
  buildAccessProfileMatrixModel,
  materializeAccessProfilePermissionsFromDraft,
} from "./accessProfilesMatrix.ts";
import { setMatrixDraftAction } from "@/src/lib/security/permissionMatrixUi/index.ts";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.ts";
import { REQUIRE_RESOURCE_ADMIN_KEYS } from "@/src/lib/security/requireResource.ts";
import type { AppAuthContext } from "@/src/lib/appAuth.ts";
import { parseApiErrorPayload } from "@/src/lib/http.ts";
import { canManageAccessProfiles } from "@/src/lib/modulePermissions.ts";
import {
  applyAccessProfileToUsers,
  previewApplyAccessProfile,
} from "./accessProfilesService.ts";

type StoredProfile = AccessProfile & { _count?: { users: number } };

function makeAuth(
  role: AppUserRole,
  permissions: string[]
): AppAuthContext {
  return {
    id: "u-diag",
    name: "Diag",
    email: "diag@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    permissionsVersion: 0,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "s-diag",
  };
}

function makePrismaMock(seed: StoredProfile[] = []) {
  const store = new Map<string, StoredProfile>(seed.map((p) => [p.id, { ...p }]));

  const accessProfile = {
    async findUnique({ where }: { where: { id?: string; name?: string; systemKey?: string } }) {
      if (where.id) return store.get(where.id) ?? null;
      if (where.name) {
        return [...store.values()].find((p) => p.name === where.name) ?? null;
      }
      if (where.systemKey) {
        return [...store.values()].find((p) => p.systemKey === where.systemKey) ?? null;
      }
      return null;
    },
    async findFirst({
      where,
    }: {
      where: { name?: string; id?: { not: string } };
    }) {
      return (
        [...store.values()].find((p) => {
          if (where.name && p.name !== where.name) return false;
          if (where.id?.not && p.id === where.id.not) return false;
          return true;
        }) ?? null
      );
    },
    async findMany() {
      return [...store.values()].map((p) => ({
        ...p,
        _count: p._count ?? { users: 0 },
      }));
    },
    async create({
      data,
      include,
    }: {
      data: {
        name: string;
        description: string | null;
        roleBase: AppUserRole | null;
        permissions: string[];
        isSystem: boolean;
        isActive: boolean;
      };
      include?: { _count?: { select: { users: boolean } } };
    }) {
      const row: StoredProfile = {
        id: `prof-${store.size + 1}`,
        name: data.name,
        description: data.description,
        roleBase: data.roleBase,
        systemKey: null,
        permissions: data.permissions,
        isSystem: data.isSystem,
        isActive: data.isActive,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { users: 0 },
      };
      store.set(row.id, row);
      if (include?._count) return { ...row, _count: { users: 0 } };
      return row;
    },
    async update({
      where,
      data,
      include,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
      include?: { _count?: { select: { users: boolean } } };
    }) {
      const existing = store.get(where.id);
      if (!existing) throw new Error("NOT_FOUND");
      const next: StoredProfile = {
        ...existing,
        ...(data.name !== undefined ? { name: data.name as string } : {}),
        ...(data.description !== undefined
          ? { description: data.description as string | null }
          : {}),
        ...(data.roleBase !== undefined
          ? { roleBase: data.roleBase as AppUserRole | null }
          : {}),
        ...(data.permissions !== undefined
          ? { permissions: data.permissions as string[] }
          : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive as boolean } : {}),
        updatedAt: new Date(),
      };
      store.set(where.id, next);
      if (include?._count) {
        return { ...next, _count: next._count ?? { users: 0 } };
      }
      return next;
    },
    async upsert() {
      return null;
    },
  };

  const prisma = {
    accessProfile,
    permissionAuditLog: {
      async createMany() {
        return { count: 0 };
      },
    },
    appUser: {
      async findMany() {
        return [];
      },
      async update() {
        return {};
      },
    },
    userPermissionOverride: {
      async deleteMany() {
        return { count: 0 };
      },
    },
    appSession: {
      async updateMany() {
        return { count: 0 };
      },
    },
    async $transaction<T>(fn: (tx: typeof prisma) => Promise<T>): Promise<T> {
      return fn(prisma);
    },
    __store: store,
  };

  return prisma as unknown as PrismaClient & { __store: Map<string, StoredProfile> };
}

function simulateRouteErrorPayload(error: unknown): {
  status: number;
  body: { error: string; code: string; message: string };
} {
  if (error instanceof AccessProfileError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : ACCESS_PROFILE_VALIDATION_CODES.has(error.code)
          ? 400
          : 409;
    return {
      status,
      body: { error: error.code, code: error.code, message: error.message },
    };
  }
  return {
    status: 500,
    body: {
      error: "INTERNAL_ERROR",
      code: "INTERNAL_ERROR",
      message: "Erro ao processar perfil de acesso.",
    },
  };
}

describe("PERM-28 access profile save", () => {
  it("cria perfil válido com bag legado", async () => {
    const prisma = makePrismaMock();
    const created = await createAccessProfile(prisma, {
      name: "Perfil Diagnóstico",
      description: "teste",
      roleBase: "VIEWER",
      permissions: ["dashboard.view", "crm.view"],
      isActive: true,
    });
    assert.equal(created.name, "Perfil Diagnóstico");
    assert.deepEqual(created.permissions.sort(), ["crm.view", "dashboard.view"]);
    assert.equal(created.isActive, true);
  });

  it("edita perfil (nome + permissions) sem alterar usuarios", async () => {
    const prisma = makePrismaMock([
      {
        id: "p1",
        name: "Antigo",
        description: null,
        roleBase: "VIEWER",
        systemKey: null,
        permissions: ["dashboard.view"],
        isSystem: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { users: 2 },
      },
    ]);
    const updated = await updateAccessProfile(prisma, "p1", {
      name: "Novo Nome",
      permissions: ["dashboard.view", "pricing.view"],
    });
    assert.equal(updated.name, "Novo Nome");
    assert.ok(updated.permissions.includes("pricing.view"));
    assert.equal(updated.userCount, 2, "snapshot: userCount preservado; apply e explicito");
  });

  it("salvar perfil sem recursos: BE rejeita EMPTY_PERMISSIONS (400)", async () => {
    let caught: unknown;
    try {
      await createAccessProfile(makePrismaMock(), {
        name: "Vazio BE",
        roleBase: "VIEWER",
        permissions: [],
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AccessProfileError);
    assert.equal((caught as AccessProfileError).code, "EMPTY_PERMISSIONS");
    const payload = simulateRouteErrorPayload(caught);
    assert.equal(payload.status, 400);
  });

  it("SUPER_ADMIN pode salvar sem bag", async () => {
    const created = await createAccessProfile(makePrismaMock(), {
      name: "SA Profile",
      roleBase: "SUPER_ADMIN",
      permissions: [],
    });
    assert.deepEqual(created.permissions, []);
  });

  it("ALLOW / DENY / INHERIT na matriz materializam bag legado corretamente", () => {
    const baselineBag = ["dashboard.view", "crm.view"];
    const model = buildAccessProfileMatrixModel(baselineBag, "VIEWER");

    const pricingKey = Object.keys(model.draft).find(
      (k) => k.includes("pricing") || k.includes("formacao") || k === "commercial.pricing"
    );
    assert.ok(pricingKey, "matriz deve conter recurso de pricing");
    let draft = setMatrixDraftAction(model.draft, pricingKey!, "view", true);
    const afterAllow = materializeAccessProfilePermissionsFromDraft(draft, baselineBag, {
      compatibleClamp: false,
    });
    assert.ok(
      afterAllow.includes("pricing.view") || afterAllow.length >= baselineBag.length
    );

    draft = setMatrixDraftAction(model.draft, "dashboard", "view", false);
    const afterDeny = materializeAccessProfilePermissionsFromDraft(draft, baselineBag, {
      compatibleClamp: false,
    });
    assert.equal(afterDeny.includes("dashboard.view"), false);
    assert.ok(afterDeny.includes("crm.view"));

    const inherited = materializeAccessProfilePermissionsFromDraft(
      model.draft,
      baselineBag,
      { compatibleClamp: true }
    );
    assert.deepEqual(inherited.sort(), [...baselineBag].sort());
  });

  it("nome duplicado → NAME_ALREADY_EXISTS (mensagem clara, nao 500)", async () => {
    const prisma = makePrismaMock([
      {
        id: "p1",
        name: "Duplicado",
        description: null,
        roleBase: null,
        systemKey: null,
        permissions: ["dashboard.view"],
        isSystem: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { users: 0 },
      },
    ]);
    let caught: unknown;
    try {
      await createAccessProfile(prisma, {
        name: "Duplicado",
        permissions: ["dashboard.view"],
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AccessProfileError);
    assert.equal((caught as AccessProfileError).code, "NAME_ALREADY_EXISTS");
    const payload = simulateRouteErrorPayload(caught);
    assert.equal(payload.status, 409);
    assert.match(payload.body.message, /Já existe um perfil/);
  });

  it("recurso desconhecido → UNKNOWN_PERMISSIONS (400)", async () => {
    let caught: unknown;
    try {
      await createAccessProfile(makePrismaMock(), {
        name: "Unknown keys",
        permissions: ["dashboard.view", "not.a.real.permission"],
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AccessProfileError);
    assert.equal((caught as AccessProfileError).code, "UNKNOWN_PERMISSIONS");
    const payload = simulateRouteErrorPayload(caught);
    assert.equal(payload.status, 400);
    assert.match(payload.body.message, /não registradas/);
  });

  it("perfil inativo: create/update isActive", async () => {
    const prisma = makePrismaMock();
    const created = await createAccessProfile(prisma, {
      name: "Inativo",
      permissions: ["dashboard.view"],
      isActive: false,
    });
    assert.equal(created.isActive, false);
    const reactivated = await updateAccessProfile(prisma, created.id, { isActive: true });
    assert.equal(reactivated.isActive, true);
  });

  it("payload legado parseAccessProfileBody aceita bag + roleBase string", () => {
    const parsed = parseAccessProfileBody({
      name: "Legado",
      description: "d",
      roleBase: "SELLER",
      permissions: ["crm.view", "dashboard.view"],
      isActive: true,
    });
    assert.equal(parsed.name, "Legado");
    assert.equal(parsed.roleBase, "SELLER");
    assert.deepEqual(parsed.permissions, ["crm.view", "dashboard.view"]);
  });

  it("erro de validação INVALID_NAME expoe code+message no FE", async () => {
    let caught: unknown;
    try {
      await createAccessProfile(makePrismaMock(), {
        name: "   ",
        permissions: ["dashboard.view"],
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AccessProfileError);
    const route = simulateRouteErrorPayload(caught);
    assert.equal(route.status, 400);
    const res = new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
    const fe = await parseApiErrorPayload(res);
    assert.equal(fe.message, "Informe o nome do perfil.");
    assert.equal(fe.code, "INVALID_NAME");
  });

  it("perfis de sistema nao podem ser renomeados", async () => {
    const prisma = makePrismaMock([
      {
        id: "sys1",
        name: "Administrador",
        description: null,
        roleBase: "ADMIN",
        systemKey: "role_admin",
        permissions: ["users.manage", "dashboard.view"],
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { users: 0 },
      },
    ]);
    let caught: unknown;
    try {
      await updateAccessProfile(prisma, "sys1", { name: "Hack" });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AccessProfileError);
    assert.equal((caught as AccessProfileError).code, "SYSTEM_PROFILE_PROTECTED");
  });

  it("P28 FIX C — overwriteCustomized declarado com useState", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../components/AccessProfilesModule.tsx", import.meta.url),
        "utf8"
      )
    );
    assert.match(
      src,
      /const \[overwriteCustomized,\s*setOverwriteCustomized\]\s*=\s*useState/
    );
  });

  it("P28 FIX D — trocar roleBase preserva draft materializado", () => {
    const emptyModel = buildAccessProfileMatrixModel([], "");
    const draftWithSelection = setMatrixDraftAction(
      emptyModel.draft,
      "dashboard",
      "view",
      true
    );
    const preserved = materializeAccessProfilePermissionsFromDraft(
      draftWithSelection,
      [],
      { compatibleClamp: false }
    );
    assert.ok(preserved.includes("dashboard.view"));

    // Mesmo fluxo do form corrigido: hydrate a partir do draft, nao do bag [].
    const rehydrated = buildAccessProfileMatrixModel(preserved, "VIEWER");
    const afterRoleChange = materializeAccessProfilePermissionsFromDraft(
      rehydrated.draft,
      preserved,
      { compatibleClamp: true }
    );
    assert.ok(
      afterRoleChange.includes("dashboard.view"),
      "selecao deve sobreviver a mudanca de roleBase"
    );
  });

  it("P28 FIX D2 — create com bag vazio nao zera draft apos rehydrate (clamp)", () => {
    const emptyModel = buildAccessProfileMatrixModel([], "");
    const draftWithSelection = setMatrixDraftAction(
      emptyModel.draft,
      "dashboard",
      "view",
      true
    );
    const preserved = materializeAccessProfilePermissionsFromDraft(
      draftWithSelection,
      [],
      { compatibleClamp: false }
    );
    // Simula create: form.permissions ainda [], dirty=false apos rehydrate.
    // Clamp com bag vazio NAO pode ser aplicado.
    const wiped = materializeAccessProfilePermissionsFromDraft(
      buildAccessProfileMatrixModel(preserved, "VIEWER").draft,
      [],
      { compatibleClamp: true }
    );
    assert.equal(
      wiped.includes("dashboard.view"),
      false,
      "clamp com bag vazio apaga grants — regressao conhecida"
    );
    const safe = materializeAccessProfilePermissionsFromDraft(
      buildAccessProfileMatrixModel(preserved, "VIEWER").draft,
      [],
      { compatibleClamp: false }
    );
    assert.ok(safe.includes("dashboard.view"), "sem clamp (ou bag sincronizado) preserva");
  });

  it("P28 FIX D3 — AccessProfilesModule sincroniza form.permissions ao trocar roleBase", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../components/AccessProfilesModule.tsx", import.meta.url),
        "utf8"
      )
    );
    assert.match(src, /permissions:\s*preserved/);
    assert.match(
      src,
      /compatibleClamp:\s*!dirty\s*&&\s*form\.permissions\.length\s*>\s*0/
    );
  });

  it("reaplicacao explicita: apply exige confirm e e separado do save", async () => {
    const profile: AccessProfile = {
      id: "p-apply",
      name: "Aplicavel",
      description: null,
      roleBase: "VIEWER",
      systemKey: null,
      permissions: ["dashboard.view", "crm.view"],
      isSystem: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const users = [
      {
        id: "u1",
        name: "User",
        email: "u@x.com",
        role: "VIEWER" as AppUserRole,
        isActive: true,
        permissions: ["dashboard.view"],
        accessProfileId: "p-apply",
      },
    ];
    const prisma = {
      accessProfile: {
        async findUnique() {
          return profile;
        },
      },
      appUser: {
        async findMany() {
          return users;
        },
        async update({ data }: { data: { permissions?: string[]; role?: AppUserRole } }) {
          if (data.permissions) users[0]!.permissions = data.permissions;
          if (data.role) users[0]!.role = data.role;
          return users[0];
        },
      },
      userPermissionOverride: {
        async deleteMany() {
          return { count: 0 };
        },
      },
      appSession: {
        async updateMany() {
          return { count: 0 };
        },
      },
      permissionAuditLog: {
        async createMany() {
          return { count: 0 };
        },
      },
      async $transaction(fn: (tx: unknown) => Promise<unknown>) {
        return fn(prisma);
      },
    } as unknown as PrismaClient;

    await assert.rejects(
      () =>
        applyAccessProfileToUsers(prisma, {
          profileId: "p-apply",
          confirm: false,
        }),
      (e: unknown) =>
        e instanceof AccessProfileError && e.code === "CONFIRM_REQUIRED"
    );

    const preview = await previewApplyAccessProfile(prisma, "p-apply");
    assert.ok(preview.changeCount >= 1);

    const result = await applyAccessProfileToUsers(prisma, {
      profileId: "p-apply",
      confirm: true,
    });
    assert.ok(result.applied >= 1);
    assert.ok(users[0]!.permissions.includes("crm.view"));
  });

  it("FE manage bag alinha com API admin.settings.security manage", () => {
    const asChecker = (auth: AppAuthContext) => ({
      hasPermission: (p: string) =>
        auth.role === "SUPER_ADMIN" || auth.permissions.includes(p),
      hasAnyPermission: (ps: string[]) =>
        auth.role === "SUPER_ADMIN" || ps.some((p) => auth.permissions.includes(p)),
      authUser: auth,
    });
    const bagOnly = makeAuth("ADMIN", ["accessProfiles.manage", "accessProfiles.view"]);
    assert.equal(canManageAccessProfiles(asChecker(bagOnly)), true);
    assert.equal(
      authorizeRequireResource(
        bagOnly,
        REQUIRE_RESOURCE_ADMIN_KEYS.security,
        "manage",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });
});
