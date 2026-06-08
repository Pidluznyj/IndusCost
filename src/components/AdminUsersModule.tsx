import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  UserCheck,
  UserX,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  APP_PASSWORD_MIN_LENGTH,
  APP_USER_ROLE_OPTIONS,
  type AppUserRole,
  type AuthUser,
  type PermissionCatalogEntry,
  formatRoleLabel,
  summarizePermissions,
} from "@/src/lib/appAuthClient";
import { PermissionEditor } from "@/src/components/admin/PermissionEditor";
import { SellerNomusPicker } from "@/src/components/admin/SellerNomusPicker";
import type { AdminSellerOption } from "@/src/lib/adminSellerOptionsTypes";
import type { AccessProfileRecord } from "@/src/lib/accessProfilesClient";
import {
  applyProfilePermissionsRaw,
  permissionsMatchProfile,
} from "@/src/lib/accessProfilesUtils";

type UserFormState = {
  name: string;
  email: string;
  role: AppUserRole;
  accessProfileId: string;
  isActive: boolean;
  externalSellerId: string;
  sellerResponsibleName: string;
  permissions: string[];
  password: string;
};

const EMPTY_FORM: UserFormState = {
  name: "",
  email: "",
  role: "VIEWER",
  accessProfileId: "",
  isActive: true,
  externalSellerId: "",
  sellerResponsibleName: "",
  permissions: [],
  password: "",
};

function formatDateTimePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function formatLinkedSeller(user: AuthUser): string {
  if (user.externalSellerId != null) {
    const name = user.sellerResponsibleName?.trim();
    return name ? `${name} · ID ${user.externalSellerId}` : `ID ${user.externalSellerId}`;
  }
  if (user.sellerResponsibleName?.trim()) {
    return `${user.sellerResponsibleName.trim()} · sem ID`;
  }
  return "—";
}

function hasSellerLink(form: UserFormState): boolean {
  return Boolean(form.externalSellerId.trim() || form.sellerResponsibleName.trim());
}

function formHasCrmSellerOwn(form: UserFormState): boolean {
  return form.permissions.includes("crm.seller.own");
}

export const AdminUsersModule: React.FC = () => {
  const { hasPermission, authUser } = useAuth();
  const canManage = hasPermission("users.manage");
  const currentUserId = authUser?.id ?? null;

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [accessProfiles, setAccessProfiles] = useState<AccessProfileRecord[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [sellerOptions, setSellerOptions] = useState<AdminSellerOption[]>([]);
  const [sellerOptionsLoading, setSellerOptionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSellerOptionsLoading(true);
      const [usersRes, catalogRes, sellersRes, profilesRes] = await Promise.all([
        fetchJsonOk<{ users: AuthUser[] }>("/api/admin/users"),
        fetchJsonOk<{ permissions: PermissionCatalogEntry[] }>("/api/admin/permissions/catalog"),
        fetchJsonOk<{ sellers: AdminSellerOption[] }>("/api/admin/seller-options"),
        fetchJsonOk<{ profiles: AccessProfileRecord[] }>("/api/access-profiles?activeOnly=1"),
      ]);
      setUsers(Array.isArray(usersRes.users) ? usersRes.users : []);
      setCatalog(Array.isArray(catalogRes.permissions) ? catalogRes.permissions : []);
      setAccessProfiles(Array.isArray(profilesRes.profiles) ? profilesRes.profiles : []);
      setSellerOptions(Array.isArray(sellersRes.sellers) ? sellersRes.sellers : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar usuários.");
    } finally {
      setLoading(false);
      setSellerOptionsLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setEditorOpen(true);
  };

  const openEdit = (user: AuthUser) => {
    setEditingId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      accessProfileId: user.accessProfileId ?? "",
      isActive: user.isActive,
      externalSellerId: user.externalSellerId != null ? String(user.externalSellerId) : "",
      sellerResponsibleName: user.sellerResponsibleName ?? "",
      permissions: [...user.permissions],
      password: "",
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const selectedAccessProfile = useMemo(
    () => accessProfiles.find((p) => p.id === form.accessProfileId) ?? null,
    [accessProfiles, form.accessProfileId]
  );

  const permissionsCustomized = useMemo(() => {
    if (!selectedAccessProfile || selectedAccessProfile.roleBase === "SUPER_ADMIN") return false;
    return !permissionsMatchProfile(form.permissions, selectedAccessProfile.permissions);
  }, [form.permissions, selectedAccessProfile]);

  const applyAccessProfileSelection = (profileId: string) => {
    const profile = accessProfiles.find((p) => p.id === profileId);
    if (!profile) {
      setForm((f) => ({ ...f, accessProfileId: profileId }));
      return;
    }
    const permissions =
      profile.roleBase === "SUPER_ADMIN"
        ? []
        : applyProfilePermissionsRaw(profile.permissions);
    setForm((f) => ({
      ...f,
      accessProfileId: profileId,
      role: profile.roleBase ?? f.role,
      permissions,
    }));
  };

  const validateForm = (isCreate: boolean): string | null => {
    if (!form.name.trim()) return "Informe o nome.";
    if (!form.email.trim() || !form.email.includes("@")) return "Informe um e-mail válido.";
    if (isCreate) {
      if (form.password.length < APP_PASSWORD_MIN_LENGTH) {
        return `A senha provisória deve ter no mínimo ${APP_PASSWORD_MIN_LENGTH} caracteres.`;
      }
    }
    if (form.externalSellerId.trim()) {
      const n = Number.parseInt(form.externalSellerId.trim(), 10);
      if (!Number.isFinite(n) || n < 0) return "ID do vendedor Nomus inválido.";
    }
    if (formHasCrmSellerOwn(form) && !hasSellerLink(form)) {
      return "Usuário com Minha Gestão (crm.seller.own) precisa estar vinculado a um vendedor.";
    }
    return null;
  };

  const sellerLinkWarning = useMemo(() => {
    if (hasSellerLink(form)) return null;
    if (formHasCrmSellerOwn(form)) {
      return "Usuário com Minha Gestão precisa estar vinculado a um vendedor.";
    }
    if (form.role === "SELLER") {
      return "Perfil vendedor sem vínculo: Minha Gestão Comercial ficará vazia até vincular um vendedor real.";
    }
    return null;
  }, [form]);

  // Quantos Super Administradores ativos existem na lista carregada — usado para
  // alertar antes que o admin tente inativar/rebaixar o único Super Admin.
  const activeSuperAdminCount = useMemo(
    () => users.filter((u) => u.isActive && u.role === "SUPER_ADMIN").length,
    [users]
  );

  const isEditingSelf = editingId !== null && editingId === currentUserId;
  const editingExistingUser = users.find((u) => u.id === editingId) ?? null;
  const isEditingTheLastSuperAdmin =
    editingExistingUser?.role === "SUPER_ADMIN" &&
    editingExistingUser.isActive &&
    activeSuperAdminCount === 1;

  /**
   * Avisos de auto-bloqueio exibidos no editor:
   * - O backend já bloqueia (409). Aqui antecipamos o feedback para o
   *   admin não chegar a clicar "Salvar".
   */
  const selfBlockWarnings = useMemo<string[]>(() => {
    if (!isEditingSelf || !editingExistingUser) return [];
    const out: string[] = [];
    if (!form.isActive) {
      out.push("Você está prestes a inativar a si mesmo. O backend bloqueia essa operação.");
    }
    if (
      editingExistingUser.role === "SUPER_ADMIN" &&
      form.role !== "SUPER_ADMIN"
    ) {
      out.push(
        "Você está prestes a rebaixar o próprio perfil de Super Administrador. O backend bloqueia essa operação."
      );
    }
    const willKeepUsersManage =
      form.role === "SUPER_ADMIN" || form.permissions.includes("users.manage");
    const currentlyHasUsersManage =
      editingExistingUser.role === "SUPER_ADMIN" ||
      editingExistingUser.permissions.includes("users.manage");
    if (currentlyHasUsersManage && !willKeepUsersManage) {
      out.push(
        "Você está prestes a remover a própria permissão Usuários e Permissões. O backend bloqueia essa operação para não te deixar sem acesso."
      );
    }
    return out;
  }, [isEditingSelf, editingExistingUser, form]);

  const lastSuperAdminWarning = useMemo<string | null>(() => {
    if (!isEditingTheLastSuperAdmin) return null;
    if (!form.isActive)
      return "Este é o único Super Administrador ativo. Cadastre outro Super Admin antes de inativar.";
    if (form.role !== "SUPER_ADMIN")
      return "Este é o único Super Administrador ativo. Cadastre outro Super Admin antes de mudar o perfil.";
    return null;
  }, [isEditingTheLastSuperAdmin, form.isActive, form.role]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCreate = !editingId;
    const validation = validateForm(isCreate);
    if (validation) {
      setFormError(validation);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const externalSellerId = form.externalSellerId.trim()
        ? Number.parseInt(form.externalSellerId.trim(), 10)
        : null;

      if (isCreate) {
        await fetchJsonOk("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
            role: form.role,
            permissions: form.permissions,
            accessProfileId: form.accessProfileId || null,
            isActive: form.isActive,
            externalSellerId,
            sellerResponsibleName: form.sellerResponsibleName.trim() || null,
          }),
        });
      } else {
        await fetchJsonOk(`/api/admin/users/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            role: form.role,
            permissions: form.permissions,
            accessProfileId: form.accessProfileId || null,
            isActive: form.isActive,
            externalSellerId,
            sellerResponsibleName: form.sellerResponsibleName.trim() || null,
          }),
        });
      }
      setEditorOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao salvar usuário.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (user: AuthUser) => {
    setSaving(true);
    try {
      await fetchJsonOk(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar status.");
    } finally {
      setSaving(false);
    }
  };

  const openResetPassword = (userId: string) => {
    setResetUserId(userId);
    setResetPassword("");
    setResetConfirm("");
    setResetError(null);
    setResetOpen(true);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetUserId) return;
    if (resetPassword.length < APP_PASSWORD_MIN_LENGTH) {
      setResetError(`A senha deve ter no mínimo ${APP_PASSWORD_MIN_LENGTH} caracteres.`);
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError("As senhas não coincidem.");
      return;
    }
    setSaving(true);
    setResetError(null);
    try {
      await fetchJsonOk(`/api/admin/users/${resetUserId}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetOpen(false);
      await loadData();
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Usuários e Permissões
          </h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Cadastre usuários, defina perfis e libere telas por permissão. Permissões efetivas = permissões
            marcadas manualmente. SUPER_ADMIN sempre possui acesso total.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            Novo usuário
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando usuários…
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto max-h-[min(520px,60vh)] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm border-b border-border">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Nome</th>
                  <th className="px-4 py-3 font-semibold">E-mail</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Perfil de acesso</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Vendedor</th>
                  <th className="px-4 py-3 font-semibold">Último login</th>
                  <th className="px-4 py-3 font-semibold">Permissões efetivas</th>
                  <th className="px-4 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-border/60 hover:bg-accent/20">
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {user.name}
                        {user.id === currentUserId ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide text-blue-900"
                            title="Este é o usuário com o qual você está logado."
                          >
                            Você
                          </span>
                        ) : null}
                        {user.role === "SUPER_ADMIN" &&
                        user.isActive &&
                        activeSuperAdminCount === 1 ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide text-amber-900"
                            title="Este é o único Super Administrador ativo do sistema. Não pode ser inativado ou rebaixado."
                          >
                            Único Super
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">{formatRoleLabel(user.role)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {user.accessProfileName ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                          user.isActive
                            ? "bg-green-100 text-green-800"
                            : "bg-slate-100 text-slate-600"
                        )}
                      >
                        {user.isActive ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px]">
                      {formatLinkedSeller(user)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTimePt(user.lastLoginAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px]">
                      {summarizePermissions(user.effectivePermissions)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(user)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
                        >
                          <Pencil className="h-3 w-3" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => openResetPassword(user.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
                        >
                          <KeyRound className="h-3 w-3" />
                          Senha
                        </button>
                        {(() => {
                          const isSelf = user.id === currentUserId;
                          const isLastSuper =
                            user.role === "SUPER_ADMIN" &&
                            user.isActive &&
                            activeSuperAdminCount === 1;
                          const blockedReason = isSelf
                            ? "Você não pode inativar a si mesmo. Peça a outro administrador."
                            : isLastSuper && user.isActive
                              ? "Único Super Administrador ativo — cadastre outro antes de inativar."
                              : null;
                          const isBlocked = Boolean(blockedReason);
                          return (
                            <button
                              type="button"
                              disabled={saving || isBlocked}
                              onClick={() => void toggleActive(user)}
                              title={blockedReason ?? undefined}
                              className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {user.isActive ? (
                                <UserX className="h-3 w-3" />
                              ) : (
                                <UserCheck className="h-3 w-3" />
                              )}
                              {user.isActive ? "Inativar" : "Ativar"}
                            </button>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum usuário cadastrado.</p>
            ) : null}
          </div>
        </div>
      )}

      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 backdrop-blur px-5 py-4">
              <div>
                <h4 className="text-lg font-bold">{editingId ? "Editar usuário" : "Novo usuário"}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {form.role === "SELLER"
                    ? "Vincule o vendedor real observado em pedidos e propostas para Minha Gestão Comercial."
                    : form.role === "COMMERCIAL_MANAGER"
                      ? "Gestores comerciais podem ver todos os vendedores no CRM (crm.seller.all)."
                      : form.role === "SUPER_ADMIN"
                        ? "Super administrador possui todas as permissões automaticamente."
                        : "Selecione o vendedor comercial quando o usuário tiver Minha Gestão (crm.seller.own)."}
                </p>
              </div>
              <button type="button" onClick={() => setEditorOpen(false)} className="p-2 rounded-full hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              {formError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {formError}
                </div>
              ) : null}
              {isEditingSelf ? (
                <div
                  className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900"
                  role="status"
                >
                  <strong className="font-bold">Você está editando seu próprio usuário.</strong>{" "}
                  Mudanças de perfil, status ativo ou a permissão "Usuários e Permissões" podem
                  bloquear seu próprio acesso — o sistema bloqueia essas operações por segurança.
                </div>
              ) : null}
              {lastSuperAdminWarning ? (
                <div
                  className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-start gap-1.5"
                  role="alert"
                >
                  <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{lastSuperAdminWarning}</span>
                </div>
              ) : null}
              {selfBlockWarnings.length > 0 ? (
                <ul
                  className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900 space-y-1"
                  role="alert"
                >
                  {selfBlockWarnings.map((w, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground">Nome</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground">E-mail</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                {!editingId ? (
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-xs font-semibold text-muted-foreground">Senha provisória</label>
                    <input
                      required
                      type="password"
                      minLength={APP_PASSWORD_MIN_LENGTH}
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                    />
                  </div>
                ) : null}
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground">Perfil de acesso</label>
                  <select
                    value={form.accessProfileId}
                    onChange={(e) => applyAccessProfileSelection(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">Selecione um perfil (opcional)</option>
                    {accessProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                        {profile.isSystem ? " · sistema" : ""}
                      </option>
                    ))}
                  </select>
                  {selectedAccessProfile?.description ? (
                    <p className="text-[10px] text-muted-foreground">{selectedAccessProfile.description}</p>
                  ) : null}
                  {permissionsCustomized ? (
                    <p className="text-[10px] text-amber-800 font-semibold">
                      Permissões personalizadas (diferentes do perfil selecionado).
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">Perfil (role)</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AppUserRole }))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    {APP_USER_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-muted-foreground">
                    {APP_USER_ROLE_OPTIONS.find((o) => o.value === form.role)?.hint}
                  </p>
                </div>
                <div className="space-y-1 flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    />
                    Usuário ativo
                  </label>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <SellerNomusPicker
                    sellers={sellerOptions}
                    loading={sellerOptionsLoading}
                    value={{
                      externalSellerId: form.externalSellerId,
                      sellerResponsibleName: form.sellerResponsibleName,
                    }}
                    onChange={({ externalSellerId, sellerResponsibleName }) =>
                      setForm((f) => ({ ...f, externalSellerId, sellerResponsibleName }))
                    }
                  />
                  {sellerLinkWarning ? (
                    <div
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs mt-2",
                        formHasCrmSellerOwn(form)
                          ? "border-red-200 bg-red-50 text-red-900"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      )}
                    >
                      {sellerLinkWarning}
                    </div>
                  ) : null}
                </div>
              </div>

              {form.role !== "SUPER_ADMIN" ? (
                <PermissionEditor
                  selected={form.permissions}
                  onChange={(permissions) => setForm((f) => ({ ...f, permissions }))}
                  quickProfiles={accessProfiles.map((p) => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    permissions: p.permissions,
                  }))}
                />
              ) : (
                <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
                  SUPER_ADMIN possui acesso total automático. Não é necessário marcar permissões manualmente.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditorOpen(false)}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {resetOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-md rounded-2xl border border-border shadow-2xl p-5 space-y-4">
            <div className="flex items-start justify-between">
              <h4 className="text-lg font-bold">Redefinir senha</h4>
              <button type="button" onClick={() => setResetOpen(false)} className="p-2 rounded-full hover:bg-accent">
                <X className="h-4 w-4" />
              </button>
            </div>
            {resetError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {resetError}
              </div>
            ) : null}
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Nova senha</label>
                <input
                  required
                  type="password"
                  minLength={APP_PASSWORD_MIN_LENGTH}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground">Confirmar senha</label>
                <input
                  required
                  type="password"
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Confirmar
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
