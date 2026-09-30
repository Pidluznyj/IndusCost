/**
 * Dossiê executivo do processo. Sem rawMetadata e sem CPF completo.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  CASE_CLAIM_VALUE_UNKNOWN_COPY,
  CASE_CLAIMANT_UNKNOWN_COPY,
  CASE_HEARING_UNKNOWN_COPY,
  CASE_POLE_UNCONFIRMED_COPY,
  CASE_STAGE_UNKNOWN_COPY,
  GROUP_ENTITY_BADGE_COPY,
  NO_TIMELINE_EVENTS_COPY,
  OFFICIAL_COMMUNICATIONS_PORTAL_URL,
  SOURCE_KIND_LABELS,
  SOURCE_LABELS,
  type ExposureCaseListItem,
  type ExposureTimelineItem,
  type LegalExposureSource,
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

type Dossier = ExposureCaseListItem & {
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
  dossier: Dossier;
  refreshing?: boolean;
  initialTab?: TabId;
  onClose: () => void;
  onRefresh: () => void;
  onPdf: () => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="mt-2 space-y-1 text-sm">{children}</div>
    </section>
  );
}

export function ExposureCaseDossier({ dossier, refreshing, initialTab = "resumo", onClose, onRefresh, onPdf }: Props) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [timelineKind, setTimelineKind] = useState("all");
  const [openComplements, setOpenComplements] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const timeline = (dossier.timeline ?? []).filter((row) => timelineKind === "all" || row.kind === timelineKind);
  const groupParties = dossier.parties?.group ?? dossier.groupEntities;
  const thirdParties = dossier.parties?.thirdParties ?? [];

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

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="exposure-dossier-title"
        className="flex h-full w-full max-w-3xl flex-col bg-background shadow-2xl"
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p id="exposure-dossier-title" className="text-lg font-semibold tracking-tight">
                {dossier.processNumber}
              </p>
              <p className="text-sm text-muted-foreground">
                {dossier.className ?? "Classe não informada"}
              </p>
            </div>
            <button ref={closeRef} type="button" className="text-sm font-semibold underline" onClick={onClose}>
              Fechar
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                dossier.verificationStatus === "CONFIRMED_OFFICIAL"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              {caseVerificationLabel(dossier.verificationStatus)}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">
              {dossier.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : dossier.stageLabel}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">
              {caseStatusLabel(dossier.currentStatus)}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs font-semibold">
              {dossier.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}
            </span>
            {dossier.secrecy ? (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs">Segredo de justiça</span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {dossier.groupEntities.map((entity) => (
              <span key={entity.id} className="rounded-full border border-border px-2 py-0.5 text-xs">
                {entity.legalName} · {entity.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(entity.pole)}
              </span>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["resumo", "partes", "timeline", "comunicacoes", "fontes"] as TabId[]).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-full border px-3 py-1 text-sm ${tab === id ? "border-slate-900 bg-slate-900 text-white" : "border-border"}`}
              >
                {id === "resumo" ? "Resumo" : id === "partes" ? "Partes" : id === "timeline" ? "Linha do Tempo" : id === "comunicacoes" ? "Comunicações" : "Fontes"}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" disabled={refreshing} onClick={onRefresh}>
              {refreshing ? "Atualizando..." : "Atualizar processo"}
            </button>
            <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={onPdf}>
              Gerar PDF
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-4 py-4">
          {tab === "resumo" ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Section title="Exposição do grupo">
                {dossier.groupEntities.map((entity) => (
                  <p key={entity.id}>
                    {entity.legalName} · {entity.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(entity.pole)}
                    {entity.displayCnpj ? ` · ${entity.displayCnpj}` : ""}
                  </p>
                ))}
                {dossier.groupNote ? <p className="text-muted-foreground">{dossier.groupNote}</p> : null}
              </Section>
              <Section title="Processo">
                <p>Autor / reclamante: {dossier.claimants.map((row) => row.name).join("; ") || CASE_CLAIMANT_UNKNOWN_COPY}</p>
                <p>Tribunal: {dossier.tribunal ?? "não informado"} · {dossier.courtUnit ?? "vara não informada"}</p>
                <p>Classe: {dossier.className ?? "não informada"}</p>
                <p>Ajuizamento: {caseFiledAtLabel(dossier.filedAt)}</p>
              </Section>
              <Section title="Valores">
                <p className="text-base font-semibold">{dossier.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}</p>
              </Section>
              <Section title="Situação">
                <p>{caseStatusLabel(dossier.currentStatus)}</p>
                <p>Fase: {dossier.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : dossier.stageLabel}</p>
                {dossier.stageReason ? <p className="text-muted-foreground">{dossier.stageReason}</p> : null}
                <p>Última movimentação: {caseMovementLabel(dossier.latestMovement)}</p>
              </Section>
              <Section title="Próximo evento">
                <p>
                  {dossier.nextHearing
                    ? `${formatExposureDateTime(dossier.nextHearing.scheduledAt) ?? "data não informada"} · ${dossier.nextHearing.type ?? "Audiência"}`
                    : CASE_HEARING_UNKNOWN_COPY}
                </p>
              </Section>
              <Section title="Pontos de atenção">
                {dossier.attentionLabels.length === 0 ? <p className="text-muted-foreground">Nenhum ponto de atenção registrado.</p> : null}
                {dossier.attentionLabels.map((label) => (
                  <p key={label}>{label}</p>
                ))}
                {dossier.openAlertCount > 0 ? <p>{dossier.openAlertCount} ação(ões) requerida(s)</p> : null}
              </Section>
              <div className="md:col-span-2">
                <Section title="Resumo executivo">
                  {dossier.narrative ? <p>{dossier.narrative}</p> : <p className="text-muted-foreground">Resumo ainda não disponível a partir das fontes consultadas.</p>}
                </Section>
              </div>
            </div>
          ) : null}

          {tab === "partes" ? (
            <div className="space-y-4 text-sm">
              <section className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">Autor / reclamante</h3>
                {(dossier.parties?.active ?? dossier.claimants).map((row) => (
                  <p key={row.name}>
                    {row.name}
                    {row.partyType ? ` · ${row.partyType}` : ""}
                    {row.documentMasked ? ` · ${row.documentMasked}` : ""}
                  </p>
                ))}
                {(dossier.parties?.active ?? dossier.claimants).length === 0 ? <p>{CASE_CLAIMANT_UNKNOWN_COPY}</p> : null}
              </section>
              <section className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">Empresas do grupo</h3>
                {groupParties.map((row) => (
                  <p key={row.id} className="mt-1">
                    <span className="mr-2 rounded-full border border-slate-900 bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                      {GROUP_ENTITY_BADGE_COPY}
                    </span>
                    {row.legalName} · CNPJ {row.displayCnpj} · {row.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(row.pole)}
                  </p>
                ))}
              </section>
              <section className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">Outros réus</h3>
                {(dossier.parties?.passiveOthers ?? dossier.otherDefendants).length === 0 ? (
                  <p className="text-muted-foreground">Nenhum outro réu identificado nas fontes.</p>
                ) : null}
                {(dossier.parties?.passiveOthers ?? dossier.otherDefendants).map((row) => (
                  <p key={row.name}>
                    {row.name}
                    {row.documentMasked ? ` · ${row.documentMasked}` : ""}
                  </p>
                ))}
              </section>
              <section className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">Terceiros</h3>
                {thirdParties.length === 0 ? <p className="text-muted-foreground">Nenhum terceiro identificado nas fontes.</p> : null}
                {thirdParties.map((row) => (
                  <p key={row.name}>
                    {row.name}
                    {row.documentMasked ? ` · ${row.documentMasked}` : ""}
                  </p>
                ))}
              </section>
              <section className="rounded-xl border border-border p-4">
                <h3 className="font-semibold">Advogados</h3>
                {(dossier.parties?.attorneys ?? dossier.attorneys).length === 0 ? (
                  <p className="text-muted-foreground">Nenhum advogado identificado nas fontes.</p>
                ) : null}
                {(dossier.parties?.attorneys ?? dossier.attorneys).map((row) => (
                  <p key={row.name}>
                    {row.name}
                    {row.oabNumber ? ` · OAB ${row.oabNumber}/${row.oabState ?? ""}` : ""}
                    {row.representedPartyName ? ` · ${row.representedPartyName}` : ""}
                  </p>
                ))}
              </section>
            </div>
          ) : null}

          {tab === "timeline" ? (
            <div className="space-y-3 text-sm">
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
                    className={`rounded-full border px-2 py-0.5 text-xs ${timelineKind === kind ? "border-slate-900 bg-slate-900 text-white" : "border-border"}`}
                    onClick={() => setTimelineKind(kind)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {timeline.length === 0 ? <p className="rounded-xl border border-dashed border-border p-4 text-muted-foreground">{NO_TIMELINE_EVENTS_COPY}</p> : null}
              <ol className="space-y-4 border-l border-border pl-4">
                {timeline.map((row, index) => {
                  const complementText = movementComplementsText(row.complements);
                  const key = `${row.at}-${row.title}-${index}`;
                  return (
                    <li key={key} className="relative">
                      <span className="absolute -left-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full border border-slate-400 bg-background" aria-hidden="true" />
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                        {exposureTimelineKindLabel(row.kind, row.title)}
                      </p>
                      <p className="text-sm font-medium">{formatExposureDateTime(row.at) ?? "data não informada"}</p>
                      <p>{row.title}</p>
                      {row.courtUnit ? <p className="text-muted-foreground">{row.courtUnit}</p> : null}
                      {row.description && openComplements !== key ? (
                        <p className="text-muted-foreground">{row.description}</p>
                      ) : null}
                      {row.complements || row.description ? (
                        <button
                          type="button"
                          className="mt-1 text-xs underline"
                          onClick={() => setOpenComplements(openComplements === key ? null : key)}
                        >
                          {openComplements === key ? "Recolher detalhes" : "Ver detalhes"}
                        </button>
                      ) : null}
                      {openComplements === key ? (
                        <p className="mt-1 text-muted-foreground">{complementText ?? row.description ?? "Sem detalhe adicional informado pela fonte."}</p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : null}

          {tab === "comunicacoes" ? (
            <div className="space-y-3 text-sm">
              {(dossier.communications ?? []).length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-muted-foreground">Nenhuma comunicação vinculada a este processo.</p>
              ) : null}
              {(dossier.communications ?? []).map((row) => (
                <article key={row.id} className="rounded-lg border border-border p-3">
                  <p className="font-medium">{communicationTypeLabel(row.communicationType)}</p>
                  {row.subject ? <p>{row.subject}</p> : null}
                  <p className="text-muted-foreground">{[row.tribunal, row.courtUnit].filter(Boolean).join(" · ") || "Órgão não informado"}</p>
                  <p>Disponibilização {formatExposureDateTime(row.availableAt) ?? "não informada"}</p>
                  <p>
                    Status{" "}
                    {COMMUNICATION_STATUS_LABELS[row.normalizedStatus as keyof typeof COMMUNICATION_STATUS_LABELS] ??
                      row.normalizedStatus}
                  </p>
                  <a className="underline" href={OFFICIAL_COMMUNICATIONS_PORTAL_URL} target="_blank" rel="noreferrer">
                    Abrir portal oficial
                  </a>
                </article>
              ))}
            </div>
          ) : null}

          {tab === "fontes" ? (
            <div className="space-y-2 text-sm">
              {dossier.evidenceSources.map((source) => (
                <p key={source}>{SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source]}</p>
              ))}
              <p>Primeira detecção: {formatExposureDateTime(dossier.firstSeenAt)}</p>
              <p>Última atualização da fonte: {formatExposureDateTime(dossier.sourceUpdatedAt) ?? "não informada"}</p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
