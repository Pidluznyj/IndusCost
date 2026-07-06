import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ADMIN_USERS_PAGE_SIZE,
  buildAdminUsersPagination,
  canGoToNextAdminUsersPage,
  canGoToPreviousAdminUsersPage,
  countActiveSuperAdmins,
  formatAdminUsersDisplayRange,
  paginateAdminUsers,
  shouldShowAdminUsersPaginationControls,
} from "./adminUsersPagination.js";

function mockUsers(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `user-${i + 1}`,
    isActive: true,
    role: i === 0 ? "SUPER_ADMIN" : "VIEWER",
  }));
}

describe("adminUsersPagination", () => {
  it("limita a 20 usuários por página", () => {
    assert.equal(ADMIN_USERS_PAGE_SIZE, 20);
    const users = mockUsers(45);
    const pagination = buildAdminUsersPagination(users.length, 1);
    const page1 = paginateAdminUsers(users, pagination);
    assert.equal(page1.length, 20);
    const page3 = paginateAdminUsers(users, buildAdminUsersPagination(users.length, 3));
    assert.equal(page3.length, 5);
  });

  it("exibe intervalo correto na contagem", () => {
    const p1 = buildAdminUsersPagination(45, 1);
    assert.equal(formatAdminUsersDisplayRange(p1), "Exibindo 1–20 de 45 usuários · Página 1 de 3");
    const p3 = buildAdminUsersPagination(45, 3);
    assert.equal(formatAdminUsersDisplayRange(p3), "Exibindo 41–45 de 45 usuários · Página 3 de 3");
    const single = buildAdminUsersPagination(12, 1);
    assert.equal(formatAdminUsersDisplayRange(single), "Exibindo 1–12 de 12 usuários");
  });

  it("navegação de botões respeita primeira e última página", () => {
    const first = buildAdminUsersPagination(45, 1);
    assert.equal(canGoToPreviousAdminUsersPage(first.page), false);
    assert.equal(canGoToNextAdminUsersPage(first.page, first.totalPages), true);

    const last = buildAdminUsersPagination(45, 3);
    assert.equal(canGoToPreviousAdminUsersPage(last.page), true);
    assert.equal(canGoToNextAdminUsersPage(last.page, last.totalPages), false);
  });

  it("ajusta página inválida para a última válida", () => {
    const clamped = buildAdminUsersPagination(25, 99);
    assert.equal(clamped.page, 2);
    assert.equal(clamped.totalPages, 2);
  });

  it("oculta controles de paginação com até 20 usuários", () => {
    assert.equal(shouldShowAdminUsersPaginationControls(buildAdminUsersPagination(20, 1).totalPages), false);
    assert.equal(shouldShowAdminUsersPaginationControls(buildAdminUsersPagination(21, 1).totalPages), true);
  });

  it("contagem de Super Admin usa lista completa", () => {
    const users = mockUsers(25);
    const page2 = paginateAdminUsers(users, buildAdminUsersPagination(users.length, 2));
    assert.equal(countActiveSuperAdmins(page2), 0);
    assert.equal(countActiveSuperAdmins(users), 1);
  });
});

describe("AdminUsersModule UI", () => {
  it("não usa rolagem vertical interna no grid", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "components", "AdminUsersModule.tsx"),
      "utf8"
    );
    assert.equal(src.includes("max-h-[min(520px,60vh)]"), false);
    assert.match(src, /<div className="overflow-x-auto">\s*\n\s*<table/);
    const tableBlock = src.split('<div className="overflow-x-auto">')[1]?.split("</table>")[0] ?? "";
    assert.equal(tableBlock.includes("overflow-y-auto"), false);
    assert.equal(tableBlock.includes("max-h-"), false);
    assert.match(src, /paginatedUsers\.map/);
    assert.match(src, /countActiveSuperAdmins\(users\)/);
    assert.match(src, /shouldShowAdminUsersPaginationControls/);
    assert.match(src, /ADMIN_USERS_PAGE_SIZE/);
  });
});
