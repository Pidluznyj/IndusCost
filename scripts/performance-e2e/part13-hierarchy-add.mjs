// Parte 13: adicionar participantes por hierarquia no Chrome real, com a cadeia fictícia
// Carla (topo) → Bruno → Ana/Bia/Gabi/Hugo/Iris/João e Carla → Marcos → Otávio (equivale a Paulo → José Eduardo → Joseane).
// Testes A (líder + diretos), B (líder + árvore), C (deduplicação), D (snapshot), E (toda a organização) e prévia desatualizada.
import { BASE, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9400);
const api = (page, method, path, body) =>
  page.eval(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }${body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`
  );
const must = async (page, method, path, body) => {
  const out = await api(page, method, path, body);
  if (out.status >= 300) throw new Error(`${method} ${path} → ${out.status} ${JSON.stringify(out.body).slice(0, 300)}`);
  return out.body;
};
const N = (s) => s.replace("[DEMO] ", "");

try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__hr = hr;
  await login(hr, "rh.teste@induscost.test");
  await openModule(hr);

  // Ciclo novo (teste) para não tocar nos anteriores.
  const models = (await must(hr, "GET", "/api/hr/performance/models")).models;
  const created = await must(hr, "POST", "/api/hr/performance/cycles", {
    name: "Ciclo hierarquia 2027",
    periodLabel: "2027",
    modelId: models.find((m) => m.kind !== "LEADERSHIP" && m.status === "PUBLISHED").id,
    leadershipModelId: models.find((m) => m.kind === "LEADERSHIP" && m.status === "PUBLISHED").id,
    selfDueAt: "2027-03-30",
    leaderDueAt: "2027-04-15",
    classification: "TEST",
  });
  const cycleId = created.cycleId;
  await hr.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(cycleId)}); sessionStorage.setItem("ic-perf-tab", "ciclos")`);
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-cycle-list", 45000);
  // Como o RH faria: escolhe o cartão do ciclo novo.
  await hr.clickText("Ciclo hierarquia 2027", "button");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-title"]')?.innerText.includes("Ciclo hierarquia 2027")`, { label: "ciclo na mesa", timeout: 45000 });

  // Teste A — Bruno, líder + diretos, pela tela.
  await hr.clickTestId("perf-add-hierarchy");
  await hr.waitTestId("perf-hierarchy-add", 20000);
  await hr.type('[data-testid="perf-hierarchy-leader-search"]', "Bruno");
  await hr.clickText("[DEMO] Bruno Líder", "button");
  await hr.waitTestId("perf-hierarchy-leader-selected");
  await hr.shot("13-01a-escolha-lider");
  await hr.clickTestId("perf-hierarchy-add-save");
  await hr.waitTestId("perf-hierarchy-preview", 20000);
  await sleep(500);
  const previewA = await hr.eval(`[...document.querySelectorAll('[data-testid^="perf-hierarchy-row-"]')].map((r) => r.textContent)`);
  const summaryA = await hr.eval(`document.querySelector('[data-testid="perf-hierarchy-summary"]').innerText.replace(/\\n+/g, " ")`);
  await hr.fullShot("13-01b-previa-lider-diretos");
  const brunoRow = previewA.find((r) => r.startsWith("[DEMO] Bruno Líder"));
  const anaRow = previewA.find((r) => r.startsWith("[DEMO] Ana Souza"));
  step(
    "13.01 Teste A (líder + diretos): prévia com Bruno (líder, superior Carla) e a equipe direta com superior Bruno",
    previewA.length >= 3 && /Carla Gerente/.test(brunoRow) && new RegExp(`Líder · ${previewA.length - 1}`).test(brunoRow) && /Bruno Líder/.test(anaRow) && /Sem liderados/.test(anaRow),
    `${previewA.length} linhas · ${summaryA.slice(0, 120)}`
  );
  const beforeConfirm = (await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`)).people.length;
  await hr.clickTestId("perf-hierarchy-add-save");
  await hr.waitFor(`!document.querySelector('[data-testid="perf-hierarchy-add"]')`, { label: "incluído", timeout: 20000 });
  await sleep(800);
  const wsA = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  const pA = (name) => wsA.people.find((p) => N(p.participant.employeeName) === name)?.participant;
  await hr.fullShot("13-01c-incluidos");
  step(
    "13.01b confirmação: todos da prévia incluídos; prévia não gravou nada antes; Ana mantém Bruno; Bruno mantém Carla",
    beforeConfirm === 0 && wsA.people.length === previewA.length && pA("Ana Souza").managerName === "[DEMO] Bruno Líder" && pA("Bruno Líder").managerName === "[DEMO] Carla Gerente",
    `antes ${beforeConfirm} · depois ${wsA.people.length}`
  );

  // Teste D — snapshot gravado na inclusão.
  step(
    "13.02 Teste D (snapshot): isLeader, liderados e data gravados; Ana sem liderados",
    pA("Bruno Líder").isLeader === true && pA("Bruno Líder").directReportCount === previewA.length - 1 && Boolean(pA("Bruno Líder").leadershipSnapshotAt) && pA("Ana Souza").isLeader === false && pA("Bruno Líder").managerSource !== "RH",
    `Bruno: líder=${pA("Bruno Líder").isLeader} lidera=${pA("Bruno Líder").directReportCount} origem=${pA("Bruno Líder").managerSource}`
  );

  // Teste B — Carla, líder + árvore (pela API, mesma rota da tela), e Teste C — deduplicação.
  const previewB = await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "TREE", leaderEmployeeId: pA("Bruno Líder").managerId });
  const rowB = (name) => previewB.rows.find((r) => N(r.name) === name);
  step(
    "13.03 Teste B (árvore de Carla): prévia traz toda a cadeia; os já incluídos marcados; Ana continua com Bruno (não vira liderada de Carla)",
    previewB.summary.alreadyIncluded === wsA.people.length && previewB.summary.newParticipants >= 3 && rowB("Ana Souza").managerName === "[DEMO] Bruno Líder" && rowB("Ana Souza").inclusion === "ALREADY" && rowB("Carla Gerente").managerSource === "TOPO" && rowB("Marcos Manutenção").isLeader === true,
    `encontradas ${previewB.summary.found} · já ${previewB.summary.alreadyIncluded} · novas ${previewB.summary.newParticipants}`
  );
  const confirmB = await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "TREE", leaderEmployeeId: pA("Bruno Líder").managerId, token: previewB.token }, exceptions: {} });
  const confirmAgain = await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "TREE", leaderEmployeeId: pA("Bruno Líder").managerId, token: previewB.token }, exceptions: {} });
  const wsB = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  const uniqueB = new Set(wsB.people.map((p) => p.participant.employeeId)).size;
  step(
    "13.04 Teste C (deduplicação): segunda confirmação não repete ninguém; uma linha por pessoa",
    confirmB.added === previewB.summary.newParticipants && confirmAgain.added === 0 && uniqueB === wsB.people.length && wsB.people.length === wsA.people.length + previewB.summary.newParticipants,
    `1ª ${confirmB.added} · 2ª ${confirmAgain.added} · total ${wsB.people.length}`
  );

  // Prévia desatualizada: assinatura de outro recorte é recusada.
  const stale = await api(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { hierarchy: { mode: "DIRECT", leaderEmployeeId: pA("Bruno Líder").managerId, token: previewB.token }, exceptions: {} });
  step("13.05 assinatura de outra prévia é recusada (409 PREVIEW_STALE)", stale.status === 409 && stale.body?.error === "PREVIEW_STALE", `${stale.status} ${stale.body?.error}`);

  // Teste E — toda a organização: prévia de volume + confirmação reforçada pela tela.
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-cycle-list", 45000);
  await hr.clickText("Ciclo hierarquia 2027", "button");
  await hr.waitTestId("perf-add-hierarchy", 45000);
  await hr.clickTestId("perf-add-hierarchy");
  await hr.waitTestId("perf-hierarchy-add", 20000);
  await hr.click('[data-testid="perf-hierarchy-mode-ALL"]');
  await hr.waitTestId("perf-hierarchy-all-warning");
  await hr.clickTestId("perf-hierarchy-add-save");
  await hr.waitTestId("perf-hierarchy-preview", 30000);
  await sleep(500);
  const summaryE = await hr.eval(`document.querySelector('[data-testid="perf-hierarchy-summary"]').innerText.replace(/\\n+/g, " ")`);
  const disabledBefore = await hr.eval(`document.querySelector('[data-testid="perf-hierarchy-add-save"]').disabled`);
  await hr.type('[data-testid="perf-hierarchy-all-phrase"]', "TODA A ORGANIZAÇÃO");
  await sleep(200);
  const disabledAfter = await hr.eval(`document.querySelector('[data-testid="perf-hierarchy-add-save"]').disabled`);
  await hr.fullShot("13-06-toda-organizacao-previa");
  step("13.06 Teste E (toda a organização): prévia de volume e confirmação só com a frase", disabledBefore === true && disabledAfter === false && /Encontradas/i.test(summaryE), summaryE.slice(0, 140));
  await hr.click('[data-testid="perf-hierarchy-add"] button[aria-label^="Fechar"]').catch(() => hr.clickText("Cancelar"));

  // RH Operacional não vê o modo "toda a organização" e a API recusa.
  const opCtx = await browser.newContext();
  const op = await browser.newPage(opCtx, { width: 1440, height: 900 });
  await login(op, "rh.operacional@induscost.test");
  await op.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(cycleId)}); sessionStorage.setItem("ic-perf-tab", "ciclos")`);
  await openModule(op);
  await op.waitTestId("perf-cycle-list", 45000);
  await op.clickText("Ciclo hierarquia 2027", "button");
  await op.waitTestId("perf-add-hierarchy", 45000);
  await op.clickTestId("perf-add-hierarchy");
  await op.waitTestId("perf-hierarchy-add", 20000);
  const allVisible = await op.eval(`Boolean(document.querySelector('[data-testid="perf-hierarchy-mode-ALL"]'))`);
  const allApi = await api(op, "POST", `/api/hr/performance/cycles/${cycleId}/participants/hierarchy/preview`, { mode: "ALL" });
  await op.shot("13-07-operacional-sem-toda-organizacao");
  step("13.07 RH Operacional: inclui por líder, mas não toda a organização (tela e API)", allVisible === false && allApi.status === 403, `modo ALL na tela: ${allVisible} · API ${allApi.status}`);
} catch (error) {
  step("ERRO parte 13", false, error.message);
  try {
    console.log("alerts:", await globalThis.__hr?.eval(`[...document.querySelectorAll('[role="alert"]')].map(e => e.innerText).join(" | ")`));
    await globalThis.__hr?.shot("error-part13");
  } catch {
    /* sem captura */
  }
} finally {
  writeResults("part13");
  await browser.close();
}
