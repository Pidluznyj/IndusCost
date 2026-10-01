/**
 * Abas de leitura do Exposure (Ação Requerida, Comunicações, Linha do Tempo,
 * Certidões, Fontes). Mesmo cartão executivo da lista de processos: o que é,
 * de qual processo/empresa, quando e o que fazer. Sem código bruto na tela.
 */

import React, { useState } from "react";
import {
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  EXPOSURE_LOADING_COPY,
  NO_ACTION_REQUIRED_COPY,
  NO_CERTIFICATES_COPY,
  NO_COMMUNICATIONS_FILTER_COPY,
  NO_TIMELINE_EVENTS_COPY,
  OFFICIAL_COMMUNICATIONS_PORTAL_URL,
  SOURCE_LABELS,
  type LegalCertificateResult,
  type LegalCertificateType,
  type LegalCommunicationNormalizedStatus,
  type LegalExposureAlertStatus,
  type LegalExposureSeverity,
  type LegalExposureSource,
  type LegalSourceConnectionStatus,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  CERTIFICATE_RESULT_LABELS,
  CERTIFICATE_TYPE_LABELS,
  COMMUNICATION_STATUS_LABELS,
  SEVERITY_LABELS,
  SOURCE_STATUS_HINTS,
  communicationTypeLabel,
} from "@/src/lib/legalExposure/legalExposureFeedUi";
import { alertActionLabel, alertChannelOf, inboxMatchesFilter } from "@/src/lib/legalExposure/legalExposureInbox";
import { casePoleLabel, caseStatusLabel, formatExposureDate, formatExposureDateTime } from "@/src/lib/legalExposure/legalExposureCaseListUi";

export type ExposureFeedReference = {
  caseId: string | null;
  processNumber: string | null;
  tribunal: string | null;
  courtUnit: string | null;
  entity: { id: string; legalName: string; displayCnpj: string } | null;
};

export type ExposureAlertItem = {
  id: string;
  severity: LegalExposureSeverity;
  status: LegalExposureAlertStatus;
  requiresAction: boolean;
  title: string;
  summary: string;
  createdAt: string;
  eventType: string | null;
  source: LegalExposureSource | null;
  detail: string | null;
  reference: ExposureFeedReference;
};

export type ExposureCommunicationItem = {
  id: string;
  caseId: string | null;
  source: LegalExposureSource;
  processNumber: string | null;
  communicationType: string;
  subject: string | null;
  sourceStatus: string;
  normalizedStatus: LegalCommunicationNormalizedStatus;
  availableAt: string | null;
  detectedAt: string;
  tribunal: string | null;
  courtUnit: string | null;
  scienceDeadlineAt: string | null;
  reference: ExposureFeedReference;
};

export type ExposureEventItem = {
  id: string;
  caseId: string | null;
  source: LegalExposureSource | null;
  eventType: string;
  severity: LegalExposureSeverity;
  detectedAt: string;
  title: string;
  detail: string | null;
  reference: ExposureFeedReference;
};

export type ExposureTimelineItem = {
  kind: "movement" | "communication" | "event";
  at: string;
  atKind: "OCCURRED" | "AVAILABLE" | "DETECTED";
  title: string;
  detail: string | null;
  source: string | null;
  status: string | null;
};

export type ExposureTimelineCase = {
  id: string;
  processNumber: string;
  tribunal: string | null;
  courtUnit: string | null;
  className: string | null;
  currentStatus: string | null;
  entityPole: string;
  entity: { id: string; legalName: string; displayCnpj: string } | null;
};

export type ExposureCertificateItem = {
  id: string;
  entityId: string;
  type: LegalCertificateType;
  tribunal: string | null;
  issuedAt: string | null;
  validUntil: string | null;
  result: LegalCertificateResult;
  verificationCode: string | null;
  originalFileName: string | null;
  notes: string | null;
  registeredByUserId?: string | null;
  createdAt?: string;
};

export type ExposureSourceItem = {
  source: string;
  label: string;
  status: LegalSourceConnectionStatus;
  statusLabel: string;
  lastSuccessfulAt: string | null;
  lastAttemptAt?: string | null;
  lastErrorCode?: string | null;
  enabled?: boolean;
  healthy: boolean;
};

export type ExposureCommunicationFilters = {
  entityId: string;
  q: string;
  communicationType: string;
  status: string;
  tribunal: string;
  source: string;
};

export const EMPTY_COMMUNICATION_FILTERS: ExposureCommunicationFilters = {
  entityId: "",
  q: "",
  communicationType: "",
  status: "",
  tribunal: "",
  source: "",
};

const SEVERITY_CLASS: Record<LegalExposureSeverity, string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-800",
  HIGH: "border-amber-200 bg-amber-50 text-amber-900",
  MEDIUM: "border-yellow-200 bg-yellow-50 text-yellow-900",
  LOW: "border-slate-200 bg-slate-50 text-slate-700",
  INFO: "border-slate-200 bg-slate-50 text-slate-700",
};

const COMM_STATUS_CLASS: Record<LegalCommunicationNormalizedStatus, string> = {
  PENDING: "border-amber-200 bg-amber-50 text-amber-900",
  ACKNOWLEDGED: "border-emerald-200 bg-emerald-50 text-emerald-800",
  EXPIRED: "border-red-200 bg-red-50 text-red-800",
  CANCELED: "border-slate-200 bg-slate-50 text-slate-600",
  UNKNOWN: "border-slate-200 bg-slate-50 text-slate-600",
};

const KIND_LABELS: Record<ExposureTimelineItem["kind"], string> = {
  movement: "Movimentação",
  communication: "Comunicação",
  event: "Registro do IndusCost",
};

const AT_KIND_LABELS: Record<ExposureTimelineItem["atKind"], string> = {
  OCCURRED: "ocorrida em",
  AVAILABLE: "disponibilizada em",
  DETECTED: "detectada pelo IndusCost em",
};

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${className ?? "border-slate-200 bg-slate-50 text-slate-700"}`}>{children}</span>;
}

function sourceLabel(source: string | null | undefined): string {
  return (source && SOURCE_LABELS[source as LegalExposureSource]) || source || "registro interno";
}

/** Linha "processo · empresa · tribunal" que identifica de que se trata. */
function ReferenceLine({ reference, onOpenCase }: { reference: ExposureFeedReference; onOpenCase?: (caseId: string) => void }) {
  const jurisdiction = [reference.tribunal, reference.courtUnit].filter(Boolean).join(" · ");
  return (
    <div className="space-y-0.5">
      <p className="font-semibold tracking-tight">
        {reference.processNumber ?? "Sem número de processo vinculado"}
        {reference.caseId && onOpenCase ? (
          <button type="button" className="ml-2 text-sm font-semibold underline" onClick={() => onOpenCase(reference.caseId!)}>
            Ver processo
          </button>
        ) : null}
      </p>
      {reference.entity ? (
        <p className="text-sm">
          {reference.entity.legalName} <span className="text-xs text-muted-foreground">CNPJ {reference.entity.displayCnpj}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Empresa não identificada</p>
      )}
      {jurisdiction ? <p className="text-xs text-muted-foreground">{jurisdiction}</p> : null}
    </div>
  );
}

function Fact({ label, value, muted = false }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <p className={`text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span className="text-muted-foreground">{label}: </span>
      {value}
    </p>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">{text}</p>;
}

/* ---------------------------------------------------------------- Ação requerida */

const INBOX_FILTERS = [
  ["all", "Todas"],
  ["critical", "Críticas"],
  ["legal", "Jurídicas"],
  ["data", "Dados incompletos"],
  ["technical", "Integração/fontes"],
  ["acknowledged", "Reconhecidas"],
] as const;

const SEVERITY_BAR: Record<LegalExposureSeverity, string> = {
  CRITICAL: "bg-red-700",
  HIGH: "bg-amber-600",
  MEDIUM: "bg-yellow-500",
  LOW: "bg-slate-400",
  INFO: "bg-slate-300",
};

export function ExposureAlertsTab({
  alerts,
  canManage,
  busy,
  busyId,
  loading,
  error,
  onOpenCase,
  onAcknowledge,
  onResolve,
}: {
  alerts: ExposureAlertItem[] | null;
  canManage: boolean;
  busy: boolean;
  busyId?: string | null;
  loading?: boolean;
  error?: string | null;
  onOpenCase: (caseId: string) => void;
  onAcknowledge: (alertId: string) => void;
  onResolve: (alertId: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof INBOX_FILTERS)[number][0]>("all");
  const items = (alerts ?? []).filter((item) => {
    const channel = alertChannelOf(item.eventType);
    if (filter === "all") return item.status !== "RESOLVED";
    return inboxMatchesFilter(filter, { channel, severity: item.severity, status: item.status });
  });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Ação requerida</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Caixa de entrada. Dar ciência aqui não substitui a ciência no portal oficial.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {INBOX_FILTERS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={`rounded-full border px-3 py-1 text-sm ${filter === id ? "border-slate-900 bg-slate-900 text-white" : "border-border bg-card"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">{EXPOSURE_LOADING_COPY}</p> : null}
      {!loading && alerts && items.length === 0 ? <EmptyState text={NO_ACTION_REQUIRED_COPY} /> : null}
      {!loading
        ? items.map((item) => {
            const channel = alertChannelOf(item.eventType);
            return (
              <article
                key={item.id}
                className="overflow-hidden rounded-2xl border border-border bg-card"
                data-testid="exposure-alert"
                data-alert-channel={channel}
              >
                <div className="flex">
                  <span className={`w-1.5 shrink-0 ${SEVERITY_BAR[item.severity]}`} aria-hidden="true" />
                  <div className="flex-1 p-4">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {channel === "TECHNICAL" ? "Integração / fonte" : channel === "DATA" ? "Dados incompletos" : "Ação jurídica"}
                      {" · "}
                      {SEVERITY_LABELS[item.severity]}
                    </p>
                    <p className="mt-1 text-base font-semibold">{alertActionLabel({ eventType: item.eventType, title: item.title })}</p>
                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-muted-foreground">Processo</dt>
                        <dd className="font-medium">{item.reference.processNumber ?? "Não vinculado"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Empresa</dt>
                        <dd className="font-medium">{item.reference.entity?.legalName ?? "Empresa do grupo"}</dd>
                      </div>
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Por que</dt>
                        <dd>{item.summary}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Quando</dt>
                        <dd>{formatExposureDateTime(item.createdAt) ?? "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Fonte</dt>
                        <dd>{sourceLabel(item.source)}</dd>
                      </div>
                    </dl>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.reference.caseId ? (
                        <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold" onClick={() => onOpenCase(item.reference.caseId!)}>
                          Ver processo
                        </button>
                      ) : null}
                      {canManage && item.status === "OPEN" ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-60"
                          onClick={() => onAcknowledge(item.id)}
                        >
                          {busyId === item.id && busy ? "Reconhecendo..." : "Reconhecer"}
                        </button>
                      ) : null}
                      {canManage && item.status !== "RESOLVED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                          onClick={() => onResolve(item.id)}
                        >
                          {busyId === item.id && busy ? "Resolvendo..." : "Resolver"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })
        : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Comunicações */

export function ExposureCommunicationsTab({
  communications,
  entities,
  filters,
  loading,
  error,
  onFilterChange,
  onOpenCase,
}: {
  communications: ExposureCommunicationItem[] | null;
  entities: Array<{ id: string; legalName: string }>;
  filters: ExposureCommunicationFilters;
  loading?: boolean;
  error?: string | null;
  onFilterChange: (patch: Partial<ExposureCommunicationFilters>) => void;
  onOpenCase: (caseId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Citações, intimações e demais comunicações oficiais detectadas. A ciência válida é a registrada no portal oficial.
      </p>
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-3">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Empresa
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={filters.entityId}
            onChange={(event) => onFilterChange({ entityId: event.target.value })}
          >
            <option value="">Todas</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.legalName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          CNJ
          <input
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={filters.q}
            onChange={(event) => onFilterChange({ q: event.target.value })}
          />
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Tipo
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={filters.communicationType}
            onChange={(event) => onFilterChange({ communicationType: event.target.value })}
          >
            <option value="">Todos</option>
            <option value="CITATION">Citação</option>
            <option value="INTIMATION">Intimação</option>
            <option value="HEARING">Audiência</option>
            <option value="DECISION">Decisão</option>
            <option value="OTHER">Outra</option>
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Status
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={filters.status}
            onChange={(event) => onFilterChange({ status: event.target.value })}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendente de ciência</option>
            <option value="ACKNOWLEDGED">Ciência registrada</option>
            <option value="EXPIRED">Prazo expirado</option>
            <option value="CANCELED">Cancelada</option>
          </select>
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Tribunal
          <input
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={filters.tribunal}
            onChange={(event) => onFilterChange({ tribunal: event.target.value })}
          />
        </label>
        <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Fonte
          <select
            className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            value={filters.source}
            onChange={(event) => onFilterChange({ source: event.target.value })}
          >
            <option value="">Todas</option>
            <option value="DJEN">DJEN</option>
            <option value="DOMICILIO">Domicílio</option>
            <option value="DATAJUD">DataJud</option>
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">{EXPOSURE_LOADING_COPY}</p> : null}
      {!loading && communications && communications.length === 0 ? <EmptyState text={NO_COMMUNICATIONS_FILTER_COPY} /> : null}
      {!loading
        ? (communications ?? []).map((item) => (
        <article key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid="exposure-communication">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip className="border-slate-900 bg-slate-900 text-white">{communicationTypeLabel(item.communicationType)}</Chip>
              <Chip className={COMM_STATUS_CLASS[item.normalizedStatus]}>{COMMUNICATION_STATUS_LABELS[item.normalizedStatus]}</Chip>
              <Chip>{sourceLabel(item.source)}</Chip>
            </div>
            <p className="text-xs text-muted-foreground">Detectada em {formatExposureDateTime(item.detectedAt) ?? "—"}</p>
          </div>
          {item.subject ? <h3 className="mt-2 text-base font-semibold">{item.subject}</h3> : null}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <ReferenceLine reference={item.reference} onOpenCase={onOpenCase} />
            <div className="space-y-1">
              <Fact label="Órgão" value={[item.tribunal, item.courtUnit].filter(Boolean).join(" · ") || "não informado"} />
              <Fact label="Disponibilizada pela fonte" value={formatExposureDateTime(item.availableAt) ?? "não informada pela fonte"} />
              <Fact label="Prazo de ciência" value={formatExposureDateTime(item.scienceDeadlineAt) ?? "não informado pela fonte"} />
              <Fact label="Situação na fonte" value={item.sourceStatus || "não informada"} muted />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 border-t border-border pt-3">
            <a className="text-sm font-semibold underline" href={OFFICIAL_COMMUNICATIONS_PORTAL_URL} target="_blank" rel="noreferrer">
              Abrir portal oficial para dar ciência
            </a>
          </div>
        </article>
          ))
        : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Linha do tempo */

const TimelineEntry: React.FC<{ item: ExposureTimelineItem }> = ({ item }) => {
  const status = item.status ? COMMUNICATION_STATUS_LABELS[item.status as LegalCommunicationNormalizedStatus] ?? item.status : null;
  return (
    <li className="relative pl-6" data-testid="exposure-timeline-item">
      <span className={`absolute left-0 top-1.5 h-3 w-3 rounded-full border-2 border-card ${item.kind === "movement" ? "bg-slate-900" : item.kind === "communication" ? "bg-amber-500" : "bg-slate-300"}`} aria-hidden="true" />
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold uppercase tracking-wide text-slate-600">{KIND_LABELS[item.kind]}</span>
        {" · "}
        {AT_KIND_LABELS[item.atKind]} {formatExposureDateTime(item.at) ?? "data não informada"}
        {" · "}
        {sourceLabel(item.source)}
      </p>
      <p className="text-sm font-medium">{item.title}</p>
      {item.detail ? <p className="text-sm text-muted-foreground">{item.detail}</p> : null}
      {status ? <p className="text-xs text-muted-foreground">{status}</p> : null}
    </li>
  );
};

export function ExposureTimelineTab({
  legalCase,
  timeline,
  feed,
  onOpenCase,
  onClearCase,
}: {
  legalCase: ExposureTimelineCase | null;
  timeline: ExposureTimelineItem[] | null;
  feed: ExposureEventItem[] | null;
  onOpenCase: (caseId: string) => void;
  onClearCase: () => void;
}) {
  if (legalCase) {
    const jurisdiction = [legalCase.tribunal, legalCase.courtUnit].filter(Boolean).join(" · ");
    return (
      <div className="space-y-3">
        <section className="rounded-xl border border-border bg-card p-4" data-testid="exposure-timeline-case">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Linha do tempo do processo</p>
              <p className="text-lg font-semibold tracking-tight">{legalCase.processNumber}</p>
              {legalCase.entity ? (
                <p className="text-sm">
                  {legalCase.entity.legalName} <span className="text-xs text-muted-foreground">CNPJ {legalCase.entity.displayCnpj}</span>
                </p>
              ) : null}
            </div>
            <button type="button" className="text-sm font-semibold underline" onClick={onClearCase}>
              Ver todas as novidades
            </button>
          </div>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
            <Fact label="Tribunal / vara" value={jurisdiction || "não informados"} />
            <Fact label="Classe" value={legalCase.className ?? "não informada pela fonte"} />
            <Fact label="Polo" value={casePoleLabel(legalCase.entityPole)} />
            <Fact label="Situação" value={caseStatusLabel(legalCase.currentStatus)} />
          </div>
        </section>
        {timeline && timeline.length === 0 ? <EmptyState text={NO_TIMELINE_EVENTS_COPY} /> : null}
        {timeline && timeline.length > 0 ? (
          <ol className="space-y-4 border-l border-border pl-3">
            {timeline.map((item, index) => (
              <TimelineEntry key={`${item.kind}-${item.at}-${index}`} item={item} />
            ))}
          </ol>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Novidades detectadas pelo IndusCost em todas as empresas, da mais recente para a mais antiga. Abra um processo para ver só a linha do tempo dele.
      </p>
      {feed && feed.length === 0 ? <EmptyState text="Nenhuma novidade registrada." /> : null}
      {(feed ?? []).map((item) => (
        <article key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid="exposure-event">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip className="border-slate-900 bg-slate-900 text-white">{item.title}</Chip>
              {item.severity !== "INFO" && item.severity !== "LOW" ? <Chip className={SEVERITY_CLASS[item.severity]}>{SEVERITY_LABELS[item.severity]}</Chip> : null}
              <Chip>{sourceLabel(item.source)}</Chip>
            </div>
            <p className="text-xs text-muted-foreground">Detectado em {formatExposureDateTime(item.detectedAt) ?? "—"}</p>
          </div>
          {item.detail ? <p className="mt-2 text-sm font-medium">{item.detail}</p> : null}
          <div className="mt-3 border-t border-border pt-3">
            <ReferenceLine reference={item.reference} onOpenCase={onOpenCase} />
          </div>
        </article>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Certidões */

export function ExposureCertificatesTab({
  certificates,
  entities,
  note,
  loading,
  error,
  canManage,
  onRegister,
}: {
  certificates: ExposureCertificateItem[] | null;
  entities: Array<{ id: string; legalName: string; cnpj: string }>;
  note: string;
  loading?: boolean;
  error?: string | null;
  canManage: boolean;
  onRegister: (body: {
    entityId: string;
    type: LegalCertificateType;
    result: LegalCertificateResult;
    tribunal: string;
    notes: string;
    issuedAt: string;
    validUntil: string;
    originalFileName: string | null;
    contentBase64: string | null;
  }) => Promise<void>;
}) {
  const [entityFilter, setEntityFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [type, setType] = useState<LegalCertificateType>("CNDT");
  const [result, setResult] = useState<LegalCertificateResult>("NEGATIVE");
  const [tribunal, setTribunal] = useState("");
  const [notes, setNotes] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const entityName = (id: string) => entities.find((entity) => entity.id === id)?.legalName ?? "Empresa não identificada";
  const resultClass = (value: LegalCertificateResult) =>
    value === "NEGATIVE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : value === "POSITIVE"
        ? "border-red-200 bg-red-50 text-red-800"
        : value === "POSITIVE_WITH_EFFECTS_OF_NEGATIVE"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-700";
  const expired = (value: string | null) => Boolean(value && Date.parse(value) < Date.now());
  const rows = (certificates ?? []).filter((row) => {
    if (entityFilter && row.entityId !== entityFilter) return false;
    if (typeFilter && row.type !== typeFilter) return false;
    if (resultFilter && row.result !== resultFilter) return false;
    return true;
  });
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{note || CNDT_DOES_NOT_MEAN_NO_CASES_COPY}</p>
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-3">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Empresa
          <select className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm" value={entityFilter} onChange={(event) => setEntityFilter(event.target.value)}>
            <option value="">Todas</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>{entity.legalName}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Tipo
          <select className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">Todos</option>
            <option value="CNDT">CNDT</option>
            <option value="TRT_LABOR_CASES">Certidão TRT</option>
            <option value="OTHER">Outra</option>
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Resultado
          <select className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm" value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
            <option value="">Todos</option>
            <option value="NEGATIVE">Negativa</option>
            <option value="POSITIVE">Positiva</option>
            <option value="POSITIVE_WITH_EFFECTS_OF_NEGATIVE">Positiva com efeitos de negativa</option>
            <option value="UNKNOWN">Não informado</option>
          </select>
        </label>
      </div>
      {canManage ? (
        <button type="button" className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => setOpen(true)}>
          + Registrar certidão
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">{EXPOSURE_LOADING_COPY}</p> : null}
      {!loading && certificates && rows.length === 0 ? <EmptyState text={NO_CERTIFICATES_COPY} /> : null}
      {!loading
        ? rows.map((item) => (
            <article key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid="exposure-certificate">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip className={resultClass(item.result)}>{CERTIFICATE_RESULT_LABELS[item.result]}</Chip>
                  {expired(item.validUntil) ? <Chip className="border-red-200 bg-red-50 text-red-800">Validade vencida</Chip> : null}
                </div>
                <p className="text-xs text-muted-foreground">Emitida em {formatExposureDate(item.issuedAt) ?? "data não informada"}</p>
              </div>
              <h3 className="mt-2 text-base font-semibold">{CERTIFICATE_TYPE_LABELS[item.type]}</h3>
              <p className="text-sm">{entityName(item.entityId)}</p>
              <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                <Fact label="Válida até" value={formatExposureDate(item.validUntil) ?? "não informada"} />
                <Fact label="Tribunal" value={item.tribunal ?? "não informado"} />
                <Fact label="Arquivo" value={item.originalFileName ?? "não anexado"} />
                <Fact label="Registrado por" value={item.registeredByUserId ?? "não informado"} />
                <Fact label="Cadastro" value={formatExposureDateTime(item.createdAt ?? null) ?? "não informado"} />
                <Fact label="Código de verificação" value={item.verificationCode ?? "não informado"} />
              </div>
              {item.type === "CNDT" && item.result === "NEGATIVE" ? (
                <p className="mt-2 text-xs text-muted-foreground">{CNDT_DOES_NOT_MEAN_NO_CASES_COPY}</p>
              ) : null}
              {item.notes ? <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p> : null}
            </article>
          ))
        : null}
      {open ? (
        <form
          className="space-y-2 rounded-xl border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!entityId) return;
            setSaving(true);
            void onRegister({
              entityId,
              type,
              result,
              tribunal,
              notes,
              issuedAt,
              validUntil,
              originalFileName: fileName,
              contentBase64: fileBase64,
            }).finally(() => {
              setSaving(false);
              setOpen(false);
            });
          }}
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Empresa
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={entityId} onChange={(event) => setEntityId(event.target.value)}>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>{entity.legalName}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tipo
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={type} onChange={(event) => setType(event.target.value as LegalCertificateType)}>
              <option value="CNDT">CNDT</option>
              <option value="TRT_LABOR_CASES">Certidão TRT</option>
              <option value="OTHER">Outra</option>
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Resultado
            <select className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={result} onChange={(event) => setResult(event.target.value as LegalCertificateResult)}>
              <option value="NEGATIVE">Negativa</option>
              <option value="POSITIVE">Positiva</option>
              <option value="POSITIVE_WITH_EFFECTS_OF_NEGATIVE">Positiva com efeitos de negativa</option>
              <option value="UNKNOWN">Desconhecido</option>
            </select>
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Tribunal
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={tribunal} onChange={(event) => setTribunal(event.target.value)} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Emissão
            <input type="date" className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Validade
            <input type="date" className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Arquivo
            <input
              type="file"
              className="mt-1 block w-full text-sm font-normal normal-case"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  setFileName(null);
                  setFileBase64(null);
                  return;
                }
                setFileName(file.name);
                const reader = new FileReader();
                reader.onload = () => {
                  const value = String(reader.result ?? "");
                  const base64 = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
                  setFileBase64(base64);
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Observações
            <input className="mt-1 w-full rounded border px-2 py-1 text-sm font-normal normal-case" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="rounded-lg bg-slate-900 px-3 py-1.5 text-white" disabled={saving || !entityId}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
            <button type="button" className="underline" onClick={() => setOpen(false)}>Cancelar</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Fontes */

export type ExposureSourceOperationItem = {
  source: string;
  label: string;
  description: string;
  readiness: string;
  configured: boolean;
  enabled: boolean;
  missingEnvVars: string[];
  hint: string;
  running: boolean;
  interrupted: boolean;
  lastRun: {
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    outcome: string | null;
    processesFound: number | null;
    processesRequested: number | null;
    communicationsReceived?: number | null;
    entitiesProcessed?: number | null;
    sanitizedError: string | null;
    trigger: string | null;
  } | null;
  nextScheduledAt: string | null;
  frequencyLabel: string;
  times: string[];
  coverage: {
    claimantPct: number | null;
    polePct: number | null;
    claimValuePct: number | null;
    movementsPct: number | null;
    processCount: number;
  } | null;
};

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes <= 0) return `${seconds} s`;
  return `${minutes} min ${seconds} s`;
}

function readinessLabel(value: string): string {
  if (value === "READY") return "Pronta";
  if (value === "NEEDS_CREDENTIAL") return "Requer credencial";
  if (value === "DISABLED_BY_POLICY") return "Desligada por política";
  if (value === "NOT_IMPLEMENTED") return "Não implementada";
  return "Erro de configuração";
}

export function ExposureSourcesTab({
  sources,
  operations,
  loading,
  error,
  onRun,
  onHistory,
  runBusy,
  runResult,
  historySource,
  historyRows,
}: {
  sources: ExposureSourceItem[];
  operations?: ExposureSourceOperationItem[];
  loading?: boolean;
  error?: string | null;
  onRun: (source: string) => void;
  onHistory?: (source: string) => void;
  runBusy?: string | null;
  runResult?: { source: string; message: string } | null;
  historySource?: string | null;
  historyRows?: Array<{
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    outcome: string | null;
    trigger: string | null;
    processesFound: number | null;
    sanitizedError: string | null;
  }>;
}) {
  const cards = operations && operations.length > 0
    ? operations
    : sources.map((source) => ({
        source: source.source,
        label: source.label,
        description: "",
        readiness: source.enabled === false ? "DISABLED_BY_POLICY" : source.configured === false ? "NEEDS_CREDENTIAL" : "READY",
        configured: source.enabled !== false,
        enabled: source.enabled !== false,
        missingEnvVars: [],
        hint: SOURCE_STATUS_HINTS[source.status],
        running: false,
        interrupted: false,
        lastRun: {
          startedAt: source.lastAttemptAt ?? null,
          finishedAt: source.lastSuccessfulAt,
          durationMs: null,
          outcome: source.status,
          processesFound: null,
          processesRequested: null,
          communicationsReceived: null,
          entitiesProcessed: null,
          sanitizedError: source.lastErrorCode,
          trigger: null,
        },
        nextScheduledAt: null,
        frequencyLabel: "—",
        times: [],
        coverage: null,
      }));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Central de integrações. Saúde lida das últimas execuções e da agenda — sem consultar as fontes só para mostrar status.
      </p>
      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">{EXPOSURE_LOADING_COPY}</p> : null}
      <div className="grid gap-3 lg:grid-cols-2">
        {cards.map((source) => {
          const running = source.running;
          const statusText = running
            ? "Em execução"
            : source.interrupted
              ? "Execução interrompida ou sem finalização"
              : readinessLabel(source.readiness);
          const tone = running
            ? "border-sky-200 bg-sky-50 text-sky-900"
            : source.readiness === "READY" && source.enabled
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-slate-50 text-slate-700";
          return (
            <article key={source.source} className="rounded-xl border border-border bg-card p-4" data-testid="exposure-source">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold">{source.label}</h3>
                  {source.description ? <p className="mt-1 text-sm text-muted-foreground">{source.description}</p> : null}
                </div>
                <Chip className={tone}>{running ? "● Em execução" : statusText}</Chip>
              </div>
              <div className="mt-3 space-y-1 text-sm">
                <Fact label="Configuração" value={source.enabled ? "Ativa" : source.readiness === "DISABLED_BY_POLICY" ? "Desligada por política" : source.configured ? "Configurada, desligada" : source.hint} />
                <Fact label="Última execução" value={formatExposureDateTime(source.lastRun?.startedAt ?? source.lastRun?.finishedAt ?? null) ?? "nunca"} />
                <Fact label="Duração" value={formatDuration(source.lastRun?.durationMs)} />
                {source.source === "DJEN" ? (
                  <>
                    <Fact label="Modo" value="Descoberta por nome da parte + atualização por CNJ" />
                    <Fact label="Empresas pesquisadas" value={source.lastRun?.entitiesProcessed != null ? String(source.lastRun.entitiesProcessed) : "—"} />
                    <Fact
                      label="Comunicações"
                      value={source.lastRun?.communicationsReceived != null ? String(source.lastRun.communicationsReceived) : "—"}
                    />
                    <Fact
                      label="CNJs únicos"
                      value={source.lastRun?.processesFound != null ? String(source.lastRun.processesFound) : "—"}
                    />
                  </>
                ) : null}
                <Fact
                  label="Resultado"
                  value={
                    source.lastRun?.processesFound != null
                      ? `${source.lastRun.processesFound} processos`
                      : source.lastRun?.outcome ?? "—"
                  }
                />
                <Fact label="Próxima execução" value={formatExposureDateTime(source.nextScheduledAt) ?? (source.times.length ? "calculando" : "Manual")} />
                <Fact label="Frequência" value={source.frequencyLabel} />
                {source.lastRun?.sanitizedError ? <Fact label="Último erro" value={source.lastRun.sanitizedError} /> : null}
                {source.missingEnvVars.length > 0 ? (
                  <Fact label="Falta" value={source.missingEnvVars.join(", ")} />
                ) : null}
                {source.coverage ? (
                  <p className="pt-1 text-xs text-muted-foreground">
                    Cobertura nos processos — reclamantes {source.coverage.claimantPct ?? "—"}% · polo {source.coverage.polePct ?? "—"}% · valor {source.coverage.claimValuePct ?? "—"}% · movimentações {source.coverage.movementsPct ?? "—"}%
                  </p>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  type="button"
                  className="text-sm font-semibold underline"
                  disabled={runBusy === source.source || running || source.readiness === "DISABLED_BY_POLICY"}
                  onClick={() => onRun(source.source)}
                >
                  {runBusy === source.source || running ? "Execução já em andamento" : "Executar agora"}
                </button>
                {onHistory ? (
                  <button type="button" className="text-sm font-semibold underline" onClick={() => onHistory(source.source)}>
                    Histórico
                  </button>
                ) : null}
              </div>
              {runResult?.source === source.source ? <p className="mt-1 text-xs text-muted-foreground">{runResult.message}</p> : null}
              {historySource === source.source && historyRows ? (
                <div className="mt-3 overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="bg-muted/40 text-left">
                        <th className="px-2 py-1">Início</th>
                        <th className="px-2 py-1">Fim</th>
                        <th className="px-2 py-1">Duração</th>
                        <th className="px-2 py-1">Resultado</th>
                        <th className="px-2 py-1">Trigger</th>
                        <th className="px-2 py-1">Processos</th>
                        <th className="px-2 py-1">Erro</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row, index) => (
                        <tr key={`${row.startedAt ?? "run"}-${index}`}>
                          <td className="px-2 py-1">{formatExposureDateTime(row.startedAt) ?? "—"}</td>
                          <td className="px-2 py-1">{formatExposureDateTime(row.finishedAt) ?? "—"}</td>
                          <td className="px-2 py-1">{formatDuration(row.durationMs)}</td>
                          <td className="px-2 py-1">{row.outcome ?? "—"}</td>
                          <td className="px-2 py-1">{row.trigger ?? "—"}</td>
                          <td className="px-2 py-1">{row.processesFound ?? "—"}</td>
                          <td className="px-2 py-1">{row.sanitizedError ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
