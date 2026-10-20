import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CnpjWeeklyRefreshAdminCard } from "./CnpjWeeklyRefreshAdminCard";
import type { CnpjRefreshMonitor } from "@/src/lib/cnpjWeeklyRefresh/monitor";

const monitor: CnpjRefreshMonitor = {
  schedulerEnabled: true,
  nextSlot: "2026-10-25",
  nextAt: "2026-10-25T11:00:00.000Z",
  lastRun: {
    id: "run-1",
    status: "PARTIAL",
    trigger: "SCHEDULED",
    startedAt: "2026-10-25T11:00:00.000Z",
    finishedAt: "2026-10-25T12:00:00.000Z",
    durationMs: 3_600_000,
    eligibleCount: 10,
    consultedCount: 8,
    updatedCount: 2,
    unchangedCount: 5,
    failedCount: 1,
    partialCount: 1,
    invalidCount: 2,
    missingDocumentCount: 3,
    customerCount: 7,
    supplierCount: 4,
    lastCnpj: "11444777000161",
    sourceLabel: "brasilapi+publica.cnpj.ws",
    statusDetail: "not_applicable",
    percent: 80,
  },
};

describe("painel da consulta semanal", () => {
  it("mostra o acompanhamento e só oferece execução a quem administra", () => {
    const visible = renderToStaticMarkup(
      <CnpjWeeklyRefreshAdminCard
        monitor={monitor}
        changes={[{ id: "1", field: "registrationStatus", previousValue: "ATIVA", nextValue: "BAIXADA" }]}
        canManage
        error={null}
      />
    );
    assert.match(visible, /PARTIAL/);
    assert.match(visible, /Executar agora/);
    assert.match(visible, /Reprocessar falhas/);
    assert.match(visible, /BAIXADA/);
    const hidden = renderToStaticMarkup(
      <CnpjWeeklyRefreshAdminCard monitor={monitor} changes={[]} canManage={false} error={null} />
    );
    assert.equal(hidden.includes("Executar agora"), false);
    const settings = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../SettingsModule.tsx"),
      "utf8"
    );
    assert.match(settings, /CnpjWeeklyRefreshAdminPanel/);
    assert.match(settings, /settings\.cnpj_weekly_refresh\.manage/);
  });
});
