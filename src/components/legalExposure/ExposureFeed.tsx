/**
 * Abas de leitura do Exposure (Ação Requerida, Comunicações, Linha do Tempo,
 * Certidões, Fontes). Mesmo cartão executivo da lista de processos: o que é,
 * de qual processo/empresa, quando e o que fazer. Sem código bruto na tela.
 */

import React from "react";
import {
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
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
  ALERT_STATUS_LABELS,
  CERTIFICATE_RESULT_LABELS,
  CERTIFICATE_TYPE_LABELS,
  COMMUNICATION_STATUS_LABELS,
  SEVERITY_LABELS,
  SOURCE_STATUS_HINTS,
  communicationTypeLabel,
} from "@/src/lib/legalExposure/legalExposureFeedUi";
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
};

export type ExposureSourceItem = {
  source: string;
  label: string;
  status: LegalSourceConnectionStatus;
  statusLabel: string;
  lastSuccessfulAt: string | null;
  lastAttemptAt?: string | null;
  healthy: boolean;
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

export function ExposureAlertsTab({
  alerts,
  canManage,
  busy,
  onOpenCase,
  onAcknowledge,
  onResolve,
}: {
  alerts: ExposureAlertItem[] | null;
  canManage: boolean;
  busy: boolean;
  onOpenCase: (caseId: string) => void;
  onAcknowledge: (alertId: string) => void;
  onResolve: (alertId: string) => void;
}) {
  const items = (alerts ?? []).filter((item) => item.requiresAction);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cada item abaixo pede uma providência humana. Dar ciência aqui não substitui a ciência no portal oficial.
      </p>
      {alerts && items.length === 0 ? <EmptyState text="Nenhuma ação requerida em aberto." /> : null}
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-border bg-card p-4" data-testid="exposure-alert">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Chip className={SEVERITY_CLASS[item.severity]}>{SEVERITY_LABELS[item.severity]}</Chip>
              <Chip>{ALERT_STATUS_LABELS[item.status]}</Chip>
              {item.source ? <Chip>{sourceLabel(item.source)}</Chip> : null}
            </div>
            <p className="text-xs text-muted-foreground">Detectado em {formatExposureDateTime(item.createdAt) ?? "—"}</p>
          </div>
          <h3 className="mt-2 text-base font-semibold">{item.title}</h3>
          <p className="text-sm text-muted-foreground">{item.summary}</p>
          {item.detail ? <p className="mt-1 text-sm">{item.detail}</p> : null}
          <div className="mt-3 border-t border-border pt-3">
            <ReferenceLine reference={item.reference} onOpenCase={onOpenCase} />
          </div>
          {canManage ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {item.status === "OPEN" ? (
                <button type="button" disabled={busy} className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-60" onClick={() => onAcknowledge(item.id)}>
                  Marcar como ciente
                </button>
              ) : null}
              <button type="button" disabled={busy} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" onClick={() => onResolve(item.id)}>
                Marcar como resolvido
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Comunicações */

export function ExposureCommunicationsTab({ communications, onOpenCase }: { communications: ExposureCommunicationItem[] | null; onOpenCase: (caseId: string) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Citações, intimações e demais comunicações oficiais detectadas. A ciência válida é a registrada no portal oficial.
      </p>
      {communications && communications.length === 0 ? <EmptyState text="Nenhuma comunicação detectada nas fontes consultadas." /> : null}
      {(communications ?? []).map((item) => (
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
      ))}
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
        {AT_KIND_LABELS[item.atKind]} {formatExposureDateTime(item.at) ?? item.at}
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
        {timeline && timeline.length === 0 ? <EmptyState text="Nenhuma movimentação ou comunicação registrada para este processo." /> : null}
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
}: {
  certificates: ExposureCertificateItem[] | null;
  entities: Array<{ id: string; legalName: string; cnpj: string }>;
}) {
  const entityName = (id: string) => entities.find((entity) => entity.id === id)?.legalName ?? "Empresa não identificada";
  const resultClass = (result: LegalCertificateResult) =>
    result === "NEGATIVE"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : result === "POSITIVE"
        ? "border-red-200 bg-red-50 text-red-800"
        : result === "POSITIVE_WITH_EFFECTS_OF_NEGATIVE"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-slate-200 bg-slate-50 text-slate-700";
  const expired = (validUntil: string | null) => Boolean(validUntil && Date.parse(validUntil) < Date.now());
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{CNDT_DOES_NOT_MEAN_NO_CASES_COPY}</p>
      {certificates && certificates.length === 0 ? <EmptyState text="Nenhuma certidão registrada. Registre a certidão emitida no portal do tribunal para acompanhar a validade." /> : null}
      {(certificates ?? []).map((item) => (
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
            <Fact label="Código de verificação" value={item.verificationCode ?? "não informado"} />
          </div>
          {item.notes ? <p className="mt-2 text-sm text-muted-foreground">{item.notes}</p> : null}
        </article>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Fontes */

export function ExposureSourcesTab({ sources }: { sources: ExposureSourceItem[] }) {
  const tone = (status: LegalSourceConnectionStatus) =>
    status === "HEALTHY"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : status === "NOT_CONFIGURED" || status === "DISABLED"
        ? "border-slate-200 bg-slate-50 text-slate-600"
        : "border-amber-200 bg-amber-50 text-amber-900";
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Situação de cada fonte consultada. Uma fonte parada ou desatualizada não sustenta ausência de exposição.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {sources.map((source) => (
          <article key={source.source} className="rounded-xl border border-border bg-card p-4" data-testid="exposure-source">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-base font-semibold">{source.label}</h3>
              <Chip className={tone(source.status)}>{source.statusLabel}</Chip>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{SOURCE_STATUS_HINTS[source.status]}</p>
            <div className="mt-3 space-y-1">
              <Fact label="Última consulta com sucesso" value={formatExposureDateTime(source.lastSuccessfulAt) ?? "nunca"} />
              <Fact label="Última tentativa" value={formatExposureDateTime(source.lastAttemptAt ?? null) ?? "nunca"} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
