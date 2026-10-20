// Parte 11: ciclo inativo (ou excluído) não aparece nas telas sem a opção "Mostrar ciclos inativos",
// nem quando era o ciclo selecionado (a seleção fica guardada no navegador). Usa os dados das partes 9/10.
import { BASE, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9380);
const api = (page, method, path, body) =>
  page.eval(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }${body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`
  );
const cardNames = (page) => page.eval(`[...document.querySelectorAll('[data-testid="perf-cycle-list"] [role="tab"], [data-testid="perf-cycle-list"] button')].map((b) => b.innerText.split("\\n")[0])`);

try {
  const ctx = await browser.newContext();
  const sa = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__hr = sa;
  await login(sa, "rh.teste@induscost.test");
  await openModule(sa);
  const cycles = (await api(sa, "GET", "/api/hr/performance/cycles")).body.cycles;
  const victim = cycles.find((c) => c.activation === "ACTIVE" && c.classification === "TEST");
  if (!victim) throw new Error("sem ciclo de teste ativo para inativar (rode a parte 10 antes)");
  const out = await api(sa, "POST", `/api/hr/performance/cycles/${victim.id}/inactivate`, { reason: "Ciclo de teste encerrado no roteiro." });
  if (out.status !== 200) throw new Error(`inativar → ${out.status} ${JSON.stringify(out.body)}`);
  // O ciclo inativado era o selecionado: é o caso relatado.
  await sa.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(victim.id)}); sessionStorage.setItem("ic-perf-tab", "ciclos")`);
  await sa.goto(`${BASE}/performance-cycle`);
  await sa.waitTestId("perf-cycle-list", 45000);
  await sleep(1500);
  const names = await cardNames(sa);
  const deskTitle = await sa.eval(`document.querySelector('[data-testid="perf-cycle-title"]')?.innerText ?? null`);
  const banner = await sa.eval(`document.body.innerText.includes("Ciclo inativo (")`);
  const stored = await sa.eval(`sessionStorage.getItem("ic-perf-cycle")`);
  await sa.fullShot("11-01-sem-opcao-inativo-oculto");
  const inactiveCount = cycles.filter((c) => c.activation === "INACTIVE").length + 1;
  step(
    "11.01 sem a opção, o ciclo inativo selecionado some da lista e da mesa",
    !banner && stored !== victim.id && names.length === cycles.length - inactiveCount,
    `cartões: ${names.length} de ${cycles.length} · mesa: ${deskTitle}`
  );

  await sa.click('[data-testid="perf-show-inactive"]');
  await sleep(800);
  const withInactive = await cardNames(sa);
  step("11.02 com a opção marcada, os inativos aparecem para consulta", withInactive.length === cycles.length, `${withInactive.length} cartões`);
  await sa.click('[data-testid="perf-show-inactive"]');
  await sleep(500);

  // Outras abas: a seleção antiga (inativa) não é usada.
  await sa.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(victim.id)})`);
  const usedIds = [];
  for (const tab of ["acompanhamento", "painel", "calibracao"]) {
    await sa.eval(`sessionStorage.setItem("ic-perf-tab", ${JSON.stringify(tab)})`);
    await sa.send("Network.enable");
    const seen = [];
    const listener = (msg) => {
      if (msg.sessionId === sa.sessionId && msg.method === "Network.requestWillBeSent" && msg.params.request.url.includes("/api/hr/performance/cycles/")) seen.push(msg.params.request.url);
    };
    browser.listeners.add(listener);
    await sa.goto(`${BASE}/performance-cycle`);
    await sa.waitTestId("perf-page", 45000);
    await sleep(2500);
    browser.listeners.delete(listener);
    usedIds.push(...seen.filter((u) => u.includes(victim.id)).map((u) => `${tab}: ${u.replace(BASE, "")}`));
  }
  await sa.fullShot("11-03-outras-abas");
  step("11.03 Acompanhamento, Painel e Calibração não carregam o ciclo inativo", usedIds.length === 0, usedIds.join(" | ") || "nenhuma chamada ao ciclo inativo");

  // Ciclo excluído guardado na seleção: some sem erro.
  await sa.eval(`sessionStorage.setItem("ic-perf-cycle", "00000000-0000-4000-8000-000000000000"); sessionStorage.setItem("ic-perf-tab", "ciclos")`);
  await sa.goto(`${BASE}/performance-cycle`);
  await sa.waitTestId("perf-cycle-list", 45000);
  await sleep(1500);
  const errors = await sa.eval(`[...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText).join(" | ")`);
  step("11.04 seleção de ciclo excluído é descartada sem erro", !errors && (await sa.eval(`sessionStorage.getItem("ic-perf-cycle")`)) !== "00000000-0000-4000-8000-000000000000", errors || "sem erro");
} catch (error) {
  step("ERRO parte 11", false, error.message);
  try {
    await globalThis.__hr?.shot("error-part11");
  } catch {
    /* sem captura */
  }
} finally {
  writeResults("part11");
  await browser.close();
}
