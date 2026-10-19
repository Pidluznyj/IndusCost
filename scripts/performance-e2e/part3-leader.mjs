// Parte 3: líder entra, vê só a própria equipe, avalia com evidência, salva, retoma e envia.
import { BASE, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9341);
async function evaluate(page, name, scores, { stopAfterSave = false } = {}) {
  await page.clickTestId(`perf-team-open-[DEMO] ${name}`);
  await page.waitTestId("perf-leader-form");
  await page.waitTestId("perf-leader-q-DT-01");
  const codes = await page.eval(`[...document.querySelectorAll('[data-testid^="perf-leader-q-"]')].map(e => e.dataset.testid).filter(t => /^perf-leader-q-[A-Z]{2}-\\d\\d$/.test(t)).map(t => t.replace("perf-leader-q-", ""))`);
  for (const code of codes) {
    const value = scores(code);
    await page.click(`[data-testid="perf-leader-q-${code}-${value}"]`);
    if (value === 1 || value === 4) {
      await page.type(`[data-testid="perf-leader-q-${code}-evidence"]`, `Exemplo observado em ${code}: lote entregue sem retrabalho.`);
    }
  }
  return codes;
}
try {
  const ctx = await browser.newContext();
  const page = await browser.newPage(ctx, { width: 1366, height: 860 });
  globalThis.__p = page;
  await login(page, "lider.teste@induscost.test");
  step("18 login do líder", true);
  await openModule(page);
  const tabs = await page.eval(`[...document.querySelectorAll('[data-testid="perf-tabs"] button')].map(b => b.innerText.trim())`);
  await page.clickTestId("perf-tabs-tab-equipe");
  await page.waitTestId("perf-team-list", 20000);
  await page.shot("18-lider-equipe");
  const names = await page.eval(`[...document.querySelectorAll('[data-testid^="perf-team-item-"]')].map(e => e.dataset.testid.replace("perf-team-item-", ""))`);
  step("18b líder vê só a própria equipe e não tem abas de RH", names.length === 3 && !names.some((n) => n.includes("Otávio")) && !tabs.includes("Calibração"), `${names.join(", ")} | abas: ${tabs.join(", ")}`);

  // IDOR: tarefa de outro líder pela API direta
  const otherTask = await page.eval(`fetch("/api/hr/performance/cycles").then(r => r.json()).then(async (c) => { const ws = await fetch("/api/hr/performance/cycles/" + c.cycles[0].id + "/workspace").then(r => r.json()); return ws.people.map(p => p.participant.employeeName); })`);
  step("18c workspace do líder só traz a equipe", !otherTask.some((n) => n.includes("Otávio")), otherTask.join(", "));

  // 19-20 avaliação com evidência; nota extrema sem exemplo é barrada
  await evaluate(page, "Ana Souza", (code) => (code === "DT-01" ? 4 : code === "PO-03" ? "no" : code.startsWith("CU") ? 3 : 4));
  await page.clickTestId("perf-leader-save");
  await page.waitTestId("perf-leader-form-notice", 15000);
  await page.shot("19-lider-formulario-salvo");
  step("19 avaliação salva como rascunho", true);
  await page.clickText("Fechar");
  await sleep(600);
  await page.clickTestId("perf-team-open-[DEMO] Ana Souza");
  await page.waitTestId("perf-leader-q-DT-01");
  const kept = await page.eval(`document.querySelector('[data-testid="perf-leader-q-DT-01-evidence"]')?.value ?? ""`);
  const guide = await page.eval(`document.querySelector('[data-testid="perf-leader-q-DT-03-guide"]')?.textContent ?? ""`);
  step("20c líder vê o comportamento observável e o exemplo do cargo da pessoa", /Regula a extrusora/.test(guide) && guide.includes("Para [DEMO] Operador de produção"), guide.slice(0, 120));
  const selfHidden = !(await page.eval(`document.querySelector('[data-testid="perf-leader-form"]').innerText.includes("Autoavaliação:")`));
  step("20 retomada com evidência preservada e autoavaliação oculta", kept.length > 10 && selfHidden);

  // evidência faltando bloqueia o envio
  await page.click('[data-testid="perf-leader-q-DT-02-1"]');
  await page.type('[data-testid="perf-leader-q-DT-02-evidence"]', "curto");
  const blocked = await page.eval(`document.querySelector('[data-testid="perf-leader-submit"]').disabled`);
  await page.click('[data-testid="perf-leader-q-DT-02-4"]');
  await page.type('[data-testid="perf-leader-q-DT-02-evidence"]', "Entregou o lote de outubro no prazo combinado.");
  step("20b nota 1 sem exemplo bloqueia o envio", blocked === true);

  // 21 finalização
  await page.clickTestId("perf-leader-submit");
  await page.waitTestId("perf-leader-confirm");
  await page.clickTestId("perf-leader-confirm-send");
  await page.waitFor(`document.querySelector('[data-testid="perf-leader-form"]').innerText.includes("Autoavaliação:")`, { label: "autoavaliação liberada", timeout: 20000 });
  await page.fullShot("21-lider-enviada-com-autoavaliacao");
  const locked = await page.eval(`!document.querySelector('[data-testid="perf-leader-submit"]')`);
  step("21 finalização: envio, autoavaliação liberada, sem edição", locked);
  await page.clickText("Fechar");
  await sleep(500);

  await evaluate(page, "Bia Lima", (code) => (code.startsWith("CU") ? 4 : 3));
  await page.clickTestId("perf-leader-submit");
  await page.waitTestId("perf-leader-confirm");
  await page.clickTestId("perf-leader-confirm-send");
  await page.waitFor(`!document.querySelector('[data-testid="perf-leader-submit"]')`, { timeout: 20000 });
  await page.clickText("Fechar");
  await sleep(500);
  await evaluate(page, "Fabi Sem Líder", (code) => (code.startsWith("PO") ? 2 : 3));
  await page.clickTestId("perf-leader-submit");
  await page.waitTestId("perf-leader-confirm");
  await page.clickTestId("perf-leader-confirm-send");
  await page.waitFor(`!document.querySelector('[data-testid="perf-leader-submit"]')`, { timeout: 20000 });
  await page.clickText("Fechar");
  await sleep(600);
  await page.clickTestId("perf-team-filter-submitted");
  await sleep(400);
  const sent = await page.eval(`document.querySelectorAll('[data-testid^="perf-team-item-"]').length`);
  step("21b três avaliações enviadas", sent === 3);
  console.log("logs:", JSON.stringify(page.logs.filter((l) => l.type !== "warning")));
} catch (error) {
  step("ERRO parte 3", false, error.message);
  try {
    await globalThis.__p?.shot("error-part3");
  } catch {}
} finally {
  writeResults("part3");
  await browser.close();
}
