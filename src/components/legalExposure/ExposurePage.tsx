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
  type LegalSourceConnectionStatus,
} from "@/src/lib/legalExposure/legalExposureContracts";
import { LEGAL_EXPOSURE_RESOURCES } from "@/src/lib/legalExposure/legalExposurePermissions";
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

  const loadDashboard = useCallback(async () => {
    const data = await fetchJsonOk<Dashboard>("/api/legal-exposure/dashboard");
    setDashboard(data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDashboard().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar o Exposure.");
    });
    return () => {
      cancelled = true;
    };
  }, [loadDashboard]);

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
          {dashboard.emptyState ? <p className="text-sm font-medium">{dashboard.emptyState}</p> : null}
          <SourceGrid sources={dashboard.sources} certificates={dashboard.certificates} />
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
                </tr>
              </thead>
              <tbody>
                {dashboard.entities.map((entity) => (
                  <tr key={entity.id} className="border-t border-border">
                    <td className="px-3 py-2">{entity.legalName}</td>
                    <td className="px-3 py-2">{entity.cnpj}</td>
                    <td className="px-3 py-2">
                      {[entity.monitoring.domicilio && "Domicílio", entity.monitoring.datajud && "DataJud", entity.monitoring.djen && "DJEN"]
                        .filter(Boolean)
                        .join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">{entity.monitoredCases}</td>
                    <td className="px-3 py-2">{entity.pendingCommunications}</td>
                    <td className="px-3 py-2">{entity.actionRequired}</td>
                    <td className="px-3 py-2">
                      {entity.freshness.map((item) => SOURCE_STATUS_LABELS[item.status as LegalSourceConnectionStatus] ?? item.status).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        <ul className="space-y-2 text-sm">
          {dashboard.configuration.map((row) => (
            <li key={row.source}>
              {row.source}: {row.configured ? "configurado" : "não configurado"}
              {row.enabled ? "" : " · desligado"}
            </li>
          ))}
          <li className="text-muted-foreground">{LIKELY_REVIEW_COPY} permanece como revisão humana. Segredos não são exibidos.</li>
        </ul>
      ) : null}
    </div>
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
