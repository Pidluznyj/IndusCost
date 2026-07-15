import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  accessStateBadgeClass,
  accessStateMessage,
  mapToAccessState,
} from "./employeeUserLink.ts";
import {
  getEmployeeUserLinkStatus,
  linkEmployeeToAppUser,
  unlinkEmployeeFromAppUser,
} from "./employeeUserLink.server.ts";

describe("employeeUserLink — estados", () => {
  it("mapeia linked / inativo / mismatch / match / conflito", () => {
    assert.equal(mapToAccessState({ linkStatus: "linked", linkedIsActive: true }), "linked");
    assert.equal(
      mapToAccessState({ linkStatus: "linked", linkedIsActive: false }),
      "linked_inactive"
    );
    assert.equal(
      mapToAccessState({ linkStatus: "linked", linkedIsActive: true, emailMismatch: true }),
      "email_mismatch"
    );
    assert.equal(mapToAccessState({ linkStatus: "available_match" }), "available_match");
    assert.equal(mapToAccessState({ linkStatus: "conflict" }), "conflict");
    assert.equal(mapToAccessState({ linkStatus: "none" }), "none");
  });

  it("mensagens e badge", () => {
    assert.equal(accessStateMessage("none"), "Sem usuário de acesso");
    assert.equal(accessStateMessage("available_match"), "Usuário disponível para vínculo");
    assert.ok(accessStateBadgeClass("linked").includes("emerald"));
    assert.ok(accessStateBadgeClass("conflict").includes("amber"));
  });
});

describe("employeeUserLink.server — status e vínculo (mock)", () => {
  it("status available_match quando AppUser livre", async () => {
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: "e1",
          corporateEmail: "a@b.com",
          appUser: null,
        }),
      },
      appUser: {
        findFirst: async () => ({
          id: "u1",
          email: "a@b.com",
          employeeId: null,
          isActive: true,
        }),
      },
    } as never;
    const dto = await getEmployeeUserLinkStatus(prisma, "e1");
    assert.equal(dto.status, "available_match");
    assert.equal(dto.canLink, true);
    assert.equal(dto.canUnlink, false);
  });

  it("conflito quando AppUser já tem outro employee", async () => {
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: "e1",
          corporateEmail: "a@b.com",
          appUser: null,
        }),
      },
      appUser: {
        findFirst: async () => ({
          id: "u1",
          email: "a@b.com",
          employeeId: "other",
          isActive: true,
        }),
      },
    } as never;
    const dto = await getEmployeeUserLinkStatus(prisma, "e1");
    assert.equal(dto.status, "conflict");
    assert.equal(dto.canLink, false);
  });

  it("linked_inactive e email_mismatch", async () => {
    const prisma = {
      employee: {
        findUnique: async () => ({
          id: "e1",
          corporateEmail: "corp@x.com",
          appUser: {
            id: "u1",
            email: "login@x.com",
            isActive: false,
            role: "USER",
            name: "Ana",
          },
        }),
      },
      appUser: { findFirst: async () => null },
    } as never;
    const dto = await getEmployeeUserLinkStatus(prisma, "e1");
    assert.equal(dto.status, "email_mismatch");
    assert.equal(dto.canUnlink, true);
    assert.equal(dto.emailMismatch, true);
  });

  it("link bloqueia vínculo duplo do colaborador", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: {
            findUnique: async () => ({
              id: "e1",
              corporateEmail: "a@b.com",
              personId: null,
              appUser: { id: "u0" },
            }),
          },
          appUser: { findFirst: async () => null, update: async () => null },
        }),
    } as never;
    await assert.rejects(
      () => linkEmployeeToAppUser(prisma, "e1"),
      (e: unknown) =>
        e instanceof Error && (e as { code?: string }).code === "EMPLOYEE_ALREADY_HAS_USER"
    );
  });

  it("link bloqueia AppUser já de outro colaborador", async () => {
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: {
            findUnique: async () => ({
              id: "e1",
              corporateEmail: "a@b.com",
              personId: null,
              appUser: null,
            }),
          },
          appUser: {
            findFirst: async () => ({
              id: "u1",
              employeeId: "other",
              personId: null,
              email: "a@b.com",
            }),
            update: async () => null,
          },
        }),
    } as never;
    await assert.rejects(
      () => linkEmployeeToAppUser(prisma, "e1"),
      (e: unknown) =>
        e instanceof Error && (e as { code?: string }).code === "APPUSER_ALREADY_LINKED"
    );
  });

  it("unlink limpa employeeId sem desativar", async () => {
    let updatedData: unknown = null;
    const prisma = {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          employee: {
            findUnique: async () => ({
              id: "e1",
              appUser: { id: "u1", email: "a@b.com", role: "SUPER_ADMIN", employeeId: "e1" },
            }),
          },
          appUser: {
            update: async ({ data }: { data: unknown }) => {
              updatedData = data;
              return {};
            },
          },
        }),
    } as never;
    const r = await unlinkEmployeeFromAppUser(prisma, "e1", { actorUserId: "actor" });
    assert.equal(r.ok, true);
    assert.equal(r.appUserId, "u1");
    assert.deepEqual(updatedData, { employeeId: null });
  });

  it("rotas de autorização documentadas no arquivo de routes", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/lib/employeeLookupRoutes.ts"), "utf8");
    assert.ok(src.includes('"/api/employees/:id/user-link-status"'));
    assert.ok(src.includes('"/api/employees/lookups/app-user-by-email"'));
    assert.ok(src.includes('"/api/employees/:id/link-user"'));
    assert.ok(src.includes('"/api/employees/:id/unlink-user"'));
    assert.ok(src.includes("EMPLOYEES_USER_LINK_MANAGE_PERMISSIONS"));
  });
});
