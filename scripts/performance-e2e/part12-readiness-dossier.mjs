// Parte 12: prontidão do ciclo (líderes fora, 180° obrigatória, topo), dossiê da pessoa e painel por
// avaliador na calibração, resumo de tarefas do líder. Usa os dados fictícios das partes 9/10.
import { BASE, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9390);
const api = (page, method, path, body) =>
  page.eval(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }${body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`
  );
const must = async (page, method, path, body) => {
  const out = await api(page, method, path, body);
  if (out.status >= 300) throw new Error(`${method} ${path} → ${out.status} ${JSON.stringify(out.body).slice(0, 300)}`);
  return out.body;
};

try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__hr = hr;
  await login(hr, "rh.teste@induscost.test");
  await openModule(hr);

  // Ciclo novo pela tela: a 180° já vem escolhida.
  await hr.clickTestId("perf-tabs-tab-ciclos");
  await hr.waitTestId("perf-cycles-tab");
  await hr.clickTestId("perf-cycle-new");
  await hr.waitTestId("perf-cycle-create");
  await hr.type('[data-testid="perf-cycle-create-name"]', "Ciclo prontidão 2027-S2");
  await hr.type('[data-testid="perf-cycle-create-period"]', "2º semestre de 2027");
  await hr.select('[data-testid="perf-cycle-create-classification"]', "OFFICIAL");
  const preselected = await hr.eval(`document.querySelector('[data-testid="perf-cycle-create-leadership"]').value`);
  await hr.shot("12-01-novo-ciclo-180-padrao");
  await hr.clickTestId("perf-cycle-create-save");
  await hr.waitTestId("perf-cycle-list", 20000);
  await hr.clickText("Ciclo prontidão 2027-S2", "button");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-title"]')?.innerText.includes("Ciclo prontidão 2027-S2")`, { label: "ciclo novo na mesa", timeout: 20000 });
  const cycleId = await hr.eval(`sessionStorage.getItem("ic-perf-cycle")`);
  step("12.01 ciclo oficial nasce com a avaliação de liderança escolhida", Boolean(preselected) && Boolean(cycleId));

  // Só a equipe de Bruno, sem o Bruno: a prontidão tem que apontar o líder fora e incluir com um clique.
  const dir = (await must(hr, "GET", `/api/hr/performance/directory?q=${encodeURIComponent("[DEMO]")}`)).employees;
  const idOf = (n) => dir.find((e) => e.name === `[DEMO] ${n}`).id;
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { employeeIds: ["Ana Souza", "Bia Lima", "Gabi Rocha", "Hugo Alves", "Iris Melo", "João Pinto"].map(idOf), exceptions: {} });
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-readiness", 45000);
  const outside = await hr.eval(`document.querySelector('[data-testid="perf-readiness-LEADER_OUTSIDE_CYCLE"]')?.innerText ?? ""`);
  await hr.fullShot("12-02-prontidao-lider-fora");
  step("12.02 prontidão aponta o líder fora do ciclo e quem ele lidera", /Bruno/.test(outside) && /lidera/.test(outside), outside.split("\n").slice(0, 3).join(" / "));

  await hr.clickTestId("perf-readiness-include-leaders");
  await hr.waitFor(`!document.querySelector('[data-testid="perf-readiness-LEADER_OUTSIDE_CYCLE"]')`, { label: "líderes incluídos", timeout: 20000 });
  await sleep(800);
  const ws = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  const names = ws.people.map((p) => p.participant.employeeName.replace("[DEMO] ", ""));
  await hr.fullShot("12-03-lideres-incluidos");
  step("12.03 um clique inclui Bruno e sobe até Carla (topo)", names.includes("Bruno Líder") && names.includes("Carla Gerente"), names.join(", "));

  // Preparar e tentar abrir: Marcos não está no ciclo (ninguém o lidera aqui), então só resta o aviso do topo.
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" });
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-page", 45000);
  await sleep(1500);
  const readiness = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/readiness`);
  const topWarn = readiness.issues.find((i) => i.code === "TOP_WITHOUT_EVALUATOR");
  const nextDisabled = await hr.eval(`document.querySelector('[data-testid="perf-cycle-next"]')?.disabled`);
  await hr.fullShot("12-04-prontidao-topo");
  step("12.04 só o aviso do topo fica; abrir continua liberado", !readiness.blocked && Boolean(topWarn) && nextDisabled === false, readiness.issues.map((i) => `${i.severity}:${i.code}`).join(","));

  // Trava real no servidor: tirar Carla e tentar abrir direto pela API.
  const carlaP = ws.people.find((p) => p.participant.employeeName.includes("Carla")).participant.id;
  await must(hr, "POST", `/api/hr/performance/participants/${carlaP}/remove`, { reason: "Teste da trava de prontidão." });
  const blocked = await api(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true });
  step("12.05 abrir pela API com líder fora é recusado (409 READINESS_BLOCKED)", blocked.status === 409 && blocked.body?.error === "READINESS_BLOCKED", `${blocked.status} ${blocked.body?.message ?? ""}`.slice(0, 160));
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants/include-leaders`);
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true });

  // Calibração do ciclo homologado da parte 9: dossiê e painel por avaliador.
  const cycles = (await must(hr, "GET", "/api/hr/performance/cycles")).cycles;
  const homologated = cycles.find((c) => c.name === "Ciclo piloto 180° 2026-S2");
  await hr.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(homologated.id)}); sessionStorage.setItem("ic-perf-tab", "calibracao")`);
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-calibration-table", 45000);
  await hr.waitTestId("perf-evaluators", 20000);
  await hr.clickTestId("perf-evaluators-toggle");
  await sleep(500);
  const evaluatorsText = await hr.eval(`document.querySelector('[data-testid="perf-evaluators"]').textContent`);
  await hr.fullShot("12-06-painel-avaliadores");
  step("12.06 painel por avaliador: Bruno e Carla com média, distribuição e leitura", /Bruno/.test(evaluatorsText) && /Carla/.test(evaluatorsText) && /Média/.test(evaluatorsText), evaluatorsText.split("\n").slice(0, 4).join(" / "));

  await hr.clickTestId("perf-cal-dossier-[DEMO] Bruno Líder");
  await hr.waitTestId("perf-dossier", 20000);
  await hr.waitTestId("perf-dossier-leadership", 20000);
  await sleep(600);
  const dossierText = await hr.eval(`document.querySelector('[data-testid="perf-dossier"]').textContent`);
  await hr.fullShot("12-07-dossie-bruno");
  const blocks = ["Pessoa × líder", "Posição preliminar", "Liderança: líder × superior × equipe", "Como esta pessoa avalia", "Ciclos anteriores", "PDI"];
  step("12.07 dossiê de Bruno reúne os seis blocos, sem comentário da equipe", blocks.every((b) => dossierText.includes(b)) && !dossierText.includes("Comentário confidencial"), blocks.filter((b) => !dossierText.includes(b)).join(",") || "todos os blocos");
  await hr.click('[data-testid="perf-dossier"] button[aria-label^="Fechar"]').catch(() => hr.clickText("Fechar"));

  // Líder: resumo do que falta.
  const lCtx = await browser.newContext();
  const leader = await browser.newPage(lCtx, { width: 1366, height: 900 });
  await login(leader, "lider.teste@induscost.test");
  await openModule(leader);
  await leader.clickTestId("perf-tabs-tab-equipe");
  await leader.waitTestId("perf-team-todo", 20000);
  const todo = await leader.eval(`document.querySelector('[data-testid="perf-team-todo"]').innerText`);
  await leader.fullShot("12-08-lider-resumo");
  step("12.08 líder vê numa linha o que falta com ele", /Falta com você|Tudo em dia/.test(todo), todo.replace(/\n/g, " ").slice(0, 160));
} catch (error) {
  step("ERRO parte 12", false, error.message);
  try {
    console.log("alerts:", await globalThis.__hr?.eval(`[...document.querySelectorAll('[role="alert"]')].map(e => e.innerText).join(" | ")`));
    await globalThis.__hr?.shot("error-part12");
  } catch {
    /* sem captura */
  }
} finally {
  writeResults("part12");
  await browser.close();
}
