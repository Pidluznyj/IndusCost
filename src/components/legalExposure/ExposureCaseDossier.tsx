/**
 * Dossiê executivo do processo. Sem rawMetadata e sem CPF completo.
 */

import React, { useState } from "react";
import {
  CASE_CLAIM_VALUE_UNKNOWN_COPY,
  CASE_CLAIMANT_UNKNOWN_COPY,
  CASE_HEARING_UNKNOWN_COPY,
  CASE_POLE_UNCONFIRMED_COPY,
  CASE_STAGE_UNKNOWN_COPY,
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
import { movementComplementsText } from "@/src/lib/legalExposure/legalExposureFeedUi";

type Dossier = ExposureCaseListItem & {
  narrative?: string;
  groupNote?: string | null;
  parties?: {
    active: ExposureCaseListItem["claimants"];
    passiveGroup: ExposureCaseListItem["groupEntities"];
    passiveOthers: ExposureCaseListItem["otherDefendants"];
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
  onClose: () => void;
  onRefresh: () => void;
  onPdf: () => void;
};

export function ExposureCaseDossier({ dossier, refreshing, onClose, onRefresh, onPdf }: Props) {
  const [tab, setTab] = useState<TabId>("resumo");
  const [timelineKind, setTimelineKind] = useState("all");
  const [openComplements, setOpenComplements] = useState<string | null>(null);
  const timeline = (dossier.timeline ?? []).filter((row) => timelineKind === "all" || row.kind === timelineKind);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <aside className="flex h-full w-full max-w-3xl flex-col overflow-auto bg-background p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{dossier.processNumber}</p>
            <p className="text-sm text-muted-foreground">
              {caseVerificationLabel(dossier.verificationStatus)} · {dossier.className ?? "Classe não informada"} ·{" "}
              {dossier.tribunal ?? "Tribunal não informado"}
            </p>
          </div>
          <button type="button" className="text-sm font-semibold underline" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {dossier.groupEntities.map((entity) => (
            <span key={entity.id} className="rounded-full border border-border px-2 py-0.5 text-xs">
              {entity.legalName} · {entity.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(entity.pole)}
            </span>
          ))}
          {dossier.secrecy ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs">Segredo de justiça</span>
          ) : null}
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

        {tab === "resumo" ? (
          <div className="mt-4 space-y-3 text-sm">
            {dossier.narrative ? <p>{dossier.narrative}</p> : null}
            <p>Autor / reclamante: {dossier.claimants.map((row) => `${row.name}${row.partyType ? ` (${row.partyType})` : ""}`).join("; ") || CASE_CLAIMANT_UNKNOWN_COPY}</p>
            <p>Outros réus: {dossier.otherDefendants.map((row) => row.name).join("; ") || "não identificados"}</p>
            <p>Tribunal: {dossier.tribunal ?? "não informado"} · Grau: {dossier.degree ?? "não informado"}</p>
            <p>Vara: {dossier.courtUnit ?? "não informada"} · Sistema: {dossier.systemName ?? "não informado"}</p>
            <p>Classe: {dossier.className ?? "não informada"} · Área: {dossier.area ?? "não informada"}</p>
            <p>
              Assunto principal:{" "}
              {dossier.subjects.find((row) => row.isMain)?.name ?? "não informado pela fonte"}
            </p>
            <p>Assuntos: {dossier.subjects.map((row) => row.name).join("; ") || "não informados"}</p>
            <p>Ajuizamento: {caseFiledAtLabel(dossier.filedAt)}</p>
            <p>Valor da causa: {dossier.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}</p>
            <p>Situação: {caseStatusLabel(dossier.currentStatus)}</p>
            <p>Fase: {dossier.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : dossier.stageLabel}</p>
            {dossier.stageReason ? <p className="text-muted-foreground">{dossier.stageReason}</p> : null}
            <p>Última movimentação: {caseMovementLabel(dossier.latestMovement)}</p>
            <p>Última publicação: {dossier.latestPublication?.type ?? "não identificada"}</p>
            <p>Próxima audiência: {dossier.nextHearing ? `${formatExposureDateTime(dossier.nextHearing.scheduledAt) ?? dossier.nextHearing.scheduledAt} · ${dossier.nextHearing.type ?? "Audiência"}` : CASE_HEARING_UNKNOWN_COPY}</p>
            <p>{dossier.movementCount} movimentações · {dossier.publicationCount} publicações · {dossier.communicationCount} comunicações · {dossier.openAlertCount} ações requeridas</p>
            <p>Origem da descoberta: {SOURCE_LABELS[dossier.primarySource]} em {formatExposureDateTime(dossier.firstSeenAt)}</p>
            <div className="flex flex-wrap gap-2">
              {dossier.evidenceSources.map((source) => (
                <span key={source} className="rounded-full border px-2 py-0.5 text-xs">{SOURCE_KIND_LABELS[source]}</span>
              ))}
            </div>
            {dossier.attentionLabels.map((label) => (
              <p key={label}>⚠ {label}</p>
            ))}
          </div>
        ) : null}

        {tab === "partes" ? (
          <div className="mt-4 space-y-4 text-sm">
            <section>
              <h3 className="font-semibold">Polo ativo</h3>
              {(dossier.parties?.active ?? dossier.claimants).map((row) => (
                <p key={row.name}>{row.name} · {row.partyType ?? "parte"} · {row.documentMasked ?? ""}</p>
              ))}
              {(dossier.parties?.active ?? dossier.claimants).length === 0 ? <p>{CASE_CLAIMANT_UNKNOWN_COPY}</p> : null}
            </section>
            <section>
              <h3 className="font-semibold">Empresas do grupo — polo passivo</h3>
              {(dossier.parties?.passiveGroup ?? dossier.groupEntities.filter((row) => row.pole === "PASSIVE")).map((row) => (
                <p key={row.id}>{row.legalName} · CNPJ {row.displayCnpj} · {casePoleLabel(row.pole)} · empresa do grupo</p>
              ))}
              {dossier.groupEntities.filter((row) => row.pole === "UNKNOWN").map((row) => (
                <p key={`${row.id}-u`}>{row.legalName} · {CASE_POLE_UNCONFIRMED_COPY}</p>
              ))}
            </section>
            <section>
              <h3 className="font-semibold">Outros réus</h3>
              {(dossier.parties?.passiveOthers ?? dossier.otherDefendants).map((row) => (
                <p key={row.name}>{row.name} · {row.documentMasked ?? ""}</p>
              ))}
            </section>
            <section>
              <h3 className="font-semibold">Advogados</h3>
              {(dossier.parties?.attorneys ?? dossier.attorneys).map((row) => (
                <p key={row.name}>{row.name} · {row.oabNumber ? `OAB ${row.oabNumber}/${row.oabState ?? ""}` : ""} · {row.representedPartyName ?? ""}</p>
              ))}
            </section>
          </div>
        ) : null}

        {tab === "timeline" ? (
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {["all", "movement", "publication", "hearing", "communication", "event"].map((kind) => (
                <button key={kind} type="button" className="rounded-full border px-2 py-0.5 text-xs" onClick={() => setTimelineKind(kind)}>
                  {kind === "all" ? "Todos" : kind}
                </button>
              ))}
            </div>
            {timeline.map((row, index) => (
              <article key={`${row.at}-${index}`} className="rounded-lg border border-border p-3">
                <p className="text-xs uppercase">{row.kind} · {SOURCE_KIND_LABELS[row.source]}</p>
                <p className="font-medium">{formatExposureDateTime(row.at) ?? row.at}</p>
                <p>{row.title}</p>
                {row.description ? <p className="text-muted-foreground">{row.description}</p> : null}
                {row.courtUnit ? <p className="text-muted-foreground">{row.courtUnit}</p> : null}
                {row.complements ? (
                  <button type="button" className="mt-1 text-xs underline" onClick={() => setOpenComplements(openComplements === row.title ? null : row.title)}>
                    {movementComplementsText(row.complements) ?? "Ver detalhes"}
                  </button>
                ) : null}
                {openComplements === row.title && row.complements ? (
                  <pre className="mt-2 overflow-auto text-xs">{JSON.stringify(row.complements, null, 2)}</pre>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {tab === "comunicacoes" ? (
          <div className="mt-4 space-y-3 text-sm">
            {(dossier.communications ?? []).map((row) => (
              <article key={row.id} className="rounded-lg border border-border p-3">
                <p className="font-medium">{row.communicationType}</p>
                <p>{row.subject}</p>
                <p>{row.tribunal} · {row.courtUnit}</p>
                <p>Disponibilização {formatExposureDateTime(row.availableAt) ?? "não informada"}</p>
                <p>Detecção {formatExposureDateTime(row.detectedAt)}</p>
                <p>Status {row.normalizedStatus} · fonte {row.sourceStatus}</p>
                <a className="underline" href={OFFICIAL_COMMUNICATIONS_PORTAL_URL} target="_blank" rel="noreferrer">
                  Abrir portal oficial
                </a>
              </article>
            ))}
          </div>
        ) : null}

        {tab === "fontes" ? (
          <div className="mt-4 space-y-2 text-sm">
            {dossier.evidenceSources.map((source) => (
              <p key={source}>{SOURCE_KIND_LABELS[source]}</p>
            ))}
            <p>Primeira detecção: {formatExposureDateTime(dossier.firstSeenAt)}</p>
            <p>Última atualização da fonte: {formatExposureDateTime(dossier.sourceUpdatedAt) ?? "não informada"}</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
