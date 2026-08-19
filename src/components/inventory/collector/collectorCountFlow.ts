/**
 * FASE 3 — máquina de estados da contagem no Collector. Motor puro (sem React,
 * sem fetch) — todo o contrato 2B do lado do cliente vive aqui e é testável
 * sem DOM.
 *
 * Regras que esta máquina garante:
 *  - operationId pertence à INTENÇÃO (fingerprint de lineId + quantidade +
 *    justificativa + expectedVersion): retry de rede reutiliza a chave;
 *    qualquer alteração gera chave nova;
 *  - replay do backend é sucesso normal, nunca falso conflito;
 *  - COUNT_LINE_VERSION_CONFLICT nunca sobrescreve nem re-tenta sozinho —
 *    recarrega o vigente e devolve a decisão ao operador;
 *  - JUSTIFICATION_REQUIRED preserva a quantidade digitada e pede justificativa;
 *  - double-submit é bloqueado pelo estado "saving".
 *
 * CONTAGEM CEGA: o estado nunca carrega systemQuantity/saldo — o operador
 * informa o que encontrou fisicamente sem ver o número do sistema.
 */

export type CollectorLineInfo = {
  lineId: string;
  expectedVersion: number;
  alreadyCounted: boolean;
  itemCode: string;
  itemDescription: string;
  itemUnit: string;
  warehouseCode: string;
  warehouseName: string;
  locationCode: string | null;
  locationName: string | null;
};

export type CollectorFlowPhase =
  | "scanning"
  | "counting"
  | "needs-justification"
  | "saving"
  | "success"
  | "conflict"
  | "error";

export type CollectorFlowState = {
  phase: CollectorFlowPhase;
  line: CollectorLineInfo | null;
  quantityText: string;
  justification: string;
  /** Intenção corrente: chave reutilizável enquanto o payload não mudar. */
  attempt: { fingerprint: string; operationId: string } | null;
  /** Mensagem operacional curta para o estado atual. */
  message: string | null;
};

export type CollectorSubmission = {
  lineId: string;
  countedQuantity: number;
  justification: string | null;
  expectedVersion: number;
  operationId: string;
};

export function createCollectorFlow(): CollectorFlowState {
  return {
    phase: "scanning",
    line: null,
    quantityText: "",
    justification: "",
    attempt: null,
    message: null,
  };
}

/** QR resolvido — pronto para digitar a quantidade (sem saldo na tela). */
export function beginCount(state: CollectorFlowState, line: CollectorLineInfo): CollectorFlowState {
  return {
    ...createCollectorFlow(),
    phase: "counting",
    line,
    message: line.alreadyCounted
      ? "Este item já foi contado nesta conferência. Nova contagem substitui a vigente."
      : null,
  };
}

export function setQuantity(state: CollectorFlowState, quantityText: string): CollectorFlowState {
  return { ...state, quantityText };
}

export function setJustification(state: CollectorFlowState, justification: string): CollectorFlowState {
  return { ...state, justification };
}

/** Quantidade na precisão do Inventory — Decimal(20,6), nunca negativa. */
export function parseQuantityText(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function intentionFingerprint(input: {
  lineId: string;
  countedQuantity: number;
  justification: string | null;
  expectedVersion: number;
}): string {
  return JSON.stringify([
    input.lineId,
    input.countedQuantity.toFixed(6),
    input.justification ?? "",
    input.expectedVersion,
  ]);
}

function newOperationId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Monta o envio. MESMA intenção → mesma operationId (retry idempotente);
 * intenção alterada → chave nova. Retorna null se a quantidade for inválida
 * ou se já houver envio em andamento (anti double-submit).
 */
export function prepareSubmission(
  state: CollectorFlowState
): { state: CollectorFlowState; submission: CollectorSubmission } | null {
  if (!state.line) return null;
  if (state.phase === "saving") return null;

  const countedQuantity = parseQuantityText(state.quantityText);
  if (countedQuantity == null) return null;

  const justification = state.justification.trim() || null;
  const fingerprint = intentionFingerprint({
    lineId: state.line.lineId,
    countedQuantity,
    justification,
    expectedVersion: state.line.expectedVersion,
  });
  const operationId =
    state.attempt && state.attempt.fingerprint === fingerprint
      ? state.attempt.operationId
      : newOperationId();

  return {
    state: {
      ...state,
      phase: "saving",
      attempt: { fingerprint, operationId },
      message: null,
    },
    submission: {
      lineId: state.line.lineId,
      countedQuantity,
      justification,
      expectedVersion: state.line.expectedVersion,
      operationId,
    },
  };
}

/** Sucesso (inclusive replay): limpa tudo e volta ao scanner. */
export function applySuccess(_state: CollectorFlowState): CollectorFlowState {
  return {
    ...createCollectorFlow(),
    phase: "success",
    message: "Contagem registrada",
  };
}

/** Depois do flash de sucesso, volta ao scanner mantendo a sessão. */
export function readyForNextScan(_state: CollectorFlowState): CollectorFlowState {
  return createCollectorFlow();
}

export type CollectorApiFailure = {
  status: number | null;
  code: string | null;
  message: string | null;
};

/**
 * Falha do envio. Cada código canônico tem transição própria:
 *  - JUSTIFICATION_REQUIRED  → preserva quantidade, pede justificativa;
 *  - COUNT_LINE_VERSION_CONFLICT → descarta a intenção, exige recarga + decisão;
 *  - COUNT_OPERATION_IDEMPOTENCY_CONFLICT → descarta a intenção, refazer envio;
 *  - rede/timeout (status null/5xx) → mantém a intenção para retry idempotente.
 */
export function applyFailure(
  state: CollectorFlowState,
  failure: CollectorApiFailure
): CollectorFlowState {
  if (failure.code === "JUSTIFICATION_REQUIRED") {
    return {
      ...state,
      phase: "needs-justification",
      message: "Divergência detectada. Informe a justificativa para confirmar.",
    };
  }
  if (failure.code === "COUNT_LINE_VERSION_CONFLICT") {
    return {
      ...state,
      phase: "conflict",
      attempt: null,
      message:
        "Este item foi contado por outro dispositivo ou atualizado. Confira e decida novamente.",
    };
  }
  if (failure.code === "COUNT_OPERATION_IDEMPOTENCY_CONFLICT") {
    return {
      ...state,
      phase: "counting",
      attempt: null,
      message: "A operação anterior divergiu. Revise a quantidade e envie novamente.",
    };
  }
  // Rede/timeout/5xx: intenção preservada — o retry reutiliza a MESMA
  // operationId e o backend faz replay se a primeira tiver chegado.
  return {
    ...state,
    phase: "counting",
    message: failure.message ?? "Falha de rede. Toque em confirmar para tentar novamente.",
  };
}

/**
 * Após conflito de versão o operador decide de novo sobre o estado VIGENTE:
 * linha recarregada, nova expectedVersion, quantidade zerada, intenção nova.
 */
export function applyReloadedLine(
  state: CollectorFlowState,
  line: CollectorLineInfo
): CollectorFlowState {
  return {
    ...createCollectorFlow(),
    phase: "counting",
    line,
    message: "Estado atualizado. Informe a quantidade encontrada.",
  };
}
