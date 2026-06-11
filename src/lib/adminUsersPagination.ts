/** Paginação da tela Configurações → Usuários e Permissões. */

export const ADMIN_USERS_PAGE_SIZE = 20;

export type AdminUsersPagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export function buildAdminUsersPagination(
  total: number,
  page: number,
  pageSize: number = ADMIN_USERS_PAGE_SIZE
): AdminUsersPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return { page: safePage, pageSize, total, totalPages };
}

export function paginateAdminUsers<T>(items: readonly T[], pagination: AdminUsersPagination): T[] {
  const start = (pagination.page - 1) * pagination.pageSize;
  return items.slice(start, start + pagination.pageSize);
}

export function formatAdminUsersDisplayRange(pagination: AdminUsersPagination): string {
  if (pagination.total === 0) return "Exibindo 0 de 0 usuários";
  const from = (pagination.page - 1) * pagination.pageSize + 1;
  const to = Math.min(pagination.page * pagination.pageSize, pagination.total);
  const pagePart =
    pagination.totalPages > 1 ? ` · Página ${pagination.page} de ${pagination.totalPages}` : "";
  return `Exibindo ${from}–${to} de ${pagination.total} usuários${pagePart}`;
}

export function shouldShowAdminUsersPaginationControls(totalPages: number): boolean {
  return totalPages > 1;
}

export function canGoToPreviousAdminUsersPage(page: number): boolean {
  return page > 1;
}

export function canGoToNextAdminUsersPage(page: number, totalPages: number): boolean {
  return page < totalPages;
}

export type AdminUserSuperAdminCountable = {
  isActive: boolean;
  role: string;
};

/** Contagem global — sempre sobre a lista completa, não a página visível. */
export function countActiveSuperAdmins(users: readonly AdminUserSuperAdminCountable[]): number {
  return users.filter((u) => u.isActive && u.role === "SUPER_ADMIN").length;
}
