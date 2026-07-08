import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  saveMaterialMarketAlertGlobalConfig,
  saveMaterialMarketAlertMaterialConfig,
} from "./materialMarketAlertConfig.server.js";

describe("materialMarketAlertConfig.server", () => {
  it("cria registro de auditoria ao salvar configuração global", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const globalState = {
      id: "GLOBAL",
      risePercentThreshold: 10,
      fallPercentThreshold: 10,
      daysWithoutQuote: 90,
      alertsEnabled: true,
      updatedAt: new Date("2026-01-01"),
      updatedBy: null as string | null,
    };

    const db = {
      materialMarketAlertGlobalConfig: {
        findUnique: async () => ({ ...globalState }),
        create: async () => globalState,
        upsert: async ({ update }: { update: Record<string, unknown> }) => {
          Object.assign(globalState, update);
          globalState.updatedAt = new Date("2026-07-01");
          return { ...globalState };
        },
      },
      materialMarketAlertConfig: {
        findUnique: async () => null,
        upsert: async () => null,
        delete: async () => null,
      },
      materialMarketAlertConfigAudit: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          audits.push(data);
          return { id: "audit-1", ...data };
        },
      },
    };

    await saveMaterialMarketAlertGlobalConfig(
      db as never,
      {
        risePercentThreshold: 15,
        fallPercentThreshold: 8,
        daysWithoutQuote: 60,
        alertsEnabled: true,
      },
      "user-1"
    );

    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.scope, "GLOBAL");
    assert.equal(audits[0]!.updatedBy, "user-1");
    assert.ok(audits[0]!.beforeJson);
    assert.ok(audits[0]!.afterJson);
  });

  it("cria registro de auditoria ao salvar override de material", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const globalState = {
      id: "GLOBAL",
      risePercentThreshold: 10,
      fallPercentThreshold: 10,
      daysWithoutQuote: 90,
      alertsEnabled: true,
      updatedAt: new Date(),
      updatedBy: null,
    };

    const db = {
      materialMarketAlertGlobalConfig: {
        findUnique: async () => ({ ...globalState }),
        create: async () => globalState,
        upsert: async () => globalState,
      },
      materialMarketAlertConfig: {
        findUnique: async () => null,
        upsert: async ({ create }: { create: Record<string, unknown> }) => ({
          ...create,
          updatedAt: new Date("2026-07-01"),
        }),
        delete: async () => null,
      },
      materialMarketAlertConfigAudit: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          audits.push(data);
          return { id: "audit-2", ...data };
        },
      },
    };

    await saveMaterialMarketAlertMaterialConfig(
      db as never,
      "mat-1",
      { risePercentThreshold: 5 },
      { updatedBy: "user-2" }
    );

    assert.equal(audits.length, 1);
    assert.equal(audits[0]!.scope, "MATERIAL");
    assert.equal(audits[0]!.materialId, "mat-1");
    assert.equal(audits[0]!.updatedBy, "user-2");
  });
});
