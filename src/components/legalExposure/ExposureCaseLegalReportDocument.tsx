/**
 * Dossiê jurídico executivo A4 — um processo.
 */

import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import {
  CASE_CLAIM_VALUE_UNKNOWN_COPY,
  CASE_CLAIMANT_MISSING_COPY,
  CASE_STAGE_UNKNOWN_COPY,
  GROUP_ENTITY_BADGE_COPY,
  PDF_DISCLAIMER,
  SOURCE_KIND_LABELS,
  type ExposureTimelineItem,
  type LegalExposureSource,
} from "@/src/lib/legalExposure/legalExposureContracts";
import { confirmedClaimants, confirmedGroupDefendants } from "@/src/lib/legalExposure/legalExposureCoverage";
import { caseFiledAtLabel, casePoleLabel, caseStatusLabel } from "@/src/lib/legalExposure/legalExposureCaseListUi";
import {
  EXPOSURE_CASE_REPORT_TITLE,
  EXPOSURE_PRINT_SOURCE_NOTE,
  buildPrintSourceRows,
  classifyExposurePrintTimeline,
  formatPrintWhen,
  selectExecutiveTimeline,
  type ExposurePrintDashboardSource,
} from "@/src/lib/legalExposure/legalExposurePrint";
import { enrichTimelineItems, sortMovementsForPdf } from "@/src/lib/legalExposure/legalExposureMovementExecutive";
import { buildAttentionSectionCopy, buildProcessStoryNarrative, originFacts } from "@/src/lib/legalExposure/legalExposureNarrative";
import { ExposureLegalReportPage, ExposureLegalReportPrintCover } from "./ExposureLegalReportDocument";
import type { ExposureDossier } from "./ExposureCaseDossier";

function FactGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="exposure-legal-report-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExposureCaseLegalReportDocument({
  dossier,
  branding,
  sources = [],
  generatedAt,
}: {
  dossier: ExposureDossier;
  branding: BrandingSettingsDTO;
  sources?: ExposurePrintDashboardSource[];
  generatedAt: string;
}) {
  const timeline = (dossier.timeline ?? []) as ExposureTimelineItem[];
  const movements = dossier.movementsExecutive?.length
    ? sortMovementsForPdf(dossier.movementsExecutive)
    : sortMovementsForPdf(enrichTimelineItems(timeline, { lastMovementsReadAt: dossier.lastMovementsReadAt ?? null }));
  const { executive, annex } = selectExecutiveTimeline(movements.map((row) => ({
    ...row,
    description: row.summary,
  })));
  const news = movements.filter((row) => row.isNew);
  const attention = buildAttentionSectionCopy(movements);
  const nextEvents = dossier.nextKnownEvents?.length
    ? dossier.nextKnownEvents
    : movements.filter((row) => row.displayKind === "hearing" || row.deadlineAt);
  const totalPages = annex.length > 0 ? 7 : 6;
  const claimants = confirmedClaimants(dossier.claimants);
  const groupDefendants = confirmedGroupDefendants(dossier.groupEntities);
  const companies = dossier.groupEntities.map((row) => row.legalName).join(", ") || "Empresas do grupo";
  const sourceRows = buildPrintSourceRows({ evidenceSources: dossier.evidenceSources, dashboardSources: sources });
  const story = buildProcessStoryNarrative({ dossier, movements });
  const parties: Array<{
    pole: string;
    name: string;
    type: string;
    document: string;
    group: string;
    attorney: string;
    source: string;
  }> = [
    ...claimants.map((row) => ({
      pole: "Ativo",
      name: row.name,
      type: row.partyType ?? "Autor/reclamante",
      document: row.documentMasked ?? "—",
      group: row.isGroupEntity ? "Sim" : "Não",
      attorney: dossier.attorneys.find((item) => item.representedPartyName === row.name)?.name ?? "—",
      source: row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? source).join(", "),
    })),
    ...groupDefendants.map((row) => ({
      pole: casePoleLabel(row.pole),
      name: row.legalName,
      type: GROUP_ENTITY_BADGE_COPY,
      document: row.displayCnpj,
      group: "Sim",
      attorney: dossier.attorneys.find((item) => item.representedPartyName === row.legalName)?.name ?? "—",
      source: row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? source).join(", "),
    })),
    ...(dossier.parties?.passiveOthers ?? dossier.otherDefendants).map((row) => ({
      pole: "Passivo",
      name: row.name,
      type: row.partyType ?? "Réu",
      document: row.documentMasked ?? "—",
      group: "Não",
      attorney: dossier.attorneys.find((item) => item.representedPartyName === row.name)?.name ?? "—",
      source: row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? source).join(", "),
    })),
    ...dossier.attorneys.map((row) => ({
      pole: "Representação",
      name: row.name,
      type: row.oabNumber ? `OAB ${row.oabNumber}/${row.oabState ?? ""}` : "Advogado",
      document: row.documentMasked ?? "—",
      group: "Não",
      attorney: row.representedPartyName ?? "—",
      source: row.sources.map((source) => SOURCE_KIND_LABELS[source] ?? source).join(", "),
    })),
  ];
  const asOf = generatedAt;
  const header = { branding, documentTitle: EXPOSURE_CASE_REPORT_TITLE, asOf, totalPages };
  const subjects = dossier.subjects.map((row) => row.name).join("; ") || "não informado";
  const latest = movements.at(-1);

  return (
    <div className="exposure-legal-report-document" data-testid="exposure-case-legal-report">
      <ExposureLegalReportPage pageId="cover" pageNumber={1} cover {...header}>
        <ExposureLegalReportPrintCover
          branding={branding}
          kicker="IndusCost"
          title="Dossiê jurídico executivo"
          subtitle="Processo"
          processNumber={dossier.processNumber}
          companies={companies}
          asOf={asOf}
        />
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="summary" pageNumber={2} {...header}>
        <p className="exposure-legal-report-kicker">Resumo executivo</p>
        <h2 className="exposure-legal-report-h1">O que este processo é</h2>
        <p className="exposure-legal-report-asof">Dados consultados até: {formatPrintWhen(asOf)}</p>
        <p className="exposure-legal-report-story">{story || dossier.narrative}</p>
        {news.length > 0 ? (
          <div className="exposure-legal-report-attention">
            <h3>Novidades desde a última revisão</h3>
            <ul>
              {news.slice(0, 8).map((row) => (
                <li key={row.id}>
                  {formatPrintWhen(row.at)} · {row.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="exposure-legal-report-vs">
          <div>
            <p className="exposure-legal-report-vs-label">Autor / reclamante</p>
            {claimants.length > 0 ? (
              claimants.map((row) => (
                <p key={row.name} className="exposure-legal-report-vs-name">
                  {row.name}
                </p>
              ))
            ) : (
              <p>{CASE_CLAIMANT_MISSING_COPY}</p>
            )}
          </div>
          <p className="exposure-legal-report-vs-mark">VS</p>
          <div>
            <p className="exposure-legal-report-vs-label">Réus / empresas do grupo</p>
            {groupDefendants.map((row) => (
              <p key={row.id} className="exposure-legal-report-vs-name">
                {row.legalName}
              </p>
            ))}
          </div>
        </div>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="origin" pageNumber={3} {...header}>
        <p className="exposure-legal-report-kicker">Origem</p>
        <h2 className="exposure-legal-report-h1">Como o processo começou</h2>
        <FactGrid items={originFacts(dossier)} />
        <p className="exposure-legal-report-kicker">Partes envolvidas</p>
        <table className="exposure-legal-report-table">
          <thead>
            <tr>
              <th>Polo</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th>Documento</th>
              <th>Grupo</th>
              <th>Advogado</th>
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {parties.length === 0 ? (
              <tr>
                <td colSpan={7}>Partes ainda não identificadas nas fontes.</td>
              </tr>
            ) : (
              parties.map((row) => (
                <tr key={`${row.pole}-${row.name}`}>
                  <td>{row.pole}</td>
                  <td>{row.name}</td>
                  <td>{row.type}</td>
                  <td>{row.document}</td>
                  <td>{row.group}</td>
                  <td>{row.attorney}</td>
                  <td>{row.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="timeline" pageNumber={4} {...header}>
        <p className="exposure-legal-report-kicker">Histórico processual</p>
        <h2 className="exposure-legal-report-h1">Evolução relevante</h2>
        <table className="exposure-legal-report-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Tipo</th>
              <th>Descrição</th>
              <th>Fonte</th>
            </tr>
          </thead>
          <tbody>
            {executive.length === 0 ? (
              <tr>
                <td colSpan={4}>Nenhum evento relevante identificado nas fontes.</td>
              </tr>
            ) : (
              executive.map((row) => (
                <tr key={row.id ?? `${row.at}-${row.title}`}>
                  <td>{formatPrintWhen(row.at)}</td>
                  <td>{classifyExposurePrintTimeline(row)}</td>
                  <td>{row.title}</td>
                  <td>{SOURCE_KIND_LABELS[row.source as LegalExposureSource] ?? row.source}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="current" pageNumber={5} {...header}>
        <p className="exposure-legal-report-kicker">Situação atual</p>
        <h2 className="exposure-legal-report-h1">Onde o processo está agora</h2>
        <FactGrid
          items={[
            ["Fase", dossier.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : dossier.stageLabel],
            ["Status", caseStatusLabel(dossier.currentStatus)],
            ["Última movimentação", latest ? `${formatPrintWhen(latest.at)} · ${latest.title}` : "não identificada"],
            [
              "Última publicação",
              dossier.latestPublication
                ? `${dossier.latestPublication.type ?? "Publicação"} · ${formatPrintWhen(dossier.latestPublication.availableAt)}`
                : "não identificada",
            ],
            ["Próxima audiência", dossier.nextHearing ? formatPrintWhen(dossier.nextHearing.scheduledAt) : "não identificada"],
            ["Movimentações conhecidas", String(dossier.movementCount)],
            ["Assuntos", subjects],
            ["Ajuizamento", caseFiledAtLabel(dossier.filedAt)],
          ]}
        />
        <div className="exposure-legal-report-attention">
          <h3>{attention.title}</h3>
          <p>{attention.body}</p>
        </div>
        <p className="exposure-legal-report-kicker">Próximos eventos conhecidos</p>
        <table className="exposure-legal-report-table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Evento</th>
              <th>Fonte</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            {nextEvents.length === 0 ? (
              <tr>
                <td colSpan={4}>Nenhum evento futuro estruturado identificado nas fontes até a data-base.</td>
              </tr>
            ) : (
              nextEvents.map((row) => (
                <tr key={row.id}>
                  <td>{formatPrintWhen(row.deadlineAt ?? row.at)}</td>
                  <td>{row.title}</td>
                  <td>{row.sourceLabel}</td>
                  <td>{row.actionLabel}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="sources" pageNumber={6} {...header}>
        <p className="exposure-legal-report-kicker">Fontes consultadas</p>
        <h2 className="exposure-legal-report-h1">Origem das informações</h2>
        <p className="exposure-legal-report-asof">Dados consultados até: {formatPrintWhen(asOf)}</p>
        <table className="exposure-legal-report-table">
          <thead>
            <tr>
              <th>Fonte</th>
              <th>Tipo</th>
              <th>Oficial/complementar</th>
              <th>Última consulta</th>
              <th>Última atualização</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {sourceRows.map((row) => (
              <tr key={row.source}>
                <td>{row.label}</td>
                <td>{row.kind}</td>
                <td>{row.authority}</td>
                <td>{formatPrintWhen(row.lastAttemptAt, "não informado")}</td>
                <td>{formatPrintWhen(row.lastSuccessfulAt, "não informado")}</td>
                <td>{row.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="exposure-legal-report-note">
          {EXPOSURE_PRINT_SOURCE_NOTE} {PDF_DISCLAIMER}
        </p>
      </ExposureLegalReportPage>

      {annex.length > 0 ? (
        <ExposureLegalReportPage pageId="annex" pageNumber={7} flow {...header}>
          <p className="exposure-legal-report-kicker">Anexo</p>
          <h2 className="exposure-legal-report-h1">Histórico completo</h2>
          <table className="exposure-legal-report-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Fonte</th>
              </tr>
            </thead>
            <tbody>
              {annex.map((row) => (
                <tr key={row.id ?? `${row.at}-${row.title}-annex`}>
                  <td>{formatPrintWhen(row.at)}</td>
                  <td>{classifyExposurePrintTimeline(row)}</td>
                  <td>{row.title}</td>
                  <td>{SOURCE_KIND_LABELS[row.source as LegalExposureSource] ?? row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ExposureLegalReportPage>
      ) : null}
    </div>
  );
}

export function expectedCasePrintPages(timelineCount: number): number {
  return timelineCount > 12 ? 7 : 6;
}
