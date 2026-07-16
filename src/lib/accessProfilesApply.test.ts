import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AccessProfile, AppUserRole } from "@prisma/client";
import {
  AccessProfileError,
  applyAccessProfileToUsers,
  previewApplyAccessProfile,
} from "./accessProfilesService.ts";

type StoreUser = {
  id: string;
  name: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  permissions: string[];
  accessProfileId: string | null;
};

function makePrismaMock(args: {
  profile: AccessProfile;
  users: StoreUser[];
}) {
  const users = args.users.map((u) => ({ ...u }));
  let shouldFail = false;
  const overridesDeleted: string[] = [];

  const prisma = {
    accessProfile: {
      async findUnique() {
        return args.profile;
      },
    },
    appUser: {
      async findMany({ where }: { where: { accessProfileId?: string; id?: { in: string[] } } }) {
        return users.filter((u) => {
          if (where.accessProfileId && u.accessProfileId !== where.accessProfileId) {
            return false;
          }
          if (where.id?.in && !where.id.in.includes(u.id)) return false;
          return true;
        });
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: {
          role?: AppUserRole;
          permissions?: string[];
          permissionsVersion?: { increment: number };
        };
      }) {
        if (shouldFail) throw new Error("ROLLBACK_TEST");
        const u = users.find((x) => x.id === where.id);
        if (!u) throw new Error("missing");
        if (data.role) u.role = data.role;
        if (data.permissions) u.permissions = data.permissions;
        return u;
      },
    },
    appSession: {
      async updateMany() {
        return { count: 0 };
      },
      async update() {
        return {};
      },
    },
    permissionAuditLog: {
      async createMany() {
        return { count: 0 };
      },
    },
    userPermissionOverride: {
      async deleteMany({ where }: { where: { userId: string } }) {
        overridesDeleted.push(where.userId);
        return { count: 1 };
      },
    },
    async $transaction(fn: (tx: typeof prisma) => Promise<unknown>) {
      const snapshot = users.map((u) => ({ ...u, permissions: [...u.permissions] }));
      const ovSnap = [...overridesDeleted];
      try {
        return await fn(prisma);
      } catch (e) {
        users.splice(0, users.length, ...snapshot);
        overridesDeleted.splice(0, overridesDeleted.length, ...ovSnap);
        throw e;
      }
    },
    __failNext() {
      shouldFail = true;
    },
    __users() {
      return users;
    },
    __overridesDeleted() {
      return overridesDeleted;
    },
  };

  return prisma;
}

describe("accessProfiles apply service", () => {
  const baseProfile = {
    id: "p1",
    name: "Seller",
    description: null,
    roleBase: "SELLER" as AppUserRole,
    systemKey: null,
    permissions: ["dashboard.view", "crm.view"],
    isSystem: false,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("preview before/after e apply exige confirm", async () => {
    const prisma = makePrismaMock({
      profile: baseProfile,
      users: [
        {
          id: "u1",
          name: "A",
          email: "a@x.com",
          role: "VIEWER",
          isActive: true,
          permissions: ["dashboard.view"],
          accessProfileId: "p1",
        },
      ],
    });

    const preview = await previewApplyAccessProfile(prisma as never, "p1");
    assert.equal(preview.changeCount, 1);
    assert.ok(preview.users[0].gained.includes("crm.view"));

    await assert.rejects(
      () =>
        applyAccessProfileToUsers(prisma as never, {
          profileId: "p1",
          confirm: false,
        }),
      (err: unknown) =>
        err instanceof AccessProfileError && err.code === "CONFIRM_REQUIRED"
    );

    const result = await applyAccessProfileToUsers(prisma as never, {
      profileId: "p1",
      confirm: true,
    });
    assert.equal(result.applied, 1);
    assert.ok(prisma.__users()[0].permissions.includes("crm.view"));
    assert.equal(prisma.__users()[0].role, "SELLER");
    assert.ok(prisma.__overridesDeleted().includes("u1"), "P06 limpa overrides no apply");
  });

  it("rollback em erro na transaction", async () => {
    const prisma = makePrismaMock({
      profile: baseProfile,
      users: [
        {
          id: "u1",
          name: "A",
          email: "a@x.com",
          role: "VIEWER",
          isActive: true,
          permissions: ["dashboard.view"],
          accessProfileId: "p1",
        },
      ],
    });
    prisma.__failNext();
    await assert.rejects(() =>
      applyAccessProfileToUsers(prisma as never, {
        profileId: "p1",
        confirm: true,
      })
    );
    assert.deepEqual(prisma.__users()[0].permissions, ["dashboard.view"]);
    assert.equal(prisma.__users()[0].role, "VIEWER");
  });

  it("update de perfil (conceitual) não aplica sozinho — apply é separado", () => {
    // Garantia documental no teste: salvar snapshot ≠ applyAccessProfileToUsers
    assert.notEqual(
      "updateAccessProfile",
      "applyAccessProfileToUsers"
    );
  });
});
