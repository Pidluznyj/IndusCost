import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Users,
  UserX,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fetchJsonOk } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { APP_USER_ROLE_OPTIONS, type AppUserRole } from "@/src/lib/appAuthClient";
import { PermissionMatrix } from "@/src/components/admin/PermissionMatrix";
import {
  canManageAccessProfiles,
  canViewAccessProfiles,
} from "@/src/lib/modulePermissions";
import {
  applyAccessProfileToUsersClient,
  EMPTY_ACCESS_PROFILE_FORM,
  fetchAccessProfileApplyPreview,
  type AccessProfileApplyPreview,
  type AccessProfileFormState,
  type AccessProfileRecord,
} from "@/src/lib/accessProfilesClient";
import { summarizePermissionSelection } from "@/src/lib/permissionCatalogUtils";
import {
  ACCESS_PROFILE_SNAPSHOT_NOTICE,
  accessProfileMatrixDirty,
  accessProfileMatrixImpact,
  buildAccessProfileMatrixModel,
  diffLegacyPermissionBags,
  formatAccessProfileImpact,
  materializeAccessProfilePermissionsFromDraft,
  needsBroadChangeConfirmation,
} from "@/src/lib/accessProfilesMatrix";
import type { PermissionMatrixDraft } from "@/src/lib/security/permissionMatrixUi/index.ts";

export const AccessProfilesModule: React.FC = () => {
  const auth = useAuth();
  const canView = canViewAccessProfiles(auth);
  const canManage = canManageAccessProfiles(auth);

  const [profiles, setProfiles] = useState<AccessProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingUserCount, setEditingUserCount] = useState(0);
  const [form, setForm] = useState<AccessProfileFormState>(EMPTY_ACCESS_PROFILE_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [matrixDraft, setMatrixDraft] = useState<PermissionMatrixDraft>({});
  const [matrixBaseline, setMatrixBaseline] = useState<PermissionMatrixDraft>({});
  const [showAliases, setShowAliases] = useState(false);
  const [confirmBroadOpen, setConfirmBroadOpen] = useState(false);

  const [applyProfile, setApplyProfile] = useState<AccessProfileRecord | null>(null);
  const [applyPreview, setApplyPreview] = useState<AccessProfileApplyPreview | null>(null);
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const includeInactive = statusFilter !== "active" ? "1" : "0";
      const profilesRes = await fetchJsonOk<{ profiles: AccessProfileRecord[] }>(
        `/api/access-profiles?includeInactive=${includeInactive}&search=${encodeURIComponent(search.trim())}`
      );
      setProfiles(Array.isArray(profilesRes.profiles) ? profilesRes.profiles : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar perfis de acesso.");
    } finally {
      setLoading(false);
    }
  }, [canView, search, statusFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredProfiles = useMemo(() => {
    return profiles.filter((p) => {
      if (statusFilter === "active" && !p.isActive) return false;
      if (statusFilter === "inactive" && p.isActive) return false;
      return true;
    });
  }, [profiles, statusFilter]);

  const matrixModel = useMemo(() => {
    if (form.roleBase === "SUPER_ADMIN") return null;
    return buildAccessProfileMatrixModel(form.permissions, form.roleBase);
  }, [form.permissions, form.roleBase]);

  // Sync draft when opening editor / changing roleBase baseline permissions bag
  const hydrateMatrix = useCallback(
    (permissions: string[], roleBase: AppUserRole | "") => {
      if (roleBase === "SUPER_ADMIN") {
        setMatrixDraft({});
        setMatrixBaseline({});
        return;
      }
      const model = buildAccessProfileMatrixModel(permissions, roleBase);
      setMatrixBaseline(model.baseline);
      setMatrixDraft(model.draft);
    },
    []
  );

  const dirty = useMemo(
    () => accessProfileMatrixDirty(matrixDraft, matrixBaseline),
    [matrixDraft, matrixBaseline]
  );

  const previewPermissions = useMemo(() => {
    if (form.roleBase === "SUPER_ADMIN") return [] as string[];
    return materializeAccessProfilePermissionsFromDraft(
      matrixDraft,
      form.permissions,
      { compatibleClamp: !dirty }
    );
  }, [form.roleBase, form.permissions, matrixDraft, dirty]);

  const legacyDiff = useMemo(
    () => diffLegacyPermissionBags(form.permissions, previewPermissions),
    [form.permissions, previewPermissions]
  );

  const impact = useMemo(() => {
    if (!matrixModel) {
      return null;
    }
    return accessProfileMatrixImpact(matrixModel.rows, matrixDraft, matrixBaseline);
  }, [matrixModel, matrixDraft, matrixBaseline]);

  const permissionSummary = useMemo(
    () =>
      summarizePermissionSelection(previewPermissions, {
        hasPermission: (p) => previewPermissions.includes(p),
        hasAnyPermission: (ps) => ps.some((p) => previewPermissions.includes(p)),
      }),
    [previewPermissions]
  );

  const openCreate = () => {
    setEditingId(null);
    setEditingUserCount(0);
    setForm(EMPTY_ACCESS_PROFILE_FORM);
    hydrateMatrix([], "");
    setFormError(null);
    setConfirmBroadOpen(false);
    setEditorOpen(true);
  };

  const openEdit = (profile: AccessProfileRecord) => {
    setEditingId(profile.id);
    setEditingUserCount(profile.userCount);
    const nextForm: AccessProfileFormState = {
      name: profile.name,
      description: profile.description ?? "",
      roleBase: profile.roleBase ?? "",
      permissions: [...profile.permissions],
      isActive: profile.isActive,
    };
    setForm(nextForm);
    hydrateMatrix(nextForm.permissions, nextForm.roleBase);
    setFormError(null);
    setConfirmBroadOpen(false);
    setEditorOpen(true);
  };

  const handleDuplicate = async (profile: AccessProfileRecord) => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/access-profiles/${profile.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível duplicar o perfil.");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (profile: AccessProfileRecord) => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      await fetchJsonOk(`/api/access-profiles/${profile.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !profile.isActive }),
      });
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível alterar o status do perfil.");
    } finally {
      setSaving(false);
    }
  };

  const openApply = async (profile: AccessProfileRecord) => {
    if (!canManage) return;
    setApplyProfile(profile);
    setApplyPreview(null);
    setApplyError(null);
    setApplyLoading(true);
    try {
      const res = await fetchAccessProfileApplyPreview(profile.id);
      setApplyPreview(res.preview);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Falha ao pré-visualizar aplicação.");
    } finally {
      setApplyLoading(false);
    }
  };

  const confirmApply = async () => {
    if (!applyProfile || !canManage) return;
    setApplyLoading(true);
    setApplyError(null);
    try {
      const res = await applyAccessProfileToUsersClient(applyProfile.id, {
        confirm: true,
        overwriteCustomized,
      });
      setApplyProfile(null);
      setApplyPreview(null);
      await loadData();
      setApplyNotice(
        `Aplicação concluída: ${res.result.applied} atualizado(s), ${res.result.skipped} ignorado(s).`
      );
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Falha ao aplicar perfil.");
    } finally {
      setApplyLoading(false);
    }
  };

  const validateForm = (): string | null => {
    if (!form.name.trim()) return "Informe o nome do perfil.";
    if (form.roleBase !== "SUPER_ADMIN" && previewPermissions.length === 0) {
      return "Selecione ao menos uma permissão ou defina role Super administrador.";
    }
    return null;
  };

  const persistProfile = async () => {
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        roleBase: form.roleBase || null,
        permissions: form.roleBase === "SUPER_ADMIN" ? [] : previewPermissions,
        isActive: form.isActive,
      };
      if (editingId) {
        await fetchJsonOk(`/api/access-profiles/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchJsonOk("/api/access-profiles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }
      setEditorOpen(false);
      setConfirmBroadOpen(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Não foi possível salvar o perfil.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    const validation = validateForm();
    if (validation) {
      setFormError(validation);
      return;
    }

    // Edição sem alteração de permissões/nome: ainda permite salvar metadados; se nada mudou na matriz, ok.
    const needsConfirm =
      form.roleBase !== "SUPER_ADMIN" &&
      dirty &&
      needsBroadChangeConfirmation({
        dirtyResourceCount: impact?.dirtyResourceCount ?? 0,
        linkedUserCount: editingUserCount,
        gainedCount: legacyDiff.gained.length,
        lostCount: legacyDiff.lost.length,
      });

    if (needsConfirm && !confirmBroadOpen) {
      setConfirmBroadOpen(true);
      return;
    }

    await persistProfile();
  };

  if (!canView) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Sem permissão para visualizar perfis de acesso.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="access-profiles-module">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Perfis de Acesso
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Templates reutilizáveis (snapshot). Editar o perfil não altera usuários já vinculados.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Novo perfil
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          {error}
        </div>
      ) : null}

      {applyNotice ? (
        <div
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
          data-testid="access-profile-apply-notice"
        >
          {applyNotice}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-border text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        >
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando perfis…
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 border-b border-border">
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-semibold">Nome</th>
                <th className="px-4 py-3 font-semibold">Role base</th>
                <th className="px-4 py-3 font-semibold">Permissões</th>
                <th className="px-4 py-3 font-semibold">Usuários</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredProfiles.map((profile) => (
                <tr key={profile.id} className="border-b border-border/60 hover:bg-accent/20">
                  <td className="px-4 py-3">
                    <div className="font-medium">{profile.name}</div>
                    {profile.description ? (
                      <div className="text-xs text-muted-foreground mt-0.5">{profile.description}</div>
                    ) : null}
                    {profile.isSystem ? (
                      <span className="inline-flex mt-1 rounded-full bg-slate-100 px-2 py-0 text-[9px] font-bold uppercase text-slate-700">
                        Sistema
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {profile.roleBase
                      ? APP_USER_ROLE_OPTIONS.find((o) => o.value === profile.roleBase)?.label ??
                        profile.roleBase
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {profile.roleBase === "SUPER_ADMIN"
                      ? "Todas (automático)"
                      : `${profile.permissions.length} permissão(ões)`}
                  </td>
                  <td className="px-4 py-3 text-xs">{profile.userCount}</td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                        profile.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-slate-100 text-slate-600"
                      )}
                    >
                      {profile.isActive ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end flex-wrap gap-1">
                      {canManage ? (
                        <>
                          <button
                            type="button"
                            onClick={() => openEdit(profile)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
                          >
                            <Pencil className="h-3 w-3" />
                            Editar
                          </button>
                          <button
                            type="button"
                            disabled={saving || profile.userCount === 0}
                            onClick={() => void openApply(profile)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent disabled:opacity-50"
                            title={
                              profile.userCount === 0
                                ? "Nenhum usuário vinculado"
                                : "Aplicar snapshot aos usuários vinculados"
                            }
                          >
                            <Users className="h-3 w-3" />
                            Aplicar
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleDuplicate(profile)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
                          >
                            <Copy className="h-3 w-3" />
                            Duplicar
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void toggleActive(profile)}
                            className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-accent"
                          >
                            <UserX className="h-3 w-3" />
                            {profile.isActive ? "Inativar" : "Ativar"}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredProfiles.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nenhum perfil encontrado.
            </p>
          ) : null}
        </div>
      )}

      {editorOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div className="bg-card w-full max-w-6xl max-h-[92vh] overflow-y-auto rounded-2xl border border-border shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-border bg-card/95 backdrop-blur px-5 py-4">
              <div>
                <h4 className="text-lg font-bold">
                  {editingId ? "Editar perfil de acesso" : "Novo perfil de acesso"}
                </h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Matriz única de permissões. Snapshot: usuários vinculados não mudam ao salvar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-2 rounded-full hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSave(e)} className="p-5 space-y-4">
              {formError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {formError}
                </div>
              ) : null}

              <div
                className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950"
                data-testid="access-profile-snapshot-notice"
              >
                <strong>Snapshot:</strong> {ACCESS_PROFILE_SNAPSHOT_NOTICE}
                {editingUserCount > 0 ? (
                  <span className="block mt-1 font-semibold">
                    {editingUserCount} usuário(s) vinculado(s) a este perfil — não serão
                    atualizados ao salvar.
                  </span>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Nome do perfil
                  </label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-semibold text-muted-foreground">Descrição</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={2}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-muted-foreground">
                    Role base (opcional)
                  </label>
                  <select
                    value={form.roleBase}
                    onChange={(e) => {
                      const roleBase = e.target.value as AppUserRole | "";
                      setForm((f) => ({ ...f, roleBase }));
                      if (roleBase === "SUPER_ADMIN") {
                        hydrateMatrix([], roleBase);
                      } else {
                        hydrateMatrix(form.permissions, roleBase);
                      }
                    }}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <option value="">Nenhum (somente permissões)</option>
                    {APP_USER_ROLE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 flex items-end">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive}
                      onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                    />
                    Perfil ativo
                  </label>
                </div>
              </div>

              {permissionSummary.critical.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <strong>Atenção:</strong> este perfil inclui permissões críticas/sensíveis:{" "}
                  {permissionSummary.critical.map((c) => c.label).join(", ")}
                </div>
              ) : null}

              {form.roleBase !== "SUPER_ADMIN" && matrixModel ? (
                <div className="space-y-3">
                  {dirty ? (
                    <div
                      className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-950"
                      data-testid="access-profile-dirty"
                    >
                      Alterações não salvas.{" "}
                      {impact ? formatAccessProfileImpact(impact) : null}
                    </div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground">
                      Sem alterações na matriz em relação ao snapshot carregado.
                    </div>
                  )}

                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>Preview legado</strong>
                      <button
                        type="button"
                        className="rounded-md border border-border bg-background px-2 py-1 font-medium hover:bg-accent"
                        onClick={() => setShowAliases((v) => !v)}
                      >
                        {showAliases ? "Ocultar aliases" : "Ver aliases"}
                      </button>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      Antes: {form.permissions.length} · Depois: {previewPermissions.length}
                      {!legacyDiff.unchanged
                        ? ` · +${legacyDiff.gained.length} / −${legacyDiff.lost.length}`
                        : " · sem mudança de chaves"}
                    </p>
                    {showAliases ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2" data-testid="access-profile-aliases">
                        <div>
                          <p className="font-semibold">Ganhas</p>
                          <ul className="mt-1 max-h-28 overflow-auto text-muted-foreground">
                            {legacyDiff.gained.length === 0 ? (
                              <li>—</li>
                            ) : (
                              legacyDiff.gained.map((k) => <li key={k}>{k}</li>)
                            )}
                          </ul>
                        </div>
                        <div>
                          <p className="font-semibold">Removidas</p>
                          <ul className="mt-1 max-h-28 overflow-auto text-muted-foreground">
                            {legacyDiff.lost.length === 0 ? (
                              <li>—</li>
                            ) : (
                              legacyDiff.lost.map((k) => <li key={k}>{k}</li>)
                            )}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <PermissionMatrix
                    rows={matrixModel.rows}
                    draft={matrixDraft}
                    baseline={matrixBaseline}
                    onDraftChange={setMatrixDraft}
                    readOnly={!canManage}
                  />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground rounded-lg border border-dashed border-border px-3 py-2">
                  Role Super administrador concede todas as permissões automaticamente.
                </p>
              )}

              {confirmBroadOpen ? (
                <div
                  className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 space-y-2"
                  data-testid="access-profile-broad-confirm"
                >
                  <p className="font-semibold">Confirmar alterações amplas no snapshot?</p>
                  <p className="text-xs">
                    {legacyDiff.gained.length + legacyDiff.lost.length} chave(s) legada(s)
                    alterada(s)
                    {editingUserCount > 0
                      ? ` · ${editingUserCount} usuário(s) vinculado(s) NÃO serão atualizados automaticamente`
                      : ""}
                    .
                  </p>
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
                      onClick={() => void persistProfile()}
                    >
                      Confirmar e salvar snapshot
                    </button>
                  </div>
                </div>
              ) : null}

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

      {applyProfile ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <div
            className="bg-card w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border shadow-2xl p-5 space-y-3"
            data-testid="access-profile-apply-modal"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="text-lg font-bold">Aplicar perfil aos usuários</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Comparação antes/depois do snapshot “{applyProfile.name}”. Aplicação manual
                  com confirmação.
                </p>
              </div>
              <button
                type="button"
                className="p-2 rounded-full hover:bg-accent"
                onClick={() => {
                  setApplyProfile(null);
                  setApplyPreview(null);
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {applyError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {applyError}
              </div>
            ) : null}

            {applyLoading && !applyPreview ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando preview…
              </div>
            ) : null}

            {applyPreview ? (
              <>
                <p className="text-xs text-muted-foreground">
                  {applyPreview.changeCount} usuário(s) com mudança ·{" "}
                  {applyPreview.customizedCount} com permissões customizadas
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={overwriteCustomized}
                    onChange={(e) => setOverwriteCustomized(e.target.checked)}
                  />
                  Sobrescrever usuários que já customizaram permissões
                </label>
                <div className="rounded-xl border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr className="text-left">
                        <th className="px-3 py-2">Usuário</th>
                        <th className="px-3 py-2">Antes</th>
                        <th className="px-3 py-2">Depois</th>
                        <th className="px-3 py-2">Diff</th>
                      </tr>
                    </thead>
                    <tbody>
                      {applyPreview.users.map((u) => (
                        <tr key={u.id} className="border-t border-border/60">
                          <td className="px-3 py-2">
                            <div className="font-medium">{u.name}</div>
                            <div className="text-muted-foreground">{u.email}</div>
                            {!u.matchesProfileBefore ? (
                              <span className="text-[10px] font-bold text-amber-800">
                                Customizado
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {u.beforePermissions.length} · {u.beforeRole}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {u.afterPermissions.length} · {u.afterRole}
                          </td>
                          <td className="px-3 py-2">
                            {u.willChange
                              ? `+${u.gained.length} / −${u.lost.length}`
                              : "igual"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                    onClick={() => {
                      setApplyProfile(null);
                      setApplyPreview(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={applyLoading || applyPreview.changeCount === 0}
                    className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    onClick={() => void confirmApply()}
                  >
                    {applyLoading ? <Loader2 className="h-4 w-4 animate-spin inline" /> : null}{" "}
                    Confirmar aplicação
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};
