/**
 * Tela de espera de autorização do tablet.
 *
 * Entra em cena quando o Collector recebe COLLECTOR_DEVICE_UNAUTHORIZED: pede
 * a autorização e fica aguardando a decisão humana. Solicitar NÃO autoriza —
 * o desbloqueio só acontece quando o servidor passa a responder AUTHORIZED,
 * o que exige um administrador ter aprovado e nascido um device ativo.
 *
 * Erro de rede NUNCA é apresentado como recusa: são estados separados.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCollectorEnrollmentStatus,
  requestCollectorEnrollment,
  type CollectorEnrollmentStatus,
} from "./collectorClient";

/** Polling leve: o aparelho fica parado numa tela, não precisa de pressa. */
export const COLLECTOR_ENROLLMENT_POLL_MS = 7000;

/** Erros seguidos param o polling — não adianta martelar um servidor fora do ar. */
export const COLLECTOR_ENROLLMENT_MAX_ERRORS = 5;

export type CollectorEnrollmentPhase =
  | "requesting"
  | "pending"
  | "rejected"
  | "authorized"
  | "error";

export type CollectorEnrollmentState = {
  phase: CollectorEnrollmentPhase;
  message: string;
};

const FALLBACK_MESSAGES: Record<CollectorEnrollmentPhase, string> = {
  requesting: "Verificando autorização do dispositivo…",
  pending:
    "Este dispositivo ainda não está autorizado. A solicitação foi enviada ao administrador.",
  rejected: "A autorização deste dispositivo não foi aprovada.",
  authorized: "Dispositivo autorizado.",
  error: "Não foi possível verificar a autorização do dispositivo.",
};

function phaseFromStatus(status: CollectorEnrollmentStatus): CollectorEnrollmentPhase {
  if (status === "AUTHORIZED") return "authorized";
  if (status === "REJECTED") return "rejected";
  // NONE logo após solicitar = pedido expirado/sumiu: seguir aguardando.
  return "pending";
}

/**
 * Solicita a autorização e acompanha a decisão.
 * `onAuthorized` dispara uma única vez, para a tela recarregar o contexto.
 */
export function useCollectorEnrollment(options: {
  sector?: string;
  enabled: boolean;
  onAuthorized: () => void;
}): { state: CollectorEnrollmentState; checkNow: () => void } {
  const { sector, enabled, onAuthorized } = options;
  const [state, setState] = useState<CollectorEnrollmentState>({
    phase: "requesting",
    message: FALLBACK_MESSAGES.requesting,
  });

  const aliveRef = useRef(true);
  const errorsRef = useRef(0);
  const authorizedRef = useRef(false);
  const onAuthorizedRef = useRef(onAuthorized);
  onAuthorizedRef.current = onAuthorized;

  const settle = useCallback((phase: CollectorEnrollmentPhase, message?: string) => {
    if (!aliveRef.current) return;
    setState({ phase, message: message?.trim() || FALLBACK_MESSAGES[phase] });
    if (phase === "authorized" && !authorizedRef.current) {
      authorizedRef.current = true;
      onAuthorizedRef.current();
    }
  }, []);

  const check = useCallback(async () => {
    try {
      const result = await fetchCollectorEnrollmentStatus();
      errorsRef.current = 0;
      settle(phaseFromStatus(result.status), result.message);
    } catch {
      errorsRef.current += 1;
      // Falha de rede não vira "recusado": estado próprio, mensagem própria.
      if (errorsRef.current >= COLLECTOR_ENROLLMENT_MAX_ERRORS) {
        settle("error");
      }
    }
  }, [settle]);

  useEffect(() => {
    if (!enabled) return;
    aliveRef.current = true;
    errorsRef.current = 0;
    authorizedRef.current = false;

    let timer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        const result = await requestCollectorEnrollment(sector);
        settle(phaseFromStatus(result.status), result.message);
        // Decisão final ou já autorizado: nada a acompanhar.
        if (result.status === "AUTHORIZED" || result.status === "REJECTED") return;
      } catch {
        settle("error");
        return;
      }
      if (!aliveRef.current) return;
      timer = setInterval(() => {
        void check();
      }, COLLECTOR_ENROLLMENT_POLL_MS);
    })();

    return () => {
      aliveRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [enabled, sector, settle, check]);

  // Para o polling assim que sai do estado de espera.
  useEffect(() => {
    if (state.phase === "authorized" || state.phase === "rejected") {
      aliveRef.current = state.phase !== "rejected" ? aliveRef.current : false;
    }
  }, [state.phase]);

  const checkNow = useCallback(() => {
    aliveRef.current = true;
    errorsRef.current = 0;
    void check();
  }, [check]);

  return { state, checkNow };
}

/** Tela de espera — botões grandes, pensada para o tablet no chão de fábrica. */
export function CollectorEnrollmentScreen({
  state,
  onCheckNow,
}: {
  state: CollectorEnrollmentState;
  onCheckNow: () => void;
}) {
  if (state.phase === "rejected") {
    return (
      <div
        className="rounded-2xl border-2 border-red-500 bg-red-950/60 p-6 text-center"
        data-testid="collector-enrollment-rejected"
      >
        <p className="text-2xl font-bold text-red-200">Autorização não aprovada</p>
        <p className="mt-3 text-base text-red-100">{state.message}</p>
        <p className="mt-4 text-sm text-slate-300">
          Entre em contato com o responsável pelo estoque.
        </p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div
        className="rounded-2xl border-2 border-amber-500 bg-amber-950/50 p-6 text-center"
        data-testid="collector-enrollment-error"
      >
        <p className="text-2xl font-bold text-amber-100">Não foi possível verificar</p>
        <p className="mt-3 text-base text-amber-50">{state.message}</p>
        <button
          type="button"
          onClick={onCheckNow}
          className="mt-6 min-h-[56px] w-full rounded-xl bg-amber-500 px-6 text-lg font-bold text-slate-900"
          data-testid="collector-enrollment-retry"
        >
          Verificar novamente
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border-2 border-sky-500 bg-sky-950/50 p-6 text-center"
      data-testid="collector-enrollment-pending"
    >
      <p className="text-2xl font-bold text-sky-100">Dispositivo aguardando autorização</p>
      <p className="mt-4 text-base text-sky-50">{state.message}</p>
      <p className="mt-4 text-sm text-slate-300">
        Você pode manter esta tela aberta. O acesso será liberado assim que o
        dispositivo for aprovado.
      </p>
      <button
        type="button"
        onClick={onCheckNow}
        className="mt-6 min-h-[56px] w-full rounded-xl bg-sky-500 px-6 text-lg font-bold text-slate-900"
        data-testid="collector-enrollment-check"
      >
        Verificar novamente
      </button>
    </div>
  );
}
