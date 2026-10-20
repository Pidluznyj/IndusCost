// Parte 4: RH encerra a coleta (com pendência explícita), abre a calibração, compara
// perspectivas e devolve a avaliação de Bia ao líder.
import { login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9342);
try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__p = hr;
  await login(hr, "rh.teste@induscost.test");
  step("22 login do RH", true);
  await openModule(hr);
  await hr.waitTestId("perf-cycle-desk", 30000);

  // 23 consolidação: pendências exigem confirmação explícita
  await hr.clickTestId("perf-cycle-next");
  await hr.waitTestId("perf-accept-pending");
  const blocked = await hr.eval(`document.querySelector('[data-testid="perf-transition-dialog-save"]').disabled`);
  const pendingText = await hr.eval(`document.querySelector('[data-testid="perf-transition-dialog"]').innerText`);
  await hr.click('[data-testid="perf-accept-pending"]');
  await hr.shot("23a-encerrar-coleta-pendencias");
  await hr.clickTestId("perf-transition-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-desk"]').innerText.includes("Iniciar a calibração")`, { label: "consolidação" });
  step("23 consolidação com tratamento explícito de pendências", blocked === true, pendingText.split("\n").find((l) => l.includes("pendente")) ?? "");
  await hr.clickTestId("perf-cycle-next");
  await hr.waitTestId("perf-transition-dialog");
  await hr.clickTestId("perf-transition-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-desk"]').innerText.includes("Tornar os resultados oficiais")`, { label: "calibração" });

  // 24 calibração: comparação de perspectivas, divergências e evidências
  await hr.clickTestId("perf-tabs-tab-calibracao");
  await hr.waitTestId("perf-calibration-table", 20000);
  await hr.click('[data-testid="perf-cal-row-[DEMO] Ana Souza"] button[aria-expanded]');
  await hr.waitTestId("perf-cal-detail-[DEMO] Ana Souza");
  await hr.fullShot("24a-calibracao-fila");
  const detail = await hr.eval(`document.querySelector('[data-testid="perf-cal-detail-[DEMO] Ana Souza"]').innerText`);
  const rows = await hr.eval(`document.querySelectorAll('[data-testid^="perf-cal-row-"]').length`);
  step("24 fila de calibração com perspectivas, divergências e evidências", rows === 4 && /Exemplo observado/.test(detail), `${rows} pessoas`);

  // devolução ao líder (Bia)
  await hr.clickTestId("perf-cal-return-[DEMO] Bia Lima");
  await hr.waitTestId("perf-return-dialog");
  await hr.type('[data-testid="perf-return-dialog-reason"]', "Detalhe com um exemplo o motivo da nota de cultura.");
  await hr.clickTestId("perf-return-dialog-save");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cal-row-[DEMO] Bia Lima"]').innerText.includes("Devolvida")`, { label: "devolvida" });
  await hr.shot("24b-revisao-solicitada");
  const homologateDisabled = await hr.eval(`document.querySelector('[data-testid="perf-homologate"]').disabled`);
  step("24b revisão solicitada ao líder bloqueia a homologação", homologateDisabled === true);
  console.log("logs:", JSON.stringify(hr.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 4", false, error.message);
  try {
    await globalThis.__p?.shot("error-part4");
  } catch {}
} finally {
  writeResults("part4");
  await browser.close();
}
