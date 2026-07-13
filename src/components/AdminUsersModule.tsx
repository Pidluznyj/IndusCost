import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  APP_PASSWORD_MIN_LENGTH,
  APP_USER_ROLE_OPTIONS,
  type AppUserRole,
  formatRoleLabel,
} from "@/src/lib/appAuthClient";
import { SellerNomusPicker } from "@/src/components/admin/SellerNomusPicker";
import type { AdminSellerOption } from "@/src/lib/adminSellerOptionsTypes";
import { countActiveSuperAdmins } from "@/src/lib/adminUsersPagination";
import { RolePermissionMatrixPanel } from "@/src/components/admin/RolePermissionMatrixPanel";
import { UserPermissionTree } from "@/src/components/admin/UserPermissionTree";
import {
  applyUserPermissionPreset,
  clearUserPermissionOverrides,
  fetchAdminUsersList,
  fetchPermissionPresets,
  fetchUserPermissionAudit,
  fetchUserPermissions,
  reloadPermissionCatalog,
  restoreUserRoleDefault,
  saveUserPermissionOverrides,
  type AdminUserListItem,
  type PermissionAuditEntry,
  type RoleMatrixRowDto,
  type UserPermissionsPayload,
} from "@/src/lib/userPermissionsAdminClient";
import {
  collectTreeKeys,
  draftFromPayloadTree,
  filterAdminUsersList,
  filterTreeBySearch,
  isPermissionDraftDirty,
  overridesPayloadFromDraft,
  setModuleFlags,
  type DraftOverrideMap,
} from "@/src/lib/userPermissionsAdminUi";
import {
  canViewFullPermissionAudit,
  permissionAuditActionLabel,
  summarizePermissionAuditChange,
} from "@/src/lib/security/permissionAudit";
import { usePermissions } from "@/src/hooks/usePermissions";
import { ResourceKeys } from "@/src/lib/permissionsClient";
import { HttpError } from "@/src/lib/http";

type CreateForm = {
  name: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  password: string;
  externalSellerId: string;
  sellerResponsibleName: string;
};

const EMPTY_CREATE: CreateForm = {
  name: "",
  email: "",
  role: "VIEWER",
  isActive: true,
  password: "",
  externalSellerId: "",
  sellerResponsibleName: "",
};

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export const AdminUsersModule: React.FC = () => {
  const { hasPermission, authUser } = useAuth();
  const permissionsApi = usePermissions();
  const canManage = hasPermission("users.manage");
  const canViewPermissionAudit = canViewFullPermissionAudit(
    permissionsApi.canManage(ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE) ||
      authUser?.role === "SUPER_ADMIN"
  );
  const currentUserId = authUser?.id ?? null;

  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [sellerOptions, setSellerOptions] = useState<AdminSellerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [workbenchTab, setWorkbenchTab] = useState<"users" | "matrix">("users");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppUserRole | "ALL">("ALL");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [customOnly, setCustomOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [detail, setDetail] = useState<UserPermissionsPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [innerTab, setInnerTab] = useState<"permissions" | "summary" | "audit">("permissions");
  const [draft, setDraft] = useState<DraftOverrideMap>({});
  const [treeSearch, setTreeSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [audit, setAudit] = useState<PermissionAuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<RoleMatrixRowDto[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createError, setCreateError] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [list, sellers] = await Promise.all([
        fetchAdminUsersList(),
        fetchJsonOk<{ sellers: AdminSellerOption[] }>("/api/admin/seller-options").catch(() => ({
          sellers: [] as AdminSellerOption[],
        })),
      ]);
      setUsers(list);
      setSellerOptions(Array.isArray(sellers.sellers) ? sellers.sellers : []);
      if (selectedId && !list.some((u) => u.id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar usuários.");
    } finally {
      setLoading(false);
    }
  }, [canManage, selectedId]);

  const loadMatrix = useCallback(async () => {
    setMatrixLoading(true);
    try {
      const res = await fetchPermissionPresets();
      setMatrix(Array.isArray(res.matrix) ? res.matrix : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar matriz de perfis.");
    } finally {
      setMatrixLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (workbenchTab === "matrix" && matrix.length === 0) {
      void loadMatrix();
    }
  }, [workbenchTab, matrix.length, loadMatrix]);

  const loadDetail = useCallback(async (userId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const payload = await fetchUserPermissions(userId);
      setDetail(payload);
      setDraft(draftFromPayloadTree(payload.tree));
      setExpanded(new Set(collectTreeKeys(payload.tree)));
      setInnerTab("permissions");
    } catch (e) {
      setDetail(null);
      setDetailError(e instanceof Error ? e.message : "Falha ao carregar permissões.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (innerTab !== "audit" || !selectedId) return;
    if (!canViewPermissionAudit) {
      setAudit([]);
      setAuditError("Sem permissão para visualizar a auditoria de permissões.");
      return;
    }
    setAuditError(null);
    void fetchUserPermissionAudit(selectedId)
      .then((entries) => {
        setAudit(entries);
        setAuditError(null);
      })
      .catch((err: unknown) => {
        setAudit([]);
        if (err instanceof HttpError && err.status === 403) {
          setAuditError("Sem permissão para visualizar a auditoria de permissões.");
          return;
        }
        setAuditError(err instanceof Error ? err.message : "Falha ao carregar auditoria.");
      });
  }, [innerTab, selectedId, canViewPermissionAudit]);

  const filteredUsers = useMemo(
    () =>
      filterAdminUsersList(users, {
        search,
        role: roleFilter,
        active: activeFilter,
        customOnly,
      }),
    [users, search, roleFilter, activeFilter, customOnly]
  );

  const activeSuperAdminCount = useMemo(() => countActiveSuperAdmins(users), [users]);
  const pending = useMemo(() => {
    if (!detail) return false;
    return isPermissionDraftDirty(draft, detail.roleDefaults, detail.overrides);
  }, [detail, draft]);

  const filteredTree = useMemo(() => {
    if (!detail) return [];
    return filterTreeBySearch(detail.tree, treeSearch);
  }, [detail, treeSearch]);

  const confirmClearIfNeeded = (hasCustom: boolean, message: string): boolean => {
    if (!hasCustom) return true;
    return window.confirm(message);
  };

  const handleSaveOverrides = async () => {
    if (!detail || !selectedId) return;
    setSaving(true);
    setDetailError(null);
    try {
      const overrides = overridesPayloadFromDraft(draft, detail.roleDefaults);
      const payload = await saveUserPermissionOverrides(selectedId, overrides);
      setDetail(payload);
      setDraft(draftFromPayloadTree(payload.tree));
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefault = async () => {
    if (!detail || !selectedId) return;
    if (
      !confirmClearIfNeeded(
        detail.hasCustomPermissions,
        "Restaurar o padrão da role remove as permissões customizadas. Continuar?"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const payload = await restoreUserRoleDefault(selectedId, true);
      setDetail(payload);
      setDraft(draftFromPayloadTree(payload.tree));
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao restaurar padrão.");
    } finally {
      setSaving(false);
    }
  };

  const handleClearCustom = async () => {
    if (!detail || !selectedId) return;
    if (
      !confirmClearIfNeeded(
        true,
        "Limpar todas as customizações e voltar ao preset da role?"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const payload = await clearUserPermissionOverrides(selectedId, true);
      setDetail(payload);
      setDraft(draftFromPayloadTree(payload.tree));
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao limpar customizações.");
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (role: AppUserRole) => {
    if (!detail || !selectedId || role === detail.user.role) return;
    if (detail.warnings.isLastSuperAdmin && role !== "SUPER_ADMIN") {
      setDetailError("Não é possível rebaixar o único Super Administrador ativo.");
      return;
    }
    if (
      !confirmClearIfNeeded(
        detail.hasCustomPermissions,
        "Trocar o perfil aplica o preset da nova role e remove customizações. Continuar?"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const payload = await applyUserPermissionPreset(selectedId, {
        role,
        confirmClearOverrides: true,
      });
      setDetail(payload);
      setDraft(draftFromPayloadTree(payload.tree));
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao alterar perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handleReloadCatalog = async () => {
    setSaving(true);
    try {
      await reloadPermissionCatalog();
      await loadMatrix();
      if (selectedId) await loadDetail(selectedId);
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao recarregar permissões.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim() || !createForm.email.includes("@")) {
      setCreateError("Informe nome e e-mail válidos.");
      return;
    }
    if (createForm.password.length < APP_PASSWORD_MIN_LENGTH) {
      setCreateError(`Senha com no mínimo ${APP_PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (
      createForm.role === "SELLER" &&
      !createForm.externalSellerId.trim() &&
      !createForm.sellerResponsibleName.trim()
    ) {
      setCreateError("Vendedor precisa de vínculo Nomus.");
      return;
    }
    setSaving(true);
    setCreateError(null);
    try {
      await fetchJsonOk("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createForm.name.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          role: createForm.role,
          permissions: [],
          isActive: createForm.isActive,
          externalSellerId: createForm.externalSellerId.trim()
            ? Number.parseInt(createForm.externalSellerId.trim(), 10)
            : null,
          sellerResponsibleName: createForm.sellerResponsibleName.trim() || null,
        }),
      });
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE);
      await loadUsers();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Falha ao criar usuário.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedId) return;
    if (resetPassword.length < APP_PASSWORD_MIN_LENGTH) {
      setResetError(`Senha com no mínimo ${APP_PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("As senhas não coincidem.");
      return;
    }
    setSaving(true);
    setResetError(null);
    try {
      await fetchJsonOk(`/api/admin/users/${selectedId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetOpen(false);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Falha ao redefinir senha.");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        Você não tem permissão para gerenciar usuários.
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="admin-users-permissions-workbench">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2 text-foreground">
            <Shield className="h-5 w-5 text-primary" />
            Usuários e Permissões
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Controle o acesso por menu, submenu, abas e ações do sistema.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleReloadCatalog()}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (saving || loading) && "animate-spin")} />
            Recarregar permissões
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateForm(EMPTY_CREATE);
              setCreateError(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo usuário
          </button>
        </div>
      </div>

      <div className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1 w-fit">
        <button
          type="button"
          onClick={() => setWorkbenchTab("users")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold",
            workbenchTab === "users" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          Usuários
        </button>
        <button
          type="button"
          onClick={() => setWorkbenchTab("matrix")}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold",
            workbenchTab === "matrix" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          Resumo por perfil
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {workbenchTab === "matrix" ? (
        <RolePermissionMatrixPanel matrix={matrix} loading={matrixLoading} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
          <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[28rem]">
            <div className="border-b border-border p-3 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar usuário…"
                  className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value as AppUserRole | "ALL")}
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]"
                >
                  <option value="ALL">Todas as roles</option>
                  {APP_USER_ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={activeFilter}
                  onChange={(e) =>
                    setActiveFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE")
                  }
                  className="rounded-lg border border-border bg-background px-2 py-1.5 text-[11px]"
                >
                  <option value="ALL">Ativos e inativos</option>
                  <option value="ACTIVE">Somente ativos</option>
                  <option value="INACTIVE">Somente inativos</option>
                </select>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={customOnly}
                  onChange={(e) => setCustomOnly(e.target.checked)}
                />
                Com permissão customizada
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nenhum usuário encontrado.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {filteredUsers.map((user) => {
                    const selected = user.id === selectedId;
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(user.id)}
                          className={cn(
                            "w-full text-left px-3 py-3 transition-colors hover:bg-accent/40",
                            selected && "bg-primary/5 border-l-2 border-l-primary"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold truncate">{user.name}</p>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {user.email}
                              </p>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                user.isActive
                                  ? "bg-emerald-50 text-emerald-800"
                                  : "bg-slate-100 text-slate-600"
                              )}
                            >
                              {user.isActive ? "Ativo" : "Inativo"}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <span className="rounded-full border border-border px-1.5 py-0 text-[9px] font-semibold text-muted-foreground">
                              {formatRoleLabel(user.role)}
                            </span>
                            {user.hasCustomPermissions ? (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[9px] font-semibold text-amber-900">
                                Permissões customizadas
                              </span>
                            ) : null}
                            {user.id === currentUserId ? (
                              <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0 text-[9px] font-semibold text-blue-900">
                                Você
                              </span>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card min-h-[28rem] flex flex-col">
            {!selectedId ? (
              <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
                Selecione um usuário para gerenciar permissões.
              </div>
            ) : detailLoading && !detail ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando permissões…
              </div>
            ) : detail ? (
              <>
                <div className="border-b border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-base font-bold">{detail.user.name}</h4>
                      <p className="text-xs text-muted-foreground">{detail.user.email}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Último acesso: {formatDateTimePt(detail.user.lastLoginAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setResetPassword("");
                        setResetConfirm("");
                        setResetError(null);
                        setResetOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent"
                    >
                      <KeyRound className="h-3 w-3" />
                      Redefinir senha
                    </button>
                  </div>

                  {detail.warnings.editingSuperAdmin ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 flex gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        Você está editando um SUPER_ADMIN. O acesso é total; a árvore fica somente
                        leitura.
                        {detail.warnings.isLastSuperAdmin
                          ? " Este é o único Super Administrador ativo."
                          : null}
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-muted-foreground">
                      Perfil / preset
                    </label>
                    <select
                      value={detail.user.role}
                      disabled={saving || detail.warnings.isLastSuperAdmin}
                      onChange={(e) => void handleRoleChange(e.target.value as AppUserRole)}
                      className="w-full max-w-md rounded-lg border border-border bg-background px-3 py-2 text-sm"
                    >
                      {APP_USER_ROLE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-1 rounded-lg border border-border bg-muted/20 p-0.5 w-fit">
                    {(
                      [
                        ["permissions", "Permissões"],
                        ["summary", "Resumo"],
                        ...(canViewPermissionAudit
                          ? ([["audit", "Auditoria"]] as const)
                          : []),
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setInnerTab(id)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] font-semibold",
                          innerTab === id
                            ? "bg-card text-foreground shadow-sm"
                            : "text-muted-foreground"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {detailError ? (
                  <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {detailError}
                  </div>
                ) : null}

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {innerTab === "permissions" ? (
                    <>
                      <div className="flex flex-wrap gap-2">
                        <div className="relative flex-1 min-w-[160px]">
                          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                          <input
                            value={treeSearch}
                            onChange={(e) => setTreeSearch(e.target.value)}
                            placeholder="Buscar na árvore…"
                            className="w-full rounded-lg border border-border pl-8 pr-3 py-2 text-xs"
                          />
                        </div>
                        <button
                          type="button"
                          className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent"
                          onClick={() => setExpanded(new Set(collectTreeKeys(detail.tree)))}
                        >
                          Expandir tudo
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent"
                          onClick={() => setExpanded(new Set())}
                        >
                          Recolher tudo
                        </button>
                        <button
                          type="button"
                          disabled={detail.treeReadOnly}
                          className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                          onClick={() => {
                            const root = detail.tree[0];
                            if (!root) return;
                            setDraft(
                              setModuleFlags(draft, detail.tree, root.key, {
                                canView: true,
                                canExecute: true,
                                canManage: true,
                              })
                            );
                          }}
                        >
                          Marcar tudo do 1º módulo
                        </button>
                        <button
                          type="button"
                          disabled={detail.treeReadOnly}
                          className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                          onClick={() => void handleClearCustom()}
                        >
                          Limpar customizações
                        </button>
                        <button
                          type="button"
                          disabled={detail.treeReadOnly}
                          className="rounded-lg border border-border px-2 py-1.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                          onClick={() => void handleRestoreDefault()}
                        >
                          Restaurar padrão da role
                        </button>
                      </div>
                      <UserPermissionTree
                        tree={filteredTree}
                        draft={draft}
                        expanded={expanded}
                        readOnly={detail.treeReadOnly}
                        onToggleExpand={(key) => {
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        onDraftChange={(key, flags) =>
                          setDraft((d) => ({ ...d, [key]: flags }))
                        }
                      />
                    </>
                  ) : null}

                  {innerTab === "summary" ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <SummaryCard title="Menus liberados" items={detail.summary.menusAllowed} />
                      <SummaryCard
                        title="Submenus liberados"
                        items={detail.summary.submenusAllowed}
                      />
                      <SummaryCard title="Abas bloqueadas" items={detail.summary.tabsBlocked} />
                      <SummaryCard
                        title="Ações críticas liberadas"
                        items={detail.summary.criticalActionsAllowed}
                      />
                      <div className="sm:col-span-2 rounded-xl border border-border bg-muted/20 p-3">
                        <h5 className="text-xs font-bold">Diferenças vs padrão da role</h5>
                        {detail.diffVsRole.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Sem customizações — alinhado ao preset.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-1.5">
                            {detail.diffVsRole.map((d) => (
                              <li key={d.resourceKey} className="text-xs">
                                <span className="font-semibold">{d.label}</span>
                                <span className="text-muted-foreground">
                                  {" "}
                                  · role V{d.roleFlags.canView ? "1" : "0"}E
                                  {d.roleFlags.canExecute ? "1" : "0"}G
                                  {d.roleFlags.canManage ? "1" : "0"} → efetivo V
                                  {d.effectiveFlags.canView ? "1" : "0"}E
                                  {d.effectiveFlags.canExecute ? "1" : "0"}G
                                  {d.effectiveFlags.canManage ? "1" : "0"}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {innerTab === "audit" ? (
                    <div className="space-y-2">
                      {auditError ? (
                        <p className="text-sm text-amber-800">{auditError}</p>
                      ) : null}
                      {!auditError && audit.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Sem histórico de alterações de permissão.
                        </p>
                      ) : null}
                      {audit.map((entry) => {
                        const summary = summarizePermissionAuditChange(
                          entry.beforeJson,
                          entry.afterJson
                        );
                        return (
                          <div
                            key={entry.id}
                            className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
                          >
                            <div className="flex flex-wrap justify-between gap-2">
                              <span className="font-semibold">
                                {permissionAuditActionLabel(entry.action)}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDateTimePt(entry.createdAt)}
                              </span>
                            </div>
                            <p className="text-muted-foreground mt-0.5">
                              Ator: {entry.actor?.name ?? "—"}
                              {entry.actor?.email ? ` (${entry.actor.email})` : ""}
                            </p>
                            <p className="mt-0.5">
                              <span className="text-muted-foreground">Recurso: </span>
                              {entry.resourceKey ?? "—"}
                            </p>
                            <p className="mt-0.5">
                              <span className="text-muted-foreground">Antes: </span>
                              {summary.before}
                              <span className="text-muted-foreground"> → Depois: </span>
                              {summary.after}
                            </p>
                            {summary.reason ? (
                              <p className="mt-0.5 text-muted-foreground">
                                Motivo: {summary.reason}
                              </p>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                {innerTab === "permissions" && !detail.treeReadOnly ? (
                  <div className="border-t border-border p-3 flex flex-wrap items-center justify-between gap-2 bg-muted/20">
                    <span className="text-[11px] text-muted-foreground">
                      {pending ? (
                        <span className="font-semibold text-amber-800">Alterações pendentes</span>
                      ) : (
                        "Sem alterações pendentes"
                      )}
                      {activeSuperAdminCount > 0 ? (
                        <span className="ml-2">· {activeSuperAdminCount} Super Admin ativos</span>
                      ) : null}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!pending || saving}
                        onClick={() => {
                          if (!detail) return;
                          setDraft(draftFromPayloadTree(detail.tree));
                        }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleRestoreDefault()}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                      >
                        Restaurar padrão da role
                      </button>
                      <button
                        type="button"
                        disabled={!pending || saving}
                        onClick={() => void handleSaveOverrides()}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                      >
                        {saving ? "Salvando…" : "Salvar alterações"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-6 text-sm text-red-700">{detailError ?? "Falha ao carregar."}</div>
            )}
          </div>
        </div>
      )}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-lg rounded-2xl border border-border shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h4 className="font-bold">Novo usuário</h4>
              <button type="button" onClick={() => setCreateOpen(false)} className="p-1.5 rounded-full hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-4 space-y-3">
              {createError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                  {createError}
                </div>
              ) : null}
              <input
                required
                placeholder="Nome"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <input
                required
                type="email"
                placeholder="E-mail"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <input
                required
                type="password"
                placeholder="Senha provisória"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <select
                value={createForm.role}
                onChange={(e) =>
                  setCreateForm((f) => ({ ...f, role: e.target.value as AppUserRole }))
                }
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              >
                {APP_USER_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {createForm.role === "SELLER" ? (
                <SellerNomusPicker
                  sellers={sellerOptions}
                  value={{
                    externalSellerId: createForm.externalSellerId,
                    sellerResponsibleName: createForm.sellerResponsibleName,
                  }}
                  onChange={(next) =>
                    setCreateForm((f) => ({
                      ...f,
                      externalSellerId: next.externalSellerId,
                      sellerResponsibleName: next.sellerResponsibleName,
                    }))
                  }
                />
              ) : null}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resetOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-xl p-4 space-y-3">
            <h4 className="font-bold">Redefinir senha</h4>
            {resetError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {resetError}
              </div>
            ) : null}
            <form onSubmit={handleResetPassword} className="space-y-3">
              <input
                type="password"
                placeholder="Nova senha"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <input
                type="password"
                placeholder="Confirmar senha"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setResetOpen(false)}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  Salvar senha
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};

function SummaryCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <h5 className="text-xs font-bold">{title}</h5>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nenhum</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item} className="text-xs text-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
