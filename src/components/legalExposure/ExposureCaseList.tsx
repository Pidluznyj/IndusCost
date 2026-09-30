/**
 * Lista executiva de processos do Exposure. Sem rawMetadata e sem "polo UNKNOWN".
 */

import React from "react";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CASE_CLAIM_VALUE_UNKNOWN_COPY,
  CASE_CLAIMANT_UNKNOWN_COPY,
  CASE_CLASS_UNKNOWN_COPY,
  CASE_FILED_AT_LABEL,
  CASE_HEARING_UNKNOWN_COPY,
  CASE_POLE_UNCONFIRMED_COPY,
  CASE_STAGE_UNKNOWN_COPY,
  LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT,
  MULTIPLE_GROUP_NOTE,
  NO_CASES_IDENTIFIED_COPY,
  SOURCE_KIND_LABELS,
  SOURCE_LABELS,
  type ExposureCaseListItem,
  type Page,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  caseEnrichmentLabel,
  caseFiledAtLabel,
  caseMovementLabel,
  casePoleLabel,
  caseVerificationLabel,
  formatExposureDateTime,
} from "@/src/lib/legalExposure/legalExposureCaseListUi";

export type ExposureCaseListFilters = {
  q: string;
  entityId: string;
  tribunal: string;
  source: string;
  verification: string;
  enrichment: string;
  pole: string;
  stage: string;
  hasHearing: string;
  hasRequiredAction: string;
  multipleGroup: string;
  page: number;
};

export const EMPTY_CASE_LIST_FILTERS: ExposureCaseListFilters = {
  q: "",
  entityId: "",
  tribunal: "",
  source: "",
  verification: "",
  enrichment: "",
  pole: "",
  stage: "",
  hasHearing: "",
  hasRequiredAction: "",
  multipleGroup: "",
  page: 1,
};

export type ExposureCaseListEntityOption = {
  id: string;
  legalName: string;
};

type Props = {
  cases: Page<ExposureCaseListItem> | null;
  entities: ExposureCaseListEntityOption[];
  filters: ExposureCaseListFilters;
  onFilterChange: (patch: Partial<ExposureCaseListFilters>) => void;
  onClearFilters: () => void;
  onPageChange: (page: number) => void;
  onOpenCase: (caseId: string) => void;
};

function FilterSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
      {props.label}
      <select
        className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      >
        {props.children}
      </select>
    </label>
  );
}

function CaseCard(props: { item: ExposureCaseListItem; onOpenCase: (caseId: string) => void }) {
  const { item, onOpenCase } = props;
  const verified = item.verificationStatus === "CONFIRMED_OFFICIAL";
  const claimant = item.claimants[0];
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-semibold tracking-tight">{item.processNumber}</p>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
            verified
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-slate-200 bg-slate-50 text-slate-700"
          }`}
        >
          {caseVerificationLabel(item.verificationStatus)}
        </span>
      </div>
      {item.groupEntities.length > 1 ? (
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {item.groupEntities.length} empresas do grupo neste processo
        </p>
      ) : null}
      <p className="mt-1 text-sm">
        {[item.jurisdiction, item.tribunal].filter(Boolean).join(" · ") || "Tribunal não informado"}
      </p>
      <p className="text-sm text-muted-foreground">{item.courtUnit || "Vara não informada"}</p>

      <div className="mt-3 space-y-1 text-sm">
        <p className="text-xs font-semibold uppercase text-muted-foreground">Empresas do grupo</p>
        <div className="flex flex-wrap gap-2">
          {item.groupEntities.map((entity) => (
            <span key={entity.id} className="rounded-full border border-border px-2 py-0.5 text-xs">
              {entity.legalName} · {entity.pole === "UNKNOWN" ? CASE_POLE_UNCONFIRMED_COPY : casePoleLabel(entity.pole)}
              {entity.displayCnpj ? ` · ${entity.displayCnpj}` : ""}
            </span>
          ))}
        </div>
        <p className="text-xs font-semibold uppercase text-muted-foreground">Reclamante</p>
        <p>{claimant ? `${claimant.name}${claimant.partyType ? ` · ${claimant.partyType}` : ""}` : CASE_CLAIMANT_UNKNOWN_COPY}</p>
        <p>Classe: {item.className ?? CASE_CLASS_UNKNOWN_COPY}</p>
        <p>Valor da causa: {item.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}</p>
        <p>
          {CASE_FILED_AT_LABEL}: {caseFiledAtLabel(item.filedAt)}
        </p>
        <p>Fase: {item.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : item.stageLabel}</p>
        <p>Última movimentação: {caseMovementLabel(item.latestMovement)}</p>
        <p>
          Próximo evento:{" "}
          {item.nextHearing
            ? `${formatExposureDateTime(item.nextHearing.scheduledAt) ?? item.nextHearing.scheduledAt} · ${item.nextHearing.type ?? "Audiência"}`
            : CASE_HEARING_UNKNOWN_COPY}
        </p>
        <p>
          {item.movementCount} movimentações · {item.publicationCount} publicações · {item.openAlertCount} ação requerida
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {item.evidenceSources.map((source) => (
            <span
              key={source}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
            >
              {SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source]}
            </span>
          ))}
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
            {caseEnrichmentLabel(item.enrichmentStatus)}
          </span>
        </div>
        <button
          type="button"
          className="text-sm font-semibold underline"
          onClick={() => onOpenCase(item.id)}
        >
          Ver processo
        </button>
      </div>
      {item.attentionLabels.map((label) => (
        <p key={label} className="mt-2 text-sm">
          ⚠ {label}
        </p>
      ))}
    </article>
  );
}

export function ExposureCaseList({
  cases,
  entities,
  filters,
  onFilterChange,
  onClearFilters,
  onPageChange,
  onOpenCase,
}: Props) {
  const total = cases?.total ?? 0;
  const page = cases?.page ?? filters.page;
  const pageSize = cases?.pageSize ?? LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = total > pageSize;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{ABSENCE_IS_NOT_CLEARANCE_COPY}</p>
      <p className="text-xs text-muted-foreground">{MULTIPLE_GROUP_NOTE}</p>
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Número CNJ
            <input
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
              value={filters.q}
              onChange={(event) => onFilterChange({ q: event.target.value, page: 1 })}
              placeholder="Buscar processo"
            />
          </label>
          <FilterSelect
            label="Empresa"
            value={filters.entityId}
            onChange={(value) => onFilterChange({ entityId: value, page: 1 })}
          >
            <option value="">Todas</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.legalName}
              </option>
            ))}
          </FilterSelect>
          <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Tribunal
            <input
              className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
              value={filters.tribunal}
              onChange={(event) => onFilterChange({ tribunal: event.target.value, page: 1 })}
              placeholder="Ex.: TRT9"
            />
          </label>
          <FilterSelect
            label="Fonte"
            value={filters.source}
            onChange={(value) => onFilterChange({ source: value, page: 1 })}
          >
            <option value="">Todas</option>
            <option value="DJEN">DJEN</option>
            <option value="DATAJUD">DataJud</option>
            <option value="ESCAVADOR">Escavador</option>
            <option value="DOMICILIO">Domicílio</option>
          </FilterSelect>
          <FilterSelect
            label="Confirmação"
            value={filters.verification}
            onChange={(value) => onFilterChange({ verification: value, page: 1 })}
          >
            <option value="">Todas</option>
            <option value="CONFIRMED_OFFICIAL">Confirmado em fonte oficial</option>
            <option value="REVIEW_REQUIRED">Sem confirmação oficial</option>
          </FilterSelect>
          <FilterSelect
            label="Enriquecimento"
            value={filters.enrichment}
            onChange={(value) => onFilterChange({ enrichment: value, page: 1 })}
          >
            <option value="">Todos</option>
            <option value="DATAJUD_ENRICHED">Dados DataJud disponíveis</option>
            <option value="DJEN_ONLY">Aguardando enriquecimento DataJud</option>
            <option value="PARTIAL">Parcial</option>
          </FilterSelect>
          <FilterSelect
            label="Polo"
            value={filters.pole}
            onChange={(value) => onFilterChange({ pole: value, page: 1 })}
          >
            <option value="">Todos</option>
            <option value="PASSIVE">Ré / polo passivo</option>
            <option value="ACTIVE">Autora / polo ativo</option>
            <option value="THIRD_PARTY">Terceira interessada</option>
            <option value="OTHER">Outro polo</option>
            <option value="UNKNOWN">Polo ainda não identificado</option>
          </FilterSelect>
          <FilterSelect
            label="Fase"
            value={filters.stage}
            onChange={(value) => onFilterChange({ stage: value, page: 1 })}
          >
            <option value="">Todas</option>
            <option value="INITIAL">Fase inicial</option>
            <option value="INSTRUCTION">Instrução</option>
            <option value="DECISION">Julgamento/decisão</option>
            <option value="APPEAL">Recurso</option>
            <option value="LIQUIDATION">Liquidação</option>
            <option value="ENFORCEMENT">Execução</option>
            <option value="ARCHIVED">Arquivado</option>
            <option value="UNKNOWN">Não determinada</option>
          </FilterSelect>
          <FilterSelect
            label="Audiência futura"
            value={filters.hasHearing}
            onChange={(value) => onFilterChange({ hasHearing: value, page: 1 })}
          >
            <option value="">Todas</option>
            <option value="true">Com audiência futura</option>
          </FilterSelect>
          <FilterSelect
            label="Ação requerida"
            value={filters.hasRequiredAction}
            onChange={(value) => onFilterChange({ hasRequiredAction: value, page: 1 })}
          >
            <option value="">Todas</option>
            <option value="true">Com ação requerida</option>
          </FilterSelect>
          <FilterSelect
            label="Múltiplas empresas"
            value={filters.multipleGroup}
            onChange={(value) => onFilterChange({ multipleGroup: value, page: 1 })}
          >
            <option value="">Todas</option>
            <option value="true">Mais de uma empresa do grupo</option>
          </FilterSelect>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">
            {total} {total === 1 ? "processo encontrado" : "processos encontrados"}
          </p>
          <button type="button" className="text-sm font-semibold underline" onClick={onClearFilters}>
            Limpar filtros
          </button>
        </div>
      </div>

      {(cases?.items ?? []).length === 0 ? <p className="text-sm">{NO_CASES_IDENTIFIED_COPY}</p> : null}
      {(cases?.items ?? []).map((item) => (
        <CaseCard key={item.id} item={item} onOpenCase={onOpenCase} />
      ))}

      {showPagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Anterior
          </button>
          <p className="text-sm">
            Página {page} de {pageCount}
          </p>
          <button
            type="button"
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
          </button>
        </div>
      ) : null}
    </div>
  );
}
