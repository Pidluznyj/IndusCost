/**
 * Exposure — monitoramento jurídico das empresas do grupo.
 * A tela não dá ciência e não mostra segredo.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  LIKELY_REVIEW_COPY,
  NO_CASES_IDENTIFIED_COPY,
  OFFICIAL_COMMUNICATIONS_PORTAL_URL,
  SOURCE_STATUS_LABELS,
  type LegalAliasType,
  type LegalSourceConnectionStatus,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  ALIAS_TYPE_OPTIONS,
  buildCreateAliasBody,
  exposureAliasCreateRequest,
  exposureAliasListPath,
  exposureAliasPatchRequest,
  type ExposureAliasRow,
} from "@/src/lib/legalExposure/legalExposureAliasForm";
import {
  buildCreateEntityBody,
  buildUpdateEntityBody,
  canSelectGroupCompany,
  EMPTY_COMPANIES_COPY,
  EMPTY_COMPANIES_MANAGE_HINT,
  emptyCreateExtras,
  entityEditFormFrom,
  EXPOSURE_GROUP_COMPANIES_PATH,
  exposureEntityActions,
  exposureEntityErrorText,
  exposureEntityRequest,
  groupCompanyStatusLabel,
  MONITOR_GLOBAL_NOTE,
  type EntityCreateExtras,
  type EntityEditForm,
  type ExposureGroupCompany,
  type MonitoredEntity,
} from "@/src/lib/legalExposure/legalExposureEntityForm";
import { LEGAL_EXPOSURE_RESOURCES } from "@/src/lib/legalExposure/legalExposurePermissions";
import { formatCnpj } from "@/src/lib/companyCnpjFormat";
import { fetchJsonOk } from "@/src/lib/http";
import { usePermissions } from "@/src/hooks/usePermissions";

type TabId =
  | "overview"
  | "action"
  | "cases"
  | "communications"
  | "timeline"
  | "certificates"
  | "sources"
  | "settings";

const TABS: { id: TabId; label: string; resource: string }[] = [
  { id: "overview", label: "Visão Geral", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "action", label: "Ação Requerida", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "cases", label: "Processos", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "communications", label: "Comunicações", resource: LEGAL_EXPOSURE_RESOURCES.communications },
  { id: "timeline", label: "Linha do Tempo", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "certificates", label: "Certidões", resource: LEGAL_EXPOSURE_RESOURCES.certificates },
  { id: "sources", label: "Fontes", resource: LEGAL_EXPOSURE_RESOURCES.sources },
  { id: "settings", label: "Configurações", resource: LEGAL_EXPOSURE_RESOURCES.settings },
];

type Dashboard = {
  cards: {
    actionRequired: number;
    monitoredCases: number;
    pendingCommunications: number;
    newsToday: number;
  };
  emptyState: string | null;
  absenceIsNotClearance: string;
  sources: {
    source: string;
    label: string;
    status: LegalSourceConnectionStatus;
    statusLabel: string;
    lastSuccessfulAt: string | null;
    healthy: boolean;
  }[];
  entities: {
    id: string;
    legalName: string;
    cnpj: string;
    monitoredCases: number;
    pendingCommunications: number;
    actionRequired: number;
    monitoring: { domicilio: boolean; datajud: boolean; djen: boolean; certificates: boolean };
    freshness: { source: string; status: string; healthy: boolean }[];
  }[];
  certificates: {
    trt: { issuedAt: string | null; result: string } | null;
    cndt: { issuedAt: string | null; result: string } | null;
    cndtNote: string;
  };
  configuration: { source: string; configured: boolean; enabled: boolean }[];
};

function statusClass(status: LegalSourceConnectionStatus): string {
  if (status === "HEALTHY") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "NOT_CONFIGURED" || status === "DISABLED") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-900";
}

export function ExposurePage() {
  const permissions = usePermissions();
  const visibleTabs = TABS.filter((tab) => permissions.canView(tab.resource));
  const [tab, setTab] = useState<TabId>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<{ items: { id: string; processNumber: string; tribunal: string | null; entityPole: string }[]; total: number } | null>(null);
  const [communications, setCommunications] = useState<{ items: { id: string; communicationType: string; processNumber: string | null; tribunal: string | null; sourceStatus: string; source: string; detectedAt: string; caseId: string | null }[] } | null>(null);
  const [alerts, setAlerts] = useState<{ items: { id: string; title: string; summary: string; severity: string; requiresAction: boolean }[] } | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<{ items: { kind: string; at: string; title: string; source: string | null }[] } | null>(null);
  const [entities, setEntities] = useState<MonitoredEntity[]>([]);
  const [groupCompanies, setGroupCompanies] = useState<ExposureGroupCompany[]>([]);
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [createStep, setCreateStep] = useState<"select" | "details">("select");
  const [selectedCompany, setSelectedCompany] = useState<ExposureGroupCompany | null>(null);
  const [createExtras, setCreateExtras] = useState<EntityCreateExtras>(emptyCreateExtras);
  const [editing, setEditing] = useState<MonitoredEntity | null>(null);
  const [editForm, setEditForm] = useState<EntityEditForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [aliasesByEntity, setAliasesByEntity] = useState<Record<string, ExposureAliasRow[]>>({});
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, { value: string; type: LegalAliasType }>>({});
  const [aliasError, setAliasError] = useState<string | null>(null);
  // Booleano estável: o objeto de permissões é recriado a cada atualização da sessão (/api/auth/me);
  // usá-lo como dependência da carga fazia a tela recarregar em laço até esgotar o navegador.
  const canManageModule = permissions.canManage(LEGAL_EXPOSURE_RESOURCES.module);
  const companyActions = exposureEntityActions(canManageModule);

  const reloadAliases = useCallback(async (list: MonitoredEntity[]) => {
    const entries = await Promise.all(
      list.map(async (entity) => {
        const rows = await fetchJsonOk<ExposureAliasRow[]>(exposureAliasListPath(entity.id));
        return [entity.id, rows] as const;
      })
    );
    setAliasesByEntity(Object.fromEntries(entries));
  }, []);

  const reloadOverview = useCallback(async () => {
    // Cada bloco é independente: a falha de um não esconde os outros nem dispara nova carga.
    const [data, list, companies] = await Promise.allSettled([
      fetchJsonOk<Dashboard>("/api/legal-exposure/dashboard"),
      fetchJsonOk<MonitoredEntity[]>("/api/legal-exposure/entities"),
      fetchJsonOk<ExposureGroupCompany[]>(EXPOSURE_GROUP_COMPANIES_PATH),
    ]);
    if (data.status === "fulfilled") setDashboard(data.value);
    if (list.status === "fulfilled") setEntities(list.value);
    if (companies.status === "fulfilled") setGroupCompanies(companies.value);
    const failure = [data, list, companies].find((result) => result.status === "rejected");
    if (canManageModule && list.status === "fulfilled") {
      await reloadAliases(list.value);
    }
    if (failure && failure.status === "rejected") throw failure.reason;
    setError(null);
  }, [canManageModule, reloadAliases]);

  useEffect(() => {
    let cancelled = false;
    reloadOverview().catch((err: unknown) => {
      if (!cancelled) setError(exposureEntityErrorText(err));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadOverview]);

  useEffect(() => {
    if (!visibleTabs.some((item) => item.id === tab) && visibleTabs[0]) setTab(visibleTabs[0].id);
  }, [tab, visibleTabs]);

  async function openCases() {
    setTab("cases");
    const data = await fetchJsonOk<{ items: { id: string; processNumber: string; tribunal: string | null; entityPole: string }[]; total: number }>(
      "/api/legal-exposure/cases?page=1&pageSize=20"
    );
    setCases(data);
  }

  async function openCommunications() {
    setTab("communications");
    const data = await fetchJsonOk<NonNullable<typeof communications>>("/api/legal-exposure/communications?page=1&pageSize=20");
    setCommunications(data);
  }

  async function openAction() {
    setTab("action");
    const data = await fetchJsonOk<NonNullable<typeof alerts>>("/api/legal-exposure/alerts?status=OPEN&page=1&pageSize=20");
    setAlerts(data);
  }

  function openCreate() {
    setCreateStep("select");
    setSelectedCompany(null);
    setCreateExtras(emptyCreateExtras());
    setFormError(null);
    setDialog("create");
  }

  function openEdit(entity: MonitoredEntity) {
    setEditing(entity);
    setEditForm(entityEditFormFrom(entity));
    setFormError(null);
    setDialog("edit");
  }

  function closeDialog() {
    if (saving) return;
    setDialog(null);
    setCreateStep("select");
    setSelectedCompany(null);
    setEditing(null);
    setEditForm(null);
    setFormError(null);
  }

  function selectGroupCompany(company: ExposureGroupCompany) {
    if (!canSelectGroupCompany(company)) return;
    setSelectedCompany(company);
    setCreateStep("details");
    setFormError(null);
  }

  async function submitCreate() {
    const built = buildCreateEntityBody(selectedCompany, createExtras);
    if (!built.ok) {
      setFormError(built.error);
      return;
    }
    const request = exposureEntityRequest("create");
    setSaving(true);
    setFormError(null);
    try {
      await fetchJsonOk(request.path, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.body),
      });
      setDialog(null);
      setCreateStep("select");
      setSelectedCompany(null);
      setCreateExtras(emptyCreateExtras());
      setNotice("Empresa adicionada.");
      await reloadOverview();
    } catch (err: unknown) {
      setFormError(exposureEntityErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function submitEdit() {
    if (!editing || !editForm) return;
    if (!editForm.legalName.trim()) {
      setFormError("Informe a razão social.");
      return;
    }
    const request = exposureEntityRequest("edit", editing.id);
    setSaving(true);
    setFormError(null);
    try {
      await fetchJsonOk(request.path, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildUpdateEntityBody(editForm)),
      });
      setDialog(null);
      setEditing(null);
      setEditForm(null);
      setNotice("Empresa atualizada.");
      await reloadOverview();
    } catch (err: unknown) {
      setFormError(exposureEntityErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function submitAlias(entityId: string) {
    const draft = aliasDrafts[entityId] ?? { value: "", type: "OTHER" as LegalAliasType };
    const built = buildCreateAliasBody(draft);
    if (!built.ok) {
      setAliasError(built.error);
      return;
    }
    const request = exposureAliasCreateRequest(entityId);
    setSaving(true);
    setAliasError(null);
    try {
      await fetchJsonOk(request.path, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.body),
      });
      setAliasDrafts((current) => ({ ...current, [entityId]: { value: "", type: "OTHER" } }));
      setNotice("Alias adicionado.");
      await reloadOverview();
    } catch (err: unknown) {
      setAliasError(exposureEntityErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function patchAlias(alias: ExposureAliasRow, patch: { value?: string; type?: LegalAliasType; active?: boolean }) {
    const request = exposureAliasPatchRequest(alias.id);
    setSaving(true);
    setAliasError(null);
    try {
      await fetchJsonOk(request.path, {
        method: request.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      setNotice(patch.active === false ? "Alias desativado." : "Alias atualizado.");
      await reloadOverview();
    } catch (err: unknown) {
      setAliasError(exposureEntityErrorText(err));
    } finally {
      setSaving(false);
    }
  }

  async function openTimeline(caseId: string) {
    setSelectedCase(caseId);
    setTab("timeline");
    const data = await fetchJsonOk<NonNullable<typeof timeline>>(`/api/legal-exposure/cases/${caseId}/timeline?page=1&pageSize=30`);
    setTimeline(data);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id === "cases") void openCases();
              else if (item.id === "communications") void openCommunications();
              else if (item.id === "action") void openAction();
              else setTab(item.id);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${tab === item.id ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {tab === "overview" && dashboard ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Card label="Ação requerida" value={dashboard.cards.actionRequired} />
            <Card label="Processos monitorados" value={dashboard.cards.monitoredCases} />
            <Card label="Comunicações pendentes" value={dashboard.cards.pendingCommunications} />
            <Card label="Novidades hoje" value={dashboard.cards.newsToday} />
          </div>
          <p className="text-sm text-muted-foreground">{dashboard.absenceIsNotClearance}</p>
          {entities.length > 0 && dashboard.emptyState ? <p className="text-sm font-medium">{dashboard.emptyState}</p> : null}
          {notice ? <p className="text-sm text-emerald-800">{notice}</p> : null}
          <SourceGrid sources={dashboard.sources} certificates={dashboard.certificates} />
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Empresas monitoradas</h2>
              {companyActions.showAdd ? (
                <button type="button" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white" onClick={openCreate}>
                  + Adicionar empresa
                </button>
              ) : null}
            </div>
            {entities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-sm">
                <p className="font-medium">{EMPTY_COMPANIES_COPY}</p>
                {companyActions.showAdd ? <p className="mt-1 text-muted-foreground">{EMPTY_COMPANIES_MANAGE_HINT}</p> : null}
                {companyActions.showAdd ? (
                  <button type="button" className="mt-3 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white" onClick={openCreate}>
                    Adicionar empresa
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2">Razão social</th>
                      <th className="px-3 py-2">CNPJ</th>
                      <th className="px-3 py-2">Monitoramento</th>
                      <th className="px-3 py-2">Processos monitorados</th>
                      <th className="px-3 py-2">Comunicações pendentes</th>
                      <th className="px-3 py-2">Ações requeridas</th>
                      <th className="px-3 py-2">Frescor</th>
                      {companyActions.showEdit ? <th className="px-3 py-2">Ações</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {entities.map((entity) => {
                      const metrics = dashboard.entities.find((row) => row.id === entity.id);
                      return (
                        <tr key={entity.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            {entity.legalName}
                            {entity.active ? "" : " · inativa"}
                          </td>
                          <td className="px-3 py-2">{formatCnpj(entity.cnpj)}</td>
                          <td className="px-3 py-2">
                            {[entity.monitorDomicilio && "Domicílio", entity.monitorDatajud && "DataJud", entity.monitorDjen && "DJEN", entity.monitorCertificates && "Certidões"]
                              .filter(Boolean)
                              .join(", ") || "—"}
                          </td>
                          <td className="px-3 py-2">{metrics?.monitoredCases ?? "—"}</td>
                          <td className="px-3 py-2">{metrics?.pendingCommunications ?? "—"}</td>
                          <td className="px-3 py-2">{metrics?.actionRequired ?? "—"}</td>
                          <td className="px-3 py-2">
                            {metrics?.freshness.map((item) => SOURCE_STATUS_LABELS[item.status as LegalSourceConnectionStatus] ?? item.status).join(" · ") || "—"}
                          </td>
                          {companyActions.showEdit ? (
                            <td className="px-3 py-2">
                              <button type="button" className="text-sm font-semibold underline" onClick={() => openEdit(entity)}>
                                Editar
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {tab === "action" && (
        <div className="space-y-3">
          {(alerts?.items ?? []).filter((item) => item.requiresAction).map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-700">{item.severity}</p>
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.summary}</p>
            </article>
          ))}
          {alerts && alerts.items.filter((item) => item.requiresAction).length === 0 ? (
            <p className="text-sm">{NO_CASES_IDENTIFIED_COPY}</p>
          ) : null}
        </div>
      )}

      {tab === "cases" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{ABSENCE_IS_NOT_CLEARANCE_COPY}</p>
          {(cases?.items ?? []).length === 0 ? <p className="text-sm">{NO_CASES_IDENTIFIED_COPY}</p> : null}
          {(cases?.items ?? []).map((item) => (
            <div key={item.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="font-medium">{item.processNumber}</p>
                <p className="text-xs text-muted-foreground">{item.tribunal ?? "Tribunal não informado"} · polo {item.entityPole}</p>
              </div>
              <button type="button" className="text-sm font-semibold underline" onClick={() => void openTimeline(item.id)}>
                Ver processo
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "communications" && (
        <div className="space-y-3">
          {(communications?.items ?? []).map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase">{item.communicationType}</p>
              <p className="text-sm">Processo {item.processNumber ?? "—"}</p>
              <p className="text-sm">Tribunal {item.tribunal ?? "—"}</p>
              <p className="text-sm">Detectada {item.detectedAt}</p>
              <p className="text-sm">Fonte {item.source}</p>
              <p className="text-sm">Situação oficial {item.sourceStatus || "—"}</p>
              <div className="mt-2 flex gap-3">
                {item.caseId ? (
                  <button type="button" className="text-sm font-semibold underline" onClick={() => void openTimeline(item.caseId!)}>
                    Ver processo
                  </button>
                ) : null}
                <a className="text-sm font-semibold underline" href={OFFICIAL_COMMUNICATIONS_PORTAL_URL} target="_blank" rel="noreferrer">
                  Abrir portal oficial
                </a>
              </div>
            </article>
          ))}
          {communications && communications.items.length === 0 ? <p className="text-sm">{NO_CASES_IDENTIFIED_COPY}</p> : null}
        </div>
      )}

      {tab === "timeline" && (
        <div className="space-y-2">
          {!selectedCase ? <p className="text-sm">Abra um processo para ver a linha do tempo.</p> : null}
          {(timeline?.items ?? []).map((item, index) => (
            <div key={`${item.kind}-${index}`} className="rounded-xl border border-border px-4 py-2 text-sm">
              <span className="font-medium">{item.title}</span>
              <span className="text-muted-foreground"> · {item.at} · {item.source ?? "interno"}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "certificates" && dashboard ? (
        <div className="space-y-2 text-sm">
          <p>Certidão TRT — última emissão: {dashboard.certificates.trt?.issuedAt ?? "não registrada"}</p>
          <p>CNDT — última emissão: {dashboard.certificates.cndt?.issuedAt ?? "não registrada"}</p>
          <p>{dashboard.certificates.cndtNote || CNDT_DOES_NOT_MEAN_NO_CASES_COPY}</p>
        </div>
      ) : null}

      {tab === "sources" && dashboard ? <SourceGrid sources={dashboard.sources} certificates={dashboard.certificates} /> : null}

      {tab === "settings" && dashboard ? (
        <div className="space-y-6">
          <ul className="space-y-2 text-sm">
            {dashboard.configuration.map((row) => (
              <li key={row.source}>
                {row.source}: {row.configured ? "configurado" : "não configurado"}
                {row.enabled ? "" : " · desligado"}
              </li>
            ))}
            <li className="text-muted-foreground">{LIKELY_REVIEW_COPY} permanece como revisão humana. Segredos não são exibidos.</li>
          </ul>
          {companyActions.showEdit ? (
            <section className="space-y-4">
              <h3 className="text-sm font-semibold">Aliases de descoberta DJEN</h3>
              {aliasError ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{aliasError}</p> : null}
              {entities.map((entity) => {
                const draft = aliasDrafts[entity.id] ?? { value: "", type: "OTHER" as LegalAliasType };
                return (
                  <article key={entity.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                    <div>
                      <p className="font-medium">{entity.legalName}</p>
                      <p className="text-xs text-muted-foreground">Razão social: {entity.legalName}</p>
                      <p className="text-xs text-muted-foreground">Nome fantasia: {entity.tradeName || "—"}</p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="py-1">Tipo</th>
                          <th className="py-1">Valor</th>
                          <th className="py-1">Ativo</th>
                          <th className="py-1" />
                        </tr>
                      </thead>
                      <tbody>
                        {(aliasesByEntity[entity.id] ?? []).map((alias) => (
                          <tr key={alias.id} className="border-t border-border">
                            <td className="py-2">
                              <select
                                value={alias.type}
                                disabled={saving}
                                onChange={(event) => void patchAlias(alias, { type: event.target.value as LegalAliasType })}
                                className="rounded border border-border bg-background px-2 py-1"
                              >
                                {ALIAS_TYPE_OPTIONS.map((option) => (
                                  <option key={option.type} value={option.type}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2">
                              <input
                                defaultValue={alias.value}
                                disabled={saving}
                                onBlur={(event) => {
                                  const value = event.target.value.trim();
                                  if (value && value !== alias.value) void patchAlias(alias, { value });
                                }}
                                className="w-full rounded border border-border bg-background px-2 py-1"
                              />
                            </td>
                            <td className="py-2">{alias.active ? "Sim" : "Não"}</td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                disabled={saving}
                                className="text-sm font-semibold underline"
                                onClick={() => void patchAlias(alias, { active: !alias.active })}
                              >
                                {alias.active ? "Desativar" : "Ativar"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Tipo
                        <select
                          value={draft.type}
                          onChange={(event) =>
                            setAliasDrafts((current) => ({
                              ...current,
                              [entity.id]: { ...draft, type: event.target.value as LegalAliasType },
                            }))
                          }
                          className="mt-1 block rounded border border-border bg-background px-2 py-1 text-sm font-normal normal-case"
                        >
                          {ALIAS_TYPE_OPTIONS.map((option) => (
                            <option key={option.type} value={option.type}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="min-w-[16rem] flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Valor
                        <input
                          value={draft.value}
                          onChange={(event) =>
                            setAliasDrafts((current) => ({
                              ...current,
                              [entity.id]: { ...draft, value: event.target.value },
                            }))
                          }
                          className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm font-normal normal-case"
                        />
                      </label>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void submitAlias(entity.id)}
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        Adicionar alias
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          ) : null}
        </div>
      ) : null}

      {dialog === "create" && createStep === "select" ? (
        <EntityDialog
          title="Adicionar empresa"
          submitLabel="Adicionar empresa"
          showSubmit={false}
          saving={saving}
          error={formError}
          onClose={closeDialog}
          onSubmit={() => undefined}
        >
          <p className="text-sm font-normal normal-case text-muted-foreground">
            Selecione uma empresa do grupo econômico para monitoramento jurídico.
          </p>
          <div className="space-y-2">
            {groupCompanies.map((company) => {
              const available = canSelectGroupCompany(company);
              return (
                <button
                  key={company.cnpj}
                  type="button"
                  disabled={!available}
                  onClick={() => selectGroupCompany(company)}
                  className="flex w-full flex-col items-start rounded-xl border border-border px-3 py-2 text-left text-sm font-normal normal-case disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="font-medium">{company.legalName}</span>
                  <span className="text-muted-foreground">{company.displayCnpj}</span>
                  <span>{groupCompanyStatusLabel(company)}</span>
                </button>
              );
            })}
          </div>
        </EntityDialog>
      ) : null}

      {dialog === "create" && createStep === "details" && selectedCompany ? (
        <EntityDialog
          title="Adicionar empresa"
          submitLabel="Adicionar empresa"
          saving={saving}
          error={formError}
          onBack={() => {
            setCreateStep("select");
            setFormError(null);
          }}
          onClose={closeDialog}
          onSubmit={() => void submitCreate()}
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Empresa
            <input
              readOnly
              value={selectedCompany.legalName}
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm font-normal normal-case"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            CNPJ
            <input
              readOnly
              value={selectedCompany.displayCnpj}
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm font-normal normal-case"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nome fantasia
            <input
              value={createExtras.tradeName}
              onChange={(event) => setCreateExtras({ ...createExtras, tradeName: event.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              UF
              <input
                maxLength={2}
                value={createExtras.state}
                onChange={(event) => setCreateExtras({ ...createExtras, state: event.target.value.toUpperCase().slice(0, 2) })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cidade
              <input
                value={createExtras.city}
                onChange={(event) => setCreateExtras({ ...createExtras, city: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
              />
            </label>
          </div>
          <p className="text-xs font-normal normal-case text-muted-foreground">{MONITOR_GLOBAL_NOTE}</p>
        </EntityDialog>
      ) : null}

      {dialog === "edit" && editing && editForm ? (
        <EntityDialog
          title="Editar empresa"
          submitLabel="Salvar"
          saving={saving}
          error={formError}
          onClose={closeDialog}
          onSubmit={() => void submitEdit()}
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            CNPJ
            <input
              readOnly
              value={formatCnpj(editing.cnpj)}
              className="mt-1 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm font-normal normal-case"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Razão social *
            <input
              required
              value={editForm.legalName}
              onChange={(event) => setEditForm({ ...editForm, legalName: event.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nome fantasia
            <input
              value={editForm.tradeName}
              onChange={(event) => setEditForm({ ...editForm, tradeName: event.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              UF
              <input
                maxLength={2}
                value={editForm.state}
                onChange={(event) => setEditForm({ ...editForm, state: event.target.value.toUpperCase().slice(0, 2) })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Cidade
              <input
                value={editForm.city}
                onChange={(event) => setEditForm({ ...editForm, city: event.target.value })}
                className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-normal normal-case"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm font-normal normal-case">
            <input
              type="checkbox"
              checked={editForm.active}
              onChange={(event) => setEditForm({ ...editForm, active: event.target.checked })}
            />
            Empresa ativa
          </label>
          <fieldset className="space-y-2 text-sm font-normal normal-case">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monitorar</legend>
            <MonitorToggle label="Domicílio Judicial" checked={editForm.monitorDomicilio} onChange={(checked) => setEditForm({ ...editForm, monitorDomicilio: checked })} />
            <MonitorToggle label="DataJud" checked={editForm.monitorDatajud} onChange={(checked) => setEditForm({ ...editForm, monitorDatajud: checked })} />
            <MonitorToggle label="DJEN" checked={editForm.monitorDjen} onChange={(checked) => setEditForm({ ...editForm, monitorDjen: checked })} />
            <MonitorToggle label="Certidões" checked={editForm.monitorCertificates} onChange={(checked) => setEditForm({ ...editForm, monitorCertificates: checked })} />
          </fieldset>
          <p className="text-xs font-normal normal-case text-muted-foreground">{MONITOR_GLOBAL_NOTE}</p>
        </EntityDialog>
      ) : null}
    </div>
  );
}

function EntityDialog({
  title,
  submitLabel,
  saving,
  error,
  onClose,
  onSubmit,
  onBack,
  showSubmit = true,
  children,
}: {
  title: string;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onBack?: () => void;
  showSubmit?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="exposure-entity-dialog-title"
        className="w-full max-w-lg space-y-3 rounded-2xl border border-border bg-card p-6 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <h3 id="exposure-entity-dialog-title" className="text-base font-semibold">
          {title}
        </h3>
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
        {children}
        <div className="flex justify-end gap-2">
          {onBack ? (
            <button type="button" className="mr-auto rounded-lg border border-border px-3 py-1.5 text-sm" onClick={onBack} disabled={saving}>
              Voltar
            </button>
          ) : null}
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          {showSubmit ? (
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" disabled={saving}>
              {saving ? "Salvando..." : submitLabel}
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function MonitorToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SourceGrid({
  sources,
  certificates,
}: {
  sources: Dashboard["sources"];
  certificates: Dashboard["certificates"];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {sources.map((source) => (
        <div key={source.source} className={`rounded-xl border p-3 text-sm ${statusClass(source.status)}`}>
          <p className="font-semibold">{source.label}</p>
          <p>{source.statusLabel}</p>
          <p>Último sucesso: {source.lastSuccessfulAt ?? "—"}</p>
        </div>
      ))}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-semibold">Certidão TRT</p>
        <p>Última emissão: {certificates.trt?.issuedAt ?? "—"}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <p className="font-semibold">CNDT</p>
        <p>Última emissão: {certificates.cndt?.issuedAt ?? "—"}</p>
        <p className="mt-1 text-xs">{CNDT_DOES_NOT_MEAN_NO_CASES_COPY}</p>
      </div>
    </div>
  );
}
