/**
 * Tela — Central de Exceções da Tesouraria.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type { TreasuryExceptionDto } from "@/src/lib/treasury/contracts/index.js";
import {
  acknowledgeTreasuryException,
  assignTreasuryException,
  fetchTreasuryExceptions,
  ignoreTreasuryException,
  resolveTreasuryException,
  setTreasuryExceptionDueAt,
  setTreasuryExceptionStatus,
} from "@/src/lib/treasury/treasuryExceptionsApi.js";
import {
  canManageTreasuryExceptions,
  canViewTreasuryExceptions,
} from "@/src/lib/treasury/treasuryExceptionsPermissions.js";
import {
  TREASURY_EXCEPTIONS_PAGE_SUBTITLE,
  TREASURY_EXCEPTIONS_PAGE_TITLE,
  createEmptyTreasuryExceptionsFilters,
  isTreasuryExceptionSeverity,
  isTreasuryExceptionStatus,
  resolveTreasuryExceptionsViewKind,
  type TreasuryExceptionsFilterState,
} from "@/src/lib/treasury/treasuryExceptionsUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryExceptionsPanel } from "./TreasuryExceptionsPanel.js";

function readFilters(params: URLSearchParams): TreasuryExceptionsFilterState {
  const base = createEmptyTreasuryExceptionsFilters();
  const statusRaw = params.get("status") ?? "";
  const severityRaw = params.get("severity") ?? "";
  const sortBy = params.get("sortBy") ?? base.sortBy;
  const sortDirectionRaw = params.get("sortDirection") ?? base.sortDirection;
  return {
    status: isTreasuryExceptionStatus(statusRaw) ? statusRaw : base.status,
    severity: isTreasuryExceptionSeverity(severityRaw)
      ? severityRaw
      : base.severity,
    type: params.get("type") ?? "",
    companyCode: params.get("companyCode") ?? "",
    responsibleUserId: params.get("responsibleUserId") ?? "",
    search: params.get("search") ?? "",
    sortBy,
    sortDirection: sortDirectionRaw === "asc" ? "asc" : "desc",
  };
}

function filtersToParams(
  filters: TreasuryExceptionsFilterState
): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.severity) qs.set("severity", filters.severity);
  if (filters.type.trim()) qs.set("type", filters.type.trim());
  if (filters.companyCode.trim())
    qs.set("companyCode", filters.companyCode.trim());
  if (filters.responsibleUserId.trim()) {
    qs.set("responsibleUserId", filters.responsibleUserId.trim());
  }
  if (filters.search.trim()) qs.set("search", filters.search.trim());
  if (filters.sortBy) qs.set("sortBy", filters.sortBy);
  if (filters.sortDirection) qs.set("sortDirection", filters.sortDirection);
  return qs;
}

export function TreasuryExceptionsPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryExceptions(permCheck);
  const canManage = canManageTreasuryExceptions(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const [items, setItems] = useState<TreasuryExceptionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!canView) return;
    const ticket = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchTreasuryExceptions({
        page: 1,
        pageSize: 100,
        status: filters.status || null,
        severity: filters.severity || null,
        type: filters.type || null,
        companyCode: filters.companyCode || null,
        responsibleUserId: filters.responsibleUserId || null,
        search: filters.search || null,
        sortBy: filters.sortBy,
        sortDirection: filters.sortDirection,
      });
      if (ticket !== seq.current) return;
      setItems(list.items);
    } catch (err) {
      if (ticket !== seq.current) return;
      setError(
        buildFinanceTabLoadError(err, "Não foi possível carregar exceções.")
      );
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const viewKind = resolveTreasuryExceptionsViewKind({
    canView,
    loading,
    error,
    itemCount: items.length,
  });

  function onFiltersChange(next: TreasuryExceptionsFilterState) {
    setSearchParams(filtersToParams(next), { replace: true });
  }

  async function onAcknowledge(row: TreasuryExceptionDto) {
    try {
      await acknowledgeTreasuryException(row.id, {
        expectedVersion: row.version,
        justification: "Colocada em análise.",
      });
      await load();
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao alterar status."));
    }
  }

  async function onAssign(row: TreasuryExceptionDto) {
    const responsibleUserId = window.prompt(
      "ID do responsável (vazio para desatribuir):",
      row.responsibleUserId ?? ""
    );
    if (responsibleUserId === null) return;
    try {
      await assignTreasuryException(row.id, {
        expectedVersion: row.version,
        responsibleUserId: responsibleUserId.trim() || null,
      });
      await load();
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao atribuir."));
    }
  }

  async function onSetDueAt(row: TreasuryExceptionDto) {
    const dueAt = window.prompt(
      "Prazo (YYYY-MM-DD; vazio para limpar):",
      row.dueAt ?? ""
    );
    if (dueAt === null) return;
    try {
      await setTreasuryExceptionDueAt(row.id, {
        expectedVersion: row.version,
        dueAt: dueAt.trim() || null,
      });
      await load();
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao registrar prazo."));
    }
  }

  async function onSetStatus(row: TreasuryExceptionDto) {
    const status = window.prompt(
      "Status operacional (OPEN | IN_ANALYSIS | WAITING_THIRD_PARTY):",
      row.status === "ACK" ? "IN_ANALYSIS" : row.status
    );
    if (!status?.trim()) return;
    try {
      await setTreasuryExceptionStatus(row.id, {
        expectedVersion: row.version,
        status: status.trim() as "OPEN" | "IN_ANALYSIS" | "WAITING_THIRD_PARTY",
      });
      await load();
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao alterar status."));
    }
  }

  async function onResolve(row: TreasuryExceptionDto) {
    const resolution = window.prompt("Nota de resolução (obrigatória):");
    if (!resolution?.trim()) return;
    try {
      await resolveTreasuryException(row.id, {
        expectedVersion: row.version,
        resolution: resolution.trim(),
      });
      await load();
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao resolver."));
    }
  }

  async function onIgnore(row: TreasuryExceptionDto) {
    const ignoreJustification = window.prompt(
      "Justificativa para ignorar (obrigatória):"
    );
    if (!ignoreJustification?.trim()) return;
    try {
      await ignoreTreasuryException(row.id, {
        expectedVersion: row.version,
        ignoreJustification: ignoreJustification.trim(),
      });
      await load();
    } catch (err) {
      setError(buildFinanceTabLoadError(err, "Falha ao ignorar."));
    }
  }

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-exceptions-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_EXCEPTIONS_PAGE_TITLE}
          subtitle={TREASURY_EXCEPTIONS_PAGE_SUBTITLE}
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
        />

        {viewKind === "denied" ? (
          <p className="text-sm text-muted-foreground">
            Sem permissão para consultar exceções.
          </p>
        ) : null}
        {viewKind === "loading" ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : null}
        {viewKind === "error" ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : null}
        {viewKind === "empty" ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma exceção para os filtros atuais.
          </p>
        ) : null}
        {viewKind === "ready" || viewKind === "empty" ? (
          <TreasuryExceptionsPanel
            items={items}
            filters={filters}
            canManage={canManage}
            onFiltersChange={onFiltersChange}
            onAcknowledge={(row) => void onAcknowledge(row)}
            onAssign={(row) => void onAssign(row)}
            onSetDueAt={(row) => void onSetDueAt(row)}
            onSetStatus={(row) => void onSetStatus(row)}
            onResolve={(row) => void onResolve(row)}
            onIgnore={(row) => void onIgnore(row)}
          />
        ) : null}
      </div>
    </FinanceBiDashboardShell>
  );
}
