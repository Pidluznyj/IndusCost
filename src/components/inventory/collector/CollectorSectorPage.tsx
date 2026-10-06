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
  fetchCollectorWithdrawItems,
  submitCollectorWithdrawal,
  type CollectorWithdrawItemDto,
} from "./collectorClient";
import {
  mapCollectorBootError,
  mapOperationalStateToBootHint,
  type CollectorBootPhase,
} from "./collectorBootError";
import {
  CollectorEnrollmentScreen,
  useCollectorEnrollment,
} from "./CollectorEnrollmentGate";
import { parseQuantityText } from "./collectorCountFlow";
import {
  isProductCollectorSectorCode,
  productSectorOperationalMessage,
} from "./collectorProductSectorMessages";
import {
  collectorOperationErrorMessage,
  collectorSectorRequestKey,
  formatCollectorQuantity,
  standardSectorFromContext,
} from "./collectorSectorMessages";
import {
  COLLECTOR_SECTORS,
  parseCollectorSector,
} from "@/src/lib/inventory/collector/collectorSectorContract";

type Boot =
  | { phase: "checking" }
  | { phase: "unauthorized"; message?: string }
  | { phase: "configuration_error"; message: string; context?: CollectorSectorContext }
  | { phase: "error"; message: string }
  | { phase: "ready"; context: CollectorSectorContext };

/** Código do setor pelo slug do deep-link; null quando o slug não é de setor. */
function sectorCodeFromSlug(slug: string): string | null {
  try {
    return parseCollectorSector(slug);
  } catch {
    return null;
  }
}

function sectorLabelFromSlug(slug: string): string {
  try {
    return COLLECTOR_SECTORS[parseCollectorSector(slug)].label;
  } catch {
    return "Collector";
  }
}

function operationalMessage(context: CollectorSectorContext): string | null {
  const state = context.operationalState;
  // Setor configurável: o almoxarifado é fixo; só pode faltar item.
  if (standardSectorFromContext(context.sector)) {
    return state === "NO_ELIGIBLE_ITEMS"
      ? "Este setor ainda não tem itens ativos neste almoxarifado. Cadastre os itens no IndusCost."
      : null;
  }
  // Componentes / Produto acabado têm mensagens próprias; as de MP seguem abaixo.
  if (context.sector && isProductCollectorSectorCode(context.sector.code)) {
    return productSectorOperationalMessage({
      sectorCode: context.sector.code,
      operationalState: state,
      itemsEligible: context.diagnostics?.itemsEligible,
    });
  }
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
  | { name: "done" }
  // Retirada: escolher material → quantidade + nome → comprovante.
  | { name: "withdrawPick" }
  | { name: "withdrawQty"; item: CollectorWithdrawItemDto; operationId: string }
  | {
      name: "withdrawDone";
      item: CollectorWithdrawItemDto;
      quantity: number;
      person: string;
      /** Saldo após a retirada, informado pelo servidor (setor configurável). */
      remainingQuantity: number | null;
    };

/**
 * Destino do botão Voltar. null = tela raiz (não mostra o botão).
 *
 * Mapa explícito em vez de pilha de histórico: o caminho de volta de cada
 * tela é determinístico, e uma pilha ainda permitiria voltar para estados já
 * superados (finalize depois de aplicar ajustes, por exemplo).
 *
 * Tudo aqui é transição de estado local. Nada de navegação de rota: o
 * operador chegou por deep-link do QR e não pode sair dele.
 */
const SCREEN_PARENT: Record<Screen["name"], Screen["name"] | null> = {
  home: null,
  list: "home",
  count: "list",
  // Não volta para "list": finalizeCollectorSession já tirou a sessão de
  // COUNTING, então o botão "Finalizar contagem" de lá falharia com
  // INVALID_STATUS. Voltar tem que levar a algum lugar que funcione.
  finalize: "home",
  done: null,
  withdrawPick: "home",
  withdrawQty: "withdrawPick",
  withdrawDone: null,
};

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
  const [bootAttempt, setBootAttempt] = useState(0);
  const [withdrawItems, setWithdrawItems] = useState<CollectorWithdrawItemDto[]>([]);
  const [withdrawQ, setWithdrawQ] = useState("");
  const [person, setPerson] = useState("");
  const [destination, setDestination] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  /** Paginação da retirada em setor configurável (busca no servidor). */
  const [withdrawNextOffset, setWithdrawNextOffset] = useState<number | null>(null);
  const [withdrawServerSearch, setWithdrawServerSearch] = useState(false);

  const sectorParam = sectorSlug;

  // Aparelho desconhecido: pede autorização e aguarda a decisão humana. Ao ser
  // aprovado, recarrega o contexto sozinho — sem fechar e reabrir o Collector.
  const enrollment = useCollectorEnrollment({
    sector: sectorParam,
    enabled: boot.phase === "unauthorized",
    onAuthorized: useCallback(() => setBootAttempt((n) => n + 1), []),
  });

  // Volta uma tela sem sair do deep-link. Limpa o erro para não arrastar
  // mensagem de uma tela para outra.
  const goBack = useCallback(() => {
    setError(null);
    setNotice(null);
    setScreen((current) => {
      const parent = SCREEN_PARENT[current.name];
      return parent ? ({ name: parent } as Screen) : current;
    });
  }, []);

  const retryBoot = useCallback(() => {
    setError(null);
    setBoot({ phase: "checking" });
    setBootAttempt((n) => n + 1);
  }, []);

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
  }, [sectorParam, bootAttempt]);

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
        sector: collectorSectorRequestKey(boot.context.sector, sectorParam),
        warehouseId: warehouseId || undefined,
        operationId: newOperationId(),
      });
      setSessionId(created.session.id);
      setWarehouseId(created.session.warehouseId);
      await loadItems(created.session.id);
      setScreen({ name: "list" });
    } catch (e: unknown) {
      setError(collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao iniciar contagem."));
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
      setError(collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao carregar itens."));
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
    setNotice(null);
    setScreen({ name: "count", item });
  };

  const confirmCount = async () => {
    if (screen.name !== "count" || !sessionId) return;
    // parseQuantityText rejeita vazio (Number("") era 0 e submetia contagem
    // zero sem o operador digitar nada) e arredonda para Decimal(20,6).
    const qty = parseQuantityText(qtyText);
    if (qty == null) {
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
      setNotice(`Contagem salva: ${screen.item.code}`);
      setScreen({ name: "list" });
    } catch (e: unknown) {
      const err = toCollectorApiError(e);
      if (err.code === "JUSTIFICATION_REQUIRED") {
        setError(
          "Falha operacional ao registrar a divergência. Recarregue a lista e tente novamente."
        );
      } else {
        setError(collectorOperationErrorMessage(err, "Erro ao salvar contagem."));
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
    setNotice(null);
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
      setError(collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao finalizar."));
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
      setError(collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao aplicar ajustes."));
    } finally {
      setBusy(false);
    }
  };

  /** Abre a lista de materiais retiráveis do almoxarifado corrente. */
  const openWithdraw = useCallback(async () => {
    if (boot.phase !== "ready") return;
    const targetWarehouse = warehouseId || boot.context.warehouses?.[0]?.id || "";
    if (!targetWarehouse) {
      setError("Selecione o almoxarifado para retirar material.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await fetchCollectorWithdrawItems({
        sector: collectorSectorRequestKey(boot.context.sector, sectorParam),
        warehouseId: targetWarehouse,
      });
      setWarehouseId(targetWarehouse);
      setWithdrawItems(data.items);
      setWithdrawNextOffset(data.nextOffset ?? null);
      // Setor configurável: o servidor pagina e busca; setor fixo filtra no aparelho.
      setWithdrawServerSearch(standardSectorFromContext(boot.context.sector) != null);
      setWithdrawQ("");
      setScreen({ name: "withdrawPick" });
    } catch (e: unknown) {
      setError(collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao listar itens."));
    } finally {
      setBusy(false);
    }
  }, [boot, warehouseId, sectorParam]);

  /** Busca / próxima página no servidor (setor configurável, catálogo grande). */
  const searchWithdrawItems = useCallback(
    async (query: string, offset: number) => {
      if (boot.phase !== "ready" || !warehouseId) return;
      try {
        const data = await fetchCollectorWithdrawItems({
          sector: collectorSectorRequestKey(boot.context.sector, sectorParam),
          warehouseId,
          q: query.trim() || undefined,
          offset,
        });
        setWithdrawItems((current) => (offset > 0 ? [...current, ...data.items] : data.items));
        setWithdrawNextOffset(data.nextOffset ?? null);
      } catch (e: unknown) {
        setError(collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao buscar itens."));
      }
    },
    [boot, warehouseId, sectorParam]
  );

  // Digitação com pausa: uma ida ao servidor por busca, não por tecla.
  useEffect(() => {
    if (screen.name !== "withdrawPick" || !withdrawServerSearch) return;
    const timer = window.setTimeout(() => void searchWithdrawItems(withdrawQ, 0), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só a busca digitada dispara
  }, [withdrawQ]);

  /**
   * O operationId nasce aqui, junto com a intenção, e é reenviado no retry —
   * é ele que impede um segundo toque de debitar o estoque duas vezes.
   */
  const openWithdrawQty = (item: CollectorWithdrawItemDto) => {
    setQtyText("");
    setPerson("");
    setDestination("");
    setError(null);
    setScreen({ name: "withdrawQty", item, operationId: newOperationId() });
  };

  const confirmWithdraw = async () => {
    if (screen.name !== "withdrawQty" || boot.phase !== "ready") return;
    const qty = parseQuantityText(qtyText);
    if (qty == null || qty <= 0) {
      setError("Informe uma quantidade maior que zero.");
      return;
    }
    const who = person.trim();
    if (!who) {
      setError("Informe o nome de quem está retirando.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submitCollectorWithdrawal({
        operationId: screen.operationId,
        sector: collectorSectorRequestKey(boot.context.sector, sectorParam),
        itemId: screen.item.itemId,
        warehouseId,
        locationId: screen.item.locationId,
        quantity: qty,
        person: who,
        ...(standardSectorFromContext(boot.context.sector) && destination.trim()
          ? { destination: destination.trim() }
          : {}),
      });
      setScreen({
        name: "withdrawDone",
        item: screen.item,
        quantity: result.quantity,
        person: result.withdrawnBy,
        remainingQuantity: result.remainingQuantity ?? null,
      });
    } catch (e: unknown) {
      setError(
        collectorOperationErrorMessage(toCollectorApiError(e), "Erro ao registrar retirada.")
      );
    } finally {
      setBusy(false);
    }
  };

  // Busca local: a lista do setor cabe na memória e filtrar no aparelho
  // evita uma ida ao servidor a cada tecla digitada com luva.
  const visibleWithdrawItems = useMemo(() => {
    // Setor configurável: a lista já vem filtrada e paginada do servidor.
    if (withdrawServerSearch) return withdrawItems;
    const term = withdrawQ.trim().toLowerCase();
    if (!term) return withdrawItems;
    return withdrawItems.filter(
      (item) =>
        item.code.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
    );
  }, [withdrawItems, withdrawQ, withdrawServerSearch]);

  const sectorLabel = useMemo(() => {
    if (boot.phase === "ready") {
      return boot.context.sector?.label ?? sectorLabelFromSlug(sectorParam);
    }
    if (boot.phase === "configuration_error" && boot.context?.sector?.label) {
      return boot.context.sector.label;
    }
    return sectorLabelFromSlug(sectorParam);
  }, [boot, sectorParam]);

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
        <CollectorEnrollmentScreen
          state={enrollment.state}
          onCheckNow={enrollment.checkNow}
        />
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
          <button
            type="button"
            onClick={retryBoot}
            className="mt-6 min-h-[56px] w-full rounded-xl bg-amber-400 px-6 text-lg font-bold text-slate-900"
          >
            Tentar novamente
          </button>
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
          <button
            type="button"
            onClick={retryBoot}
            className="mt-6 min-h-[56px] w-full rounded-xl bg-orange-400 px-6 text-lg font-bold text-slate-900"
          >
            Tentar novamente
          </button>
        </div>
      </Shell>
    );
  }

  const warehouses = boot.context.warehouses ?? [];
  // Retirada existe só em Matéria-prima; Componentes/Produto acabado só contam.
  const withdrawalEnabled =
    (boot.context.sector?.code ?? sectorCodeFromSlug(sectorParam)) === "RAW_MATERIAL";
  const selectionHint =
    boot.context.operationalState === "NEEDS_WAREHOUSE_SELECTION"
      ? operationalMessage(boot.context)
      : null;
  // Setor configurável: capacidades e almoxarifado vêm do servidor.
  const standardSector = standardSectorFromContext(boot.context.sector);

  return (
    <Shell>
      <header className="mb-4">
        <p className="text-sm uppercase tracking-wide text-emerald-300">Collector</p>
        <h1 className="text-2xl font-bold text-white">{sectorLabel}</h1>
        {standardSector && warehouses[0] ? (
          <p className="text-base text-slate-200">{warehouses[0].name}</p>
        ) : null}
        <p className="text-sm text-slate-300">{boot.context.device?.name}</p>
      </header>

      <CollectorBackButton screen={screen.name} onBack={goBack} />

      {error ? (
        <div className="mb-3 rounded-xl border border-red-400 bg-red-950/50 p-3 text-red-100">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div
          className="mb-3 rounded-xl border border-emerald-400 bg-emerald-950/50 p-3 text-emerald-100"
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {screen.name === "home" && standardSector ? (
        <div className="space-y-4">
          <p className="text-xl font-semibold text-white">O que deseja fazer?</p>
          {progress ? (
            <p className="text-base text-slate-200">
              Conferência ativa {progress.code}: {progress.countedLines}/{progress.totalLines}
            </p>
          ) : null}
          {standardSector.allowsCounting ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startOrContinue()}
              className="min-h-[88px] w-full rounded-2xl bg-emerald-500 px-4 py-6 text-2xl font-bold uppercase tracking-wide text-slate-950 disabled:opacity-40"
            >
              {sessionId ? "Continuar contagem" : "Contagem"}
            </button>
          ) : null}
          {standardSector.allowsWithdrawal ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void openWithdraw()}
              className="min-h-[88px] w-full rounded-2xl bg-sky-500 px-4 py-6 text-2xl font-bold uppercase tracking-wide text-slate-950 disabled:opacity-40"
            >
              Retirada
            </button>
          ) : null}
          {!standardSector.allowsCounting && !standardSector.allowsWithdrawal ? (
            <p className="rounded-xl border border-slate-600 bg-slate-900/80 p-3 text-slate-200">
              Este setor está sem operações habilitadas. Acione o supervisor de estoque.
            </p>
          ) : null}
        </div>
      ) : null}

      {screen.name === "home" && !standardSector ? (
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

          {withdrawalEnabled ? (
            <button
              type="button"
              disabled={busy || (warehouses.length > 1 && !warehouseId)}
              onClick={() => void openWithdraw()}
              className="w-full rounded-2xl bg-sky-500 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
            >
              Retirar material
            </button>
          ) : null}
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
            disabled={busy || (progress != null && progress.status !== "COUNTING")}
            onClick={() => void runFinalize()}
            className="w-full rounded-2xl bg-amber-400 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
          >
            Finalizar contagem
          </button>
        </div>
      ) : null}

      {screen.name === "count" ? (
        <div className="space-y-4">
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

      {screen.name === "withdrawPick" ? (
        <div className="space-y-3">
          <p className="text-xl font-bold text-white">Retirar material</p>
          <input
            value={withdrawQ}
            onChange={(e) => setWithdrawQ(e.target.value)}
            placeholder="Buscar código ou descrição"
            className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-lg text-white"
          />
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto">
            {visibleWithdrawItems.map((item) => (
              <li key={`${item.itemId}:${item.locationId ?? "-"}`}>
                <button
                  type="button"
                  onClick={() => openWithdrawQty(item)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-4 text-left"
                >
                  <p className="text-lg font-bold text-white">{item.code}</p>
                  <p className="text-sm text-slate-300">{item.description}</p>
                  <p className="mt-1 text-sm text-sky-300">
                    {item.locationCode ? `Endereço ${item.locationCode} · ` : ""}
                    {item.availableQuantity != null
                      ? `Disponível: ${formatCollectorQuantity(item.availableQuantity, item.unit)}`
                      : item.unit}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {visibleWithdrawItems.length === 0 ? (
            <p className="text-slate-300">Nenhum material encontrado.</p>
          ) : null}
          {withdrawServerSearch && withdrawNextOffset != null ? (
            <button
              type="button"
              onClick={() => void searchWithdrawItems(withdrawQ, withdrawNextOffset)}
              className="min-h-[56px] w-full rounded-xl bg-slate-800 px-4 text-lg font-semibold text-slate-100"
            >
              Carregar mais
            </button>
          ) : null}
        </div>
      ) : null}

      {screen.name === "withdrawQty" ? (
        <div className="space-y-4">
          <p className="text-2xl font-bold text-white">{screen.item.code}</p>
          <p className="text-slate-300">{screen.item.description}</p>
          <p className="text-sm text-slate-400">
            Unidade: {screen.item.unit}
            {screen.item.locationCode ? ` · Endereço ${screen.item.locationCode}` : ""}
          </p>
          {screen.item.availableQuantity != null ? (
            <p className="rounded-xl bg-slate-800/80 p-3 text-lg text-slate-100">
              Saldo disponível:{" "}
              <strong>{formatCollectorQuantity(screen.item.availableQuantity, screen.item.unit)}</strong>
            </p>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Quantidade a retirar</span>
            <input
              inputMode="decimal"
              value={qtyText}
              onChange={(e) => setQtyText(e.target.value)}
              className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-5 text-3xl text-white"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Quem está retirando</span>
            <input
              type="text"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              placeholder="Nome de quem leva o material"
              className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-4 text-xl text-white"
            />
          </label>
          {standardSector ? (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Destino / motivo (opcional)</span>
              <input
                type="text"
                value={destination}
                maxLength={120}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="Ex.: Recepção, RH"
                className="w-full rounded-xl border border-slate-600 bg-slate-900 px-4 py-4 text-xl text-white"
              />
            </label>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmWithdraw()}
            className="w-full rounded-2xl bg-sky-500 px-4 py-5 text-xl font-bold text-slate-950 disabled:opacity-40"
          >
            Confirmar retirada
          </button>
        </div>
      ) : null}

      {screen.name === "withdrawDone" ? (
        <div className="rounded-2xl border border-sky-400 bg-sky-950/40 p-6 text-center">
          <p className="text-2xl font-bold text-sky-200">Retirada registrada</p>
          <p className="mt-2 text-slate-100">
            {screen.quantity} {screen.item.unit} de {screen.item.code}
          </p>
          <p className="mt-1 text-sm text-slate-300">Retirado por {screen.person}</p>
          {screen.remainingQuantity != null ? (
            <p className="mt-3 text-lg text-slate-100">
              Saldo resultante:{" "}
              <strong>{formatCollectorQuantity(screen.remainingQuantity, screen.item.unit)}</strong>
            </p>
          ) : null}
          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={() => void openWithdraw()}
              className="min-h-[56px] w-full rounded-xl bg-sky-500 px-4 text-lg font-bold text-slate-950"
            >
              Nova retirada
            </button>
            <button
              type="button"
              onClick={() => setScreen({ name: "home" })}
              className="min-h-[56px] w-full rounded-xl bg-slate-100 px-4 text-lg font-semibold text-slate-900"
            >
              Voltar ao início
            </button>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

/**
 * Voltar compartilhado. Alvo grande porque é usado de luva no chão de
 * fábrica, e some nas telas raiz — onde voltar significaria sair do QR.
 */
function CollectorBackButton({
  screen,
  onBack,
}: {
  screen: Screen["name"];
  onBack: () => void;
}) {
  if (!SCREEN_PARENT[screen]) return null;
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 min-h-[56px] rounded-xl bg-slate-800 px-5 text-lg font-semibold text-slate-100"
    >
      ← Voltar
    </button>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto w-full max-w-lg">{children}</div>
    </div>
  );
}
