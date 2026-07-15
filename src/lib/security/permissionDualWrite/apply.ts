/**
 * Apply dual-write com dry-run, transaction e anti-loop.
 * Backfill legado→estrutura é opt-in e NÃO regrava AppUser.permissions[].
 */

import type { AppUserRole } from "@prisma/client";
import {
  planLegacyToStructured,
  planStructuredToLegacy,
} from "./plan.ts";
import type {
  DualWriteApplyResult,
  DualWritePlan,
  StructuredGrantMap,
} from "./types.ts";

export type DualWriteUserSnapshot = {
  userId: string;
  role: AppUserRole;
  legacyPermissions: string[];
  overrides: Array<{
    resourceKey: string;
    canView: boolean | null;
    canExecute: boolean | null;
    canManage: boolean | null;
    reason: string | null;
  }>;
};

export type DualWritePort = {
  loadUser(userId: string): Promise<DualWriteUserSnapshot | null>;
  updateLegacyPermissions(userId: string, permissions: string[]): Promise<void>;
  replaceOverrides(
    userId: string,
    overrides: DualWriteUserSnapshot["overrides"]
  ): Promise<void>;
  transaction<T>(fn: (port: DualWritePort) => Promise<T>): Promise<T>;
};

export type DualWriteApplyOptions = {
  port: DualWritePort;
  userId: string;
  dryRun: boolean;
  /**
   * Sentido 1 com mapa estruturado já calculado (admin save / preset).
   * Se omitido, porta só usa snapshot atual.
   */
  effectiveByResourceKey?: StructuredGrantMap;
  /**
   * Sentido 2 (backfill): projeta legado → overrides.
   * NUNCA materializa de volta permissions[] neste passo.
   * Default false — backfill futuro, não produção neste prompt.
   */
  backfillStructuredFromLegacy?: boolean;
  /** Exige true além de dryRun=false para aplicar backfill. */
  confirmBackfillApply?: boolean;
  preserveOutsideCatalog?: boolean;
};

function attachApplied(plan: DualWritePlan, applied: boolean): DualWriteApplyResult {
  return { ...plan, applied };
}

/**
 * Dual-write controlado.
 * - structured→legacy: único sentido que grava AppUser.permissions[]
 * - legacy→structured: só grava overrides se backfill confirmado; sem loop
 */
export async function applyDualWrite(
  options: DualWriteApplyOptions
): Promise<DualWriteApplyResult> {
  const snap = await options.port.loadUser(options.userId);
  if (!snap) {
    throw new Error(`DUAL_WRITE_USER_NOT_FOUND:${options.userId}`);
  }

  if (options.backfillStructuredFromLegacy) {
    const plan = planLegacyToStructured({
      role: snap.role,
      legacyPermissions: snap.legacyPermissions,
      dryRun: options.dryRun,
    });

    if (options.dryRun) {
      return attachApplied(plan, false);
    }
    if (!options.confirmBackfillApply) {
      throw new Error(
        "DUAL_WRITE_BACKFILL_CONFIRM_REQUIRED: passe confirmBackfillApply=true (proibido em prod neste prompt)."
      );
    }
    if (!plan.compatible) {
      throw new Error(
        `DUAL_WRITE_BACKFILL_INCOMPATIBLE: lost=${plan.lostLegacy.join(",")}`
      );
    }

    const overrides = Object.entries(plan.afterStructured).map(([resourceKey, f]) => ({
      resourceKey,
      canView: f.canView ? true : null,
      canExecute: f.canExecute ? true : null,
      canManage: f.canManage ? true : null,
      reason: "dual-write-backfill",
    }));

    await options.port.transaction(async (tx) => {
      // Anti-loop: NÃO chamar updateLegacyPermissions aqui.
      await tx.replaceOverrides(options.userId, overrides);
    });

    return attachApplied(
      {
        ...plan,
        note: `${plan.note} Applied overrides only; permissions[] untouched.`,
      },
      true
    );
  }

  if (!options.effectiveByResourceKey) {
    throw new Error(
      "DUAL_WRITE_MISSING_STRUCTURED: informe effectiveByResourceKey ou backfillStructuredFromLegacy."
    );
  }

  const plan = planStructuredToLegacy({
    effectiveByResourceKey: options.effectiveByResourceKey,
    previousLegacyPermissions: snap.legacyPermissions,
    dryRun: options.dryRun,
    preserveOutsideCatalog: options.preserveOutsideCatalog,
  });

  if (options.dryRun || plan.unchanged) {
    return attachApplied(plan, false);
  }

  await options.port.transaction(async (tx) => {
    // Anti-loop: NÃO recriar overrides a partir do legado no mesmo write.
    await tx.updateLegacyPermissions(options.userId, plan.afterLegacy);
  });

  return attachApplied(plan, true);
}

/** Porta in-memory para testes de integração. */
export function createInMemoryDualWritePort(
  users: DualWriteUserSnapshot[]
): DualWritePort & { store: Map<string, DualWriteUserSnapshot> } {
  const store = new Map(users.map((u) => [u.userId, structuredClone(u)]));

  const port: DualWritePort & { store: Map<string, DualWriteUserSnapshot> } = {
    store,
    async loadUser(userId) {
      const u = store.get(userId);
      return u ? structuredClone(u) : null;
    },
    async updateLegacyPermissions(userId, permissions) {
      const u = store.get(userId);
      if (!u) throw new Error(`missing user ${userId}`);
      u.legacyPermissions = [...permissions].sort();
    },
    async replaceOverrides(userId, overrides) {
      const u = store.get(userId);
      if (!u) throw new Error(`missing user ${userId}`);
      u.overrides = structuredClone(overrides);
    },
    async transaction(fn) {
      const snapshot = new Map(
        [...store.entries()].map(([k, v]) => [k, structuredClone(v)])
      );
      try {
        return await fn(port);
      } catch (e) {
        store.clear();
        for (const [k, v] of snapshot) store.set(k, v);
        throw e;
      }
    },
  };
  return port;
}
