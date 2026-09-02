import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Copy,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { HttpError, fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  APP_USER_ROLE_OPTIONS,
  type AppUserRole,
  formatRoleLabel,
} from "@/src/lib/appAuthClient";
import {
  describePasswordPolicy,
  validatePasswordPolicy,
} from "@/src/lib/auth/passwordPolicy";
import {
  describePasswordError,
  requestAdminResetPassword,
} from "@/src/lib/auth/passwordLifecycleClient";
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
import { PermissionsTree } from "@/src/components/admin/PermissionsTree";
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
import {
  fetchAccessProfilesList,
  type AccessProfileRecord,
} from "@/src/lib/accessProfilesClient";
import { evaluateAppUserDeleteGuard } from "@/src/lib/adminUserDelete";
import {
  filterAdminUsersList,
  flattenPermissionTreeLabels,
  formatPermissionFlagsHuman,
} from "@/src/lib/userPermissionsAdminUi";
import {
  buildMatrixSaveDiff,
  buildSaveOverridesFromMatrix,
  buildUserEffectivePreview,
  buildUserPermissionMatrixModel,
  hasBroadPermissionChanges,
  hasCriticalPermissionChanges,
  liberateFirstMenuInMatrixDraft,
  resetMatrixDraftToBaseline,
  sessionAffectedMessage,
  userMatrixImpact,
  wouldMatrixRemoveOwnUsersManage,
} from "@/src/lib/userPermissionsMatrix";
import {
  buildUserPermissionTreeModel,
  countUserPermissionExceptions,
  countUserPermissionTreeChanges,
  decisionsFromUserDraft,
  detectAccessProfileSnapshotDrift,
  draftFromUserDecisions,
} from "@/src/lib/userPermissionsTree";
import type { PermissionMatrixDraft } from "@/src/lib/security/permissionMatrixUi/index.ts";
import { isMatrixDraftDirty } from "@/src/lib/security/permissionMatrixUi/index.ts";
import type {
  PermissionTreeDecisions,
  PermissionTreeNode,
} from "@/src/lib/security/permissionsTreeUi/index.ts";
import { mapPermissionTreeEffectives } from "@/src/lib/security/permissionsTreeUi/index.ts";
import { arrangePermissionTreeBySidebar } from "@/src/lib/permissionTreeSidebarLayout";
import {
  canViewFullPermissionAudit,
  permissionAuditActionLabel,
  summarizePermissionAuditChange,
} from "@/src/lib/security/permissionAudit";
import { usePermissions } from "@/src/hooks/usePermissions";
import { ResourceKeys } from "@/src/lib/permissionsClient";

type CreateForm = {
  employeeId: string;
  name: string;
  email: string;
  isActive: boolean;
  password: string;
};

const EMPTY_CREATE: CreateForm = {
  employeeId: "",
  name: "",
  email: "",
  isActive: true,
  password: "",
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
  const [accessProfiles, setAccessProfiles] = useState<AccessProfileRecord[]>([]);
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
  /**
   * Árvore canônica do catálogo: fonte de verdade para decisões ⇄ draft e para
   * o resultado efetivo (herança de pai). A exibição usa o layout da sidebar.
   */
  const [treeNodes, setTreeNodes] = useState<PermissionTreeNode[]>([]);
  const [treeDecisions, setTreeDecisions] = useState<PermissionTreeDecisions>({});
  const [treeBaselineDecisions, setTreeBaselineDecisions] =
    useState<PermissionTreeDecisions>({});
  const [confirmCriticalOpen, setConfirmCriticalOpen] = useState(false);
  const [confirmBroadOpen, setConfirmBroadOpen] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showEffectivePreview, setShowEffectivePreview] = useState(false);
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
  // A senha temporária é GERADA pelo backend e devolvida uma única vez.
  // Fica só neste estado local: fechar o modal ou recarregar a página a perde,
  // e não existe rota para reconsultá-la.
  const [resetTemporaryPassword, setResetTemporaryPassword] = useState<string | null>(null);
  const [resetCopied, setResetCopied] = useState(false);
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
      const [list, sellers, profiles] = await Promise.all([
        fetchAdminUsersList(),
        fetchJsonOk<{ sellers: AdminSellerOption[] }>("/api/admin/seller-options").catch(() => ({
          sellers: [] as AdminSellerOption[],
        })),
        fetchAccessProfilesList({ activeOnly: true }).catch(() => [] as AccessProfileRecord[]),
      ]);
      setUsers(list);
      setSellerOptions(Array.isArray(sellers.sellers) ? sellers.sellers : []);
      setAccessProfiles(profiles);
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

  const hydrateTreeFromPayload = useCallback((payload: UserPermissionsPayload) => {
    const model = buildUserPermissionTreeModel(payload.tree, {
      profileFlagsByKey: payload.profileFlags,
    });
    setRoleBaseline(model.baseline);
    setLoadedSnapshot(model.draft);
    setMatrixDraft(model.draft);
    setTreeNodes(model.nodes);
    setTreeDecisions(model.decisions);
    setTreeBaselineDecisions({ ...model.decisions });
  }, []);

  const loadDetail = useCallback(async (userId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setConfirmCriticalOpen(false);
    setSaveSuccess(null);
    try {
      const payload = await fetchUserPermissions(userId);
      setDetail(payload);
      hydrateTreeFromPayload(payload);
      setInnerTab("permissions");
    } catch (e) {
      setDetail(null);
      setDetailError(e instanceof Error ? e.message : "Falha ao carregar permissões.");
    } finally {
      setDetailLoading(false);
    }
  }, [hydrateTreeFromPayload]);

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

  const closePermissionsEditor = useCallback(() => {
    if (pending) {
      const discard = window.confirm(
        "Há alterações de permissão não salvas. Fechar e descartar?"
      );
      if (!discard) return;
    }
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setConfirmCriticalOpen(false);
    setConfirmBroadOpen(false);
    setSaveSuccess(null);
  }, [pending]);

  const selectUser = useCallback(
    (userId: string) => {
      if (userId === selectedId) return;
      if (pending && selectedId) {
        const discard = window.confirm(
          "Há alterações de permissão não salvas. Descartar e abrir outro usuário?"
        );
        if (!discard) return;
      }
      setSelectedId(userId);
    },
    [pending, selectedId]
  );

  useEffect(() => {
    if (!selectedId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Não fechar se outro overlay (criar/senha/excluir) estiver aberto.
      if (createOpen || resetOpen || deleteOpen || confirmCriticalOpen || confirmBroadOpen) {
        return;
      }
      event.preventDefault();
      closePermissionsEditor();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    selectedId,
    closePermissionsEditor,
    createOpen,
    resetOpen,
    deleteOpen,
    confirmCriticalOpen,
    confirmBroadOpen,
  ]);

  const changeCount = useMemo(
    () => countUserPermissionTreeChanges(treeDecisions, treeBaselineDecisions),
    [treeDecisions, treeBaselineDecisions]
  );

  const exceptionCounts = useMemo(
    () => countUserPermissionExceptions(treeDecisions),
    [treeDecisions]
  );

  /** Mesma disposição do menu lateral (grupos, ordem e rótulos da sidebar). */
  const sidebarTreeNodes = useMemo(
    () => arrangePermissionTreeBySidebar(treeNodes),
    [treeNodes]
  );

  /**
   * Efetivo calculado na árvore do catálogo, não na exibida: o resolvedor de
   * runtime bloqueia por ancestral do catálogo, e o layout da sidebar move
   * telas entre grupos (ex.: Compras sai de Operações).
   */
  const treeEffectives = useMemo(
    () => mapPermissionTreeEffectives(treeNodes, treeDecisions),
    [treeNodes, treeDecisions]
  );

  const profileDrift = useMemo(() => {
    if (!detail) return false;
    return detectAccessProfileSnapshotDrift({
      hasAccessProfile: Boolean(detail.accessProfile),
      hasCustomPermissions: detail.hasCustomPermissions,
      userPermissions: detail.user.permissions,
      profilePermissions: detail.accessProfile?.permissions,
    });
  }, [detail]);

  const matrixModelRows = useMemo(() => {
    if (!detail) return [];
    return buildUserPermissionMatrixModel(detail.tree, {
      profileFlagsByKey: detail.profileFlags,
    }).rows;
  }, [detail]);

  const handleTreeDecisionsChange = useCallback(
    (next: PermissionTreeDecisions) => {
      setTreeDecisions(next);
      setMatrixDraft((prev) =>
        draftFromUserDecisions(treeNodes, next, roleBaseline, prev)
      );
      setSaveSuccess(null);
    },
    [treeNodes, roleBaseline]
  );

  const saveDiff = useMemo(() => {
    if (!detail || matrixModelRows.length === 0) return [];
    return buildMatrixSaveDiff(matrixModelRows, loadedSnapshot, matrixDraft);
  }, [detail, matrixModelRows, loadedSnapshot, matrixDraft]);

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
    hydrateTreeFromPayload(payload);
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
      const payload = await saveUserPermissionOverrides(selectedId, overrides, {
        ifMatchOverrideCount: detail.overrideCount,
        reason: saveReason.trim() || undefined,
      });
      setDetail(payload);
      hydrateMatrixFromPayload(payload);
      setConfirmCriticalOpen(false);
      setConfirmBroadOpen(false);
      setSaveReason("");
      setSaveSuccess(
        `Permissões salvas. permissionsVersion → ${payload.user.permissionsVersion}. Resultado efetivo recarregado.`
      );
      await loadUsers();
      if (selectedId === currentUserId) {
        await loadMe();
      }
    } catch (e) {
      if (e instanceof HttpError && e.code === "CONFLICT") {
        setDetailError(`${e.message} Recarregue os dados do usuário.`);
      } else {
        setDetailError(e instanceof Error ? e.message : "Falha ao salvar.");
      }
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
    if (hasBroadPermissionChanges(impact) && !confirmBroadOpen && !confirmCriticalOpen) {
      setConfirmBroadOpen(true);
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

  const handleApplyRolePreset = async (role: AppUserRole, forceSameRole = false) => {
    if (!detail || !selectedId) return;
    if (!forceSameRole && role === detail.user.role) return;
    if (detail.warnings.isLastSuperAdmin && role !== "SUPER_ADMIN") {
      setDetailError("Não é possível alterar o perfil do único Super Administrador ativo.");
      return;
    }
    if (
      !confirmClearIfNeeded(
        detail.hasCustomPermissions,
        forceSameRole && role === detail.user.role
          ? "Aplicar o preset da role remove as exceções individuais e reaplica o padrão. Continuar?"
          : "Trocar a role aplica o padrão do novo perfil e remove personalizações. Continuar?"
      )
    ) {
      return;
    }
    setSaving(true);
    setSaveSuccess(null);
    try {
      const payload = await applyUserPermissionPreset(selectedId, {
        role,
        confirmClearOverrides: true,
      });
      setDetail(payload);
      hydrateMatrixFromPayload(payload);
      setSaveSuccess(
        `Preset da role aplicado. permissionsVersion → ${payload.user.permissionsVersion}.`
      );
      await loadUsers();
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Falha ao alterar role.");
    } finally {
      setSaving(false);
    }
  };

  const handleAccessProfileChange = async (accessProfileId: string | null) => {
    if (!detail || !selectedId) return;
    const currentId = detail.accessProfile?.id ?? null;
    if (accessProfileId === currentId) return;
    if (detail.warnings.isLastSuperAdmin && accessProfileId) {
      const next = accessProfiles.find((p) => p.id === accessProfileId);
      if (next?.roleBase && next.roleBase !== "SUPER_ADMIN") {
        setDetailError(
          "Não é possível vincular um perfil que rebaixa o único Super Administrador ativo."
        );
        return;
      }
    }
    if (
      !confirmClearIfNeeded(
        detail.hasCustomPermissions || Boolean(currentId),
        accessProfileId
          ? "Vincular o perfil de acesso aplica o snapshot e remove as exceções individuais. Continuar?"
          : "Desvincular o perfil de acesso? As exceções e a role atual serão preservadas."
      )
    ) {
      return;
    }
    setSaving(true);
    setSaveSuccess(null);
    setDetailError(null);
    try {
      await fetchJsonOk(`/api/admin/users/${selectedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessProfileId }),
      });
      await loadDetail(selectedId);
      await loadUsers();
      setSaveSuccess(
        accessProfileId
          ? "Perfil de acesso vinculado e snapshot aplicado."
          : "Perfil de acesso desvinculado."
      );
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : "Falha ao vincular perfil de acesso."
      );
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
    const createPasswordPolicy = validatePasswordPolicy(createForm.password);
    if (!createPasswordPolicy.valid) {
      setCreateError(createPasswordPolicy.reasons[0] ?? "Senha fora da política.");
      return;
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
          isActive: createForm.isActive,
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
    setSaving(true);
    setResetError(null);
    try {
      const result = await requestAdminResetPassword(selectedId);
      // Mantém o modal aberto: é a única exibição da senha temporária.
      setResetTemporaryPassword(result.temporaryPassword);
      setResetCopied(false);
      await loadUsers();
    } catch (err) {
      const code = err instanceof HttpError ? err.code : undefined;
      setResetError(
        describePasswordError(
          code,
          err instanceof Error ? err.message : "Falha ao redefinir senha."
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const closeResetModal = () => {
    setResetOpen(false);
    // A senha temporária some com o modal — não fica em memória nem em storage.
    setResetTemporaryPassword(null);
    setResetCopied(false);
    setResetError(null);
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
        <div className="flex flex-col gap-4 max-w-2xl">
          <div
            className="rounded-xl border border-border bg-card overflow-hidden flex flex-col min-h-[28rem]"
            data-testid="admin-users-list"
          >
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
              <p className="text-[11px] text-muted-foreground">
                Clique em um usuário para abrir a gestão de permissões em tela cheia.
              </p>
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
                          onClick={() => selectUser(user.id)}
                          className={cn(
                            "w-full text-left px-3 py-3 transition-colors hover:bg-accent/40",
                            selected && "bg-primary/5 border-l-2 border-l-primary"
                          )}
                          data-testid={`admin-user-row-${user.id}`}
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
        </div>
      )}

      {workbenchTab === "users" && selectedId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-sm"
          data-testid="user-permission-editor-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-permission-editor-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePermissionsEditor();
            }
          }}
        >
          <div className="bg-card flex h-[94vh] w-full max-w-[min(96vw,1280px)] flex-col overflow-hidden rounded-xl border border-border shadow-xl">
            <div
              className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2"
              data-testid="user-permission-compact-header"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <h4
                      id="user-permission-editor-title"
                      className="truncate text-[15px] font-semibold tracking-tight"
                    >
                      {detail?.user.name ??
                        selectedListUser?.name ??
                        "Gestão de permissões"}
                    </h4>
                    {detail ? (
                      <>
                        <span
                          className={cn(
                            "text-[11px] font-medium",
                            detail.user.isActive
                              ? "text-emerald-700"
                              : "text-muted-foreground"
                          )}
                        >
                          {detail.user.isActive ? "Ativo" : "Inativo"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatRoleLabel(detail.user.role)}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <p className="truncate text-[12px] text-muted-foreground">
                    {detail?.user.email ?? selectedListUser?.email ?? "Carregando…"}
                    {selectedListUser?.employeeName
                      ? ` · ${selectedListUser.employeeName}${
                          selectedListUser.employeeDepartment
                            ? ` / ${selectedListUser.employeeDepartment}`
                            : ""
                        }`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {detail ? (
                  <>
                    {/* Só SUPER_ADMIN vê o botão. Quem decide é o 403 do backend. */}
                    {authUser?.role === "SUPER_ADMIN" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setResetTemporaryPassword(null);
                        setResetCopied(false);
                        setResetError(null);
                        setResetOpen(true);
                      }}
                      className="hidden items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent sm:inline-flex"
                    >
                      <KeyRound className="h-3 w-3" />
                      Redefinir senha
                    </button>
                    ) : null}
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
                      className="hidden items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 sm:inline-flex"
                      data-testid="admin-user-delete-open"
                    >
                      <Trash2 className="h-3 w-3" />
                      Excluir
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={closePermissionsEditor}
                  className="rounded-full p-2 hover:bg-accent"
                  aria-label="Fechar gestão de permissões"
                  data-testid="user-permission-editor-close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 flex flex-col overflow-hidden bg-card">
            {detailLoading && !detail ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground p-8">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando acessos…
              </div>
            ) : detail ? (
              <>
                <div
                  className="shrink-0 border-b border-border px-4 py-3"
                  data-testid="user-permission-profile-bar"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
                      <label className="block min-w-0">
                        <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          Perfil de acesso
                        </span>
                        <select
                          value={detail.accessProfile?.id ?? ""}
                          disabled={saving || detail.warnings.isLastSuperAdmin}
                          title={
                            detail.warnings.isLastSuperAdmin
                              ? "Não é possível alterar o único Super Administrador ativo"
                              : undefined
                          }
                          onChange={(e) => {
                            const next = e.target.value.trim();
                            void handleAccessProfileChange(next ? next : null);
                          }}
                          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
                          data-testid="user-permission-access-profile-select"
                        >
                          <option value="">Sem perfil de acesso</option>
                          {accessProfiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.roleBase ? ` · ${formatRoleLabel(p.roleBase)}` : ""}
                            </option>
                          ))}
                          {detail.accessProfile &&
                          !accessProfiles.some((p) => p.id === detail.accessProfile!.id) ? (
                            <option value={detail.accessProfile.id}>
                              {detail.accessProfile.name} (inativo)
                            </option>
                          ) : null}
                        </select>
                      </label>

                      <div className="min-w-0 self-end pb-0.5 text-[12px] text-muted-foreground">
                        <span className="text-foreground">
                          {formatRoleLabel(detail.user.role)}
                        </span>
                        <span className="mx-1.5 text-border">·</span>
                        <span>
                          {detail.hasCustomPermissions
                            ? `${exceptionCounts.allow + exceptionCounts.deny} exceções`
                            : "Sem exceções"}
                        </span>
                        <span className="mx-1.5 text-border">·</span>
                        <span>
                          Último acesso {formatDateTimePt(detail.user.lastLoginAt)}
                        </span>
                      </div>
                    </div>

                    <div
                      className="flex h-9 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5"
                      role="tablist"
                      aria-label="Seções da gestão de permissões"
                    >
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
                          role="tab"
                          aria-selected={innerTab === id}
                          onClick={() => setInnerTab(id)}
                          className={cn(
                            "h-8 rounded-[5px] px-3 text-[12px] font-medium transition",
                            innerTab === id
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {detail.warnings.editingSuperAdmin ? (
                    <div className="mt-2 flex gap-2 rounded-lg border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        Este usuário é Super Administrador: o acesso é total e a árvore fica somente
                        leitura.
                        {detail.warnings.isLastSuperAdmin
                          ? " Ele é o único Super Administrador ativo — o perfil não pode ser alterado."
                          : null}
                      </span>
                    </div>
                  ) : null}

                </div>

                {detailError ? (
                  <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {detailError}
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
                  {selectedListUser && roleAllowsSellerNomusLink(selectedListUser.role) ? (
                    <details
                      className="group rounded-xl border border-border bg-muted/20 open:bg-muted/30"
                      data-testid="admin-user-seller-nomus-link"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-semibold text-foreground [&::-webkit-details-marker]:hidden">
                        <span className="min-w-0">
                          Identidade comercial e vínculo Nomus
                          <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                            {roleRequiresSellerNomusLink(selectedListUser.role)
                              ? "Obrigatório para Vendedor: responsável da carteira + ID Nomus do vendedor dos pedidos."
                              : selectedListUser.role === "VIEWER"
                                ? "Necessário para acessar dados quando o perfil VIEWER usa escopo próprio."
                                : "Opcional no Gestor comercial; o perfil define o escopo global."}
                            {sellerLinkDraft.externalSellerIds.length > 0
                              ? ` · ${sellerLinkDraft.externalSellerIds.length} ID(s)`
                              : ""}
                            {sellerLinkDirty ? " · alterações não salvas" : ""}
                          </span>
                        </span>
                        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" />
                      </summary>
                      <div className="space-y-3 border-t border-border px-3 py-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                            <strong className="block text-foreground">Carteira CRM</strong>
                            O nome do responsável comercial identifica os clientes da carteira.
                          </div>
                          <div className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] text-muted-foreground">
                            <strong className="block text-foreground">Pedidos e Comissões</strong>
                            Os IDs Nomus identificam o vendedor dos pedidos usados nas comissões próprias.
                          </div>
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
                    </details>
                  ) : null}

                  {innerTab === "permissions" ? (
                    <>
                      <div
                        className="flex flex-wrap items-center justify-between gap-2"
                        data-testid="user-permission-context"
                      >
                        <p className="text-[12px] text-muted-foreground">
                          Exceções individuais sobre o perfil.{" "}
                          <span className="text-foreground">
                            {exceptionCounts.allow + exceptionCounts.deny} ativas
                          </span>
                          {pending ? (
                            <span
                              className="ml-2 text-amber-700"
                              data-testid="user-permission-unsaved"
                            >
                              · {changeCount} não salva(s)
                            </span>
                          ) : null}
                        </p>
                        <p className="sr-only" data-testid="user-permission-version">
                          permissionsVersion: {detail.user.permissionsVersion}
                        </p>
                        <div
                          className="flex flex-wrap items-center gap-1.5"
                          data-testid="user-permission-quick-actions"
                        >
                          <button
                            type="button"
                            disabled={detail.treeReadOnly || detail.warnings.isLastSuperAdmin}
                            className="h-8 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                            title="Aplica o padrão da role técnica (limpa exceções)"
                            onClick={() =>
                              void handleApplyRolePreset(detail.user.role, true)
                            }
                            data-testid="user-permission-apply-profile"
                          >
                            Preset da role
                          </button>
                          <button
                            type="button"
                            disabled={detail.treeReadOnly}
                            className="h-8 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                            onClick={() => void handleRestoreDefault()}
                            data-testid="user-permission-reapply-profile"
                            title="Restaura o snapshot do perfil de acesso vinculado (ou o preset da role)"
                          >
                            Reaplicar perfil
                          </button>
                          <button
                            type="button"
                            disabled={detail.treeReadOnly}
                            className="h-8 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                            onClick={() => void handleClearCustom()}
                            data-testid="user-permission-clear-exceptions"
                          >
                            Limpar exceções
                          </button>
                          <button
                            type="button"
                            disabled={detail.treeReadOnly}
                            title="Concede Ver/Executar/Gerenciar no primeiro menu e filhos"
                            className="h-8 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                            onClick={() => {
                              const next = liberateFirstMenuInMatrixDraft(
                                detail.tree,
                                matrixDraft
                              );
                              setMatrixDraft(next);
                              setTreeDecisions(
                                decisionsFromUserDraft(treeNodes, next, roleBaseline)
                              );
                              setSaveSuccess(null);
                            }}
                          >
                            Liberar 1º menu
                          </button>
                          <button
                            type="button"
                            className="h-8 rounded-md px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => setShowEffectivePreview((v) => !v)}
                          >
                            {showEffectivePreview ? "Ocultar preview" : "Preview efetivo"}
                          </button>
                        </div>
                      </div>

                      {saveSuccess ? (
                        <div
                          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground"
                          data-testid="user-permission-save-success"
                          role="status"
                        >
                          {saveSuccess}
                        </div>
                      ) : null}

                      {profileDrift ? (
                        <div
                          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground"
                          data-testid="user-permission-profile-drift"
                        >
                          O perfil de acesso foi alterado depois do snapshot deste usuário.
                          Use <strong className="text-foreground">Reaplicar perfil</strong>{" "}
                          para sincronizar.
                        </div>
                      ) : null}

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
                              ? ` · ${impact.dirtyResourceCount} recurso(s) alterado(s) · ${impact.parentBlockedCount} bloqueado(s) por pai`
                              : ""}
                          </p>
                          {pending && selectedListUser ? (
                            <p
                              className="mt-1 text-amber-900"
                              data-testid="user-permission-session-warning"
                            >
                              {sessionAffectedMessage({
                                isEditingSelf: selectedId === currentUserId,
                                targetName: selectedListUser.name,
                              })}
                            </p>
                          ) : null}
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
                          {saveDiff.length > 0 ? (
                            <div className="mt-2 border-t border-border/60 pt-2">
                              <p className="font-medium">Diff pendente (amostra)</p>
                              <ul className="mt-1 max-h-24 overflow-y-auto text-muted-foreground">
                                {saveDiff.slice(0, 8).map((d) => (
                                  <li key={`${d.resourceKey}:${d.action}`}>
                                    {d.kind === "grant" ? "+" : "−"} {d.label} ({d.action})
                                  </li>
                                ))}
                                {saveDiff.length > 8 ? (
                                  <li>… +{saveDiff.length - 8} alteração(ões)</li>
                                ) : null}
                              </ul>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {confirmBroadOpen ? (
                        <div
                          className="rounded-xl border border-sky-300 bg-sky-50 px-3 py-3 text-sm text-sky-950 space-y-2"
                          data-testid="user-permission-broad-confirm"
                        >
                          <p className="font-semibold">
                            Confirmar alteração ampla ({impact?.dirtyResourceCount ?? 0}{" "}
                            recursos)?
                          </p>
                          <p className="text-xs">
                            {sessionAffectedMessage({
                              isEditingSelf: selectedId === currentUserId,
                              targetName: selectedListUser?.name ?? "usuário",
                            })}
                          </p>
                          <label className="block text-xs">
                            Motivo (opcional, auditoria)
                            <input
                              type="text"
                              value={saveReason}
                              onChange={(e) => setSaveReason(e.target.value)}
                              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                              maxLength={200}
                            />
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold"
                              onClick={() => setConfirmBroadOpen(false)}
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

                      {confirmCriticalOpen ? (
                        <div
                          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 space-y-2"
                          data-testid="user-permission-critical-confirm"
                        >
                          <p className="font-semibold">
                            Confirmar alteração em permissões administrativas críticas?
                          </p>
                          <p className="text-xs">
                            {sessionAffectedMessage({
                              isEditingSelf: selectedId === currentUserId,
                              targetName: selectedListUser?.name ?? "usuário",
                            })}
                          </p>
                          <label className="block text-xs">
                            Motivo (opcional, auditoria)
                            <input
                              type="text"
                              value={saveReason}
                              onChange={(e) => setSaveReason(e.target.value)}
                              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
                              maxLength={200}
                            />
                          </label>
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

                      <PermissionsTree
                        nodes={sidebarTreeNodes}
                        decisions={treeDecisions}
                        onDecisionsChange={handleTreeDecisionsChange}
                        effectiveByNodeId={treeEffectives}
                        readOnly={detail.treeReadOnly}
                        highlightExceptions
                        enableBranchBatch={!detail.treeReadOnly}
                        initialExpandMode="collapsed"
                        originColumnLabel="Valor do perfil"
                        configuredColumnLabel="Exceção do usuário"
                        resultColumnLabel="Resultado efetivo"
                        emptyMessage="Nenhuma área de acesso disponível."
                        className="h-[min(62vh,720px)] min-h-[420px] max-h-none"
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
                  <div
                    className="shrink-0 border-t border-border p-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between bg-muted/20"
                    data-testid="user-permission-editor-footer"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                      {pending ? (
                        <span
                          className="font-medium text-foreground"
                          data-testid="user-permission-pending-count"
                        >
                          {changeCount} alteração(ões) pendente(s)
                        </span>
                      ) : (
                        <span>Sem alterações pendentes</span>
                      )}
                      <span>· v{detail.user.permissionsVersion}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={!pending || saving}
                        onClick={() => {
                          if (!detail) return;
                          const restored = resetMatrixDraftToBaseline(loadedSnapshot);
                          setMatrixDraft(restored);
                          setTreeDecisions(
                            decisionsFromUserDraft(
                              treeNodes,
                              restored,
                              roleBaseline
                            )
                          );
                          setConfirmCriticalOpen(false);
                          setConfirmBroadOpen(false);
                          setSaveSuccess(null);
                        }}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={!pending || saving}
                        onClick={() => void handleSaveOverrides()}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                        data-testid="user-permission-save"
                      >
                        {saving ? "Salvando…" : "Salvar permissões"}
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
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
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
                autoComplete="new-password"
                placeholder="Senha provisória"
                value={createForm.password}
                onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm"
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {describePasswordPolicy()} Como quem digita é você, ela vale como senha
                temporária: o usuário terá de definir a própria senha no primeiro acesso.
              </p>
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                O usuário será criado sem perfil e sem acesso. Depois da criação, abra o usuário
                para atribuir um perfil pronto ou configurar as permissões manualmente.
              </p>
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div
            className="bg-card w-full max-w-md rounded-2xl border border-border shadow-xl p-4 space-y-3"
            data-testid="admin-user-reset-modal"
          >
            {resetTemporaryPassword ? (
              <>
                <h4 className="font-bold">Senha temporária criada</h4>
                <p className="text-xs text-muted-foreground">
                  Entregue esta senha a {selectedListUser?.name ?? "o usuário"}. No próximo
                  acesso o sistema vai exigir que ele defina uma senha definitiva.
                </p>
                <div
                  data-testid="admin-user-temporary-password"
                  className="rounded-lg border border-border bg-muted/60 px-3 py-2 font-mono text-sm break-all select-all"
                >
                  {resetTemporaryPassword}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard
                        ?.writeText(resetTemporaryPassword)
                        .then(() => setResetCopied(true))
                        .catch(() => setResetCopied(false));
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-accent"
                  >
                    <Copy className="h-3 w-3" />
                    {resetCopied ? "Copiada" : "Copiar senha"}
                  </button>
                  <button
                    type="button"
                    onClick={closeResetModal}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    Fechar
                  </button>
                </div>
                <p className="text-[11px] font-medium text-amber-700">
                  Esta senha será exibida somente agora. Se ela se perder, gere um novo reset.
                </p>
              </>
            ) : (
              <>
                <h4 className="font-bold">
                  Redefinir senha de {selectedListUser?.name ?? "usuário"}?
                </h4>
                {resetError ? (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                    {resetError}
                  </div>
                ) : null}
                <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                  <li>encerrará todas as sessões deste usuário;</li>
                  <li>criará uma senha temporária gerada pelo sistema;</li>
                  <li>exigirá uma nova senha no próximo acesso.</li>
                </ul>
                <form onSubmit={handleResetPassword} className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeResetModal}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-semibold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Redefinir senha
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      ) : null}

      {deleteOpen && selectedListUser ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
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
