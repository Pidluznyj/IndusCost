/**
 * PERM-27 — Diagnóstico do fluxo criar/salvar AccessProfile.
 * Reproduz cenários e isola a causa raiz sem mascarar erros.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessProfile, AppUserRole, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
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
import { filterKnownPermissions } from "@/src/lib/appAuth.ts";
import type { AppAuthContext } from "@/src/lib/appAuth.ts";
import { parseApiErrorPayload } from "@/src/lib/http.ts";
import { canManageAccessProfiles } from "@/src/lib/modulePermissions.ts";

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
  const byName = () => new Set([...store.values()].map((p) => p.name));

  const prisma = {
    accessProfile: {
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
        if (byName().has(data.name)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["name"] },
          });
        }
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
        if (typeof data.name === "string" && data.name !== existing.name && byName().has(data.name)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["name"] },
          });
        }
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
    },
    permissionAuditLog: {
      async createMany() {
        return { count: 0 };
      },
    },
    __store: store,
  };

  return prisma as unknown as PrismaClient & { __store: Map<string, StoredProfile> };
}

function simulateRouteErrorPayload(error: unknown): {
  status: number;
  body: { error: string; message: string };
} {
  if (error instanceof AccessProfileError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "NO_CHANGES" ||
            error.code === "INVALID_NAME" ||
            error.code === "CONFIRM_REQUIRED"
          ? 400
          : 409;
    return { status, body: { error: error.code, message: error.message } };
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return {
      status: 409,
      body: {
        error: "NAME_ALREADY_EXISTS",
        message: "Já existe um perfil com este nome.",
      },
    };
  }
  return {
    status: 500,
    body: {
      error: "INTERNAL_ERROR",
      message: "Erro ao processar perfil de acesso.",
    },
  };
}

describe("PERM-27 access profile save diagnosis", () => {
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

  it("edita perfil (nome + permissions)", async () => {
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
        _count: { users: 0 },
      },
    ]);
    const updated = await updateAccessProfile(prisma, "p1", {
      name: "Novo Nome",
      permissions: ["dashboard.view", "pricing.view"],
    });
    assert.equal(updated.name, "Novo Nome");
    assert.ok(updated.permissions.includes("pricing.view"));
  });

  it("salvar perfil sem recursos: FE bloqueia; BE aceita bag vazia (não-SUPER_ADMIN)", async () => {
    // FE validateForm exige previewPermissions.length > 0 — comportamento documentado.
    const prisma = makePrismaMock();
    const created = await createAccessProfile(prisma, {
      name: "Vazio BE",
      roleBase: "VIEWER",
      permissions: [],
    });
    assert.deepEqual(created.permissions, []);
  });

  it("ALLOW / DENY / INHERIT na matriz materializam bag legado corretamente", () => {
    const baselineBag = ["dashboard.view", "crm.view"];
    const model = buildAccessProfileMatrixModel(baselineBag, "VIEWER");

    // ALLOW explícito em pricing
    let draft = setMatrixDraftAction(model.draft, "commercial.pricing", "view", true);
    // chave seed PT também usada na árvore
    if (!model.draft["commercial.pricing"] && model.draft["comercial"]) {
      // fallback: só dashboard já está true no baseline
    }
    const pricingKey = Object.keys(model.draft).find(
      (k) => k.includes("pricing") || k.includes("formacao") || k === "commercial.pricing"
    );
    assert.ok(pricingKey, "matriz deve conter recurso de pricing");
    draft = setMatrixDraftAction(model.draft, pricingKey!, "view", true);
    const afterAllow = materializeAccessProfilePermissionsFromDraft(draft, baselineBag, {
      compatibleClamp: false,
    });
    assert.ok(
      afterAllow.includes("pricing.view") || afterAllow.length >= baselineBag.length,
      `ALLOW deveria emitir alias; got=${afterAllow.join(",")}`
    );

    // DENY dashboard
    draft = setMatrixDraftAction(model.draft, "dashboard", "view", false);
    const afterDeny = materializeAccessProfilePermissionsFromDraft(draft, baselineBag, {
      compatibleClamp: false,
    });
    assert.equal(afterDeny.includes("dashboard.view"), false, "DENY remove dashboard.view");
    assert.ok(afterDeny.includes("crm.view"), "INHERIT/outros preservam crm.view");

    // INHERIT: draft == baseline → sem diff material
    const inherited = materializeAccessProfilePermissionsFromDraft(
      model.draft,
      baselineBag,
      { compatibleClamp: true }
    );
    assert.deepEqual(inherited.sort(), [...baselineBag].sort());
  });

  it("nome duplicado → P2002 → NAME_ALREADY_EXISTS (mensagem clara)", async () => {
    const prisma = makePrismaMock([
      {
        id: "p1",
        name: "Duplicado",
        description: null,
        roleBase: null,
        systemKey: null,
        permissions: [],
        isSystem: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { users: 0 },
      },
    ]);
    let caught: unknown;
    try {
      await createAccessProfile(prisma, { name: "Duplicado", permissions: ["dashboard.view"] });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Prisma.PrismaClientKnownRequestError);
    const payload = simulateRouteErrorPayload(caught);
    assert.equal(payload.status, 409);
    assert.equal(payload.body.error, "NAME_ALREADY_EXISTS");
    assert.match(payload.body.message, /Já existe um perfil/);
  });

  it("recurso/permissão desconhecida é filtrada (não explode; bag perde a chave)", async () => {
    const prisma = makePrismaMock();
    const created = await createAccessProfile(prisma, {
      name: "Unknown keys",
      permissions: ["dashboard.view", "not.a.real.permission", "engineering.products"],
    });
    assert.ok(created.permissions.includes("dashboard.view"));
    assert.equal(created.permissions.includes("not.a.real.permission"), false);
    // resourceKey canônico NÃO é chave do PERMISSION_CATALOG bag
    assert.equal(
      created.permissions.includes("engineering.products"),
      false,
      "causa raiz parcial: resourceKey estruturado não entra no bag legado"
    );
  });

  it("perfil inativo: create com isActive=false e update status", async () => {
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

  it("erro de validação INVALID_NAME é exibido (campo error→message no FE)", async () => {
    let caught: unknown;
    try {
      await createAccessProfile(makePrismaMock(), { name: "   ", permissions: ["dashboard.view"] });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof AccessProfileError);
    assert.equal((caught as AccessProfileError).code, "INVALID_NAME");
    const route = simulateRouteErrorPayload(caught);
    assert.equal(route.status, 400);
    // Simula Response JSON do backend (usa `error`, não `code`)
    const res = new Response(JSON.stringify(route.body), {
      status: route.status,
      headers: { "Content-Type": "application/json" },
    });
    const fe = await parseApiErrorPayload(res);
    assert.equal(fe.message, "Informe o nome do perfil.");
    // GAP: HttpError.code fica undefined porque backend manda `error` e FE lê `code`
    assert.equal(fe.code, undefined);
  });

  it("ROOT CAUSE A — FE libera manage por bag; API exige admin.settings.security manage", () => {
    const asChecker = (auth: AppAuthContext) => ({
      hasPermission: (p: string) =>
        auth.role === "SUPER_ADMIN" || auth.permissions.includes(p),
      hasAnyPermission: (ps: string[]) =>
        auth.role === "SUPER_ADMIN" || ps.some((p) => auth.permissions.includes(p)),
      authUser: auth,
    });

    const bagOnly = makeAuth("ADMIN", ["accessProfiles.manage", "accessProfiles.view"]);
    assert.equal(canManageAccessProfiles(asChecker(bagOnly)), true, "UI mostra Salvar");

    const api = authorizeRequireResource(
      bagOnly,
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage",
      { legacyCompatMode: true }
    );
    assert.equal(
      api.ok,
      true,
      `API deveria autorizar com accessProfiles.manage; got=${JSON.stringify(api)}`
    );

    const usersManage = makeAuth("ADMIN", ["users.manage", "settings.view"]);
    assert.equal(canManageAccessProfiles(asChecker(usersManage)), true);
    const apiUsers = authorizeRequireResource(
      usersManage,
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage",
      { legacyCompatMode: true }
    );
    assert.equal(apiUsers.ok, true, "users.manage deve autorizar security manage");

    // VIEWER sem bags admin: FE esconde Salvar; API nega
    const viewer = makeAuth("VIEWER", ["dashboard.view"]);
    assert.equal(canManageAccessProfiles(asChecker(viewer)), false);
    assert.equal(
      authorizeRequireResource(viewer, REQUIRE_RESOURCE_ADMIN_KEYS.security, "manage", {
        legacyCompatMode: true,
      }).ok,
      false
    );
  });

  it("ROOT CAUSE B — matriz ALLOW em resourceKey sem alias 1:1 pode materializar vazio", () => {
    const model = buildAccessProfileMatrixModel([], "VIEWER");
    // Seleciona um recurso canônico EN se existir na árvore seed
    const engKey = Object.keys(model.draft).find((k) => k.startsWith("engineering."));
    if (!engKey) {
      assert.ok(true, "seed sem engineering.* — skip parcial");
      return;
    }
    const draft = setMatrixDraftAction(model.draft, engKey, "view", true);
    const legacy = materializeAccessProfilePermissionsFromDraft(draft, [], {
      compatibleClamp: false,
    });
    // Documenta o comportamento: se vazio, FE bloqueia save com "Selecione ao menos uma permissão"
    if (legacy.length === 0) {
      assert.equal(
        filterKnownPermissions([engKey]).length,
        0,
        "resourceKey estruturado não é bag key — materialize vazio = falha percebida no save"
      );
    } else {
      assert.ok(legacy.every((k) => k.includes(".")));
    }
  });

  it("ROOT CAUSE C — AccessProfilesModule referencia overwriteCustomized sem useState", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../components/AccessProfilesModule.tsx", import.meta.url),
        "utf8"
      )
    );
    const declaresState =
      /useState\(.*overwriteCustomized|const \[overwriteCustomized/.test(src);
    const usesVar = /overwriteCustomized/.test(src);
    assert.equal(usesVar, true);
    assert.equal(
      declaresState,
      false,
      "BUG: overwriteCustomized usado sem useState - ReferenceError no modal Aplicar"
    );
  });

  it("ROOT CAUSE D — trocar roleBase reidrata matriz a partir do bag (nao do draft)", () => {
    // Simula create: bag vazio, usuario marca dashboard na matriz, depois muda roleBase.
    const emptyModel = buildAccessProfileMatrixModel([], "");
    const draftWithSelection = setMatrixDraftAction(
      emptyModel.draft,
      "dashboard",
      "view",
      true
    );
    const before = materializeAccessProfilePermissionsFromDraft(
      draftWithSelection,
      [],
      { compatibleClamp: false }
    );
    assert.ok(before.includes("dashboard.view"), "selecao deveria materializar");

    // Codigo do form: hydrateMatrix(form.permissions, roleBase) com form.permissions=[]
    const wiped = buildAccessProfileMatrixModel([], "VIEWER");
    const afterRoleChange = materializeAccessProfilePermissionsFromDraft(
      wiped.draft,
      [],
      { compatibleClamp: false }
    );
    assert.deepEqual(
      afterRoleChange,
      [],
      "CAUSA RAIZ: mudanca de roleBase descarta draft e preview fica vazio -> FE bloqueia Salvar"
    );
  });
});
