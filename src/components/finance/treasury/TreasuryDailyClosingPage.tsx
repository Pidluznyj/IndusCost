/**
 * Tela — Fechamento diário da Central de Tesouraria.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryDailyClosingDto,
  TreasuryDailyClosingPreviewDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  closeTreasuryDailyClosing,
  fetchTreasuryDailyClosingById,
  fetchTreasuryDailyClosingPreview,
  fetchTreasuryDailyClosings,
  reopenTreasuryDailyClosing,
} from "@/src/lib/treasury/treasuryDailyClosingApi.js";
import {
  canCloseTreasuryDailyClosing,
  canReopenTreasuryDailyClosing,
  canViewTreasuryDailyClosing,
} from "@/src/lib/treasury/treasuryDailyClosingPermissions.js";
import {
  TREASURY_DAILY_CLOSING_PAGE_SUBTITLE,
  TREASURY_DAILY_CLOSING_PAGE_TITLE,
  buildTreasuryDailyClosingCaveatPayload,
  buildTreasuryDailyClosingChecklist,
  isTreasuryDailyClosingChecklistReady,
  resolveTreasuryDailyClosingConflictMessage,
  resolveTreasuryDailyClosingViewKind,
  todayTreasuryCivilDateLocal,
} from "@/src/lib/treasury/treasuryDailyClosingUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryDailyClosingPanel } from "./TreasuryDailyClosingPanel.js";

const DENIED =
  "Sem permissão para consultar o fechamento diário da Tesouraria." as const;

export function TreasuryDailyClosingPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryDailyClosing(permCheck);
  const canClose = canCloseTreasuryDailyClosing(permCheck);
  const canReopen = canReopenTreasuryDailyClosing(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const civilDate =
    searchParams.get("date")?.trim() || todayTreasuryCivilDateLocal();
  const companyCode = searchParams.get("companyCode") ?? "";

  const [preview, setPreview] = useState<TreasuryDailyClosingPreviewDto | null>(
    null
  );
  const [history, setHistory] = useState<TreasuryDailyClosingDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [caveatDrafts, setCaveatDrafts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [compareLeftId, setCompareLeftId] = useState("");
  const [compareRightId, setCompareRightId] = useState("");
  const [compareLeft, setCompareLeft] = useState<TreasuryDailyClosingDto | null>(
    null
  );
  const [compareRight, setCompareRight] =
    useState<TreasuryDailyClosingDto | null>(null);
  const seq = useRef(0);

  const patchParams = useCallback(
    (patch: { date?: string; companyCode?: string }) => {
      const next = new URLSearchParams(searchParams);
      if (patch.date != null) {
        if (patch.date) next.set("date", patch.date);
        else next.delete("date");
      }
      if (patch.companyCode != null) {
        if (patch.companyCode.trim())
          next.set("companyCode", patch.companyCode.trim());
        else next.delete("companyCode");
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    if (!canView) return;
    const ticket = ++seq.current;
    setLoading(true);
    setError(null);
    setConflictMessage(null);
    try {
      const [prev, list] = await Promise.all([
        fetchTreasuryDailyClosingPreview({
          date: civilDate,
          companyCode: companyCode.trim() || null,
        }),
        fetchTreasuryDailyClosings({
          companyCode: companyCode.trim() || null,
          dateFrom: civilDate,
          dateTo: civilDate,
          page: 1,
          pageSize: 50,
        }),
      ]);
      if (ticket !== seq.current) return;
      setPreview(prev);
      setHistory(list.items);
      setCaveatDrafts((prevDrafts) => {
        const next: Record<string, string> = {};
        for (const code of prev.requiredCaveatCodes) {
          next[code] = prevDrafts[code] ?? "";
        }
        return next;
      });
    } catch (err) {
      if (ticket !== seq.current) return;
      setError(
        buildFinanceTabLoadError(
          err,
          "Não foi possível carregar o preview do fechamento."
        )
      );
    } finally {
      if (ticket === seq.current) setLoading(false);
    }
  }, [canView, civilDate, companyCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    async function loadCompare(id: string, side: "left" | "right") {
      if (!id) {
        if (side === "left") setCompareLeft(null);
        else setCompareRight(null);
        return;
      }
      try {
        const res = await fetchTreasuryDailyClosingById(id);
        if (cancelled) return;
        if (side === "left") setCompareLeft(res.closing);
        else setCompareRight(res.closing);
      } catch {
        if (cancelled) return;
        if (side === "left") setCompareLeft(null);
        else setCompareRight(null);
      }
    }
    void loadCompare(compareLeftId, "left");
    void loadCompare(compareRightId, "right");
    return () => {
      cancelled = true;
    };
  }, [compareLeftId, compareRightId]);

  const viewKind = resolveTreasuryDailyClosingViewKind({
    canView,
    loading,
    error,
    hasPreview: preview != null,
  });

  async function refreshPreviewOnly(): Promise<TreasuryDailyClosingPreviewDto | null> {
    const prev = await fetchTreasuryDailyClosingPreview({
      date: civilDate,
      companyCode: companyCode.trim() || null,
    });
    setPreview(prev);
    setCaveatDrafts((prevDrafts) => {
      const next: Record<string, string> = {};
      for (const code of prev.requiredCaveatCodes) {
        next[code] = prevDrafts[code] ?? "";
      }
      return next;
    });
    return prev;
  }

  async function onRequestConfirm() {
    if (!canClose || !companyCode.trim()) return;
    setBusy(true);
    setError(null);
    setConflictMessage(null);
    setSuccessMessage(null);
    try {
      const previousHash = preview?.sourceHash ?? null;
      const fresh = await refreshPreviewOnly();
      if (!fresh) return;
      if (previousHash && fresh.sourceHash !== previousHash) {
        setConflictMessage(
          "O preview mudou desde a última leitura. Revise resumo, bloqueios e pendências antes de confirmar."
        );
        setConfirming(false);
        return;
      }
      const ready = isTreasuryDailyClosingChecklistReady(
        buildTreasuryDailyClosingChecklist(fresh, caveatDrafts)
      );
      if (!ready || !fresh.canCloseWithCaveats) {
        setError(
          "Checklist incompleto após atualizar o preview. Resolva bloqueios ou preencha as ressalvas."
        );
        setConfirming(false);
        return;
      }
      setConfirming(true);
    } catch (err) {
      setError(
        buildFinanceTabLoadError(err, "Falha ao atualizar o preview.")
      );
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function onConfirmClose() {
    if (!canClose || !preview || !companyCode.trim()) return;
    setBusy(true);
    setError(null);
    setConflictMessage(null);
    try {
      // Atualiza preview imediatamente antes do POST (hash fresco).
      const fresh = await refreshPreviewOnly();
      if (!fresh) return;
      const caveats = buildTreasuryDailyClosingCaveatPayload(
        fresh.requiredCaveatCodes,
        caveatDrafts
      );
      if (
        !isTreasuryDailyClosingChecklistReady(
          buildTreasuryDailyClosingChecklist(fresh, caveatDrafts)
        )
      ) {
        setConflictMessage(
          "O preview mudou e o checklist não está pronto. Revise novamente antes de confirmar."
        );
        setConfirming(false);
        return;
      }
      await closeTreasuryDailyClosing({
        companyCode: companyCode.trim(),
        date: civilDate,
        sourceHash: fresh.sourceHash,
        notes: notes.trim() || null,
        caveats,
      });
      setConfirming(false);
      setSuccessMessage("Fechamento diário registrado com sucesso.");
      setNotes("");
      await load();
    } catch (err) {
      const conflict = resolveTreasuryDailyClosingConflictMessage(err);
      if (conflict) {
        setConflictMessage(conflict);
        setConfirming(false);
        try {
          await refreshPreviewOnly();
        } catch {
          /* ignore */
        }
      } else {
        setError(
          buildFinanceTabLoadError(err, "Não foi possível fechar o dia.")
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function onReopen(row: TreasuryDailyClosingDto) {
    if (!canReopen) return;
    const reason = window.prompt(
      "Justificativa da reabertura autorizada (obrigatória):"
    );
    if (!reason?.trim()) return;
    setBusy(true);
    setError(null);
    setConflictMessage(null);
    setSuccessMessage(null);
    try {
      await reopenTreasuryDailyClosing(row.id, { reason: reason.trim() });
      setSuccessMessage(
        `Dia reaberto. Versão anterior v${row.version} supersedida.`
      );
      await load();
    } catch (err) {
      const conflict = resolveTreasuryDailyClosingConflictMessage(err);
      if (conflict) {
        setConflictMessage(conflict);
      } else {
        setError(
          buildFinanceTabLoadError(err, "Não foi possível reabrir o fechamento.")
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-daily-closing-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_DAILY_CLOSING_PAGE_TITLE}
          subtitle={TREASURY_DAILY_CLOSING_PAGE_SUBTITLE}
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => {
                setConfirming(false);
                void load();
              },
            },
          ]}
        />

        <TreasuryDailyClosingPanel
          viewKind={viewKind}
          deniedMessage={DENIED}
          error={error}
          conflictMessage={conflictMessage}
          successMessage={successMessage}
          civilDate={civilDate}
          companyCode={companyCode}
          notes={notes}
          preview={preview}
          history={history}
          caveatDrafts={caveatDrafts}
          canClose={canClose}
          canReopen={canReopen}
          busy={busy}
          confirming={confirming}
          compareLeftId={compareLeftId}
          compareRightId={compareRightId}
          compareLeft={compareLeft}
          compareRight={compareRight}
          onCivilDateChange={(value) => patchParams({ date: value })}
          onCompanyCodeChange={(value) => patchParams({ companyCode: value })}
          onNotesChange={setNotes}
          onCaveatDraftChange={(code, message) =>
            setCaveatDrafts((prev) => ({ ...prev, [code]: message }))
          }
          onRefreshPreview={() => {
            setConfirming(false);
            void load();
          }}
          onRequestConfirm={() => void onRequestConfirm()}
          onCancelConfirm={() => setConfirming(false)}
          onConfirmClose={() => void onConfirmClose()}
          onReopen={(row) => void onReopen(row)}
          onCompareLeftIdChange={setCompareLeftId}
          onCompareRightIdChange={setCompareRightId}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
