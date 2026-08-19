/**
 * FASE 3 — página operacional do Stock Collector.
 *
 * Standalone e mobile-first: NÃO usa o shell administrativo nem login humano.
 * Quem decide se este aparelho entra é o servidor (Tailscale + Device
 * Registry, fail-closed) — a página apenas reage a 403.
 *
 * CONTAGEM CEGA: a tela nunca mostra o saldo do sistema. O operador informa o
 * que encontrou fisicamente; divergência é assunto do supervisor no fluxo
 * humano.
 *
 * Estados: A verificando · B não autorizado · C sem conferência ativa ·
 * D seleção de conferência · E scanner · F item identificado / G quantidade ·
 * H salvando · I sucesso · J conflito · K erro.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCollectorContext,
  fetchCollectorSessions,
  resolveCollectorQr,
  submitCollectorCount,
  toCollectorApiError,
  type CollectorSessionSummary,
} from "./collectorClient";
import {
  applyFailure,
  applySuccess,
  beginCount,
  createCollectorFlow,
  parseQuantityText,
  prepareSubmission,
  readyForNextScan,
  setJustification,
  setQuantity,
  type CollectorFlowState,
} from "./collectorCountFlow";
import { CollectorQrScanner } from "./CollectorQrScanner";

type BootState =
  | { phase: "checking" }
  | { phase: "unauthorized" }
  | { phase: "ready"; deviceName: string };

export function CollectorPage() {
  const [boot, setBoot] = useState<BootState>({ phase: "checking" });
  const [sessions, setSessions] = useState<CollectorSessionSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [flow, setFlow] = useState<CollectorFlowState>(createCollectorFlow());
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastScanRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  const session = sessions.find((s) => s.id === sessionId) ?? null;

  const loadSessions = useCallback(async () => {
    const list = await fetchCollectorSessions();
    setSessions(list);
    // Uma única conferência COUNTING → pré-seleciona.
    if (list.length === 1) setSessionId(list[0].id);
    return list;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const context = await fetchCollectorContext();
        if (cancelled) return;
        if (!context.device) {
          setBoot({ phase: "unauthorized" });
          return;
        }
        setBoot({ phase: "ready", deviceName: context.device.name });
        await loadSessions();
      } catch {
        if (!cancelled) setBoot({ phase: "unauthorized" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  const handleScan = useCallback(
    async (rawText: string) => {
      if (!sessionId || busy) return;
      // Debounce: o detector emite o mesmo QR várias vezes por segundo.
      const now = Date.now();
      if (lastScanRef.current.text === rawText && now - lastScanRef.current.at < 2500) return;
      lastScanRef.current = { text: rawText, at: now };

      setBusy(true);
      setResolveError(null);
      try {
        const line = await resolveCollectorQr(sessionId, rawText);
        setFlow((prev) => beginCount(prev, line));
      } catch (e: unknown) {
        const failure = toCollectorApiError(e);
        setResolveError(failure.message ?? "Etiqueta não reconhecida.");
      } finally {
        setBusy(false);
      }
    },
    [sessionId, busy]
  );

  const handleConfirm = useCallback(async () => {
    if (!sessionId) return;
    const prepared = prepareSubmission(flow);
    if (!prepared) return;
    setFlow(prepared.state);
    try {
      await submitCollectorCount(sessionId, prepared.submission);
      setFlow((prev) => applySuccess(prev));
      void loadSessions();
      // Flash curto de sucesso e volta ao scanner.
      setTimeout(() => setFlow((prev) => (prev.phase === "success" ? readyForNextScan(prev) : prev)), 1200);
    } catch (e: unknown) {
      setFlow((prev) => applyFailure(prev, toCollectorApiError(e)));
    }
  }, [sessionId, flow, loadSessions]);

  // Conflito de versão: a decisão explícita do operador é re-escanear — o
  // resolve-qr devolve a linha VIGENTE (expectedVersion nova) e a transição
  // canônica applyReloadedLine/beginCount zera quantidade e intenção.

  // -- render ---------------------------------------------------------------

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
            Este aparelho não está liberado para contagem. Acione o supervisor de estoque.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell deviceName={boot.deviceName} sessionCode={session?.code ?? null}>
      {!sessionId ? (
        sessions.length === 0 ? (
          <div className="rounded-2xl border-2 border-slate-600 bg-slate-800 p-6 text-center">
            <p className="text-xl font-semibold text-slate-100">Nenhuma conferência ativa</p>
            <p className="mt-2 text-base text-slate-300">
              Aguarde o supervisor iniciar uma conferência.
            </p>
            <button
              type="button"
              onClick={() => void loadSessions()}
              className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-4 text-lg font-bold text-white active:bg-emerald-600"
            >
              Atualizar
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="collector-session-picker">
            <p className="text-lg font-semibold text-slate-100">Escolha a conferência</p>
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSessionId(s.id)}
                className="rounded-2xl border-2 border-slate-600 bg-slate-800 p-4 text-left active:bg-slate-700"
              >
                <p className="text-xl font-bold text-white">{s.code}</p>
                <p className="text-base text-slate-300">
                  {s.warehouseName ?? s.warehouseCode ?? "—"}
                </p>
                <p className="mt-1 text-sm text-emerald-300">
                  {s.countedLines}/{s.totalLines} itens contados
                </p>
              </button>
            ))}
          </div>
        )
      ) : flow.phase === "scanning" || flow.phase === "success" ? (
        <div className="flex flex-col gap-3">
          {flow.phase === "success" ? (
            <div
              className="rounded-2xl bg-emerald-500 p-5 text-center text-2xl font-bold text-white"
              data-testid="collector-success"
            >
              ✓ Contagem registrada
            </div>
          ) : null}
          <CollectorQrScanner onScan={(text) => void handleScan(text)} disabled={busy} />
          {resolveError ? (
            <div className="rounded-xl border-2 border-amber-400 bg-amber-950/60 p-3 text-base text-amber-100">
              {resolveError}
            </div>
          ) : null}
          <button
            type="button"
            onClick={() => setSessionId(null)}
            className="rounded-xl border-2 border-slate-600 px-4 py-3 text-base text-slate-300"
          >
            Trocar conferência
          </button>
        </div>
      ) : flow.line ? (
        <div className="flex flex-col gap-4" data-testid="collector-count-form">
          <div className="rounded-2xl border-2 border-slate-600 bg-slate-800 p-4">
            <p className="text-sm uppercase tracking-wide text-slate-400">Item identificado</p>
            <p className="mt-1 text-2xl font-bold text-white">{flow.line.itemCode}</p>
            <p className="text-base text-slate-200">{flow.line.itemDescription}</p>
            <p className="mt-2 text-base text-slate-300">
              {flow.line.warehouseName}
              {flow.line.locationName ? ` · ${flow.line.locationName}` : ""}
            </p>
          </div>

          {flow.message ? (
            <div
              className={
                flow.phase === "conflict"
                  ? "rounded-xl border-2 border-amber-400 bg-amber-950/70 p-3 text-base text-amber-100"
                  : "rounded-xl border-2 border-slate-500 bg-slate-800 p-3 text-base text-slate-200"
              }
              data-testid="collector-flow-message"
            >
              {flow.message}
            </div>
          ) : null}

          {flow.phase === "conflict" ? (
            <button
              type="button"
              onClick={() => {
                // Decisão explícita do operador: recomeçar do scanner com o
                // estado vigente — nunca reenvio automático.
                setFlow(createCollectorFlow());
              }}
              className="rounded-2xl bg-amber-500 px-4 py-5 text-xl font-bold text-black active:bg-amber-600"
            >
              Escanear novamente e recontar
            </button>
          ) : (
            <>
              <label className="flex flex-col gap-2">
                <span className="text-lg font-semibold text-slate-100">
                  Quantidade física ({flow.line.itemUnit})
                </span>
                <input
                  inputMode="decimal"
                  value={flow.quantityText}
                  onChange={(e) => setFlow((prev) => setQuantity(prev, e.target.value))}
                  disabled={flow.phase === "saving"}
                  placeholder="0"
                  className="rounded-2xl border-2 border-slate-500 bg-white px-4 py-5 text-center text-4xl font-bold tabular-nums text-slate-900"
                  data-testid="collector-quantity"
                />
              </label>

              {flow.phase === "needs-justification" ? (
                <label className="flex flex-col gap-2">
                  <span className="text-lg font-semibold text-amber-200">Justificativa</span>
                  <textarea
                    value={flow.justification}
                    onChange={(e) => setFlow((prev) => setJustification(prev, e.target.value))}
                    rows={2}
                    placeholder="Ex.: avaria, sobra identificada…"
                    className="rounded-2xl border-2 border-amber-400 px-4 py-3 text-lg"
                    data-testid="collector-justification"
                  />
                </label>
              ) : null}

              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={
                  flow.phase === "saving" || parseQuantityText(flow.quantityText) == null
                }
                className="rounded-2xl bg-emerald-500 px-4 py-6 text-2xl font-bold text-white active:bg-emerald-600 disabled:opacity-40"
                data-testid="collector-confirm"
              >
                {flow.phase === "saving" ? "Salvando…" : "CONFIRMAR CONTAGEM"}
              </button>

              <button
                type="button"
                onClick={() => setFlow(createCollectorFlow())}
                disabled={flow.phase === "saving"}
                className="rounded-xl border-2 border-slate-600 px-4 py-3 text-base text-slate-300 disabled:opacity-40"
              >
                Cancelar e voltar ao scanner
              </button>
            </>
          )}
        </div>
      ) : null}
    </Shell>
  );
}

function Shell({
  children,
  deviceName,
  sessionCode,
}: {
  children: React.ReactNode;
  deviceName?: string;
  sessionCode?: string | null;
}) {
  return (
    <div className="min-h-screen bg-slate-900 px-4 pb-10 pt-6">
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold text-white">Coletor de Inventário</h1>
          <div className="text-right text-sm text-slate-400">
            {deviceName ? <p>{deviceName}</p> : null}
            {sessionCode ? <p className="font-semibold text-emerald-300">{sessionCode}</p> : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
