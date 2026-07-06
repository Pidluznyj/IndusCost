import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import type { FinanceCostCenterAuditSortField } from "@/src/lib/financeCostCenterAudit";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  FinanceCostCenterGridActiveFilters,
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridSummary,
  FinanceCostCenterGridTableShell,
  FinanceCostCenterSortableTh,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  clampFinanceGridPage,
  readFinanceGridUrlInt,
  readFinanceGridUrlSort,
  readFinanceGridUrlString,
  toggleSortState,
  writeFinanceGridUrlParams,
} from "@/src/lib/financeCostCenterGridKit";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { FinanceCostCenterReclassificationPanel } from "@/src/components/finance/cost-centers/FinanceCostCenterReclassificationPanel";

type AuditLogRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userName: string | null;
  createdAt: string;
};

type AuditListPayload = {
  page: number;
  limit: number;
  total: number;
  items: AuditLogRow[];
};

const AUDIT_SORT_KEYS = ["createdAt", "userName", "action", "entityType"] as const;

type Props = {
  canView: boolean;
  canManage?: boolean;
};

export function FinanceCostCenterAuditTab({ canView, canManage = false }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [payload, setPayload] = useState<AuditListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const entityType = readFinanceGridUrlString(searchParams, "aud_entity");
  const userName = readFinanceGridUrlString(searchParams, "aud_user");
  const action = readFinanceGridUrlString(searchParams, "aud_action");
  const search = readFinanceGridUrlString(searchParams, "aud_q");
  const dateFrom = readFinanceGridUrlString(searchParams, "aud_from");
  const dateTo = readFinanceGridUrlString(searchParams, "aud_to");
  const page = readFinanceGridUrlInt(searchParams, "aud_page", 1);
  const pageSize = readFinanceGridUrlInt(searchParams, "aud_limit", 50, 1, 500);
  const sort = readFinanceGridUrlSort(
    searchParams,
    "aud_sort",
    "aud_dir",
    AUDIT_SORT_KEYS,
    { key: "createdAt", direction: "desc" }
  );
  const sortKey = sort.key;
  const sortDirection = sort.direction;

  const patchUrl = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      setSearchParams(writeFinanceGridUrlParams(searchParams, patch), { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      if (entityType.trim()) q.set("entityType", entityType.trim());
      if (userName.trim()) q.set("userName", userName.trim());
      if (action.trim()) q.set("action", action.trim());
      if (search.trim()) q.set("search", search.trim());
      if (dateFrom.trim()) q.set("dateFrom", dateFrom.trim());
      if (dateTo.trim()) q.set("dateTo", dateTo.trim());
      q.set("page", String(page));
      q.set("limit", String(pageSize));
      q.set("sortBy", sortKey);
      q.set("sortDirection", sortDirection);
      const data = await fetchJsonOk<AuditListPayload>(
        `/api/finance/cost-center-audit?${q.toString()}`,
        { credentials: "include" }
      );
      setPayload(data);
    } catch (e) {
      setPayload(null);
      setError(buildFinanceTabLoadError("Não foi possível carregar a auditoria de classificação.", e));
    } finally {
      setLoading(false);
    }
  }, [
    canView,
    entityType,
    userName,
    action,
    search,
    dateFrom,
    dateTo,
    page,
    pageSize,
    sortKey,
    sortDirection,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = payload?.items ?? [];
  const total = payload?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const hasActiveFilters = Boolean(
    entityType.trim() || userName.trim() || action.trim() || search.trim() || dateFrom || dateTo
  );

  const emptyCopy = hasActiveFilters
    ? {
        title: "Nenhum registro no filtro",
        description: "Ajuste datas, entidade, usuário ou busca para ver outros registros.",
      }
    : {
        title: "Nenhum registro de auditoria",
        description:
          "As alterações em centros de custo, regras e classificações aparecerão aqui conforme forem registradas.",
      };

  const handleSort = (key: FinanceCostCenterAuditSortField) => {
    const next = toggleSortState(sort, key, key === "createdAt" ? "desc" : "asc");
    patchUrl({ aud_sort: next.key, aud_dir: next.direction, aud_page: 1 });
  };

  const filterChips = [
    ...(entityType.trim()
      ? [{ key: "entity", label: `Entidade: ${entityType}`, onRemove: () => patchUrl({ aud_entity: null, aud_page: 1 }) }]
      : []),
    ...(userName.trim()
      ? [{ key: "user", label: `Usuário: ${userName}`, onRemove: () => patchUrl({ aud_user: null, aud_page: 1 }) }]
      : []),
    ...(action.trim()
      ? [{ key: "action", label: `Ação: ${action}`, onRemove: () => patchUrl({ aud_action: null, aud_page: 1 }) }]
      : []),
    ...(search.trim()
      ? [{ key: "q", label: `Busca: ${search}`, onRemove: () => patchUrl({ aud_q: null, aud_page: 1 }) }]
      : []),
    ...(dateFrom
      ? [{ key: "from", label: `De: ${dateFrom}`, onRemove: () => patchUrl({ aud_from: null, aud_page: 1 }) }]
      : []),
    ...(dateTo
      ? [{ key: "to", label: `Até: ${dateTo}`, onRemove: () => patchUrl({ aud_to: null, aud_page: 1 }) }]
      : []),
  ];

  if (!canView) {
    return (
      <FinanceModuleEmptyState
        title="Sem permissão para auditoria"
        description="Solicite acesso à auditoria de classificação para consultar o histórico de alterações."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-audit-tab">
      <FinanceCostCenterReclassificationPanel canManage={canManage} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <FinanceCostCenterGridSearchBar
            value={search}
            onChange={(value) => patchUrl({ aud_q: value || null, aud_page: 1 })}
            placeholder="Texto livre"
            testId="finance-audit-search"
          />
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Entidade</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={entityType}
              onChange={(e) => patchUrl({ aud_entity: e.target.value || null, aud_page: 1 })}
              placeholder="Ex.: FinancialCostCenter"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Usuário</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={userName}
              onChange={(e) => patchUrl({ aud_user: e.target.value || null, aud_page: 1 })}
              placeholder="Nome do usuário"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Ação</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={action}
              onChange={(e) => patchUrl({ aud_action: e.target.value || null, aud_page: 1 })}
              placeholder="Tipo de ação"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Data inicial</span>
            <input
              type="date"
              className={financeModuleFilterFieldClass()}
              value={dateFrom}
              onChange={(e) => patchUrl({ aud_from: e.target.value || null, aud_page: 1 })}
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Data final</span>
            <input
              type="date"
              className={financeModuleFilterFieldClass()}
              value={dateTo}
              onChange={(e) => patchUrl({ aud_to: e.target.value || null, aud_page: 1 })}
            />
          </label>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      <FinanceCostCenterGridActiveFilters
        chips={filterChips}
        onClear={
          hasActiveFilters
            ? () =>
                patchUrl({
                  aud_entity: null,
                  aud_user: null,
                  aud_action: null,
                  aud_q: null,
                  aud_from: null,
                  aud_to: null,
                  aud_page: 1,
                })
            : undefined
        }
      />

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando auditoria…" /> : null}

      {!loading && rows.length === 0 ? (
        <FinanceModuleEmptyState title={emptyCopy.title} description={emptyCopy.description} />
      ) : null}

      {!loading && rows.length > 0 ? (
        <>
          <FinanceCostCenterGridSummary
            totals={{ rowCount: total }}
            filteredCount={total}
            page={clampFinanceGridPage(page, totalPages)}
            totalPages={totalPages}
            amountLabel="Registros"
          />
          <FinanceCostCenterGridTableShell
            tableClassName="min-w-[720px]"
            head={
              <tr className="border-b border-border text-left">
                <FinanceCostCenterSortableTh label="Data" sortKey="createdAt" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Entidade" sortKey="entityType" sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">ID</th>
                <FinanceCostCenterSortableTh label="Ação" sortKey="action" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Usuário" sortKey="userName" sort={sort} onSort={handleSort} />
              </tr>
            }
            footer={
              <FinanceCostCenterGridPagination
                page={clampFinanceGridPage(page, totalPages)}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={(nextPage) => patchUrl({ aud_page: nextPage })}
                onPageSizeChange={(nextSize) => patchUrl({ aud_limit: nextSize, aud_page: 1 })}
              />
            }
          >
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDateTime(row.createdAt)}</td>
                <td className="px-3 py-2">{row.entityType}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.entityId}</td>
                <td className="px-3 py-2">{row.action}</td>
                <td className="px-3 py-2">{row.userName ?? "—"}</td>
              </tr>
            ))}
          </FinanceCostCenterGridTableShell>
        </>
      ) : null}
    </div>
  );
}
