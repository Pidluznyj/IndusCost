import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSaoPauloDateTimeParts } from "@/src/lib/brentCommodityJob.js";
import { listRegisteredScheduledJobs } from "@/src/lib/brentCommodityJob.js";
import {
  CNPJ_WEEKLY_REFRESH_CRON,
  CNPJ_WEEKLY_REFRESH_REGISTERED_JOB,
  cnpjWeeklyRefreshInstant,
  dueCnpjWeeklyRefreshSlot,
  getCnpjRefreshSaoPauloParts,
  isCnpjWeeklyRefreshInstant,
  nextCnpjWeeklyRefresh,
} from "./schedule.js";

describe("agenda semanal de CNPJ", () => {
  it("dispara domingo às 08:00 no horário de Brasília", () => {
    const sundayMorning = new Date("2026-10-25T11:00:00.000Z");
    const parts = getCnpjRefreshSaoPauloParts(sundayMorning);
    assert.equal(parts.dateIso, "2026-10-25");
    assert.equal(parts.weekday, 0);
    assert.equal(parts.hour, 8);
    assert.equal(parts.minute, 0);
    assert.equal(isCnpjWeeklyRefreshInstant(parts), true);
    assert.deepEqual(parts, getSaoPauloDateTimeParts(sundayMorning));
    assert.equal(dueCnpjWeeklyRefreshSlot(sundayMorning), "2026-10-25");
    assert.equal(CNPJ_WEEKLY_REFRESH_CRON, "0 8 * * 0");
    assert.equal(CNPJ_WEEKLY_REFRESH_REGISTERED_JOB.timezone, "America/Sao_Paulo");
    const registered = listRegisteredScheduledJobs().find((job) => job.id === "cnpj-weekly-refresh");
    assert.equal(registered?.cronExpression, "0 8 * * 0");
  });

  it("não antecipa o domingo antes das 08:00 e calcula a próxima execução", () => {
    const before = new Date("2026-10-25T10:59:00.000Z");
    const beforeParts = getCnpjRefreshSaoPauloParts(before);
    assert.equal(beforeParts.hour, 7);
    assert.equal(beforeParts.minute, 59);
    assert.equal(isCnpjWeeklyRefreshInstant(beforeParts), false);
    assert.equal(dueCnpjWeeklyRefreshSlot(before), "2026-10-18");
    const next = nextCnpjWeeklyRefresh(before);
    assert.equal(next.slot, "2026-10-25");
    assert.equal(getCnpjRefreshSaoPauloParts(next.at).hour, 8);
    assert.equal(getCnpjRefreshSaoPauloParts(cnpjWeeklyRefreshInstant("2026-10-25")).weekday, 0);

    const saturday = new Date("2026-10-24T11:00:00.000Z");
    assert.equal(getCnpjRefreshSaoPauloParts(saturday).weekday, 6);
    assert.equal(isCnpjWeeklyRefreshInstant(getCnpjRefreshSaoPauloParts(saturday)), false);
    assert.equal(nextCnpjWeeklyRefresh(new Date("2026-10-26T13:00:00.000Z")).slot, "2026-11-01");
  });
});
