/**
 * Lista executiva de processos do Exposure. Triagem rápida, filtros recolhíveis.
 */

import React, { useState } from "react";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CASE_AWAITING_DATAJUD_COPY,
  CASE_CLAIM_VALUE_UNKNOWN_COPY,
  CASE_CLASS_UNKNOWN_COPY,
  CASE_STAGE_UNKNOWN_COPY,
  EXPOSURE_LOADING_COPY,
  LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT,
  MULTIPLE_GROUP_NOTE,
  NO_CASES_FILTER_COPY,
  NO_CASES_IDENTIFIED_COPY,
  SOURCE_KIND_LABELS,
  SOURCE_LABELS,
  type ExposureCaseListItem,
  type Page,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  caseFiledAtLabel,
  caseMovementLabel,
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
  cases: (Page<ExposureCaseListItem> & { physicalCaseCount?: number; uniqueProcessCount?: number }) | null;
  entities: ExposureCaseListEntityOption[];
  filters: ExposureCaseListFilters;
  loading?: boolean;
  error?: string | null;
  defaultAdvancedFiltersOpen?: boolean;
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
  const where = [item.courtUnit, item.tribunal].filter(Boolean).join(" · ");
  const claimant = item.claimants[0]?.name;
  const incomplete = !claimant || !item.claimValueFormatted || item.stage === "UNKNOWN";
  const archived = item.stage === "ARCHIVED" || Boolean(item.currentStatus?.toLowerCase().includes("arquiv"));
  const hearingSoon = Boolean(item.nextHearing);
  const required = item.openAlertCount > 0;
  const secret = Boolean(item.secrecy);
  const tone = required
    ? "border-amber-300 hover:border-amber-400"
    : hearingSoon
      ? "border-sky-200 hover:border-sky-300"
      : archived
        ? "border-slate-200 opacity-90"
        : incomplete
          ? "border-slate-300"
          : "border-border hover:border-slate-400";
  function open() {
    onOpenCase(item.id);
  }
  return (
    <article
      data-testid="exposure-case-card"
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      className={`cursor-pointer rounded-2xl border bg-card p-5 shadow-sm transition hover:shadow-md ${tone}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold tracking-tight text-[1.05rem]">{item.processNumber}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {[item.className ?? CASE_CLASS_UNKNOWN_COPY, item.tribunal].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] uppercase tracking-wide text-emerald-800">
          {caseVerificationLabel(item.verificationStatus)}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Reclamante</p>
          <p className="mt-1 text-base font-semibold tracking-tight">{claimant ?? "Autor/reclamante ainda não identificado"}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Contra</p>
          <div className="mt-1 space-y-1">
            {item.groupEntities.map((entity) => (
              <div key={entity.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold">{entity.legalName}</p>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {entity.pole === "PASSIVE" ? "Ré · grupo" : entity.pole === "ACTIVE" ? "Autora · grupo" : "Grupo"}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 text-sm">
        <p className="text-lg font-semibold">{item.claimValueFormatted ?? CASE_CLAIM_VALUE_UNKNOWN_COPY}</p>
        <p className="text-muted-foreground">{caseFiledAtLabel(item.filedAt)}</p>
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p>
          <span className="text-muted-foreground">Fase: </span>
          {item.stage === "UNKNOWN" ? CASE_STAGE_UNKNOWN_COPY : item.stageLabel}
        </p>
        <p>
          <span className="text-muted-foreground">Último: </span>
          {caseMovementLabel(item.latestMovement)}
        </p>
        {item.nextHearing ? (
          <p>
            <span className="text-muted-foreground">Próxima audiência: </span>
            {formatExposureDateTime(item.nextHearing.scheduledAt) ?? "data não informada"}
            {item.nextHearing.type ? ` · ${item.nextHearing.type}` : ""}
          </p>
        ) : null}
        {required ? (
          <p className="font-medium text-amber-900">
            {item.openAlertCount} {item.openAlertCount === 1 ? "ação requerida" : "ações requeridas"}
          </p>
        ) : null}
        {item.enrichmentStatus === "DJEN_ONLY" ? (
          <p className="text-xs text-muted-foreground">{CASE_AWAITING_DATAJUD_COPY}</p>
        ) : null}
        {archived ? <p className="text-xs text-muted-foreground">Arquivado</p> : null}
        {secret ? <p className="text-xs text-muted-foreground">Segredo de justiça</p> : null}
        {where ? <p className="text-xs text-muted-foreground">{where}</p> : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2">
          {item.evidenceSources.map((source) => (
            <span key={source} className="rounded-full border border-border px-2 py-0.5 text-[11px]">
              {SOURCE_KIND_LABELS[source] ?? SOURCE_LABELS[source]}
            </span>
          ))}
        </div>
        <button type="button" className="text-sm font-semibold underline" onClick={(event) => { event.stopPropagation(); open(); }}>
          Ver processo
        </button>
      </div>
    </article>
  );
}

export function ExposureCaseList({
  cases,
  entities,
  filters,
  loading,
  error,
  defaultAdvancedFiltersOpen = false,
  onFilterChange,
  onClearFilters,
  onPageChange,
  onOpenCase,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(defaultAdvancedFiltersOpen);
  const total = cases?.total ?? 0;
  const page = cases?.page ?? filters.page;
  const pageSize = cases?.pageSize ?? LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = total > pageSize;
  const hasActiveFilter = Boolean(
    filters.q.trim() ||
      filters.entityId ||
      filters.tribunal.trim() ||
      filters.source ||
      filters.verification ||
      filters.enrichment ||
      filters.pole ||
      filters.stage ||
      filters.hasHearing ||
      filters.hasRequiredAction ||
      filters.multipleGroup
  );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{ABSENCE_IS_NOT_CLEARANCE_COPY}</p>
      <p className="text-xs text-muted-foreground">{MULTIPLE_GROUP_NOTE}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          className="min-w-[16rem] flex-[2] rounded-xl border border-border bg-card px-4 py-2.5 text-sm"
          value={filters.q}
          onChange={(event) => onFilterChange({ q: event.target.value, page: 1 })}
          placeholder="Buscar CNJ, parte, empresa ou assunto"
        />
        <FilterSelect label="Empresa" value={filters.entityId} onChange={(value) => onFilterChange({ entityId: value, page: 1 })}>
          <option value="">Todas</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.legalName}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Situação/Fase" value={filters.stage} onChange={(value) => onFilterChange({ stage: value, page: 1 })}>
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
        <FilterSelect label="Ação requerida" value={filters.hasRequiredAction} onChange={(value) => onFilterChange({ hasRequiredAction: value, page: 1 })}>
          <option value="">Todas</option>
          <option value="true">Com ação requerida</option>
        </FilterSelect>
        <button
          type="button"
          className="rounded-xl border border-border px-3 py-2.5 text-sm font-semibold"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Filtros avançados
        </button>
        {hasActiveFilter ? (
          <button type="button" className="text-sm font-semibold underline" onClick={onClearFilters}>
            Limpar filtros
          </button>
        ) : null}
      </div>
      {advancedOpen ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-[8rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Tribunal
              <input
                className="rounded-lg border border-border bg-card px-2 py-1.5 text-sm text-foreground"
                value={filters.tribunal}
                onChange={(event) => onFilterChange({ tribunal: event.target.value, page: 1 })}
                placeholder="Ex.: TRT9"
              />
            </label>
            <FilterSelect label="Fonte" value={filters.source} onChange={(value) => onFilterChange({ source: value, page: 1 })}>
              <option value="">Todas</option>
              <option value="DJEN">DJEN</option>
              <option value="DATAJUD">DataJud</option>
              <option value="ESCAVADOR">Escavador</option>
              <option value="DOMICILIO">Domicílio</option>
            </FilterSelect>
            <FilterSelect label="Confirmação" value={filters.verification} onChange={(value) => onFilterChange({ verification: value, page: 1 })}>
              <option value="">Todas</option>
              <option value="CONFIRMED_OFFICIAL">Confirmado em fonte oficial</option>
              <option value="REVIEW_REQUIRED">Sem confirmação oficial</option>
            </FilterSelect>
            <FilterSelect label="Enriquecimento" value={filters.enrichment} onChange={(value) => onFilterChange({ enrichment: value, page: 1 })}>
              <option value="">Todos</option>
              <option value="DATAJUD_ENRICHED">Dados DataJud disponíveis</option>
              <option value="DJEN_ONLY">Aguardando enriquecimento DataJud</option>
              <option value="PARTIAL">Parcial</option>
            </FilterSelect>
            <FilterSelect label="Polo" value={filters.pole} onChange={(value) => onFilterChange({ pole: value, page: 1 })}>
              <option value="">Todos</option>
              <option value="PASSIVE">Ré / polo passivo</option>
              <option value="ACTIVE">Autora / polo ativo</option>
              <option value="THIRD_PARTY">Terceira interessada</option>
              <option value="OTHER">Outro polo</option>
              <option value="UNKNOWN">Polo ainda não identificado</option>
            </FilterSelect>
            <FilterSelect label="Audiência futura" value={filters.hasHearing} onChange={(value) => onFilterChange({ hasHearing: value, page: 1 })}>
              <option value="">Todas</option>
              <option value="true">Com audiência futura</option>
            </FilterSelect>
            <FilterSelect label="Múltiplas empresas" value={filters.multipleGroup} onChange={(value) => onFilterChange({ multipleGroup: value, page: 1 })}>
              <option value="">Todas</option>
              <option value="true">Mais de uma empresa do grupo</option>
            </FilterSelect>
          </div>
        </div>
      ) : null}
      <div>
        <p className="text-sm font-medium">
          {total} {total === 1 ? "processo único" : "processos únicos"}
        </p>
        {typeof cases?.physicalCaseCount === "number" &&
        typeof cases?.uniqueProcessCount === "number" &&
        cases.physicalCaseCount > cases.uniqueProcessCount ? (
          <p className="text-xs text-muted-foreground">
            {cases.physicalCaseCount} registros históricos consolidados em {cases.uniqueProcessCount} processos CNJ.
          </p>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {loading ? <p className="text-sm text-muted-foreground">{EXPOSURE_LOADING_COPY}</p> : null}
      {!loading && (cases?.items ?? []).length === 0 ? (
        <p className="text-sm">{hasActiveFilter ? NO_CASES_FILTER_COPY : NO_CASES_IDENTIFIED_COPY}</p>
      ) : null}
      {!loading ? (
        <div className="grid gap-4 lg:grid-cols-2" data-testid="exposure-case-grid">
          {(cases?.items ?? []).map((item) => (
            <CaseCard key={item.canonicalCaseId || item.id} item={item} onOpenCase={onOpenCase} />
          ))}
        </div>
      ) : null}

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
