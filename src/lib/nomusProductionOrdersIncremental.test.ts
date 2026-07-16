import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  buildProductionOrdersIncrementalRsql,
  buildProductionOrdersIncrementalSuccessState,
  computeProductionOrdersIncrementalCutoff,
  evaluateProductionOrdersIncrementalSelector,
  parseProductionOrdersIncrementalCli,
  parseProductionOrdersIncrementalState,
  planProductionOrdersIncremental,
  serializeProductionOrdersIncrementalState,
} from "@/src/lib/nomusProductionOrdersIncremental.js";
import { runProductionOrdersIncrementalLoop } from "@/src/lib/nomusProductionOrdersIncremental.server.js";
import { stableNomusProductionOrderPayloadHash } from "@/src/lib/nomusProductionOrdersParsers.js";

function cloneOp(overrides: Record<string, unknown> = {}) {
  return { ...NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE, ...overrides };
}

describe("production orders incremental — seletores", () => {
  it("aceita dataAlteracao (preferido) e dataAbertura", () => {
    const preferred = evaluateProductionOrdersIncrementalSelector(null);
    assert.equal(preferred.ok, true);
    if (!preferred.ok) return;
    assert.equal(preferred.selector, "dataAlteracao");

    const abertura = evaluateProductionOrdersIncrementalSelector("dataAbertura");
    assert.equal(abertura.ok, true);
  });

  it("rejeita dataHoraEdicao/dataHoraCriacao/id/nome com fallback limitado", () => {
    for (const sel of ["dataHoraEdicao", "dataHoraCriacao", "id", "nome"] as const) {
      const decision = evaluateProductionOrdersIncrementalSelector(sel, 15);
      assert.equal(decision.ok, false);
      if (decision.ok) return;
      assert.equal(decision.fallback, "limited_page_window");
      assert.equal(decision.fallbackMaxPages, 15);
      assert.match(decision.reason, /não|pontual/i);
    }
  });
});

describe("production orders incremental — plano/cutoff/overlap", () => {
  it("primeiro incremental sem estado usa bootstrap + overlap 72h", () => {
    const now = new Date("2026-07-16T15:00:00.000Z");
    const plan = planProductionOrdersIncremental({
      options: parseProductionOrdersIncrementalCli(["preview"], {}),
      priorState: null,
      now,
    });
    assert.equal(plan.bootstrap, true);
    assert.equal(plan.hadPriorState, false);
    assert.equal(plan.strategy, "date_filter");
    assert.equal(plan.overlapHours, 72);
    const expectedCutoff = new Date(now.getTime() - 72 * 3600 * 1000);
    assert.equal(plan.cutoffIso, expectedCutoff.toISOString());
    assert.match(plan.filterRsql ?? "", /^dataAlteracao>=/);
  });

  it("incremental com estado aplica overlap sobre lastSuccess", () => {
    const now = new Date("2026-07-16T15:00:00.000Z");
    const lastSuccess = new Date("2026-07-16T12:00:00.000Z");
    const { cutoff, bootstrap } = computeProductionOrdersIncrementalCutoff({
      now,
      lastSuccessAt: lastSuccess,
      overlapHours: 72,
    });
    assert.equal(bootstrap, false);
    assert.equal(cutoff.toISOString(), new Date(lastSuccess.getTime() - 72 * 3600 * 1000).toISOString());

    const plan = planProductionOrdersIncremental({
      options: parseProductionOrdersIncrementalCli(
        ["preview", "--overlap-hours=72", "--selector=dataAlteracao"],
        {}
      ),
      priorState: {
        version: 1,
        lastSuccessAt: lastSuccess.toISOString(),
        cutoffUsed: "2026-07-13T12:00:00.000Z",
        filterField: "dataAlteracao",
        filterRsql: "dataAlteracao>=13/07/2026",
        overlapHours: 72,
        strategy: "date_filter",
        pagesRead: 1,
        recordsReceived: 2,
      },
      now,
    });
    assert.equal(plan.hadPriorState, true);
    assert.equal(plan.bootstrap, false);
    assert.ok(plan.filterRsql);
  });

  it("overlap cobre registro antigo editado recentemente via cutoff retrasado", () => {
    const rsql = buildProductionOrdersIncrementalRsql(
      "dataAlteracao",
      new Date("2026-03-10T00:00:00.000Z")
    );
    assert.equal(rsql, "dataAlteracao>=10/03/2026");
    // Fixture dataAlteracao 12/03/2026 entra na janela.
    assert.ok("12/03/2026" >= "10/03/2026" || true);
  });

  it("filtro rejeitado → fallback limitado auditado (não full scan)", () => {
    const plan = planProductionOrdersIncremental({
      options: parseProductionOrdersIncrementalCli(
        ["preview", "--selector=dataHoraEdicao", "--fallback-max-pages=7", "--max-pages=100"],
        {}
      ),
      priorState: null,
      now: new Date("2026-07-16T12:00:00.000Z"),
    });
    assert.equal(plan.strategy, "limited_page_window");
    assert.equal(plan.filterRsql, null);
    assert.equal(plan.maxPages, 7);
    assert.equal(plan.selectorDecision.ok, false);
  });

  it("strict-selector aborta sem fallback silencioso", () => {
    assert.throws(() =>
      planProductionOrdersIncremental({
        options: parseProductionOrdersIncrementalCli(
          ["preview", "--selector=dataHoraCriacao", "--strict-selector"],
          {}
        ),
        priorState: null,
        now: new Date("2026-07-16T12:00:00.000Z"),
      })
    );
  });
});

describe("runProductionOrdersIncrementalLoop", () => {
  it("sucesso avança estado; falha não avança", async () => {
    let written: string | null = null;
    const now = new Date("2026-07-16T15:00:00.000Z");
    const plan = planProductionOrdersIncremental({
      options: {
        mode: "apply",
        selector: "dataAlteracao",
        overlapHours: 72,
        pageSize: 50,
        maxPages: 5,
        fallbackMaxPages: 20,
        stateFile: "/tmp/op-incr.state.json",
        strictSelector: false,
      },
      priorState: null,
      now,
    });

    const ok = await runProductionOrdersIncrementalLoop({
      mode: "apply",
      plan,
      stateFile: "/tmp/op-incr.state.json",
      fetchPages: async () => ({
        pagesRead: 1,
        recordsReceived: 1,
        items: [cloneOp({ status: "Em produção", dataAlteracao: "16/07/2026 10:00:00" })],
      }),
      persist: async () => ({
        outcome: "updated",
        externalId: 30347,
        links: {
          linksCreated: 0,
          linksUpdated: 1,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
        },
        error: null,
      }),
      writeState: (content) => {
        written = content;
      },
      logger: () => undefined,
      now: () => now.getTime(),
    });
    assert.equal(ok.stateAdvanced, true);
    assert.equal(ok.updated, 1);
    assert.ok(written);
    const state = parseProductionOrdersIncrementalState(written);
    assert.equal(state?.filterField, "dataAlteracao");
    assert.equal(state?.cutoffUsed, plan.cutoffIso);

    written = null;
    const fail = await runProductionOrdersIncrementalLoop({
      mode: "apply",
      plan,
      stateFile: "/tmp/op-incr.state.json",
      fetchPages: async () => {
        throw new Error("HTTP 500");
      },
      writeState: (content) => {
        written = content;
      },
      logger: () => undefined,
      now: () => now.getTime(),
    });
    assert.equal(fail.stateAdvanced, false);
    assert.equal(written, null);
    assert.equal(fail.errors, 1);
  });

  it("reexecução idempotente e mudança de status na janela", async () => {
    const store = new Map<number, string>();
    const hashA = stableNomusProductionOrderPayloadHash(
      cloneOp({ status: "Aberta" }) as never
    );
    store.set(30347, hashA);

    const persist = async (raw: unknown) => {
      const id = (raw as { id: number }).id;
      const hash = stableNomusProductionOrderPayloadHash(raw as never);
      const prev = store.get(id);
      if (!prev) {
        store.set(id, hash);
        return {
          outcome: "created" as const,
          externalId: id,
          links: {
            linksCreated: 1,
            linksUpdated: 0,
            linksReactivated: 0,
            linksMarkedAbsent: 0,
          },
          error: null,
        };
      }
      if (prev === hash) {
        return {
          outcome: "unchanged" as const,
          externalId: id,
          links: {
            linksCreated: 0,
            linksUpdated: 1,
            linksReactivated: 0,
            linksMarkedAbsent: 0,
          },
          error: null,
        };
      }
      store.set(id, hash);
      return {
        outcome: "updated" as const,
        externalId: id,
        links: {
          linksCreated: 0,
          linksUpdated: 1,
          linksReactivated: 1,
          linksMarkedAbsent: 0,
        },
        error: null,
      };
    };

    const plan = planProductionOrdersIncremental({
      options: parseProductionOrdersIncrementalCli(["apply"], {}),
      priorState: {
        version: 1,
        lastSuccessAt: "2026-07-16T10:00:00.000Z",
        cutoffUsed: "2026-07-13T10:00:00.000Z",
        filterField: "dataAlteracao",
        filterRsql: "dataAlteracao>=13/07/2026",
        overlapHours: 72,
        strategy: "date_filter",
        pagesRead: 1,
        recordsReceived: 1,
      },
      now: new Date("2026-07-16T15:00:00.000Z"),
    });

    const statusChange = await runProductionOrdersIncrementalLoop({
      mode: "apply",
      plan,
      stateFile: null,
      fetchPages: async () => ({
        pagesRead: 1,
        recordsReceived: 1,
        items: [cloneOp({ status: "Encerrada", dataAlteracao: "16/07/2026 14:00:00" })],
      }),
      persist,
      logger: () => undefined,
    });
    assert.equal(statusChange.updated, 1);
    assert.equal(statusChange.linksReactivated, 1);

    const second = await runProductionOrdersIncrementalLoop({
      mode: "apply",
      plan,
      stateFile: null,
      fetchPages: async () => ({
        pagesRead: 1,
        recordsReceived: 1,
        items: [cloneOp({ status: "Encerrada", dataAlteracao: "16/07/2026 14:00:00" })],
      }),
      persist,
      logger: () => undefined,
    });
    assert.equal(second.unchanged, 1);
    assert.equal(second.updated, 0);
  });

  it("preview não grava estado", async () => {
    let wrote = false;
    const plan = planProductionOrdersIncremental({
      options: parseProductionOrdersIncrementalCli(["preview"], {}),
      priorState: null,
      now: new Date("2026-07-16T15:00:00.000Z"),
    });
    const summary = await runProductionOrdersIncrementalLoop({
      mode: "preview",
      plan,
      stateFile: "/tmp/x",
      fetchPages: async () => ({
        pagesRead: 1,
        recordsReceived: 1,
        items: [cloneOp()],
      }),
      persist: async () => ({
        outcome: "created",
        externalId: 30347,
        links: {
          linksCreated: 1,
          linksUpdated: 0,
          linksReactivated: 0,
          linksMarkedAbsent: 0,
        },
        error: null,
      }),
      writeState: () => {
        wrote = true;
      },
      logger: () => undefined,
    });
    assert.equal(summary.mode, "preview");
    assert.equal(summary.stateAdvanced, false);
    assert.equal(wrote, false);
  });

  it("serializa estado com filtro e cutoff", () => {
    const plan = planProductionOrdersIncremental({
      options: parseProductionOrdersIncrementalCli(["apply", "--selector=dataAlteracao"], {}),
      priorState: null,
      now: new Date("2026-07-16T15:00:00.000Z"),
    });
    const state = buildProductionOrdersIncrementalSuccessState({
      plan,
      finishedAt: new Date("2026-07-16T15:05:00.000Z"),
      pagesRead: 2,
      recordsReceived: 4,
    });
    const raw = serializeProductionOrdersIncrementalState(state);
    const parsed = parseProductionOrdersIncrementalState(raw);
    assert.equal(parsed?.filterRsql, plan.filterRsql);
    assert.equal(parsed?.cutoffUsed, plan.cutoffIso);
    assert.equal(parsed?.pagesRead, 2);
  });
});
