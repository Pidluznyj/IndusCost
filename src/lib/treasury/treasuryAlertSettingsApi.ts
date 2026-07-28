/**
 * Client API — configuração global de alertas da Tesouraria.
 */

import { TREASURY_ALERT_SETTINGS_PATH } from "./contracts/treasuryContracts.js";
import type { TreasuryAlertSettingsFields } from "./contracts/treasuryAlertConfig.js";

export type TreasuryAlertSettingsClientDto = TreasuryAlertSettingsFields & {
  id: string;
  updatedAt: string;
  updatedByUserId: string | null;
};

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error =
      typeof body.error === "string"
        ? body.error
        : `Erro HTTP ${res.status}`;
    const err = new Error(error) as Error & {
      status?: number;
      code?: string;
      field?: string;
    };
    err.status = res.status;
    if (typeof body.code === "string") err.code = body.code;
    if (typeof body.field === "string") err.field = body.field;
    throw err;
  }
  return body;
}

export async function fetchTreasuryAlertSettings(): Promise<TreasuryAlertSettingsClientDto> {
  const res = await fetch(TREASURY_ALERT_SETTINGS_PATH, {
    credentials: "include",
  });
  const body = await parseJson(res);
  return body.settings as TreasuryAlertSettingsClientDto;
}

export async function updateTreasuryAlertSettings(
  patch: Partial<TreasuryAlertSettingsFields>
): Promise<TreasuryAlertSettingsClientDto> {
  const res = await fetch(TREASURY_ALERT_SETTINGS_PATH, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const body = await parseJson(res);
  return body.settings as TreasuryAlertSettingsClientDto;
}
