/**
 * Cockpit executivo jurídico da Visão Geral do Exposure.
 */

import React from "react";
import { ABSENCE_IS_NOT_CLEARANCE_COPY } from "@/src/lib/legalExposure/legalExposureContracts";
import { formatExposureDateTime } from "@/src/lib/legalExposure/legalExposureCaseListUi";
import type { ExposureCaseListFilters } from "./ExposureCaseList";

export type ExposureOverviewEntity = {
  id: string;
  legalName: string;
  cnpj: string;
  monitoredCases: number;
  polePassive?: number;
  poleActive?: number;
  actionRequired: number;
  lastSuccessfulSyncAt?: string | null;
  knownClaimTotalFormatted?: string | null;
};

export type ExposureAttentionItem = {
  id: string;
  type: string;
  company: string;
  processNumber: string | null;
  description: string;
  at: string;
  caseId: string | null;
  channel: "LEGAL" | "TECHNICAL" | "DATA";
};

export type ExposureOverviewDashboard = {
  cards: {
    actionRequired: number;
    monitoredCases: number;
    pendingCommunications: number;
    newsToday: number;
    news7Days?: number;
    newMovements?: number;
    processesWithNewMovements?: number;
    passiveCases?: number;
    futureHearings?: number;
    knownClaimCount?: number;
    knownClaimTotalFormatted?: string | null;
  };
  lastUpdatedAt?: string | null;
  dataQuality?: {
    claimantIdentifiedPct: number;
    groupPolesIdentifiedPct: number;
    claimValuePct: number;
    datajudEnrichedPct: number;
  };
  attentionNow?: ExposureAttentionItem[];
  absenceIsNotClearance: string;
  emptyState: string | null;
  entities: ExposureOverviewEntity[];
};

type Props = {
  dashboard: ExposureOverviewDashboard;
  onOpenAction: () => void;
  onOpenCases: (patch?: Partial<ExposureCaseListFilters>) => void;
  onOpenCase: (caseId: string) => void;
  onExecutiveReport: () => void;
};

function Kpi(props: { label: string; value: string | number; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-slate-400"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{props.value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{props.hint}</p>
    </button>
  );
}

export function ExposureOverview({ dashboard, onOpenAction, onOpenCases, onOpenCase, onExecutiveReport }: Props) {
  const cards = dashboard.cards;
  const quality = dashboard.dataQuality;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Exposição jurídica</h2>
          <p className="mt-1 text-sm text-muted-foreground">Panorama consolidado das empresas do grupo</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Última atualização: {formatExposureDateTime(dashboard.lastUpdatedAt) ?? "ainda não sincronizado"}
          </p>
          <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold" onClick={onExecutiveReport}>
            Relatório executivo
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi label="Processos únicos" value={cards.monitoredCases} hint="Um CNJ, um processo" onClick={() => onOpenCases()} />
        <Kpi
          label="Empresas no polo passivo"
          value={cards.passiveCases ?? 0}
          hint="Processos em que o grupo figura como réu"
          onClick={() => onOpenCases({ pole: "PASSIVE" })}
        />
        <Kpi label="Ações que exigem atenção" value={cards.actionRequired} hint="Itens abertos na caixa de entrada" onClick={onOpenAction} />
        <Kpi
          label="Valor conhecido das causas"
          value={cards.knownClaimTotalFormatted ?? "—"}
          hint={cards.knownClaimCount ? `${cards.knownClaimCount} processo(s) com valor informado` : "Valor ainda não informado pelas fontes"}
          onClick={() => onOpenCases()}
        />
        <Kpi
          label="Audiências futuras"
          value={cards.futureHearings ?? 0}
          hint="Datas conhecidas à frente"
          onClick={() => onOpenCases({ hasHearing: "true" })}
        />
        <Kpi
          label="Novas movimentações"
          value={cards.newMovements ?? 0}
          hint={cards.processesWithNewMovements ? `${cards.processesWithNewMovements} processo(s) com novidade` : "Desde a última revisão deste usuário"}
          onClick={() => onOpenCases()}
        />
      </div>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">Atenção agora</h3>
          <button type="button" className="text-sm font-semibold underline" onClick={onOpenAction}>
            Abrir caixa de entrada
          </button>
        </div>
        {(dashboard.attentionNow ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nenhum item crítico no momento.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {(dashboard.attentionNow ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {item.channel === "TECHNICAL" ? "Integração" : item.type}
                  </p>
                  <p className="font-medium">{item.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.company}
                    {item.processNumber ? ` · ${item.processNumber}` : ""}
                    {` · ${formatExposureDateTime(item.at) ?? ""}`}
                  </p>
                </div>
                {item.caseId ? (
                  <button type="button" className="text-sm font-semibold underline" onClick={() => onOpenCase(item.caseId!)}>
                    Ver processo
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-base font-semibold">Panorama por empresa</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {dashboard.entities.map((entity) => (
            <article key={entity.id} className="rounded-2xl border border-border bg-card p-5">
              <h4 className="text-lg font-semibold tracking-tight">{entity.legalName}</h4>
              <p className="text-xs text-muted-foreground">CNPJ {entity.cnpj}</p>
              <dl className="mt-4 space-y-1 text-sm">
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Processos únicos</dt><dd className="font-medium">{entity.monitoredCases}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Polo passivo</dt><dd className="font-medium">{entity.polePassive ?? 0}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Polo ativo</dt><dd className="font-medium">{entity.poleActive ?? 0}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Ações abertas</dt><dd className="font-medium">{entity.actionRequired}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Valor conhecido</dt><dd className="font-medium">{entity.knownClaimTotalFormatted ?? "—"}</dd></div>
                <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Última atualização</dt><dd className="font-medium">{formatExposureDateTime(entity.lastSuccessfulSyncAt) ?? "nunca"}</dd></div>
              </dl>
              <button
                type="button"
                className="mt-4 text-sm font-semibold underline"
                onClick={() => onOpenCases({ entityId: entity.id })}
              >
                Ver processos
              </button>
            </article>
          ))}
        </div>
      </section>

      {quality ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold">Qualidade da informação</h3>
          <p className="mt-1 text-xs text-muted-foreground">Completude dos dados consultados — não é risco jurídico.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <p>Reclamante identificado: {quality.claimantIdentifiedPct}%</p>
            <p>Polo identificado: {quality.groupPolesIdentifiedPct}%</p>
            <p>Valor da causa: {quality.claimValuePct}%</p>
            <p>DataJud enriquecido: {quality.datajudEnrichedPct}%</p>
          </div>
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">{dashboard.absenceIsNotClearance || ABSENCE_IS_NOT_CLEARANCE_COPY}</p>
      {dashboard.emptyState ? <p className="text-sm font-medium">{dashboard.emptyState}</p> : null}
    </div>
  );
}
