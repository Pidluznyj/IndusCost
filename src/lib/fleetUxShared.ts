export {
  FLEET_LIST_DEFAULT_LIMIT,
  FLEET_LIST_MAX_LIMIT,
  parseFleetListLimit,
} from "@/src/lib/fleetListQuery.js";
export type FleetCriticalActionId =
  | "vehicle.deactivate"
  | "vehicle.sell"
  | "vehicle.return"
  | "vehicle.block"
  | "vehicle.unblock"
  | "reservation.cancel"
  | "cost.cancel"
  | "maintenance.complete"
  | "maintenance.cancel";

const CRITICAL_ACTIONS: Record<
  FleetCriticalActionId,
  { title: string; message: string; requireReason: boolean }
> = {
  "vehicle.deactivate": {
    title: "Inativar veículo",
    message: "Confirma inativar este veículo? Ele deixará de aparecer na operação.",
    requireReason: true,
  },
  "vehicle.sell": {
    title: "Vender veículo",
    message: "Confirma registrar a venda deste veículo?",
    requireReason: true,
  },
  "vehicle.return": {
    title: "Devolver veículo",
    message: "Confirma a devolução deste veículo ao fornecedor/locadora?",
    requireReason: true,
  },
  "vehicle.block": {
    title: "Bloquear veículo",
    message: "Confirma bloquear este veículo?",
    requireReason: true,
  },
  "vehicle.unblock": {
    title: "Desbloquear veículo",
    message: "Confirma desbloquear este veículo?",
    requireReason: true,
  },
  "reservation.cancel": {
    title: "Cancelar reserva",
    message: "Confirma cancelar esta reserva?",
    requireReason: true,
  },
  "cost.cancel": {
    title: "Cancelar custo",
    message: "Confirma cancelar este custo? O histórico será mantido.",
    requireReason: true,
  },
  "maintenance.complete": {
    title: "Concluir manutenção",
    message: "Confirma concluir esta manutenção?",
    requireReason: false,
  },
  "maintenance.cancel": {
    title: "Cancelar manutenção",
    message: "Confirma cancelar esta manutenção?",
    requireReason: true,
  },
};

export function getFleetCriticalActionConfig(action: FleetCriticalActionId) {
  return CRITICAL_ACTIONS[action];
}

export function validateFleetCriticalReason(
  action: FleetCriticalActionId,
  reason: string | null | undefined
): boolean {
  const cfg = CRITICAL_ACTIONS[action];
  if (!cfg?.requireReason) return true;
  return Boolean(typeof reason === "string" && reason.trim());
}

/** Confirmação no browser (UI); backend valida motivo quando obrigatório. */
export function confirmFleetCriticalAction(action: FleetCriticalActionId): {
  confirmed: boolean;
  reason: string | null;
} {
  const cfg = CRITICAL_ACTIONS[action];
  if (!cfg) return { confirmed: false, reason: null };

  if (!window.confirm(`${cfg.title}\n\n${cfg.message}`)) {
    return { confirmed: false, reason: null };
  }

  if (cfg.requireReason) {
    const reason = window.prompt("Informe o motivo (obrigatório):");
    if (!validateFleetCriticalReason(action, reason)) {
      return { confirmed: false, reason: null };
    }
    return { confirmed: true, reason: reason!.trim() };
  }

  const optional = window.prompt("Motivo (opcional):") ?? "";
  return { confirmed: true, reason: optional.trim() || null };
}

export const FLEET_AUDIT_ACTION_LABEL: Record<string, string> = {
  CREATE: "Criação",
  UPDATE: "Atualização",
  STATUS_CHANGE: "Alteração de status",
  BLOCK: "Bloqueio",
  UNBLOCK: "Desbloqueio",
  DEACTIVATE: "Inativação",
  SELL: "Venda",
  RETURN: "Devolução",
  APPROVE: "Aprovação",
  REJECT: "Rejeição",
  CANCEL: "Cancelamento",
  CHECKOUT: "Retirada",
  CHECKIN: "Devolução de uso",
  COMPLETE: "Conclusão",
  OPEN: "Abertura",
  STATUS: "Status",
  AUTO_BLOCK_CHECKLIST: "Bloqueio por checklist crítico",
  CRITICAL_CHECKLIST: "Checklist com item crítico",
  PUBLIC_CHECK_IN: "Check-in público (QR)",
  PUBLIC_CHECK_OUT: "Check-out público (QR)",
  PRESUMED_CHECK_OUT: "Check-out presumido (novo check-in)",
  REGENERATE: "Regeneração de token",
  REVOKE: "Revogação de token",
};
