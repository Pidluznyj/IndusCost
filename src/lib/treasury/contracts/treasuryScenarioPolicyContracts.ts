/**
 * Contratos tipados da política de cenários da Caixa (client-safe).
 * Persistência: TreasuryScenarioPolicy (singleton "GLOBAL") — só o backend
 * grava. O frontend usa este DTO para renderizar (admin) e para receber
 * junto do endpoint dos cenários (metadata da política que produziu o
 * resultado, sem esconder números no código).
 */

import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";

export const TREASURY_SCENARIO_POLICY_SINGLETON_ID = "GLOBAL" as const;

export type TreasuryScenarioPolicyDto = {
  id: "GLOBAL";
  pessimisticEnabled: boolean;
  optimisticReceivableAdvanceLimitDays: number;
  optimisticPayableDelayLimitDays: number;
  pessimisticReceivableDelayDays: number;
  pessimisticOverdueReceivableDelayDays: number | null;
  pessimisticTreatBrokenPromiseAsDelayed: boolean;
  useCustomerBehaviorHistory: boolean;
  useSupplierBehaviorHistory: boolean;
  version: number;
  updatedAt: TreasuryTimestampIso;
  createdAt: TreasuryTimestampIso;
  updatedByUserId: string | null;
};

export type TreasuryScenarioPolicyPatch = Partial<
  Pick<
    TreasuryScenarioPolicyDto,
    | "pessimisticEnabled"
    | "optimisticReceivableAdvanceLimitDays"
    | "optimisticPayableDelayLimitDays"
    | "pessimisticReceivableDelayDays"
    | "pessimisticOverdueReceivableDelayDays"
    | "pessimisticTreatBrokenPromiseAsDelayed"
    | "useCustomerBehaviorHistory"
    | "useSupplierBehaviorHistory"
  >
>;

/**
 * Valores default oficiais — usados quando o singleton ainda não foi criado
 * (edge case: banco antes da migration ter rodado localmente, ou setup novo).
 * Iguais aos defaults do schema; documentados aqui para que o motor dos
 * cenários possa consumir sem depender de request a banco.
 */
export const TREASURY_SCENARIO_POLICY_DEFAULTS = {
  pessimisticEnabled: true,
  optimisticReceivableAdvanceLimitDays: 0,
  optimisticPayableDelayLimitDays: 0,
  pessimisticReceivableDelayDays: 15,
  pessimisticOverdueReceivableDelayDays: null as number | null,
  pessimisticTreatBrokenPromiseAsDelayed: true,
  useCustomerBehaviorHistory: false,
  useSupplierBehaviorHistory: false,
} as const;

/**
 * Validações puras dos ranges aceitáveis — mesmo checador é usado no
 * repositório (server) e nos testes. Rejeição com mensagem em pt-BR.
 */
export function assertValidTreasuryScenarioPolicyPatch(
  patch: TreasuryScenarioPolicyPatch
): void {
  function isPositiveInt(value: number | null | undefined): boolean {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
  }
  function isReasonableDelay(value: number): boolean {
    return value <= 365; // um ano é o limite prático — evita input absurdo.
  }
  function check(field: keyof TreasuryScenarioPolicyPatch, value: unknown) {
    if (value == null) return;
    if (typeof value === "boolean") return;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`${field}: valor deve ser numérico ou booleano.`);
    }
    if (!isPositiveInt(value)) {
      throw new Error(`${field}: valor deve ser inteiro ≥ 0.`);
    }
    if (!isReasonableDelay(value)) {
      throw new Error(`${field}: valor máximo aceitável é 365 dias.`);
    }
  }

  for (const [k, v] of Object.entries(patch) as [
    keyof TreasuryScenarioPolicyPatch,
    unknown,
  ][]) {
    check(k, v);
  }
}
