import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
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
import { SellerNomusPicker, type SellerNomusPickerValue } from "@/src/components/admin/SellerNomusPicker";
import { EmployeeUserPicker } from "@/src/components/admin/EmployeeUserPicker";
import type { AdminSellerOption } from "@/src/lib/adminSellerOptionsTypes";
import type { EligibleEmployeeForUserDto } from "@/src/lib/adminUserEmployeeLink";
import {
  roleAllowsSellerNomusLink,
  roleRequiresSellerNomusLink,
} from "@/src/lib/adminUserSellerLink";
import { countActiveSuperAdmins } from "@/src/lib/adminUsersPagination";
import { RolePermissionMatrixPanel } from "@/src/components/admin/RolePermissionMatrixPanel";
import { PermissionMatrix } from "@/src/components/admin/PermissionMatrix";
import {
  applyUserPermissionPreset,
  clearUserPermissionOverrides,
  deleteAdminUser,
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
import { evaluateAppUserDeleteGuard } from "@/src/lib/adminUserDelete";
import {
  filterAdminUsersList,
  flattenPermissionTreeLabels,
  formatPermissionFlagsHuman,
} from "@/src/lib/userPermissionsAdminUi";
import {
  buildSaveOverridesFromMatrix,
  buildUserEffectivePreview,
  buildUserPermissionMatrixModel,
  hasCriticalPermissionChanges,
  liberateFirstMenuInMatrixDraft,
  resetMatrixDraftToBaseline,
  USER_PERMISSION_PRECEDENCE_NOTICE,
  userMatrixImpact,
  wouldMatrixRemoveOwnUsersManage,
} from "@/src/lib/userPermissionsMatrix";
import type { PermissionMatrixDraft } from "@/src/lib/security/permissionMatrixUi/index.ts";
import {
  isMatrixDraftDirty,
} from "@/src/lib/security/permissionMatrixUi/index.ts";
import {
  canViewFullPermissionAudit,
  permissionAuditActionLabel,
  summarizePermissionAuditChange,
} from "@/src/lib/security/permissionAudit";
import { usePermissions } from "@/src/hooks/usePermissions";
import { ResourceKeys } from "@/src/lib/permissionsClient";
import { HttpError } from "@/src/lib/http";

type CreateForm = {
  employeeId: string;
  name: string;
  email: string;
  role: AppUserRole;
  isActive: boolean;
  password: string;
  externalSellerId: string;
  externalSellerIds: number[];
  sellerResponsibleName: string;
};

const EMPTY_CREATE: CreateForm = {
  employeeId: "",
  name: "",
  email: "",
  role: "VIEWER",
  isActive: true,
  password: "",
  externalSellerId: "",
  externalSellerIds: [],
  sellerResponsibleName: "",
};

const EMPTY_SELLER_LINK: SellerNomusPickerValue = {
  externalSellerId: "",
  externalSellerIds: [],
  sellerResponsibleName: "",
};

function sellerLinkFromUser(user: {
  externalSellerId: number | null;
  externalSellerIds?: number[] | null;
  sellerResponsibleName: string | null;
}): SellerNomusPickerValue {
  const ids = Array.isArray(user.externalSellerIds)
    ? user.externalSellerIds.filter((id) => Number.isFinite(id) && id > 0)
    : user.externalSellerId != null
      ? [user.externalSellerId]
      : [];
  const primary = user.externalSellerId ?? (ids.length > 0 ? Math.min(...ids) : null);
  return {
    externalSellerId: primary != null ? String(primary) : "",
    externalSellerIds: ids,
    sellerResponsibleName: user.sellerResponsibleName?.trim() ?? "",
  };
}

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

export const AdminUsersModule: React.FC = () => {
  const { hasPermission, authUser, loadMe } = useAuth();
  const permissionsApi = usePermissions();
  const canManage =
    hasPermission("users.manage") ||
    permissionsApi.canPerformAction("admin.settings.security", "manage");
  const canViewPermissionAudit = canViewFullPermissionAudit(
    permissionsApi.canManage(ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE) ||
      permissionsApi.canPerformAction("admin.settings.security", "manage") ||
      authUser?.role === "SUPER_ADMIN"
  );
  const currentUserId = authUser?.id ?? null;

  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [sellerOptions, setSellerOptions] = useState<AdminSellerOption[]>([]);
  const [eligibleEmployees, setEligibleEmployees] = useState<EligibleEmployeeForUserDto[]>([]);
  const [eligibleEmployeesLoading, setEligibleEmployeesLoading] = useState(false);
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
  const [matrixDraft, setMatrixDraft] = useState<PermissionMatrixDraft>({});
  /** Baseline da role (allow/deny/baseline). */
  const [roleBaseline, setRoleBaseline] = useState<PermissionMatrixDraft>({});
  /** Snapshot efetivo no load (dirty / cancelar). */
  const [loadedSnapshot, setLoadedSnapshot] = useState<PermissionMatrixDraft>({});
  const [confirmCriticalOpen, setConfirmCriticalOpen] = useState(false);
  const [showEffectivePreview, setShowEffectivePreview] = useState(true);
  const [audit, setAudit] = useState<PermissionAuditEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<RoleMatrixRowDto[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [createError, setCreateError] = useState<string | null>(null);
  const [sellerLinkDraft, setSellerLinkDraft] = useState<SellerNomusPickerValue>(EMPTY_SELLER_LINK);
  const [sellerLinkError, setSellerLinkError] = useState<string | null>(null);
  const [sellerLinkSaving, setSellerLinkSaving] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadEligibleEmployees = useCallback(async () => {
    setEligibleEmployeesLoading(true);
    try {
      const res = await fetchJsonOk<{ employees: EligibleEmployeeForUserDto[] }>(
        "/api/admin/eligible-employees"
      );
      setEligibleEmployees(Array.isArray(res.employees) ? res.employees : []);
    } catch {
      setEligibleEmployees([]);
    } finally {
      setEligibleEmployeesLoading(false);
    }
  }, []);

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
    setConfirmCriticalOpen(false);
    try {
      const payload = await fetchUserPermissions(userId);
      setDetail(payload);
      const model = buildUserPermissionMatrixModel(payload.tree);
      setRoleBaseline(model.baseline);
      setLoadedSnapshot(model.draft);
      setMatrixDraft(model.draft);
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
    return isMatrixDraftDirty(matrixDraft, loadedSnapshot);
  }, [matrixDraft, loadedSnapshot]);

  const matrixModelRows = useMemo(() => {
    if (!detail) return [];
    return buildUserPermissionMatrixModel(detail.tree).rows;
  }, [detail]);

  const effectivePreview = useMemo(() => {
    if (!detail) return null;
    return buildUserEffectivePreview(detail.tree, matrixDraft, roleBaseline);
  }, [detail, matrixDraft, roleBaseline]);

  const impact = useMemo(() => {
    if (!detail || matrixModelRows.length === 0) return null;
    return userMatrixImpact(matrixModelRows, matrixDraft, loadedSnapshot);
  }, [detail, matrixModelRows, matrixDraft, loadedSnapshot]);

  const selectedListUser = useMemo(
    () => users.find((u) => u.id === selectedId) ?? null,
    [users, selectedId]
  );

  useEffect(() => {
    if (!selectedListUser) {
      setSellerLinkDraft(EMPTY_SELLER_LINK);
      setSellerLinkError(null);
      return;
    }
    setSellerLinkDraft(sellerLinkFromUser(selectedListUser));
    setSellerLinkError(null);
  }, [selectedListUser]);

  const sellerLinkDirty = useMemo(() => {
    if (!selectedListUser || !roleAllowsSellerNomusLink(selectedListUser.role)) return false;
    const baseline = sellerLinkFromUser(selectedListUser);
    return (
      baseline.sellerResponsibleName !== sellerLinkDraft.sellerResponsibleName.trim() ||
      baseline.externalSellerId !== sellerLinkDraft.externalSellerId ||
      baseline.externalSellerIds.join(",") !== sellerLinkDraft.externalSellerIds.join(",")
    );
  }, [selectedListUser, sellerLinkDraft]);

  const treeLabels = useMemo(
    () => (detail ? flattenPermissionTreeLabels(detail.tree) : new Map<string, string>()),
    [detail]
  );

  const hydrateMatrixFromPayload = (payload: UserPermissionsPayload) => {
    const model = buildUserPermissionMatrixModel(payload.tree);
    setRoleBaseline(model.baseline);
    setLoadedSnapshot(model.draft);
    setMatrixDraft(model.draft);
  };

  const confirmClearIfNeeded = (hasCustom: boolean, message: string): boolean => {
    if (!hasCustom) return true;
    return window.confirm(message);
  };

  const persistOverrides = async () => {
    if (!detail || !selectedId) return;
    setSaving(true);
    setDetailError(null);
    try {
      if (
        wouldMatrixRemoveOwnUsersManage({
          isEditingSelf: selectedId === currentUserId,
          existingRole: detail.user.role,
          matrixDraft,
          roleDefaults: detail.roleDefaults,
        })
      ) {
        setDetailError(
          "Você não pode remover a própria permissão de gerenciar usuários (auto-lockout)."
        );
        setSaving(false);
        return;
      }
      const overrides = buildSaveOverridesFromMatrix(matrixDraft, detail.roleDefaults);
      const payload = await saveUserPermissionOverrides(selectedId, overrides);
      setDetail(payload);
      hydrateMatrixFromPayload(payload);
      setConfirmCriticalOpen(false);
      await loadUsers();
      if (selectedId === currentUserId) {
        await loadMe();
      }
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOverrides = async () => {
    if (!detail || !selectedId) return;
    if (hasCriticalPermissionChanges(matrixDraft, roleBaseline) && !confirmCriticalOpen) {
      setConfirmCriticalOpen(true);
      return;
    }
    await persistOverrides();
  };

  const handleRestoreDefault = async () => {
    if (!detail || !selectedId) return;
    if (
      !confirmClearIfNeeded(
        detail.hasCustomPermissions,
        "Restaurar o padrão do perfil remove as permissões personalizadas. Continuar?"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const payload = await restoreUserRoleDefault(selectedId, true);
      setDetail(payload);
      hydrateMatrixFromPayload(payload);
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Não foi possível restaurar o padrão.");
    } finally {
      setSaving(false);
    }
  };

  const handleClearCustom = async () => {
    if (!detail || !selectedId) return;
    if (
      !confirmClearIfNeeded(
        true,
        "Limpar todas as personalizações e voltar ao padrão do perfil?"
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const payload = await clearUserPermissionOverrides(selectedId, true);
      setDetail(payload);
      hydrateMatrixFromPayload(payload);
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Não foi possível limpar as personalizações.");
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (role: AppUserRole) => {
    if (!detail || !selectedId || role === detail.user.role) return;
    if (detail.warnings.isLastSuperAdmin && role !== "SUPER_ADMIN") {
      setDetailError("Não é possível alterar o perfil do único Super Administrador ativo.");
      return;
    }
    if (
      !confirmClearIfNeeded(
        detail.hasCustomPermissions,
        "Trocar o perfil aplica o padrão do novo perfil e remove personalizações. Continuar?"
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
      hydrateMatrixFromPayload(payload);
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao alterar perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSellerLink = async () => {
    if (!selectedListUser || !selectedId) return;
    if (!roleAllowsSellerNomusLink(selectedListUser.role)) return;

    if (roleRequiresSellerNomusLink(selectedListUser.role)) {
      if (!sellerLinkDraft.sellerResponsibleName.trim()) {
        setSellerLinkError("Vendedor precisa de um responsável comercial.");
        return;
      }
      if (sellerLinkDraft.externalSellerIds.length === 0) {
        setSellerLinkError("Selecione ao menos um ID Nomus para vincular a este login.");
        return;
      }
    }

    setSellerLinkSaving(true);
    setSellerLinkError(null);
    try {
      await fetchJsonOk(`/api/admin/users/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          externalSellerId: sellerLinkDraft.externalSellerId.trim()
            ? Number.parseInt(sellerLinkDraft.externalSellerId.trim(), 10)
            : null,
          externalSellerIds: sellerLinkDraft.externalSellerIds,
          sellerResponsibleName: sellerLinkDraft.sellerResponsibleName.trim() || null,
        }),
      });
      await loadUsers();
    } catch (e) {
      setSellerLinkError(e instanceof Error ? e.message : "Falha ao salvar vínculo Nomus.");
    } finally {
      setSellerLinkSaving(false);
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
    if (!createForm.employeeId.trim()) {
      setCreateError("Selecione uma pessoa cadastrada em Pessoas / RH.");
      return;
    }
    if (!createForm.name.trim() || !createForm.email.includes("@")) {
      setCreateError("Informe nome e e-mail de acesso válidos.");
      return;
    }
    if (createForm.password.length < APP_PASSWORD_MIN_LENGTH) {
      setCreateError(`Senha com no mínimo ${APP_PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (roleRequiresSellerNomusLink(createForm.role)) {
      if (!createForm.sellerResponsibleName.trim()) {
        setCreateError("Vendedor precisa de um responsável comercial.");
        return;
      }
      if (createForm.externalSellerIds.length === 0) {
        setCreateError("Selecione ao menos um ID Nomus para vincular a este login.");
        return;
      }
    }
    setSaving(true);
    setCreateError(null);
    try {
      await fetchJsonOk("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: createForm.employeeId.trim(),
          name: createForm.name.trim(),
          email: createForm.email.trim(),
          password: createForm.password,
          role: createForm.role,
          permissions: [],
          isActive: createForm.isActive,
          externalSellerId: createForm.externalSellerId.trim()
            ? Number.parseInt(createForm.externalSellerId.trim(), 10)
            : null,
          externalSellerIds: createForm.externalSellerIds,
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

  const deleteGuardPreview = useMemo(() => {
    if (!selectedListUser) return null;
    const otherActiveSuperAdmins = users.filter(
      (u) =>
        u.id !== selectedListUser.id && u.isActive && u.role === "SUPER_ADMIN"
    ).length;
    return evaluateAppUserDeleteGuard({
      target: {
        id: selectedListUser.id,
        role: selectedListUser.role,
        isActive: selectedListUser.isActive,
      },
      actorUserId: currentUserId,
      otherActiveSuperAdminCount: otherActiveSuperAdmins,
    });
  }, [selectedListUser, users, currentUserId]);

  const handleDeleteUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedListUser || !selectedId) return;
    if (deleteGuardPreview && !deleteGuardPreview.ok) {
      setDeleteError(deleteGuardPreview.message);
      return;
    }
    if (
      deleteConfirmEmail.trim().toLowerCase() !== selectedListUser.email.trim().toLowerCase()
    ) {
      setDeleteError("Digite o e-mail do usuário para confirmar a exclusão.");
      return;
    }
    setSaving(true);
    setDeleteError(null);
    try {
      await deleteAdminUser(selectedId);
      setDeleteOpen(false);
      setDeleteConfirmEmail("");
      setSelectedId(null);
      setDetail(null);
      await loadUsers();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Falha ao excluir usuário.");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div
        className="rounded-2xl border border-amber-200/80 bg-amber-50/80 p-6 text-sm text-amber-950"
        data-testid="admin-users-no-permission"
      >
        <p className="font-semibold">Sem permissão</p>
        <p className="mt-1 text-amber-900/90">
          Você não tem acesso para gerenciar usuários e permissões. Peça a um administrador.
        </p>
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
            Controle o acesso por menu, submenu, abas e ações. Novos usuários nascem apenas a partir
            do cadastro de Pessoas / RH.
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
            Atualizar acessos
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateForm(EMPTY_CREATE);
              setCreateError(null);
              setCreateOpen(true);
              void loadEligibleEmployees();
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
                  <option value="ALL">Todos os perfis</option>
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
                Com acesso personalizado
              </label>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando usuários…
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-6 text-center space-y-1">
                  <p className="text-sm font-medium text-foreground">Nenhum usuário encontrado</p>
                  <p className="text-xs text-muted-foreground">
                    Ajuste a busca ou os filtros, ou crie um novo usuário.
                  </p>
                </div>
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
                              {user.employeeName ? (
                                <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                                  RH: {user.employeeName}
                                  {user.employeeDepartment ? ` · ${user.employeeDepartment}` : ""}
                                </p>
                              ) : (
                                <p className="text-[10px] text-amber-800/90 truncate mt-0.5">
                                  Sem vínculo Pessoas / RH
                                </p>
                              )}
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
                                Personalizado
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
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <Shield className="h-8 w-8 text-muted-foreground/50" aria-hidden />
                <p className="text-sm font-medium text-foreground">Nenhum usuário selecionado</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Escolha um usuário à esquerda para ver e ajustar o acesso a menus, abas e ações.
                </p>
              </div>
            ) : detailLoading && !detail ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando acessos…
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
                      {selectedListUser?.employeeName ? (
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Pessoas / RH:{" "}
                          <span className="font-medium text-foreground">
                            {selectedListUser.employeeName}
                          </span>
                          {selectedListUser.employeeDepartment
                            ? ` · ${selectedListUser.employeeDepartment}`
                            : ""}
                        </p>
                      ) : (
                        <p className="text-[11px] text-amber-800 mt-1">
                          Usuário legado sem vínculo com Pessoas / RH.
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                      <button
                        type="button"
                        disabled={
                          saving ||
                          selectedId === currentUserId ||
                          (deleteGuardPreview != null && !deleteGuardPreview.ok)
                        }
                        title={
                          selectedId === currentUserId
                            ? "Você não pode excluir o próprio usuário"
                            : deleteGuardPreview && !deleteGuardPreview.ok
                              ? deleteGuardPreview.message
                              : "Excluir usuário permanentemente"
                        }
                        onClick={() => {
                          setDeleteConfirmEmail("");
                          setDeleteError(
                            deleteGuardPreview && !deleteGuardPreview.ok
                              ? deleteGuardPreview.message
                              : null
                          );
                          setDeleteOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50"
                        data-testid="admin-user-delete-open"
                      >
                        <Trash2 className="h-3 w-3" />
                        Excluir
                      </button>
                    </div>
                  </div>

                  {detail.warnings.editingSuperAdmin ? (
                    <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950 flex gap-2">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>
                        Este usuário é Super Administrador: o acesso é total e a árvore fica somente
                        leitura.
                        {detail.warnings.isLastSuperAdmin
                          ? " Ele é o único Super Administrador ativo — o perfil não pode ser alterado."
                          : null}
                      </span>
                    </div>
                  ) : null}

                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-muted-foreground">
                      Perfil de acesso
                    </label>
                    <select
                      value={detail.user.role}
                      disabled={saving || detail.warnings.isLastSuperAdmin}
                      title={
                        detail.warnings.isLastSuperAdmin
                          ? "Não é possível alterar o único Super Administrador ativo"
                          : undefined
                      }
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

                  {selectedListUser && roleAllowsSellerNomusLink(selectedListUser.role) ? (
                    <div
                      className="rounded-xl border border-border bg-muted/20 p-3 space-y-3"
                      data-testid="admin-user-seller-nomus-link"
                    >
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Vínculo Nomus / responsável comercial
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                          {roleRequiresSellerNomusLink(selectedListUser.role)
                            ? "Obrigatório para o perfil Vendedor filtrar a carteira corretamente."
                            : "Opcional no perfil Gestor comercial — use para vincular os IDs Nomus da carteira acompanhada."}
                        </p>
                      </div>
                      {sellerLinkError ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                          {sellerLinkError}
                        </div>
                      ) : null}
                      <SellerNomusPicker
                        sellers={sellerOptions}
                        requireNomusIds={roleRequiresSellerNomusLink(selectedListUser.role)}
                        disabled={sellerLinkSaving || saving}
                        value={sellerLinkDraft}
                        onChange={setSellerLinkDraft}
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={!sellerLinkDirty || sellerLinkSaving || saving}
                          onClick={() => void handleSaveSellerLink()}
                          className="rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
                          data-testid="admin-user-seller-nomus-save"
                        >
                          {sellerLinkSaving ? "Salvando…" : "Salvar vínculo Nomus"}
                        </button>
                      </div>
                    </div>
                  ) : null}

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
                      <div
                        className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-[11px] space-y-1"
                        data-testid="user-permission-context"
                      >
                        <p>
                          <strong>Baseline (role):</strong>{" "}
                          {formatRoleLabel(detail.user.role)}
                        </p>
                        <p>
                          <strong>Snapshot de perfil de acesso:</strong>{" "}
                          {selectedListUser?.accessProfileName
                            ? selectedListUser.accessProfileName
                            : "Nenhum vinculado (só role / overrides)"}
                        </p>
                        <p>
                          <strong>Permissões diretas:</strong>{" "}
                          {detail.user.permissions.length} chave(s) legadas materializadas
                        </p>
                        <p className="text-muted-foreground">{USER_PERMISSION_PRECEDENCE_NOTICE}</p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={detail.treeReadOnly}
                          title="Concede Ver/Executar/Gerenciar no primeiro menu e filhos"
                          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                          onClick={() => {
                            setMatrixDraft(
                              liberateFirstMenuInMatrixDraft(detail.tree, matrixDraft)
                            );
                          }}
                        >
                          Liberar 1º menu
                        </button>
                        <button
                          type="button"
                          disabled={detail.treeReadOnly}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                          onClick={() => void handleClearCustom()}
                        >
                          Limpar personalizações
                        </button>
                        <button
                          type="button"
                          disabled={detail.treeReadOnly}
                          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                          onClick={() => void handleRestoreDefault()}
                        >
                          Restaurar padrão do perfil
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent"
                          onClick={() => setShowEffectivePreview((v) => !v)}
                        >
                          {showEffectivePreview ? "Ocultar preview" : "Preview efetivo"}
                        </button>
                      </div>

                      {showEffectivePreview && effectivePreview ? (
                        <div
                          className="rounded-xl border border-border bg-card px-3 py-2 text-[11px]"
                          data-testid="user-permission-effective-preview"
                        >
                          <p className="font-semibold">Como este usuário verá o sistema</p>
                          <p className="mt-1 text-muted-foreground">
                            Allow: {effectivePreview.allowCount} · Deny:{" "}
                            {effectivePreview.denyCount} · Só baseline:{" "}
                            {effectivePreview.baselineOnlyCount}
                            {impact
                              ? ` · ${impact.dirtyResourceCount} recurso(s) alterado(s)`
                              : ""}
                          </p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div>
                              <p className="font-medium">Menus liberados</p>
                              <p className="text-muted-foreground">
                                {effectivePreview.menusAllowed.slice(0, 8).join(", ") || "—"}
                                {effectivePreview.menusAllowed.length > 8
                                  ? ` (+${effectivePreview.menusAllowed.length - 8})`
                                  : ""}
                              </p>
                            </div>
                            <div>
                              <p className="font-medium">Abas bloqueadas</p>
                              <p className="text-muted-foreground">
                                {effectivePreview.tabsBlocked.slice(0, 8).join(", ") || "—"}
                                {effectivePreview.tabsBlocked.length > 8
                                  ? ` (+${effectivePreview.tabsBlocked.length - 8})`
                                  : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {confirmCriticalOpen ? (
                        <div
                          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 space-y-2"
                          data-testid="user-permission-critical-confirm"
                        >
                          <p className="font-semibold">
                            Confirmar alteração em permissões administrativas críticas?
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold"
                              onClick={() => setConfirmCriticalOpen(false)}
                            >
                              Voltar
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                              onClick={() => void persistOverrides()}
                            >
                              Confirmar e salvar
                            </button>
                          </div>
                        </div>
                      ) : null}

                      <PermissionMatrix
                        rows={matrixModelRows}
                        draft={matrixDraft}
                        baseline={loadedSnapshot}
                        onDraftChange={setMatrixDraft}
                        readOnly={detail.treeReadOnly}
                        emptyMessage="Nenhuma área de acesso disponível."
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
                        title="Ações sensíveis liberadas"
                        items={detail.summary.criticalActionsAllowed}
                      />
                      <div className="sm:col-span-2 rounded-xl border border-border bg-muted/20 p-3">
                        <h5 className="text-xs font-bold">Diferenças em relação ao padrão do perfil</h5>
                        {detail.diffVsRole.length === 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Sem personalizações — alinhado ao padrão do perfil.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {detail.diffVsRole.map((d) => (
                              <li
                                key={d.resourceKey}
                                className="rounded-lg border border-border/60 bg-background px-2.5 py-2 text-xs"
                              >
                                <span className="font-semibold">{d.label}</span>
                                <p className="mt-1 text-muted-foreground">
                                  Padrão: {formatPermissionFlagsHuman(d.roleFlags)}
                                </p>
                                <p className="text-foreground">
                                  Atual: {formatPermissionFlagsHuman(d.effectiveFlags)}
                                </p>
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
                        <div className="rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-sm text-amber-950">
                          {auditError}
                        </div>
                      ) : null}
                      {!auditError && audit.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
                          <p className="text-sm text-muted-foreground">
                            Ainda não há histórico de alterações de acesso para este usuário.
                          </p>
                        </div>
                      ) : null}
                      {audit.map((entry) => {
                        const summary = summarizePermissionAuditChange(
                          entry.beforeJson,
                          entry.afterJson
                        );
                        const areaLabel = entry.resourceKey
                          ? treeLabels.get(entry.resourceKey) ?? entry.resourceKey
                          : "Perfil / acesso geral";
                        return (
                          <div
                            key={entry.id}
                            className="rounded-lg border border-border bg-background px-3 py-2.5 text-xs"
                          >
                            <div className="flex flex-wrap justify-between gap-2">
                              <span className="font-semibold">
                                {permissionAuditActionLabel(entry.action)}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDateTimePt(entry.createdAt)}
                              </span>
                            </div>
                            <p className="text-muted-foreground mt-1">
                              Alterado por: {entry.actor?.name ?? "—"}
                              {entry.actor?.email ? ` (${entry.actor.email})` : ""}
                            </p>
                            <p className="mt-0.5">
                              <span className="text-muted-foreground">Área: </span>
                              {areaLabel}
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
                  <div className="border-t border-border p-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between bg-muted/20">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {pending ? (
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-950">
                          Alterações pendentes
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Sem alterações pendentes</span>
                      )}
                      {activeSuperAdminCount > 0 ? (
                        <span className="text-muted-foreground">
                          · {activeSuperAdminCount} Super Admin ativo
                          {activeSuperAdminCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!pending || saving}
                        onClick={() => {
                          if (!detail) return;
                          setMatrixDraft(resetMatrixDraftToBaseline(loadedSnapshot));
                          setConfirmCriticalOpen(false);
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
                        Restaurar padrão do perfil
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
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm font-medium text-red-800">
                  {detailError ?? "Não foi possível carregar este usuário."}
                </p>
                <button
                  type="button"
                  className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  onClick={() => selectedId && void loadDetail(selectedId)}
                >
                  Tentar novamente
                </button>
              </div>
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
              <EmployeeUserPicker
                employees={eligibleEmployees}
                value={createForm.employeeId}
                loading={eligibleEmployeesLoading}
                onChange={(employeeId, employee) => {
                  setCreateForm((f) => ({
                    ...f,
                    employeeId,
                    name: employee?.displayName ?? "",
                    email: employee?.personalEmail?.trim() || f.email,
                  }));
                }}
              />
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">Nome</span>
                <input
                  required
                  placeholder="Nome (vindo do RH)"
                  value={createForm.name}
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  E-mail de acesso
                </span>
                <input
                  required
                  type="email"
                  placeholder="E-mail de login"
                  value={createForm.email}
                  onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </label>
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
              {roleAllowsSellerNomusLink(createForm.role) ? (
                <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {roleRequiresSellerNomusLink(createForm.role)
                      ? "Vínculo obrigatório: responsável comercial e ao menos um ID Nomus."
                      : "Opcional para gestor comercial: vincule o responsável e os IDs Nomus da carteira que este perfil acompanha."}
                  </p>
                  <SellerNomusPicker
                    sellers={sellerOptions}
                    requireNomusIds={roleRequiresSellerNomusLink(createForm.role)}
                    value={{
                      externalSellerId: createForm.externalSellerId,
                      externalSellerIds: createForm.externalSellerIds,
                      sellerResponsibleName: createForm.sellerResponsibleName,
                    }}
                    onChange={(next) =>
                      setCreateForm((f) => ({
                        ...f,
                        externalSellerId: next.externalSellerId,
                        externalSellerIds: next.externalSellerIds,
                        sellerResponsibleName: next.sellerResponsibleName,
                      }))
                    }
                  />
                </div>
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
                  disabled={saving || !createForm.employeeId}
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

      {deleteOpen && selectedListUser ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div
            className="bg-card w-full max-w-md rounded-2xl border border-border shadow-xl p-4 space-y-3"
            data-testid="admin-user-delete-modal"
          >
            <h4 className="font-bold text-red-800">Excluir usuário</h4>
            <p className="text-sm text-muted-foreground">
              Esta ação remove permanentemente a conta{" "}
              <span className="font-semibold text-foreground">{selectedListUser.name}</span> (
              {selectedListUser.email}). Sessões ativas serão encerradas e a pessoa do RH fica
              liberada para novo vínculo.
            </p>
            {deleteError ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                {deleteError}
              </div>
            ) : null}
            <form onSubmit={handleDeleteUser} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Digite o e-mail para confirmar
                </span>
                <input
                  type="email"
                  autoComplete="off"
                  placeholder={selectedListUser.email}
                  value={deleteConfirmEmail}
                  onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  data-testid="admin-user-delete-confirm-email"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteOpen(false);
                    setDeleteConfirmEmail("");
                    setDeleteError(null);
                  }}
                  className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    saving ||
                    (deleteGuardPreview != null && !deleteGuardPreview.ok) ||
                    deleteConfirmEmail.trim().toLowerCase() !==
                      selectedListUser.email.trim().toLowerCase()
                  }
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  data-testid="admin-user-delete-confirm"
                >
                  {saving ? "Excluindo…" : "Excluir definitivamente"}
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
    <div className="rounded-xl border border-border bg-muted/20 p-3 h-full">
      <h5 className="text-xs font-bold">{title}</h5>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nenhum item nesta lista.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {items.map((item) => (
            <li key={item} className="text-xs text-foreground leading-snug">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
