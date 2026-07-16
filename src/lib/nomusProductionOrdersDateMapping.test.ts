/**
 * OP-14.1 — mapeamento oficial de datas GET /rest/ordens.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED_DATES,
  NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
} from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  mapNomusProductionOrderPayload,
  resolveNomusProductionOrderDateInputs,
} from "@/src/lib/nomusProductionOrdersMapper.js";
import { parseNomusProductionOrderDateTime } from "@/src/lib/nomusProductionOrdersParsers.js";
import {
  mapProductionOrderDatesFromRawJson,
  parseProductionOrderDateRepairCli,
  productionOrderDatesNeedRepair,
  summarizeProductionOrderDateRepairDiff,
} from "@/src/lib/nomusProductionOrdersDateRepair.js";

function iso(d: Date | null): string | null {
  return d?.toISOString() ?? null;
}

describe("OP-14.1 — mapeamento oficial de datas", () => {
  it("converte cada um dos cinco campos oficiais (fixture OP 05800)", () => {
    const mapped = mapNomusProductionOrderPayload(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const exp = NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED_DATES;
    assert.equal(iso(mapped.row.openedAt), exp.openedAt);
    assert.equal(iso(mapped.row.releasedAt), exp.releasedAt);
    assert.equal(iso(mapped.row.plannedAt), exp.plannedAt);
    assert.equal(iso(mapped.row.deliveryAt), exp.deliveryAt);
    assert.equal(iso(mapped.row.nomusUpdatedAt), exp.nomusUpdatedAt);
    assert.equal(mapped.row.closedAt, null);
  });

  it("timezone America/Sao_Paulo (parede local → UTC)", () => {
    const parsed = parseNomusProductionOrderDateTime("23/06/2026 10:55:11");
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value?.toISOString(), "2026-06-23T13:55:11.000Z");
  });

  it("campos ausentes permanecem null (sem Date.now)", () => {
    const mapped = mapNomusProductionOrderPayload({ id: 9, nome: "OP X", status: "Liberada" });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.openedAt, null);
    assert.equal(mapped.row.releasedAt, null);
    assert.equal(mapped.row.plannedAt, null);
    assert.equal(mapped.row.deliveryAt, null);
    assert.equal(mapped.row.closedAt, null);
    assert.equal(mapped.row.nomusUpdatedAt, null);
    assert.equal(mapped.fieldErrors.length, 0);
  });

  it("datas inválidas viram null + fieldErrors", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 10,
      dataHoraCriacao: "não-é-data",
      dataHoraEntrega: "2026-07-08",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.openedAt, null);
    assert.equal(mapped.row.deliveryAt, null);
    assert.ok(mapped.fieldErrors.some((e) => e.field === "openedAt"));
    assert.ok(mapped.fieldErrors.some((e) => e.field === "deliveryAt"));
  });

  it("dataHoraEntrega NÃO preenche closedAt", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 11,
      status: "Encerrada",
      dataHoraEntrega: "08/07/2026 17:00:00",
      dataHoraEdicao: "14/07/2026 00:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(iso(mapped.row.deliveryAt), "2026-07-08T20:00:00.000Z");
    assert.equal(iso(mapped.row.nomusUpdatedAt), "2026-07-14T03:00:00.000Z");
    assert.equal(mapped.row.closedAt, null);
  });

  it("OP Liberada com dataHoraEntrega futura", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 12,
      status: "Liberada",
      dataHoraCriacao: "01/07/2026 08:00:00",
      dataHoraLiberacao: "01/07/2026 09:00:00",
      dataHoraInicialPlanejada: "02/07/2026 17:00:00",
      dataHoraEntrega: "31/12/2026 17:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.status, "Liberada");
    assert.equal(iso(mapped.row.deliveryAt), "2026-12-31T20:00:00.000Z");
    assert.equal(mapped.row.closedAt, null);
  });

  it("OP Encerrada sem timestamp oficial de encerramento → closedAt null", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 13,
      status: "Encerrada",
      dataHoraCriacao: "23/06/2026 00:00:00",
      dataHoraEntrega: "08/07/2026 17:00:00",
      dataHoraEdicao: "14/07/2026 00:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.status, "Encerrada");
    assert.ok(mapped.row.deliveryAt);
    assert.ok(mapped.row.nomusUpdatedAt);
    assert.equal(mapped.row.closedAt, null);
  });

  it("OP Cancelada com dataHoraEntrega → deliveryAt preenchido, closedAt null", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 14,
      status: "Cancelada",
      dataHoraEntrega: "08/07/2026 17:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(mapped.row.status, "Cancelada");
    assert.equal(iso(mapped.row.deliveryAt), "2026-07-08T20:00:00.000Z");
    assert.equal(mapped.row.closedAt, null);
  });

  it("payload com todos os campos oficiais", () => {
    const inputs = resolveNomusProductionOrderDateInputs(
      NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE
    );
    assert.equal(inputs.openedAt, "23/06/2026 00:00:00");
    assert.equal(inputs.releasedAt, "23/06/2026 10:55:11");
    assert.equal(inputs.plannedAt, "24/06/2026 17:00:00");
    assert.equal(inputs.deliveryAt, "08/07/2026 17:00:00");
    assert.equal(inputs.nomusUpdatedAt, "14/07/2026 00:00:00");
    assert.equal(inputs.closedAt, null);
  });

  it("payload parcial preenche só o que veio", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 15,
      dataHoraCriacao: "23/06/2026 00:00:00",
      dataHoraInicialPlanejada: "24/06/2026 17:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(iso(mapped.row.openedAt), "2026-06-23T03:00:00.000Z");
    assert.equal(iso(mapped.row.plannedAt), "2026-06-24T20:00:00.000Z");
    assert.equal(mapped.row.releasedAt, null);
    assert.equal(mapped.row.deliveryAt, null);
    assert.equal(mapped.row.nomusUpdatedAt, null);
  });

  it("aliases legados só como fallback (oficial tem prioridade)", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 16,
      dataHoraCriacao: "23/06/2026 00:00:00",
      dataAbertura: "01/01/2020 00:00:00",
      dataHoraEdicao: "14/07/2026 00:00:00",
      dataAlteracao: "01/01/2020 00:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(iso(mapped.row.openedAt), "2026-06-23T03:00:00.000Z");
    assert.equal(iso(mapped.row.nomusUpdatedAt), "2026-07-14T03:00:00.000Z");
  });

  it("closedAt só com campo inequívoco de encerramento", () => {
    const mapped = mapNomusProductionOrderPayload({
      id: 17,
      dataHoraEncerramento: "14/07/2026 18:00:00",
      dataHoraEntrega: "08/07/2026 17:00:00",
    });
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    assert.equal(iso(mapped.row.closedAt), "2026-07-14T21:00:00.000Z");
    assert.equal(iso(mapped.row.deliveryAt), "2026-07-08T20:00:00.000Z");
  });
});

describe("OP-14.1 — reparo a partir do rawJson", () => {
  it("extrai datas do rawJson sem consultar Nomus", () => {
    const result = mapProductionOrderDatesFromRawJson(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(iso(result.dates.openedAt), NOMUS_PRODUCTION_ORDER_OP_05800_EXPECTED_DATES.openedAt);
    assert.equal(result.dates.closedAt, null);
  });

  it("detecta necessidade de reparo e segunda passagem sem diff", () => {
    const mapped = mapProductionOrderDatesFromRawJson(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(mapped.ok, true);
    if (!mapped.ok) return;
    const empty = {
      openedAt: null,
      releasedAt: null,
      plannedAt: null,
      deliveryAt: null,
      closedAt: null,
      nomusUpdatedAt: null,
    };
    assert.equal(productionOrderDatesNeedRepair(empty, mapped.dates), true);
    assert.equal(productionOrderDatesNeedRepair(mapped.dates, mapped.dates), false);
    const diff = summarizeProductionOrderDateRepairDiff(empty, mapped.dates);
    assert.ok(diff.openedAt);
    assert.equal(Object.keys(summarizeProductionOrderDateRepairDiff(mapped.dates, mapped.dates)).length, 0);
  });

  it("CLI preview/apply e flags", () => {
    const preview = parseProductionOrderDateRepairCli([
      "preview",
      "--only-null-dates",
      "--limit=100",
      "--after-externalId=10",
      "--batch-size=50",
    ]);
    assert.equal(preview.mode, "preview");
    assert.equal(preview.onlyNullDates, true);
    assert.equal(preview.limit, 100);
    assert.equal(preview.afterExternalId, 10);
    assert.equal(preview.batchSize, 50);

    const apply = parseProductionOrderDateRepairCli(["apply", "--externalId=30347"]);
    assert.equal(apply.mode, "apply");
    assert.equal(apply.externalId, 30347);
  });
});
