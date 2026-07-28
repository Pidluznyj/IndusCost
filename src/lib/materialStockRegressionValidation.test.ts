/**
 * Validação de regressão/integração — Conferência de Estoque + espelho planilha.
 * Fixtures estáveis de custo; performance de busca; segurança de endpoints.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { computeMaterialLandedCost } from "./materialCostPublication.js";
import { resolveMaterialLineCostForEngine } from "./materialCostEngineResolver.js";
import { directMaterialLineFromBom } from "./openBookMaterialExplosion.js";
import {
  computeMaterialTotalValue,
  normalizeMaterialQuantity,
} from "./materialQuantityTotal.js";
import { resolveMaterialStockStatus } from "./materialStockLevelRules.js";
import { searchMaterialStockTablet } from "./materialStockTablet.server.js";
import { parseMaterialStockTabletSearchQuery } from "./materialStockTabletQuery.js";
import { applySpreadsheetUpsert } from "./materialStockSpreadsheetMirror/queueRules.js";
import { validateMaterialStockSpreadsheetWebhookUrl } from "./materialStockSpreadsheetMirror/urlAllowlist.js";
import { deliverMaterialStockSpreadsheetMirrorWebhook } from "./materialStockSpreadsheetMirror/webhookClient.server.js";
import type { MaterialStockSpreadsheetMirrorPayload } from "./materialStockSpreadsheetMirror/types.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Fixture estável — valores oficiais de custo (não alterar). */
const FIXTURE = {
  currentCost: 5.17,
  averageCost: 5.0,
  standardCost: 4.8,
  freight: 0.25,
  standardLoss: 10,
  conversionFactor: 1.5,
  quantity: 100,
  bomQty: 2,
  bomLossPct: 0,
} as const;

const EXPECTED = {
  landedCost: 5.42,
  effectiveCost: 5.42 / 0.9,
  totalMaterialValue: 517,
  lineUnitCost: 5.42 / 0.9,
} as const;

describe("materialStock regression — custos idênticos (fixture estável)", () => {
  it("preserva current/standard/average/freight/perda/fator e custos derivados", () => {
    assert.equal(FIXTURE.currentCost, 5.17);
    assert.equal(FIXTURE.standardCost, 4.8);
    assert.equal(FIXTURE.averageCost, 5.0);
    assert.equal(FIXTURE.freight, 0.25);
    assert.equal(FIXTURE.standardLoss, 10);
    assert.equal(FIXTURE.conversionFactor, 1.5);

    const landed = computeMaterialLandedCost({
      currentCost: FIXTURE.currentCost,
      freight: FIXTURE.freight,
    });
    assert.equal(landed, EXPECTED.landedCost);

    const engine = resolveMaterialLineCostForEngine({
      id: "mat-reg-1",
      code: "MP-REG",
      description: "Fixture",
      currentCost: FIXTURE.currentCost,
      freight: FIXTURE.freight,
      standardLoss: FIXTURE.standardLoss,
    });
    assert.equal(engine.ok, true);
    if (!engine.ok) return;
    assert.equal(engine.landedCost, EXPECTED.landedCost);
    assert.ok(
      Math.abs(
        engine.landedCost / (1 - engine.standardLossPct / 100) -
          EXPECTED.effectiveCost
      ) < 1e-9
    );

    const line = directMaterialLineFromBom(
      engine.landedCost,
      engine.standardLossPct,
      FIXTURE.bomQty,
      FIXTURE.bomLossPct
    );
    assert.ok(Math.abs(line.matEffectiveCost - EXPECTED.lineUnitCost) < 1e-9);

    const total = computeMaterialTotalValue(
      normalizeMaterialQuantity(FIXTURE.quantity),
      FIXTURE.currentCost
    );
    assert.equal(total, EXPECTED.totalMaterialValue);

    // Níveis de estoque / status não alteram custos.
    const status = resolveMaterialStockStatus({
      currentQuantity: FIXTURE.quantity,
      contingencyQuantity: 40,
      minimumQuantity: 10,
      recommendedQuantity: 80,
    });
    assert.ok(typeof status === "string");
    assert.equal(
      computeMaterialLandedCost({
        currentCost: FIXTURE.currentCost,
        freight: FIXTURE.freight,
      }),
      EXPECTED.landedCost
    );
  });

  it("motores oficiais e APIs antigas não foram reescritos pela feature", () => {
    const engine = read("src/lib/productCostAnalysisEngine.server.ts");
    const resolver = read("src/lib/materialCostEngineResolver.ts");
    const qty = read("src/lib/materialQuantityTotal.ts");
    const tablet = read("src/lib/materialStockTablet.server.ts");
    assert.doesNotMatch(tablet, /currentCost|landedCost|effectiveCost|standardCost/);
    assert.match(resolver, /resolveMaterialLineCostForEngine/);
    assert.match(engine, /getProductCostAnalysis|ProductBOM/);
    assert.match(qty, /computeMaterialTotalValue/);
    assert.match(read("server.ts"), /app\.(get|put|post)\("\/api\/materials/);
  });
});

describe("materialStock regression — performance busca/paginação", () => {
  it("busca em 2000 MPs com paginação, payload enxuto e sem N+1 de users", async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => {
      const n = String(i).padStart(4, "0");
      return {
        id: `00000000-0000-4000-8000-${n.padStart(12, "0")}`,
        code: `MP-${n}`,
        description: i % 50 === 0 ? `Aço especial ${n}` : `Insumo ${n}`,
        unit: "kg",
        quantity: i,
        contingencyQuantity: null,
        minimumQuantity: null,
        recommendedQuantity: null,
        lastStockConferenceAt: null,
        lastStockConferenceUserId:
          i % 10 === 0 ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : null,
        stockConferenceVersion: 1,
        updatedAt: new Date("2026-07-28T12:00:00.000Z"),
        status: "ACTIVE",
      };
    });

    let userQueries = 0;
    let findManyCalls = 0;
    const db = {
      material: {
        async count() {
          return rows.length;
        },
        async findMany(args: { select?: object; take?: number; skip?: number }) {
          findManyCalls += 1;
          // select mínimo — sem custos
          const keys = Object.keys(args.select ?? {});
          assert.ok(!keys.includes("currentCost"));
          assert.ok(!keys.includes("freight"));
          let out = rows;
          if (args.skip != null || args.take != null) {
            out = rows.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? rows.length));
          }
          return out.map((r) => ({ ...r }));
        },
      },
      appUser: {
        async findMany() {
          userQueries += 1;
          return [
            {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              name: "Operador",
              email: "op@test.local",
            },
          ];
        },
      },
    };

    const query = parseMaterialStockTabletSearchQuery({
      q: "aço",
      page: "1",
      pageSize: "50",
      materialStatus: "ACTIVE",
    });

    const t0 = performance.now();
    const page1 = await searchMaterialStockTablet(db as any, query);
    const elapsed = performance.now() - t0;

    assert.ok(page1.rows.length > 0);
    assert.ok(page1.rows.length <= 50);
    assert.ok(page1.total >= page1.rows.length);
    assert.ok(page1.totalPages >= 1);
    assert.ok(elapsed < 500, `busca 2k MPs demorou ${elapsed.toFixed(1)}ms`);

    const payloadBytes = Buffer.byteLength(JSON.stringify(page1), "utf8");
    assert.ok(payloadBytes < 120_000, `payload grande: ${payloadBytes}`);
    assert.doesNotMatch(JSON.stringify(page1), /currentCost|landedCost|averageCost/);

    // Um único batch de users (não N+1 por linha).
    assert.equal(userQueries, 1);
    assert.ok(findManyCalls >= 1);

    const page2 = await searchMaterialStockTablet(
      db as any,
      parseMaterialStockTabletSearchQuery({
        q: "aço",
        page: "2",
        pageSize: "50",
        materialStatus: "ACTIVE",
      })
    );
    const ids1 = new Set(page1.rows.map((r) => r.id));
    for (const r of page2.rows) {
      assert.equal(ids1.has(r.id), false, "paginação não deve duplicar ids");
    }
  });
});

describe("materialStock regression — segurança e planilha", () => {
  it("endpoints admin/tablet exigem auth e não confiam em userId do body", () => {
    const routes = read("src/lib/materialStockTabletRoutes.ts");
    const admin = read("src/lib/materialStockSpreadsheetMirror/adminRoutes.ts");
    const conference = read("src/lib/materialStockConference.server.ts");
    assert.match(routes, /requireAppAuth/);
    assert.match(routes, /requireResource/);
    assert.match(routes, /userId do body é ignorado/);
    assert.match(routes, /autoridade é a sessão/);
    assert.match(admin, /settings\.material_stock_mirror\.view/);
    assert.match(admin, /settings\.material_stock_mirror\.manage/);
    assert.match(conference, /actor\.id/);
    assert.doesNotMatch(admin, /MaterialStockConferenceWorkspace/);
  });

  it("webhook rejeita secret ausente / destino inválido; upsert sem duplicar", async () => {
    const payload: MaterialStockSpreadsheetMirrorPayload = {
      operation: "UPSERT",
      eventId: "e",
      idempotencyKey: "i",
      eventType: "CONFERENCE",
      occurredAt: "2026-07-28T12:00:00.000Z",
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "MP-1",
      description: "Aço",
      unit: "kg",
      currentQuantity: 10,
      contingencyQuantity: 1,
      minimumQuantity: 2,
      recommendedQuantity: 3,
      lastStockConferenceAt: null,
      stockConferenceVersion: 1,
      materialStatus: "ACTIVE",
    };
    const missingSecret = await deliverMaterialStockSpreadsheetMirrorWebhook(payload, {
      config: {
        enabled: true,
        webhookUrl: "https://prod.westus.logic.azure.com/workflows/x",
        webhookSecret: null,
        allowedHosts: ["logic.azure.com"],
        httpTimeoutMs: 1000,
        maxAttempts: 5,
        workerIntervalMs: 5000,
        workerBatchSize: 5,
      },
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    assert.equal(missingSecret.ok, false);

    assert.equal(
      validateMaterialStockSpreadsheetWebhookUrl("https://127.0.0.1/x", [
        "logic.azure.com",
      ]).ok,
      false
    );

    let sheet = [
      {
        materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        code: "MP-1",
        description: "Aço",
        currentQuantity: 1,
      },
    ];
    sheet = applySpreadsheetUpsert(sheet, {
      materialId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "MP-1",
      description: "Aço v2",
      currentQuantity: 99,
    });
    assert.equal(sheet.length, 1);
    assert.equal(sheet[0].currentQuantity, 99);
  });

  it("logs de mirror/webhook não referenciam secret literal hardcoded", () => {
    const webhook = read(
      "src/lib/materialStockSpreadsheetMirror/webhookClient.server.ts"
    );
    const enqueue = read(
      "src/lib/materialStockSpreadsheetMirror/enqueue.server.ts"
    );
    assert.doesNotMatch(webhook, /X-IndusCost-Webhook-Secret.:\s*["'][^"']+["']/);
    assert.match(webhook, /process\.env|config\.webhookSecret|readMaterialStockSpreadsheetMirrorConfig/);
    assert.doesNotMatch(enqueue, /console\.(log|info|debug)\([^)]*payloadJson/);
  });
});
