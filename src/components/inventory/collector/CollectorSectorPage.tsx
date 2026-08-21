/**
 * Fluxo autônomo por setor do Stock Collector (mobile-first).
 * Contagem cega: nunca exibe saldo do sistema antes/durante a contagem.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  applyCollectorAdjustments,
  createCollectorSectorSession,
  fetchCollectorSectorContext,
  fetchCollectorSectorItems,
  finalizeCollectorSectorSession,
  submitCollectorSectorCount,
  toCollectorApiError,
  type CollectorBlindItemDto,
  type CollectorSectorContext,
  type CollectorSessionProgressDto,
  type CollectorDivergenceDto,
} from "./collectorClient";
import {
  mapCollectorBootError,
  mapOperationalStateToBootHint,
  type CollectorBootPhase,
} from "./collectorBootError";

type Boot =
  | { phase: "checking" }
  | { phase: "unauthorized"; message?: string }
  | { phase: "configuration_error"; message: string; context?: CollectorSectorContext }
  | { phase: "error"; message: string }
  | { phase: "ready"; context: CollectorSectorContext };

function operationalMessage(context: CollectorSectorContext): string | null {
  const state = context.operationalState;
  if (state === "CONFIGURATION_REQUIRED") {
    return "Nenhum almoxarifado ACTIVE configurado. Cadastre um almoxarifado no estoque antes de contar.";
  }
  if (state === "NO_ELIGIBLE_ITEMS") {
    return "Não há matérias-primas elegíveis para inventário. Verifique o cadastro de Suprimentos.";
  }
  if (state === "NEEDS_WAREHOUSE_SELECTION") {
    return "Selecione o almoxarifado para iniciar a contagem.";
  }
  return null;
}

type Screen =
  | { name: "home" }
  | { name: "list" }
  | { name: "count"; item: CollectorBlindItemDto }
  | { name: "finalize"; divergences: CollectorDivergenceDto[]; progress: CollectorSessionProgressDto }
  | { name: "done" };

function newOperationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CollectorSectorPage() {
  const { sectorSlug = "raw-material" } = useParams<{ sectorSlug: string }>();
  const [boot, setBoot] = useState<Boot>({ phase: "checking" });
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [items, setItems] = useState<CollectorBlindItemDto[]>([]);
  const [progress, setProgress] = useState<CollectorSessionProgressDto | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "counted">("all");
  const [q, setQ] = useState("");
  const [qtyText, setQtyText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowUncounted, setAllowUncounted] = useState(false);

  const sectorParam = sectorSlug;

  const loadItems = useCallback(async (id: string, f = filter, query = q) => {
    const data = await fetchCollectorSectorItems(id, { filter: f, q: query });
    setItems(data.items);
    setProgress(data.progress);
  }, [filter, q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const context = await fetchCollectorSectorContext(sectorParam);
        if (cancelled) return;
        if (!context.device) {
          setBoot({
            phase: "unauthorized",
            message:
              "Este aparelho não está liberado para contagem. Acione o supervisor de estoque.",
          });
          return;
        }

        const configHint = mapOperationalStateToBootHint(context.operationalState);
        const opMsg = operationalMessage(context);
        if (configHint === "configuration_error" && !context.activeSession) {
          setBoot({
            phase: "configuration_error",
            message:
              opMsg ?? "Configuração de estoque incompleta para iniciar a contagem.",
            context,
          });
          return;
        }

        setBoot({ phase: "ready", context });
        const warehouses = context.warehouses ?? [];
        if (warehouses.length === 1) setWarehouseId(warehouses[0].id);
        if (context.activeSession) {
          setSessionId(context.activeSession.sessionId);
          setWarehouseId(context.activeSession.warehouseId);
          setProgress(context.activeSession);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const api = toCollectorApiError(e);
        const mapped = mapCollectorBootError({
          status: api.status,
          code: api.code,
          message: api.message,
          networkFailure: api.status == null,
        });
        setBoot({
          phase: mapped.phase as Exclude<CollectorBootPhase, "checking" | "ready">,
          message: mapped.message,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sectorParam]);

  const startOrContinue = useCallback(async () => {
    if (boot.phase !== "ready") return;
    setBusy(true);
    setError(null);
    try {
      if (sessionId) {
        await loadItems(sessionId);
        setScreen({ name: "list" });
        return;
      }
      const created = await createCollectorSectorSession({
        sector: boot.context.sector?.code ?? sectorParam,
        warehouseId: warehouseId || undefined,
        operationId: newOperationId(),
      });
      setSessionId(created.session.id);
      setWarehouseId(created.session.warehouseId);
      await loadItems(created.session.id);
      setScreen({ name: "list" });
    } catch (e: unknown) {
      setError(toCollectorApiError(e).message ?? "Erro ao iniciar contagem.");
    } finally {
      setBusy(false);
    }
  }, [boot, sessionId, warehouseId, sectorParam, loadItems]);

  const refreshList = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await loadItems(sessionId, filter, q);
    } catch (e: unknown) {
      setError(toCollectorApiError(e).message ?? "Erro ao carregar itens.");
    } finally {
      setBusy(false);
    }
  }, [sessionId, filter, q, loadItems]);

  useEffect(() => {
    if (screen.name === "list" && sessionId) {
      void refreshList();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on filter/q only while listing
  }, [filter, q]);

  const openCount = (item: CollectorBlindItemDto) => {
    setQtyText(item.countedQuantity != null ? String(item.countedQuantity) : "");
    setError(null);
    setScreen({ name: "count", item });
  };

  const confirmCount = async () => {
    if (screen.name !== "count" || !sessionId) return;
    const qty = Number(qtyText.replace(",", "."));
    if (!Number.isFinite(qty) || qty < 0) {
      setError("Informe uma quantidade ≥ 0.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitCollectorSectorCount({
        sessionId,
        lineId: screen.item.lineId,
        countedQuantity: qty,
        expectedVersion: screen.item.version,
        operationId: newOperationId(),
      });
      await loadItems(sessionId);
      setScreen({ name: "list" });
    } catch (e: unknown) {
      const err = toCollectorApiError(e);
      if (err.code === "JUSTIFICATION_REQUIRED") {
        setError(
          "Falha operacional ao registrar a divergência. Recarregue a lista e tente novamente."
        );
      } else {
        setError(err.message ?? "Erro ao salvar contagem.");
      }
      if (err.code === "COUNT_LINE_VERSION_CONFLICT" && sessionId) {
        await loadItems(sessionId);
      }
    } finally {
      setBusy(false);
    }
  };

  const runFinalize = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const summary = await finalizeCollectorSectorSession(sessionId, {
        allowUncounted,
        confirm: true,
      });
      setProgress(summary.progress);
      setScreen({
        name: "finalize",
        divergences: summary.divergences,
        progress: summary.progress,
      });
    } catch (e: unknown) {
      setError(toCollectorApiError(e).message ?? "Erro ao finalizar.");
    } finally {
      setBusy(false);
    }
  };

  const runApply = async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await applyCollectorAdjustments(sessionId, {
        confirm: true,
        operationId: newOperationId(),
      });
      setScreen({ name: "done" });
    } catch (e: unknown) {
      setError(toCollectorApiError(e).message ?? "Erro ao aplicar ajustes.");
    } finally {
      setBusy(false);
    }
  };

  const sectorLabel = useMemo(() => {
    if (boot.phase === "ready") return boot.context.sector?.label ?? "Matéria-prima";
    if (boot.phase === "configuration_error" && boot.context?.sector?.label) {
      return boot.context.sector.label;
    }
    return "Matéria-prima";
  }, [boot]);

  if (boot.phase === "checking") {
    return (
      <Shell>
        <p className="text-center text-xl text-slate-200">Verificando dispositivo…</p>
      </Shell>
    );
  }
  if (boot.phase === "unauthorized") {
    return (
      <Shell>
        <div className="rounded-2xl border-2 border-red-500 bg-red-950/60 p-6 text-center">
          <p className="text-2xl font-bold text-red-200">Dispositivo não autorizado</p>
          <p className="mt-3 text-base text-red-100">
            {boot.message ??
              "Este aparelho não está liberado para contagem. Acione o supervisor de estoque."}
          </p>
        </div>
      </Shell>
    );
  }
  if (boot.phase === "configuration_error") {
    return (
      <Shell>
        <div className="rounded-2xl border-2 border-amber-500 bg-amber-950/50 p-6 text-center">
          <p className="text-2xl font-bold text-amber-100">Configuração necessária</p>
          <p className="mt-3 text-base text-amber-50">{boot.message}</p>
          <p className="mt-4 text-sm text-slate-300">
            O dispositivo está autorizado. Ajuste almoxarifado / vínculos de estoque no IndusCost.
          </p>
        </div>
      </Shell>
    );
  }
  if (boot.phase === "error") {
    return (
      <Shell>
        <div className="rounded-2xl border-2 border-orange-500 bg-orange-950/50 p-6 text-center">
          <p className="text-2xl font-bold text-orange-100">Erro ao carregar</p>
          <p className="mt-3 text-base text-orange-50">{boot.message}</p>
        </div>
      </Shell>
    );
  }

  const warehouses = boot.context.warehouses ?? [];
  const selectionHint =
    boot.context.operationalState === "NEEDS_WAREHOUSE_SELECTION"
      ? operationalMessage(boot.context)
      : null;

  return (
    <Shell>
      <header className="mb-4">
        <p className="text-sm uppercase tracking-wide text-emerald-300">Collector</p>
        <h1 className="text-2xl font-bold text-white">{sectorLabel}</h1>
        <p className="text-sm text-slate-300">{boot.context.device?.name}</p>
      </header>

      {error ? (
        <div className="mb-3 rounded-xl border border-red-400 bg-red-950/50 p-3 text-red-100">
          {error}
        </div>
      ) : null}

      {screen.name === "home" ? (
        <div className="space-y-4">
          {selectionHint ? (
            <p className="rounded-xl border border-slate-600 bg-slate-900/80 p-3 text-slate-200">
              {selectionHint}
            </p>
          ) : null}
          {warehouses.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Almoxarifado</span>
              <select
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-4 text-lg text-white"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {progress ? (
            <p className="text-base text-slate-200">
              Conferência ativa {progress.code}: {progress.countedLines}/{progress.totalLines}
            </p>
          ) : null}

          <button
            type="button"
            disabled={busy || (warehouses.length > 1 && !warehouseId && !sessionId)}
            onClick={() => void startOrContinue()}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
          >
            {sessionId ? "Continuar contagem" : "Nova contagem"}
          </button>
        </div>
      ) : null}

      {screen.name === "list" && progress ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-800/80 p-3 text-slate-100">
            <p className="font-semibold">{progress.code}</p>
            <p>
              Progresso: {progress.countedLines}/{progress.totalLines} (
              {progress.pendingLines} pendentes)
            </p>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar código ou descrição"
            className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-lg text-white"
          />
          <div className="flex gap-2">
            {(
              [
                ["all", "Todos"],
                ["pending", "Pendentes"],
                ["counted", "Contados"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`flex-1 rounded-xl px-2 py-3 text-sm font-semibold ${
                  filter === key ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-200"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {items.map((item) => (
              <li key={item.lineId}>
                <button
                  type="button"
                  onClick={() => openCount(item)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-4 text-left"
                >
                  <p className="text-lg font-bold text-white">{item.code}</p>
                  <p className="text-sm text-slate-300">{item.description}</p>
                  <p className="mt-1 text-sm text-emerald-300">
                    {item.counted
                      ? `Contado: ${item.countedQuantity} ${item.unit}`
                      : `Pendente · ${item.unit}`}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-3 text-slate-200">
            <input
              type="checkbox"
              checked={allowUncounted}
              onChange={(e) => setAllowUncounted(e.target.checked)}
              className="h-5 w-5"
            />
            Permitir finalizar com pendentes
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runFinalize()}
            className="w-full rounded-2xl bg-amber-400 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
          >
            Finalizar contagem
          </button>
        </div>
      ) : null}

      {screen.name === "count" ? (
        <div className="space-y-4">
          <button
            type="button"
            className="text-sm text-slate-300 underline"
            onClick={() => setScreen({ name: "list" })}
          >
            ← Voltar
          </button>
          <p className="text-2xl font-bold text-white">{screen.item.code}</p>
          <p className="text-slate-300">{screen.item.description}</p>
          <p className="text-sm text-slate-400">Unidade: {screen.item.unit}</p>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Quantidade contada</span>
            <input
              inputMode="decimal"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-5 text-3xl text-white"
              autoFocus
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmCount()}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
          >
            Confirmar
          </button>
        </div>
      ) : null}

      {screen.name === "finalize" ? (
        <div className="space-y-4">
          <p className="text-xl font-bold text-white">Divergências</p>
          <p className="text-slate-300">
            {screen.progress.countedLines}/{screen.progress.totalLines} contados
          </p>
          {screen.divergences.length === 0 ? (
            <p className="text-emerald-300">Nenhuma divergência efetiva.</p>
          ) : (
            <ul className="max-h-[40vh] space-y-2 overflow-y-auto">
              {screen.divergences.map((d) => (
                <li
                  key={d.lineId}
                  className="rounded-xl border border-amber-500/40 bg-slate-900 p-3 text-slate-100"
                >
                  <p className="font-bold">
                    {d.code} · Δ {d.adjustmentDelta}
                  </p>
                  <p className="text-sm">
                    Contado {d.countedQuantity} × esperado {d.expectedQuantity} {d.unit}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void runApply()}
            className="w-full rounded-2xl bg-emerald-500 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
          >
            Confirmar e aplicar ajustes
          </button>
        </div>
      ) : null}

      {screen.name === "done" ? (
        <div className="rounded-2xl border border-emerald-400 bg-emerald-950/40 p-6 text-center">
          <p className="text-2xl font-bold text-emerald-200">Contagem concluída</p>
          <p className="mt-2 text-slate-200">Ajustes aplicados via motor canônico.</p>
          <button
            type="button"
            className="mt-4 rounded-xl bg-slate-100 px-4 py-3 font-semibold text-slate-900"
            onClick={() => {
              setSessionId(null);
              setProgress(null);
              setScreen({ name: "home" });
            }}
          >
            Nova operação
          </button>
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </div>
  );
}
