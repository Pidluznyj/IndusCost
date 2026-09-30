/**
 * Lista executiva de processos do Exposure. Sem rawMetadata e sem "polo UNKNOWN".
 */

import React from "react";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CASE_CLASS_UNKNOWN_COPY,
  CASE_DETECTED_LABEL,
  CASE_FILED_AT_LABEL,
  CASE_SOURCE_UPDATED_LABEL,
  LEGAL_EXPOSURE_PAGE_SIZE_DEFAULT,
  NO_CASES_IDENTIFIED_COPY,
  SOURCE_LABELS,
  type ExposureCaseListItem,
  type Page,
} from "@/src/lib/legalExposure/legalExposureContracts";
import {
  caseEnrichmentLabel,
  caseFiledAtLabel,
  caseMovementLabel,
  casePoleLabel,
  caseStatusLabel,
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
  const jurisdictionLine = [item.tribunal, item.courtUnit].filter(Boolean).join(" · ");
  const classLine = item.className ?? CASE_CLASS_UNKNOWN_COPY;
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
      <p className="mt-1 font-medium">{item.entity.legalName || "Empresa não identificada"}</p>
      <p className="text-xs text-muted-foreground">CNPJ {item.entity.displayCnpj}</p>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="space-y-1 text-sm">
          <p>{jurisdictionLine || "Tribunal/vara não informados"}</p>
          <p className="text-muted-foreground">{classLine}</p>
        </div>
        <div className="space-y-1 text-sm">
          <p>
            {CASE_FILED_AT_LABEL}: {caseFiledAtLabel(item.filedAt)}
          </p>
          <p>
            {CASE_DETECTED_LABEL}: {formatExposureDateTime(item.firstSeenAt) ?? item.firstSeenAt}
          </p>
          <p>
            {CASE_SOURCE_UPDATED_LABEL}:{" "}
            {formatExposureDateTime(item.sourceUpdatedAt) ?? "não informada pela fonte"}
          </p>
        </div>
        <div className="space-y-1 text-sm">
          <p>Polo: {casePoleLabel(item.entityPole)}</p>
          <p>Situação: {caseStatusLabel(item.currentStatus)}</p>
          <p>
            Última movimentação:
            <br />
            {caseMovementLabel(item.latestMovement)}
          </p>
          {item.latestPublication?.type ? (
            <p className="text-muted-foreground">Última publicação: {item.latestPublication.type}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {item.evidenceSources.map((source) => (
            <span
              key={source}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700"
            >
              {SOURCE_LABELS[source]}
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
