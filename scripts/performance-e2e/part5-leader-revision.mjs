// Parte 5: o líder recebe a devolução, vê o motivo, corrige e reenvia (nova versão).
import { login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9343);
try {
  const ctx = await browser.newContext();
  const page = await browser.newPage(ctx, { width: 1366, height: 860 });
  globalThis.__p = page;
  await login(page, "lider.teste@induscost.test");
  await openModule(page);
  await page.clickTestId("perf-tabs-tab-equipe");
  await page.waitTestId("perf-team-item-[DEMO] Bia Lima", 20000);
  const card = await page.eval(`document.querySelector('[data-testid="perf-team-item-[DEMO] Bia Lima"]').innerText`);
  await page.clickTestId("perf-team-open-[DEMO] Bia Lima");
  await page.waitTestId("perf-leader-returned");
  await page.shot("25a-lider-revisao-recebida");
  // corrige: CU-01 vira 4 com exemplo (as respostas anteriores vieram copiadas)
  await page.click('[data-testid="perf-leader-q-CU-01-4"]');
  await page.type('[data-testid="perf-leader-q-CU-01-evidence"]', "Mediou a discussão do turno B com calma em 12/10.");
  await page.clickTestId("perf-leader-submit");
  await page.waitTestId("perf-leader-confirm");
  await page.clickTestId("perf-leader-confirm-send");
  await page.waitFor(`!document.querySelector('[data-testid="perf-leader-submit"]')`, { timeout: 20000, label: "reenviada" });
  await page.shot("25b-lider-revisao-reenviada");
  step("25 líder recebe a revisão, corrige e reenvia", /Devolvida pelo RH/.test(card));
  console.log("logs:", JSON.stringify(page.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 5", false, error.message);
  try {
    await globalThis.__p?.shot("error-part5");
  } catch {}
} finally {
  writeResults("part5");
  await browser.close();
}
