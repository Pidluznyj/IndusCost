/**
 * Exposure — monitoramento jurídico das empresas do grupo.
 * A tela não dá ciência e não mostra segredo.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  EXPOSURE_LOADING_COPY,
  LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT,
  MULTIPLE_GROUP_NOTE,
  SOURCE_LABELS,
  type ExposureCaseListItem,
  type LegalAliasType,
  type Page,
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
import {
  EMPTY_CASE_LIST_FILTERS,
  ExposureCaseList,
  type ExposureCaseListFilters,
} from "./ExposureCaseList";
import {
  EMPTY_COMMUNICATION_FILTERS,
  ExposureAlertsTab,
  ExposureCertificatesTab,
  ExposureCommunicationsTab,
  ExposureSourcesTab,
  type ExposureAlertItem,
  type ExposureCertificateItem,
  type ExposureCommunicationFilters,
  type ExposureCommunicationItem,
  type ExposureSourceItem,
} from "./ExposureFeed";
import { formatExposureDateTime } from "@/src/lib/legalExposure/legalExposureCaseListUi";
import { ExposureCaseDossier } from "./ExposureCaseDossier";

type TabId =
  | "overview"
  | "action"
  | "cases"
  | "communications"
  | "certificates"
  | "sources"
  | "settings";

const TABS: { id: TabId; label: string; resource: string }[] = [
  { id: "overview", label: "Visão Geral", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "action", label: "Ação Requerida", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "cases", label: "Processos", resource: LEGAL_EXPOSURE_RESOURCES.module },
  { id: "communications", label: "Comunicações", resource: LEGAL_EXPOSURE_RESOURCES.communications },
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
    passiveCases?: number;
    futureHearings?: number;
    knownClaimCount?: number;
    knownClaimTotalFormatted?: string | null;
  };
  emptyState: string | null;
    absenceIsNotClearance: string;
    multipleGroupNote?: string;
    monitoredCasesLabel?: string;
  sources: ExposureSourceItem[];
  entities: {
    id: string;
    legalName: string;
    cnpj: string;
    monitoredCases: number;
    polePassive?: number;
    poleActive?: number;
    pendingCommunications: number;
    actionRequired: number;
    lastSuccessfulSyncAt?: string | null;
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

export function ExposurePage() {
  const permissions = usePermissions();
  const visibleTabs = TABS.filter((tab) => permissions.canView(tab.resource));
  const [tab, setTab] = useState<TabId>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tabError, setTabError] = useState<Partial<Record<TabId, string | null>>>({});
  const [tabLoading, setTabLoading] = useState<Partial<Record<TabId, boolean>>>({});
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [cases, setCases] = useState<Page<ExposureCaseListItem> | null>(null);
  const [caseFilters, setCaseFilters] = useState<ExposureCaseListFilters>(EMPTY_CASE_LIST_FILTERS);
  const [communications, setCommunications] = useState<{ items: ExposureCommunicationItem[] } | null>(null);
  const [commFilters, setCommFilters] = useState<ExposureCommunicationFilters>(EMPTY_COMMUNICATION_FILTERS);
  const [alerts, setAlerts] = useState<{ items: ExposureAlertItem[] } | null>(null);
  const [busyAlertId, setBusyAlertId] = useState<string | null>(null);
  const [selectedCase, setSelectedCase] = useState<string | null>(null);
  const [dossier, setDossier] = useState<React.ComponentProps<typeof ExposureCaseDossier>["dossier"] | null>(null);
  const [refreshingCase, setRefreshingCase] = useState(false);
  const [certificates, setCertificates] = useState<ExposureCertificateItem[] | null>(null);
  const [sourceTestBusy, setSourceTestBusy] = useState<string | null>(null);
  const [sourceTestResult, setSourceTestResult] = useState<{ source: string; message: string } | null>(null);
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
    setOverviewLoading(true);
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
    setOverviewLoading(false);
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

  function caseListPath(filters: ExposureCaseListFilters): string {
    const params = new URLSearchParams();
    params.set("page", String(filters.page || 1));
    params.set("pageSize", String(LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT));
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.entityId) params.set("entityId", filters.entityId);
    if (filters.tribunal.trim()) params.set("tribunal", filters.tribunal.trim());
    if (filters.source) params.set("source", filters.source);
    if (filters.verification) params.set("verification", filters.verification);
    if (filters.enrichment) params.set("enrichment", filters.enrichment);
    if (filters.pole) params.set("pole", filters.pole);
    if (filters.stage) params.set("stage", filters.stage);
    if (filters.hasHearing) params.set("hasHearing", filters.hasHearing);
    if (filters.hasRequiredAction) params.set("hasRequiredAction", filters.hasRequiredAction);
    if (filters.multipleGroup) params.set("multipleGroup", filters.multipleGroup);
    return `/api/legal-exposure/cases?${params.toString()}`;
  }

  async function loadCases(filters: ExposureCaseListFilters) {
    setTab("cases");
    setTabLoading((current) => ({ ...current, cases: true }));
    setTabError((current) => ({ ...current, cases: null }));
    setCases(null);
    try {
      const data = await fetchJsonOk<Page<ExposureCaseListItem>>(caseListPath(filters));
      setCases(data);
    } catch (err: unknown) {
      setTabError((current) => ({ ...current, cases: exposureEntityErrorText(err) }));
    } finally {
      setTabLoading((current) => ({ ...current, cases: false }));
    }
  }

  async function openCases(patch?: Partial<ExposureCaseListFilters>) {
    const next = { ...EMPTY_CASE_LIST_FILTERS, ...patch };
    setCaseFilters(next);
    await loadCases(next);
  }

  function communicationsPath(filters: ExposureCommunicationFilters): string {
    const params = new URLSearchParams();
    params.set("page", "1");
    params.set("pageSize", "20");
    if (filters.entityId) params.set("entityId", filters.entityId);
    if (filters.q.trim()) params.set("q", filters.q.trim());
    if (filters.communicationType) params.set("communicationType", filters.communicationType);
    if (filters.status) params.set("status", filters.status);
    if (filters.tribunal.trim()) params.set("tribunal", filters.tribunal.trim());
    if (filters.source) params.set("source", filters.source);
    return `/api/legal-exposure/communications?${params.toString()}`;
  }

  async function loadCommunications(filters: ExposureCommunicationFilters) {
    setTab("communications");
    setTabLoading((current) => ({ ...current, communications: true }));
    setTabError((current) => ({ ...current, communications: null }));
    setCommunications(null);
    try {
      const data = await fetchJsonOk<NonNullable<typeof communications>>(communicationsPath(filters));
      setCommunications(data);
    } catch (err: unknown) {
      setTabError((current) => ({ ...current, communications: exposureEntityErrorText(err) }));
    } finally {
      setTabLoading((current) => ({ ...current, communications: false }));
    }
  }

  async function openCommunications(patch?: Partial<ExposureCommunicationFilters>) {
    const next = { ...EMPTY_COMMUNICATION_FILTERS, ...patch };
    setCommFilters(next);
    await loadCommunications(next);
  }

  async function openAction() {
    setTab("action");
    setTabLoading((current) => ({ ...current, action: true }));
    setTabError((current) => ({ ...current, action: null }));
    setAlerts(null);
    try {
      const data = await fetchJsonOk<NonNullable<typeof alerts>>("/api/legal-exposure/alerts?status=OPEN&page=1&pageSize=20");
      setAlerts(data);
    } catch (err: unknown) {
      setTabError((current) => ({ ...current, action: exposureEntityErrorText(err) }));
    } finally {
      setTabLoading((current) => ({ ...current, action: false }));
    }
  }

  async function updateAlert(alertId: string, action: "acknowledge" | "resolve") {
    setBusyAlertId(alertId);
    setSaving(true);
    setTabError((current) => ({ ...current, action: null }));
    try {
      await fetchJsonOk(`/api/legal-exposure/alerts/${alertId}/${action}`, { method: "POST" });
      setAlerts((current) =>
        current
          ? {
              items: current.items.map((item) =>
                item.id === alertId
                  ? { ...item, status: action === "acknowledge" ? "ACKNOWLEDGED" : "RESOLVED", requiresAction: action !== "resolve" }
                  : item
              ),
            }
          : current
      );
      setNotice(action === "acknowledge" ? "Ação reconhecida no IndusCost (não substitui o portal oficial)." : "Ação marcada como resolvida.");
      void reloadOverview().catch(() => undefined);
    } catch (err: unknown) {
      setTabError((current) => ({ ...current, action: exposureEntityErrorText(err) }));
    } finally {
      setSaving(false);
      setBusyAlertId(null);
    }
  }

  async function openCertificates() {
    setTab("certificates");
    setTabLoading((current) => ({ ...current, certificates: true }));
    setTabError((current) => ({ ...current, certificates: null }));
    setCertificates(null);
    try {
      const data = await fetchJsonOk<ExposureCertificateItem[]>("/api/legal-exposure/certificates");
      setCertificates(data);
    } catch (err: unknown) {
      setTabError((current) => ({ ...current, certificates: exposureEntityErrorText(err) }));
    } finally {
      setTabLoading((current) => ({ ...current, certificates: false }));
    }
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

  async function openDossier(caseId: string) {
    setSelectedCase(caseId);
    const data = await fetchJsonOk<NonNullable<typeof dossier>>(`/api/legal-exposure/cases/${caseId}`);
    setDossier(data);
  }

  async function testSource(source: string) {
    setSourceTestBusy(source);
    try {
      const result = await fetchJsonOk<{ success?: boolean; sanitizedError?: string | null; connectivityTest?: string }>(
        "/api/legal-exposure/sources/test",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source }),
        }
      );
      setSourceTestResult({
        source,
        message: result.success
          ? `Conexão ok${result.connectivityTest ? ` (${result.connectivityTest})` : ""}.`
          : result.sanitizedError || "Falha no teste de conexão.",
      });
    } catch (err: unknown) {
      setSourceTestResult({ source, message: exposureEntityErrorText(err) });
    } finally {
      setSourceTestBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {visibleTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id === "cases") void loadCases(caseFilters);
              else if (item.id === "communications") void loadCommunications(commFilters);
              else if (item.id === "action") void openAction();
              else if (item.id === "certificates") void openCertificates();
              else if (item.id === "sources") {
                setTab("sources");
                void reloadOverview().catch((err: unknown) => {
                  setTabError((current) => ({ ...current, sources: exposureEntityErrorText(err) }));
                });
              } else setTab(item.id);
            }}
            className={`rounded-full border px-3 py-1 text-sm ${tab === item.id ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && error ? (
        <p role="alert" className="text-sm text-red-700">{error}</p>
      ) : null}

      {tab === "overview" && overviewLoading && !dashboard ? (
        <p className="text-sm text-muted-foreground">{EXPOSURE_LOADING_COPY}</p>
      ) : null}

      {tab === "overview" && dashboard ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Card label="Ações requeridas" value={dashboard.cards.actionRequired} onClick={() => void openAction()} />
            <Card label="Processos únicos" value={dashboard.cards.monitoredCases} onClick={() => void openCases()} />
            <Card
              label="Comunicações pendentes"
              value={dashboard.cards.pendingCommunications}
              onClick={() => void openCommunications({ status: "PENDING" })}
            />
            <Card label="Novidades hoje" value={dashboard.cards.newsToday} onClick={() => void openCommunications()} />
            <Card
              label="Processos no polo passivo"
              value={dashboard.cards.passiveCases ?? 0}
              onClick={() => void openCases({ pole: "PASSIVE" })}
            />
            {(dashboard.cards.futureHearings ?? 0) > 0 ? (
              <Card
                label="Audiências futuras"
                value={dashboard.cards.futureHearings ?? 0}
                onClick={() => void openCases({ hasHearing: "true" })}
              />
            ) : dashboard.cards.knownClaimTotalFormatted ? (
              <Card
                label="Valor conhecido das causas"
                value={dashboard.cards.knownClaimTotalFormatted}
                onClick={() => void openCases()}
              />
            ) : (
              <Card
                label="Audiências futuras"
                value={dashboard.cards.futureHearings ?? 0}
                onClick={() => void openCases({ hasHearing: "true" })}
              />
            )}
          </div>
          {dashboard.cards.knownClaimTotalFormatted && (dashboard.cards.futureHearings ?? 0) > 0 ? (
            <p className="text-sm text-muted-foreground">
              Valor conhecido das causas: <button type="button" className="font-semibold underline" onClick={() => void openCases()}>{dashboard.cards.knownClaimTotalFormatted}</button>
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">{dashboard.absenceIsNotClearance}</p>
          <p className="text-xs text-muted-foreground">{dashboard.multipleGroupNote || MULTIPLE_GROUP_NOTE}</p>
          {entities.length > 0 && dashboard.emptyState ? <p className="text-sm font-medium">{dashboard.emptyState}</p> : null}
          {notice ? <p className="text-sm text-emerald-800">{notice}</p> : null}
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1.5 text-sm"
            onClick={() => {
              window.open("/api/legal-exposure/reports/group.pdf", "_blank");
            }}
          >
            Gerar relatório PDF
          </button>
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
                      <th className="px-3 py-2">Nome</th>
                      <th className="px-3 py-2">CNPJ</th>
                      <th className="px-3 py-2">Processos únicos</th>
                      <th className="px-3 py-2">Polo passivo</th>
                      <th className="px-3 py-2">Polo ativo</th>
                      <th className="px-3 py-2">Ações requeridas</th>
                      <th className="px-3 py-2">Última atualização</th>
                      <th className="px-3 py-2">Fontes habilitadas</th>
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
                          <td className="px-3 py-2">{metrics?.monitoredCases ?? "—"}</td>
                          <td className="px-3 py-2">{metrics?.polePassive ?? "—"}</td>
                          <td className="px-3 py-2">{metrics?.poleActive ?? "—"}</td>
                          <td className="px-3 py-2">{metrics?.actionRequired ?? "—"}</td>
                          <td className="px-3 py-2">{formatExposureDateTime(metrics?.lastSuccessfulSyncAt ?? entity.lastSuccessfulSyncAt) ?? "nunca"}</td>
                          <td className="px-3 py-2">
                            {[entity.monitorDomicilio && "Domicílio", entity.monitorDatajud && "DataJud", entity.monitorDjen && "DJEN", entity.monitorCertificates && "Certidões"]
                              .filter(Boolean)
                              .join(", ") || "—"}
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
        <ExposureAlertsTab
          alerts={alerts?.items ?? null}
          canManage={companyActions.showEdit}
          busy={saving}
          busyId={busyAlertId}
          loading={tabLoading.action}
          error={tabError.action ?? null}
          onOpenCase={(caseId) => void openDossier(caseId)}
          onAcknowledge={(alertId) => void updateAlert(alertId, "acknowledge")}
          onResolve={(alertId) => void updateAlert(alertId, "resolve")}
        />
      )}

      {tab === "cases" && (
        <ExposureCaseList
          cases={cases}
          entities={entities.map((entity) => ({ id: entity.id, legalName: entity.legalName }))}
          filters={caseFilters}
          loading={tabLoading.cases}
          error={tabError.cases ?? null}
          onFilterChange={(patch) => {
            const next = { ...caseFilters, ...patch };
            setCaseFilters(next);
            void loadCases(next);
          }}
          onClearFilters={() => {
            setCaseFilters(EMPTY_CASE_LIST_FILTERS);
            void loadCases(EMPTY_CASE_LIST_FILTERS);
          }}
          onPageChange={(page) => {
            const next = { ...caseFilters, page };
            setCaseFilters(next);
            void loadCases(next);
          }}
          onOpenCase={(caseId) => void openDossier(caseId)}
        />
      )}

      {tab === "communications" && (
        <ExposureCommunicationsTab
          communications={communications?.items ?? null}
          entities={entities.map((entity) => ({ id: entity.id, legalName: entity.legalName }))}
          filters={commFilters}
          loading={tabLoading.communications}
          error={tabError.communications ?? null}
          onFilterChange={(patch) => {
            const next = { ...commFilters, ...patch };
            setCommFilters(next);
            void loadCommunications(next);
          }}
          onOpenCase={(caseId) => void openDossier(caseId)}
        />
      )}

      {tab === "certificates" && (
        <ExposureCertificatesTab
          certificates={certificates}
          entities={entities}
          note={dashboard?.certificates.cndtNote || CNDT_DOES_NOT_MEAN_NO_CASES_COPY}
          loading={tabLoading.certificates}
          error={tabError.certificates ?? null}
          canManage={companyActions.showEdit}
          onRegister={async (body) => {
            await fetchJsonOk("/api/legal-exposure/certificates", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            await openCertificates();
          }}
        />
      )}

      {tab === "sources" && (
        <ExposureSourcesTab
          sources={dashboard?.sources ?? []}
          loading={overviewLoading && !dashboard}
          error={tabError.sources ?? null}
          onTest={(source) => void testSource(source)}
          testBusy={sourceTestBusy}
          testResult={sourceTestResult}
        />
      )}

      {tab === "settings" && dashboard ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Empresas monitoradas</h2>
            <p className="text-sm text-muted-foreground">{MULTIPLE_GROUP_NOTE}</p>
            <p className="text-sm">{entities.length} empresa(s) ativa(s) no monitoramento.</p>
          </section>
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Monitoramento por fonte</h2>
            <ul className="space-y-2 text-sm">
              {dashboard.configuration.map((row) => (
                <li key={row.source}>
                  {SOURCE_LABELS[row.source as keyof typeof SOURCE_LABELS] ?? row.source}: {row.configured ? "configurado" : "não configurado"}
                  {row.enabled ? "" : " · Desligado"}
                </li>
              ))}
            </ul>
          </section>
          {companyActions.showEdit ? (
            <section className="space-y-4">
              <h2 className="text-base font-semibold">Aliases de descoberta</h2>
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
          <section className="space-y-3">
            <h2 className="text-base font-semibold">Configurações técnicas visíveis</h2>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {dashboard.configuration.map((row) => (
                <li key={`${row.source}-tech`}>
                  {SOURCE_LABELS[row.source as keyof typeof SOURCE_LABELS] ?? row.source}:{" "}
                  {row.enabled ? "habilitada" : "Desligado"} · {row.configured ? "credencial/config presente" : "sem configuração local"}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Segredos e tokens não são exibidos nesta tela.</p>
          </section>
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

      {dossier ? (
        <ExposureCaseDossier
          dossier={dossier}
          refreshing={refreshingCase}
          onClose={() => {
            setDossier(null);
            setSelectedCase(null);
          }}
          onRefresh={async () => {
            if (!selectedCase || refreshingCase) return;
            setRefreshingCase(true);
            try {
              await fetchJsonOk(`/api/legal-exposure/cases/${selectedCase}/refresh`, { method: "POST" });
              await openDossier(selectedCase);
            } finally {
              setRefreshingCase(false);
            }
          }}
          onPdf={() => {
            if (!selectedCase) return;
            window.open(`/api/legal-exposure/cases/${selectedCase}/pdf`, "_blank");
          }}
        />
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
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);
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
        <h3 id="exposure-entity-dialog-title" ref={titleRef} tabIndex={-1} className="text-base font-semibold">
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

function Card({ label, value, onClick }: { label: string; value: number | string; onClick?: () => void }) {
  const className = "rounded-xl border border-border bg-card p-4 text-left";
  const body = (
    <>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`${className} hover:border-slate-400`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className={className}>{body}</div>;
}
