// Parte 7: o líder consulta resultados liberados, registra devolutiva e PDI da equipe e não
// consegue agir fora dela (backend).
import { loadState, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const state = loadState();
const browser = await start(9345);
try {
  const ctx = await browser.newContext();
  const page = await browser.newPage(ctx, { width: 1366, height: 860 });
  globalThis.__p = page;
  await login(page, "lider.teste@induscost.test");
  await openModule(page);
  await page.clickTestId("perf-tabs-tab-equipe");
  await page.clickTestId("perf-team-filter-all");
  await page.waitTestId("perf-team-result-[DEMO] Bia Lima", 20000);
  await page.shot("36a-lider-resultados-liberados");
  await page.clickTestId("perf-team-feedback-[DEMO] Bia Lima");
  await page.waitTestId("perf-feedback-dialog");
  await page.type('[data-testid="perf-feedback-strength"]', "Ajuda os colegas sem precisar pedir.");
  await page.type('[data-testid="perf-feedback-improvement"]', "Avisar antes quando a máquina dá sinal de falha.");
  await page.type('[data-testid="perf-feedback-action"]', "Usar o checklist de partida todo turno.");
  await page.clickTestId("perf-feedback-dialog-save");
  await page.waitTestId("perf-team-pdi-[DEMO] Bia Lima", 20000);
  await page.clickTestId("perf-team-pdi-[DEMO] Bia Lima");
  await page.waitTestId("perf-pdi-dialog");
  await page.type('[data-testid="perf-pdi-title"]', "Checklist de partida em todos os turnos");
  await page.clickTestId("perf-pdi-dialog-save");
  await sleep(1200);
  await page.shot("36b-lider-devolutiva-pdi");
  const card = await page.eval(`document.querySelector('[data-testid="perf-team-item-[DEMO] Bia Lima"]').innerText`);
  step("36 líder consulta resultado liberado, registra devolutiva e PDI", /Checklist de partida/.test(card));

  await page.clickTestId("perf-tabs-tab-pdi");
  await page.waitTestId("perf-pdi-list", 20000);
  const list = await page.eval(`document.querySelector('[data-testid="perf-pdi-list"]').innerText`);
  step("37 acompanhamento do PDI pelo líder (só a equipe)", /Bia Lima/.test(list) && /Ana Souza/.test(list));

  const forbidden = await page.eval(`(async () => {
    const cycles = await fetch("/api/hr/performance/cycles").then(r => r.json());
    const cycleId = cycles.cycles[0].id;
    const consolidated = await fetch("/api/hr/performance/reports/issue", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cycleId, kind: "consolidado" }) });
    const calib = await fetch("/api/hr/performance/cycles/" + cycleId + "/calibration");
    const manage = await fetch("/api/hr/performance/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Modelo do líder" }) });
    const dir = await fetch("/api/hr/performance/directory?q=a");
    return [consolidated.status, calib.status, manage.status, dir.status];
  })()`);
  step("38 backend nega ao líder: relatório do ciclo, calibração, gestão e cadastro", forbidden.every((s) => s === 403), forbidden.join(","));
  console.log("logs:", JSON.stringify(page.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 7", false, error.message);
  try {
    await globalThis.__p?.shot("error-part7");
  } catch {}
} finally {
  writeResults("part7");
  await browser.close();
}
