/**
 * Modal central do dossiê do processo. Sem drawer lateral.
 */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Calendar, FileText, Gavel, Scale, X } from "lucide-react";
import {
  CASE_CLAIM_VALUE_UNKNOWN_COPY,
  CASE_CLAIMANT_MISSING_COPY,
  CASE_HEARING_UNKNOWN_COPY,
  CASE_POLE_UNCONFIRMED_COPY,
  CASE_STAGE_UNKNOWN_COPY,
  COVERAGE_FIELD_LABELS,
  GROUP_ENTITY_BADGE_COPY,
  NO_TIMELINE_EVENTS_COPY,
  OFFICIAL_COMMUNICATIONS_PORTAL_URL,
  SOURCE_KIND_LABELS,
  SOURCE_LABELS,
  type ExposureCaseListItem,
  type ExposureTimelineItem,
  type LegalExposureSource,
  type LegalProcessEnrichmentStep,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  caseFiledAtLabel,
  caseMovementLabel,
  casePoleLabel,
  caseStatusLabel,
  caseVerificationLabel,
  formatExposureDateTime,
} from "@/src/lib/legalExposure/legalExposureCaseListUi";
import {
  COMMUNICATION_STATUS_LABELS,
  communicationTypeLabel,
  exposureTimelineKindLabel,
  movementComplementsText,
} from "@/src/lib/legalExposure/legalExposureFeedUi";
import { ExposureLitigationSides } from "./ExposureLitigationSides";

export type ExposureDossier = ExposureCaseListItem & {
  narrative?: string;
  groupNote?: string | null;
  parties?: {
    active: ExposureCaseListItem["claimants"];
    group?: ExposureCaseListItem["groupEntities"];
    passiveGroup: ExposureCaseListItem["groupEntities"];
    passiveOthers: ExposureCaseListItem["otherDefendants"];
    thirdParties?: ExposureCaseListItem["claimants"];
    attorneys: ExposureCaseListItem["attorneys"];
  };
  timeline?: ExposureTimelineItem[];
  communications?: Array<{
    id: string;
    communicationType: string;
    subject: string | null;
    tribunal: string | null;
    courtUnit: string | null;
    availableAt: string | null;
    detectedAt: string;
    normalizedStatus: string;
    sourceStatus: string;
    source: LegalExposureSource;
    caseId: string | null;
  }>;
  discovery?: { firstSeenAt: string; primarySource: LegalExposureSource; evidenceSources: LegalExposureSource[] };
  stageReason?: string;
};

type TabId = "resumo" | "partes" | "timeline" | "comunicacoes" | "fontes";

type Props = {
  dossier: ExposureDossier;
  refreshing?: boolean;
  completing?: boolean;
  completeSteps?: LegalProcessEnrichmentStep[];
  initialTab?: TabId;
  onClose: () => void;
  onRefresh: () => void;
  onCompleteData: () => void;
  onPdf: () => void;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "resumo", label: "Resumo" },
  { id: "partes", label: "Partes e representantes" },
  { id: "timeline", label: "Linha do tempo" },
  { id: "comunicacoes", label: "Comunicações" },
  { id: "fontes", label: "Fontes e evidências" },
];

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{value}</dd>
    </div>
  );
}

function timelineVisual(row: ExposureTimelineItem): { label: string; Icon: typeof FileText } {
  const title = `${row.kind} ${row.title}`.toLowerCase();
  if (row.kind === "hearing" || title.includes("audi")) return { label: "Audiência", Icon: Calendar };
  if (row.kind === "publication" || title.includes("public")) return { label: "Publicação", Icon: Bell };
  if (row.kind === "communication") return { label: "Comunicação", Icon: Bell };
  if (title.includes("distrib")) return { label: "Distribuição", Icon: FileText };
  if (title.includes("decis") || title.includes("senten") || title.includes("gavel")) return { label: "Decisão", Icon: Gavel };
  if (row.kind === "event") return { label: "Evento IndusCost", Icon: Scale };
  return { label: exposureTimelineKindLabel(row.kind, row.title), Icon: FileText };
}

function PartyCard(props: { name: string; meta: string; sources?: string[] }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <p className="font-semibold">{props.name}</p>
      {props.meta ? <p className="mt-1 text-sm text-muted-foreground">{props.meta}</p> : null}
      {props.sources && props.sources.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{props.sources.join(" · ")}</p>
      ) : null}
    </article>
  );
}

export function ExposureCaseDossier({
  dossier,
  refreshing,
  completing,
  completeSteps = [],
  initialTab = "resumo",
  onClose,
  onRefresh,
  onCompleteData,
  onPdf,
}: Props) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [timelineKind, setTimelineKind] = useState("all");
  const [openComplements, setOpenComplements] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timeline = (dossier.timeline ?? []).filter((row) => timelineKind === "all" || row.kind === timelineKind);
  const groupParties = dossier.parties?.group ?? dossier.groupEntities;
  const thirdParties = dossier.parties?.thirdParties ?? [];
  const incomplete = dossier.coverage?.coverageScore != null && dossier.coverage.coverageScore < 100;
  const mainSubject = dossier.subjects.find((row) => row.isMain)?.name ?? dossier.subjects[0]?.name ?? "não informado";

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const modal = (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]"
      data-testid="exposure-dossier-overlay"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="exposure-dossier-title"
        data-testid="exposure-case-dossier"
        className="flex h-[min(92vh,960px)] max-h-[92vh] w-[min(96vw,1440px)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-10 border-b border-border bg-background px-6 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Processo</p>
              <h2 id="exposure-dossier-title" className="mt-1 text-2xl font-semibold tracking-tight">
                {dossier.processNumber}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
                disabled={refreshing || completing}
                onClick={onCompleteData}
              >
                {completing ? "Consultando..." : "Completar dados"}
              </button>
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-sm"
                disabled={refreshing || completing}
                onClick={onRefresh}
              >
                {refreshing ? "Atualizando..." : "Atualizar dados"}
              </button>
              <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={onPdf}>
                Relatório PDF
              </button>
              <button
                ref={closeRef}
                type="button"
                aria-label="Fechar"
                className="rounded-lg border border-border p-1.5"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {[dossier.className, dossier.tribunal, dossier.courtUnit, dossier.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : dossier.stageLabel, dossier.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
              {caseVerificationLabel(dossier.verificationStatus)}
            </span>
            {dossier.secrecy ? (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs">Segredo de justiça</span>
            ) : null}
            {incomplete ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs">Dados incompletos</span>
            ) : null}
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-card px-5 py-4">
            <ExposureLitigationSides item={dossier} onCompleteData={onCompleteData} />
          </div>
          <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-transparent">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                  tab === item.id ? "border-slate-900 font-semibold text-foreground" : "border-transparent text-muted-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5">
          {tab === "resumo" ? (
            <div className="space-y-6">
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Situação processual</h3>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Fact label="Classe" value={dossier.className ?? "não informada"} />
                  <Fact label="Assunto principal" value={mainSubject} />
                  <Fact label="Tribunal" value={dossier.tribunal ?? "não informado"} />
                  <Fact label="Vara" value={dossier.courtUnit ?? "não informada"} />
                  <Fact label="Grau" value={dossier.degree ?? "não informado"} />
                  <Fact label="Sistema" value={dossier.systemName ?? "não informado"} />
                  <Fact label="Ajuizamento" value={caseFiledAtLabel(dossier.filedAt)} />
                  <Fact label="Status" value={caseStatusLabel(dossier.currentStatus)} />
                  <Fact label="Fase" value={dossier.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : dossier.stageLabel} />
                </dl>
              </section>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Exposição</h3>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Fact label="Valor da causa" value={dossier.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY} />
                  <Fact label="Quantidade de réus" value={groupParties.filter((row) => row.pole === "PASSIVE").length + (dossier.parties?.passiveOthers ?? dossier.otherDefendants).length} />
                </dl>
                <div className="mt-3 space-y-1 text-sm">
                  {groupParties.map((entity) => (
                    <p key={entity.id}>
                      {entity.legalName} · {entity.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(entity.pole)}
                      {entity.displayCnpj ? ` · ${entity.displayCnpj}` : ""}
                    </p>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Agora</h3>
                <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Fact label="Última movimentação" value={caseMovementLabel(dossier.latestMovement)} />
                  <Fact
                    label="Próxima audiência"
                    value={
                      dossier.nextHearing
                        ? `${formatExposureDateTime(dossier.nextHearing.scheduledAt) ?? "data não informada"} · ${dossier.nextHearing.type ?? "Audiência"}`
                        : CASE_HEARING_UNKNOWN_COPY
                    }
                  />
                  <Fact
                    label="Última publicação"
                    value={
                      dossier.latestPublication
                        ? `${dossier.latestPublication.type ?? "Publicação"} · ${formatExposureDateTime(dossier.latestPublication.availableAt) ?? "data não informada"}`
                        : "Publicação ainda não identificada"
                    }
                  />
                  <Fact label="Ações pendentes" value={`${dossier.openAlertCount} ação(ões) requerida(s)`} />
                </dl>
              </section>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Resumo executivo</h3>
                <p className="mt-2 max-w-4xl text-sm leading-6">
                  {dossier.narrative ?? "Resumo ainda não disponível a partir das fontes consultadas."}
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pontos de atenção</h3>
                {dossier.attentionLabels.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Nenhum ponto de atenção registrado.</p>
                ) : (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                    {dossier.attentionLabels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                )}
              </section>
              {dossier.coverage ? (
                <section data-testid="exposure-coverage-panel">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Cobertura dos dados</h3>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    {(Object.keys(COVERAGE_FIELD_LABELS) as Array<keyof typeof COVERAGE_FIELD_LABELS>).map((field) => (
                      <div key={field} className="flex justify-between gap-3 border-b border-border/60 py-1">
                        <dt className="text-muted-foreground">{COVERAGE_FIELD_LABELS[field]}</dt>
                        <dd className="text-right font-medium">
                          {dossier.coverage?.fieldDiagnoses?.[field]?.line ?? dossier.coverage?.fields[field]}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <button
                    type="button"
                    className="mt-3 text-sm font-semibold underline"
                    onClick={() => setTab("fontes")}
                  >
                    Ver diagnóstico das fontes
                  </button>
                </section>
              ) : null}
              {completeSteps.length > 0 ? (
                <section>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Consulta às fontes</h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {completeSteps.map((step) => (
                      <li key={step.source}>
                        {SOURCE_KIND_LABELS[step.source] ?? SOURCE_LABELS[step.source]} · {step.outcome}
                        {step.publicUrl ? (
                          <>
                            {" "}
                            ·{" "}
                            <a className="underline" href={step.publicUrl} target="_blank" rel="noreferrer">
                              consulta oficial
                            </a>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "partes" ? (
            <div className="grid gap-6 md:grid-cols-2">
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Polo ativo</h3>
                <div className="mt-3 space-y-3">
                  {(dossier.parties?.active ?? dossier.claimants).map((row) => (
                    <PartyCard
                      key={row.name}
                      name={row.name}
                      meta={[row.partyType, row.documentMasked].filter(Boolean).join(" · ")}
                      sources={row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source])}
                    />
                  ))}
                  {(dossier.parties?.active ?? dossier.claimants).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {dossier.coverage?.fieldDiagnoses?.claimant.line ?? CASE_CLAIMANT_MISSING_COPY}{" "}
                      <button type="button" className="font-semibold underline" onClick={onCompleteData}>
                        Completar dados
                      </button>
                    </p>
                  ) : null}
                </div>
              </section>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Polo passivo</h3>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresas do grupo</p>
                <div className="mt-2 space-y-3">
                  {groupParties.map((row) => (
                    <PartyCard
                      key={row.id}
                      name={row.legalName}
                      meta={`${GROUP_ENTITY_BADGE_COPY} · CNPJ ${row.displayCnpj} · ${row.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(row.pole)}`}
                      sources={row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source])}
                    />
                  ))}
                </div>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Demais réus</p>
                <div className="mt-2 space-y-3">
                  {(dossier.parties?.passiveOthers ?? dossier.otherDefendants).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum outro réu identificado nas fontes.</p>
                  ) : (
                    (dossier.parties?.passiveOthers ?? dossier.otherDefendants).map((row) => (
                      <PartyCard
                        key={row.name}
                        name={row.name}
                        meta={[row.partyType, row.documentMasked].filter(Boolean).join(" · ")}
                        sources={row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source])}
                      />
                    ))
                  )}
                </div>
              </section>
              <section className="md:col-span-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Advogados e representantes</h3>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {(dossier.parties?.attorneys ?? dossier.attorneys).length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhum advogado identificado nas fontes.</p>
                  ) : (
                    (dossier.parties?.attorneys ?? dossier.attorneys).map((row) => (
                      <PartyCard
                        key={row.name}
                        name={row.name}
                        meta={[
                          row.oabNumber ? `OAB ${row.oabNumber}/${row.oabState ?? ""}` : null,
                          row.representedPartyName ? `Representa ${row.representedPartyName}` : null,
                          row.documentMasked,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        sources={row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source])}
                      />
                    ))
                  )}
                </div>
                {thirdParties.length > 0 ? (
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Terceiros</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {thirdParties.map((row) => (
                        <PartyCard key={row.name} name={row.name} meta={row.documentMasked ?? ""} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {tab === "timeline" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {[
                  ["all", "Todos"],
                  ["movement", "Movimentação"],
                  ["publication", "Publicação"],
                  ["hearing", "Audiência"],
                  ["communication", "Comunicação"],
                  ["event", "Evento IndusCost"],
                ].map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    className={`rounded-full border px-3 py-1 text-xs ${timelineKind === kind ? "border-slate-900 bg-slate-900 text-white" : "border-border"}`}
                    onClick={() => setTimelineKind(kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {timeline.length === 0 ? <p className="text-sm text-muted-foreground">{NO_TIMELINE_EVENTS_COPY}</p> : null}
              <ol className="space-y-5">
                {timeline.map((row, index) => {
                  const complementText = movementComplementsText(row.complements);
                  const key = `${row.at}-${row.title}-${index}`;
                  const visual = timelineVisual(row);
                  const Icon = visual.Icon;
                  return (
                    <li key={key} className="grid grid-cols-[7.5rem_1.5rem_minmax(0,1fr)] gap-3">
                      <p className="pt-0.5 text-xs text-muted-foreground">{formatExposureDateTime(row.at) ?? "data não informada"}</p>
                      <div className="relative flex justify-center">
                        <span className="absolute inset-y-0 w-px bg-border" aria-hidden="true" />
                        <span className="relative z-[1] rounded-full border border-border bg-background p-1">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{visual.label}</p>
                        <p className="font-medium">{row.title}</p>
                        {row.courtUnit ? <p className="text-sm text-muted-foreground">{row.courtUnit}</p> : null}
                        {row.description && openComplements !== key ? <p className="text-sm text-muted-foreground">{row.description}</p> : null}
                        {row.complements || row.description ? (
                          <button type="button" className="mt-1 text-xs underline" onClick={() => setOpenComplements(openComplements === key ? null : key)}>
                            {openComplements === key ? "Recolher detalhes" : "Ver detalhes"}
                          </button>
                        ) : null}
                        {openComplements === key ? (
                          <p className="mt-1 text-sm text-muted-foreground">{complementText ?? row.description ?? "Sem detalhe adicional informado pela fonte."}</p>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {tab === "comunicacoes" ? (
            <div className="space-y-3">
              {(dossier.communications ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma comunicação vinculada a este processo.</p>
              ) : null}
              {(dossier.communications ?? []).map((row) => (
                <article key={row.id} className="rounded-xl border border-border p-4 text-sm">
                  <p className="font-medium">{communicationTypeLabel(row.communicationType)}</p>
                  {row.subject ? <p>{row.subject}</p> : null}
                  <p className="text-muted-foreground">{[row.tribunal, row.courtUnit].filter(Boolean).join(" · ") || "Órgão não informado"}</p>
                  <p>Disponibilização {formatExposureDateTime(row.availableAt) ?? "não informada"}</p>
                  <p>
                    Status{" "}
                    {COMMUNICATION_STATUS_LABELS[row.normalizedStatus as keyof typeof COMMUNICATION_STATUS_LABELS] ?? row.normalizedStatus}
                  </p>
                  <a className="underline" href={OFFICIAL_COMMUNICATIONS_PORTAL_URL} target="_blank" rel="noreferrer">
                    Abrir portal oficial
                  </a>
                </article>
              ))}
            </div>
          ) : null}

          {tab === "fontes" ? (
            <div className="space-y-4 text-sm" data-testid="exposure-source-diagnosis">
              {dossier.evidenceSources.map((source) => (
                <p key={source}>{SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source]}</p>
              ))}
              <p>Primeira detecção: {formatExposureDateTime(dossier.firstSeenAt)}</p>
              <p>Última atualização da fonte: {formatExposureDateTime(dossier.sourceUpdatedAt) ?? "não informada"}</p>
              {dossier.coverage ? (
                <div className="mt-2 space-y-3">
                  <p>Completude: {dossier.coverage.coverageScore}% (não é risco jurídico)</p>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Fonte</th>
                          <th className="px-3 py-2">Resultado</th>
                          <th className="px-3 py-2">Reclamante</th>
                          <th className="px-3 py-2">Réus</th>
                          <th className="px-3 py-2">Classe</th>
                          <th className="px-3 py-2">Movimentos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dossier.coverage.sourceMatrix?.map((row) => (
                          <tr key={row.source} className="border-t border-border">
                            <td className="px-3 py-2">{row.label}</td>
                            <td className="px-3 py-2">{row.outcome}</td>
                            <td className="px-3 py-2">{row.claimant}</td>
                            <td className="px-3 py-2">{row.defendants}</td>
                            <td className="px-3 py-2">{row.class}</td>
                            <td className="px-3 py-2">{row.movements}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {dossier.coverage.publicCompare ? (
                    <p className="text-muted-foreground">
                      Portal {dossier.coverage.publicCompare.adapterLabel ?? "não mapeado"}: acesso automático
                      indisponível ({dossier.coverage.publicCompare.reason}). Campos adicionais em relação ao DataJud:{" "}
                      {dossier.coverage.publicCompare.additionalOnPortal.join(", ") || "nenhum mapeado"}.
                      {dossier.coverage.publicCompare.publicUrl ? (
                        <>
                          {" "}
                          <a className="underline" href={dossier.coverage.publicCompare.publicUrl} target="_blank" rel="noreferrer">
                            Abrir consulta oficial
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {dossier.coverage.missingReasons.map((reason) => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return modal;
  return createPortal(modal, document.body);
}
