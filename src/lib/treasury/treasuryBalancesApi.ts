/**
 * Cliente HTTP — snapshots de saldo da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import {
  TREASURY_ACCOUNTS_PATH,
  type TreasuryBalanceOrigin,
  type TreasuryBalanceSnapshotDto,
  type TreasuryListResponse,
} from "@/src/lib/treasury/contracts/index.js";

export type TreasuryBalancesListParams = {
  page?: number;
  pageSize?: number;
  origin?: TreasuryBalanceOrigin | null;
  from?: string | null;
  to?: string | null;
  signal?: AbortSignal;
};

export type TreasuryBalancesListPayload =
  TreasuryListResponse<TreasuryBalanceSnapshotDto> & {
    requestId?: string;
  };

export type TreasuryCreateBalanceSnapshotBody = {
  referenceAt: string;
  availableBalance: string;
  blockedBalance: string;
  investmentsBalance: string;
  usedLimit: string;
  origin: TreasuryBalanceOrigin;
  notes: string | null;
  justification?: string | null;
};

export type TreasuryCreateBalanceSnapshotPayload = {
  ok: true;
  created: boolean;
  snapshot: TreasuryBalanceSnapshotDto;
  requestId?: string;
};

function balancesPath(accountId: string): string {
  return `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/balances`;
}

export async function fetchTreasuryAccountBalances(
  accountId: string,
  params: TreasuryBalancesListParams = {}
): Promise<TreasuryBalancesListPayload> {
  const qs = new URLSearchParams();
  if (params.page != null) qs.set("page", String(params.page));
  if (params.pageSize != null) qs.set("pageSize", String(params.pageSize));
  if (params.origin) qs.set("origin", params.origin);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const query = qs.toString();
  const url = query
    ? `${balancesPath(accountId)}?${query}`
    : balancesPath(accountId);
  return fetchJsonOk<TreasuryBalancesListPayload>(url, {
    credentials: "include",
    signal: params.signal,
  });
}

export async function fetchTreasuryAccountLatestBalance(
  accountId: string,
  signal?: AbortSignal
): Promise<TreasuryBalanceSnapshotDto | null> {
  const res = await fetchJsonOk<{
    ok: true;
    snapshot: TreasuryBalanceSnapshotDto | null;
  }>(`${balancesPath(accountId)}/latest`, {
    credentials: "include",
    signal,
  });
  return res.snapshot;
}

export async function createTreasuryBalanceSnapshot(
  accountId: string,
  body: TreasuryCreateBalanceSnapshotBody,
  idempotencyKey: string
): Promise<TreasuryCreateBalanceSnapshotPayload> {
  return fetchJsonOk<TreasuryCreateBalanceSnapshotPayload>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/balance-snapshots`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
    }
  );
}

export type TreasuryCancelBalanceSnapshotPayload = {
  ok: true;
  snapshot: TreasuryBalanceSnapshotDto;
  requestId?: string;
};

/**
 * Cancelamento lógico (SUPER_ADMIN) — nunca DELETE físico. O saldo some de
 * todos os cálculos, mas fica no histórico/auditoria.
 */
export async function cancelTreasuryBalanceSnapshot(
  accountId: string,
  snapshotId: string,
  reason: string
): Promise<TreasuryCancelBalanceSnapshotPayload> {
  return fetchJsonOk<TreasuryCancelBalanceSnapshotPayload>(
    `${TREASURY_ACCOUNTS_PATH}/${encodeURIComponent(accountId)}/balance-snapshots/${encodeURIComponent(snapshotId)}/cancel`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }
  );
}
