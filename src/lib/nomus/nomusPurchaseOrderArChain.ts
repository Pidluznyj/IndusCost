/**
 * Encadeamento AR → Pedido de Compra Nomus.
 * PO só inicia se AR terminar com sucesso técnico.
 * Falha de PO não altera o exit code original de AR.
 */

export type NomusArPoChainDecision = {
  shouldRunPurchaseOrders: boolean;
  preserveArExitCode: true;
  reason: string;
};

export function decideNomusArToPurchaseOrderChain(input: {
  arExitCode: number;
  poEnabled?: boolean;
}): NomusArPoChainDecision {
  if (input.poEnabled === false) {
    return {
      shouldRunPurchaseOrders: false,
      preserveArExitCode: true,
      reason: "PO_CHAIN_DISABLED",
    };
  }
  if (input.arExitCode !== 0) {
    return {
      shouldRunPurchaseOrders: false,
      preserveArExitCode: true,
      reason: "AR_TECHNICAL_FAILURE",
    };
  }
  return {
    shouldRunPurchaseOrders: true,
    preserveArExitCode: true,
    reason: "AR_TECHNICAL_OK",
  };
}

export function resolveChainedExitCode(arExitCode: number, _poExitCode: number | null): number {
  return arExitCode;
}
