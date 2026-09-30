/**
 * Relatório executivo de exposição jurídica do grupo.
 */

import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { CASE_CLAIM_VALUE_UNKNOWN_COPY, PDF_DISCLAIMER } from "@/src/lib/legalExposure/legalExposureContracts";
import { casePoleLabel } from "@/src/lib/legalExposure/legalExposureCaseListUi";
import { confirmedClaimants, confirmedGroupDefendants } from "@/src/lib/legalExposure/legalExposureCoverage";
import {
  EXPOSURE_GROUP_REPORT_TITLE,
  EXPOSURE_PRINT_SOURCE_NOTE,
  buildPrintSourceRows,
  formatPrintWhen,
  selectPriorityProcesses,
  uniqueProcesses,
  type ExposureGroupPrintReport,
  type ExposurePrintDashboardSource,
} from "@/src/lib/legalExposure/legalExposurePrint";
import { ExposureLegalReportPage, ExposureLegalReportPrintCover } from "./ExposureLegalReportDocument";

export function ExposureGroupLegalReportDocument({
  report,
  branding,
  sources = [],
}: {
  report: ExposureGroupPrintReport;
  branding: BrandingSettingsDTO;
  sources?: ExposurePrintDashboardSource[];
}) {
  const processes = uniqueProcesses(report.processes);
  const priority = selectPriorityProcesses(processes);
  const extraProcessPages = Math.max(0, Math.ceil(Math.max(0, processes.length - 18) / 22));
  const totalPages = 6 + extraProcessPages;
  const asOf = report.generatedAt;
  const header = { branding, documentTitle: EXPOSURE_GROUP_REPORT_TITLE, asOf, totalPages };
  const companies = report.entities.map((row) => row.legalName).join(", ") || "Empresas do grupo";
  const sourceRows = buildPrintSourceRows({
    evidenceSources: sources.length > 0 ? sources.map((row) => row.source) : ["DATAJUD", "DJEN"],
    dashboardSources: sources,
  });
  const firstBatch = processes.slice(0, 18);
  const restBatches: typeof processes[] = [];
  for (let i = 18; i < processes.length; i += 22) restBatches.push(processes.slice(i, i + 22));
  const sourcesPage = 6 + extraProcessPages;

  return (
    <div className="exposure-legal-report-document" data-testid="exposure-group-legal-report">
      <ExposureLegalReportPage pageId="cover" pageNumber={1} cover {...header}>
        <ExposureLegalReportPrintCover
          branding={branding}
          kicker="IndusCost"
          title="Relatório executivo de exposição jurídica"
          subtitle="Panorama consolidado das empresas do grupo"
          companies={companies}
          asOf={asOf}
        />
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="summary" pageNumber={2} {...header}>
        <p className="exposure-legal-report-kicker">Resumo</p>
        <h2 className="exposure-legal-report-h1">Exposição consolidada</h2>
        <dl className="exposure-legal-report-kpis">
          {[
            ["Processos únicos", String(report.totals.uniqueProcesses)],
            ["Processos passivos", String(report.totals.passive)],
            ["Valor conhecido", report.totals.claimTotalFormatted ?? "—"],
            ["Ações abertas", String(report.totals.requiredActions)],
            ["Audiências futuras", String(report.totals.futureHearings)],
            ["Empresas monitoradas", String(report.entities.length)],
          ].map(([label, value]) => (
            <div className="exposure-legal-report-kpi" key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="exposure-legal-report-note">{report.groupNote}</p>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="companies" pageNumber={3} {...header}>
        <p className="exposure-legal-report-kicker">Panorama</p>
        <h2 className="exposure-legal-report-h1">Empresas do grupo</h2>
        <div className="exposure-legal-report-company-grid">
          {report.entities.map((entity) => {
            const unique = uniqueProcesses(entity.processes);
            const passive = unique.filter((row) => row.groupEntities.some((item) => item.id === entity.entityId && item.pole === "PASSIVE")).length;
            const active = unique.filter((row) => row.groupEntities.some((item) => item.id === entity.entityId && item.pole === "ACTIVE")).length;
            const open = unique.reduce((sum, row) => sum + row.openAlertCount, 0);
            return (
              <article key={entity.entityId} className="exposure-legal-report-company">
                <h3>{entity.legalName}</h3>
                <p>Processos únicos: {entity.monitoredCases}</p>
                <p>Polo passivo: {passive}</p>
                <p>Polo ativo: {active}</p>
                <p>Ações abertas: {open}</p>
              </article>
            );
          })}
        </div>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="priority" pageNumber={4} {...header}>
        <p className="exposure-legal-report-kicker">Processos prioritários</p>
        <h2 className="exposure-legal-report-h1">Itens que exigem acompanhamento</h2>
        <table className="exposure-legal-report-table">
          <thead>
            <tr>
              <th>CNJ</th>
              <th>Autor</th>
              <th>Empresa do grupo</th>
              <th>Valor</th>
              <th>Motivo</th>
            </tr>
          </thead>
          <tbody>
            {priority.length === 0 ? (
              <tr>
                <td colSpan={5}>Nenhum processo prioritário no momento.</td>
              </tr>
            ) : (
              priority.map((row) => (
                <tr key={row.processNumber}>
                  <td>{row.processNumber}</td>
                  <td>{confirmedClaimants(row.claimants)[0]?.name ?? "não identificado"}</td>
                  <td>{confirmedGroupDefendants(row.groupEntities).map((item) => item.legalName).join(", ") || row.entity.legalName}</td>
                  <td>{row.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}</td>
                  <td>
                    {[
                      row.nextHearing ? "Audiência futura" : null,
                      row.openAlertCount > 0 ? "Ação aberta" : null,
                      row.attentionLabels[0] ?? null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ExposureLegalReportPage>

      <ExposureLegalReportPage pageId="processes" pageNumber={5} flow={restBatches.length === 0} {...header}>
        <p className="exposure-legal-report-kicker">Processos</p>
        <h2 className="exposure-legal-report-h1">Todos os processos resumidos</h2>
        <ProcessSummaryTable rows={firstBatch} />
      </ExposureLegalReportPage>

      {restBatches.map((batch, index) => (
        <ExposureLegalReportPage
          key={`processes-${index}`}
          pageId={`processes-${index + 2}`}
          pageNumber={6 + index}
          flow
          {...header}
        >
          <p className="exposure-legal-report-kicker">Processos</p>
          <h2 className="exposure-legal-report-h1">Continuação</h2>
          <ProcessSummaryTable rows={batch} />
        </ExposureLegalReportPage>
      ))}

      <ExposureLegalReportPage pageId="sources" pageNumber={sourcesPage} {...header}>
        <p className="exposure-legal-report-kicker">Fontes</p>
        <h2 className="exposure-legal-report-h1">Origem das informações</h2>
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
    </div>
  );
}

function ProcessSummaryTable({ rows }: { rows: ExposureGroupPrintReport["processes"] }) {
  return (
    <table className="exposure-legal-report-table">
      <thead>
        <tr>
          <th>CNJ</th>
          <th>Classe</th>
          <th>Autor</th>
          <th>Grupo</th>
          <th>Polo</th>
          <th>Valor</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6}>Nenhum processo identificado nas fontes consultadas.</td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.processNumber}>
              <td>{row.processNumber}</td>
              <td>{row.className ?? "não informada"}</td>
              <td>{confirmedClaimants(row.claimants)[0]?.name ?? "não identificado"}</td>
              <td>{row.groupEntities.map((item) => item.legalName).join(", ")}</td>
              <td>{row.groupEntities.map((item) => casePoleLabel(item.pole)).join(", ")}</td>
              <td>{row.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export { formatPrintWhen };
