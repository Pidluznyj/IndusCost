// Parte 10: RH Operacional × RH Gestor no Chrome real, sobre os dados da parte 9.
// Pré-requisitos: parte 9 executada (ciclo 180° homologado) e `npx tsx scripts/performance-e2e/seedHrRoles.mts`.
// O SUPER_ADMIN do roteiro abre um segundo ciclo, com pendências reais, para a central de acompanhamento.
import { BASE, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const SECRET = "Comentário confidencial do liderado";
const browser = await start(9360);
const api = (page, method, path, body) =>
  page.eval(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "same-origin", headers: { "content-type": "application/json" }${
      body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`
    } }).then(async (r) => ({ status: r.status, text: await r.text() })).then((r) => ({ ...r, body: (() => { try { return JSON.parse(r.text); } catch { return null; } })() }))`
  );
const must = async (page, method, path, body) => {
  const out = await api(page, method, path, body);
  if (out.status >= 300) throw new Error(`${method} ${path} → ${out.status} ${out.text.slice(0, 300)}`);
  return out.body;
};
const tabsOf = (page) => page.eval(`[...document.querySelectorAll('[data-testid="perf-tabs"] [role="tab"], [data-testid="perf-tabs"] button')].map(b => b.innerText.trim())`);

try {
  // ------------------------------------------------------------ preparo (SUPER_ADMIN): ciclo aberto com pendências
  const saCtx = await browser.newContext();
  const sa = await browser.newPage(saCtx, { width: 1440, height: 900 });
  globalThis.__hr = sa;
  await login(sa, "rh.teste@induscost.test");
  await openModule(sa);
  const models = (await must(sa, "GET", "/api/hr/performance/models")).models;
  const leadershipModel = models.find((m) => m.kind === "LEADERSHIP" && m.status === "PUBLISHED");
  const standardModel = models.find((m) => m.kind !== "LEADERSHIP" && m.status === "PUBLISHED");
  const homologated = (await must(sa, "GET", "/api/hr/performance/cycles")).cycles.find((c) => c.name === "Ciclo piloto 180° 2026-S2");
  const created = await must(sa, "POST", "/api/hr/performance/cycles", {
    name: "Ciclo acompanhamento 2027-S1",
    periodLabel: "1º semestre de 2027",
    modelId: standardModel.id,
    leadershipModelId: leadershipModel.id,
    selfDueAt: "2026-10-30",
    leaderDueAt: "2026-11-20",
    classification: "TEST",
  });
  const cycleId = created.cycleId;
  const dir = (await must(sa, "GET", `/api/hr/performance/directory?q=${encodeURIComponent("[DEMO]")}`)).employees;
  const names = ["Carla Gerente", "Bruno Líder", "Marcos Manutenção", "Ana Souza", "Bia Lima", "Gabi Rocha", "Hugo Alves", "Iris Melo", "João Pinto", "Otávio Pereira"];
  await must(sa, "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { employeeIds: names.map((n) => dir.find((e) => e.name === `[DEMO] ${n}`).id), exceptions: {} });
  await must(sa, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" });
  await must(sa, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true });
  const issued = (await must(sa, "POST", `/api/hr/performance/cycles/${cycleId}/invites`, { onlyMissing: true })).issued;
  // Duas pessoas concluem pelo portal público (mesmas rotas do celular).
  for (const name of ["Ana Souza", "Bia Lima"]) {
    const invite = issued.find((c) => c.employeeName === `[DEMO] ${name}`);
    let cookie = "";
    const call = async (method, path, body) => {
      const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return r.json();
    };
    const opened = await call("POST", "/api/public/performance/session", { token: new URL(invite.url).hash.replace(/^#t=/, "") });
    if (opened.phase !== "form") await call("POST", "/api/public/performance/verify", { otp: invite.otp });
    for (let guard = 0; guard < 3; guard += 1) {
      const form = await call("GET", "/api/public/performance/form");
      const kind = form.step?.kind ?? "SELF";
      const saved = await call("PUT", "/api/public/performance/answers", { expectedVersion: form.version, answers: form.questions.map((q) => ({ code: q.code, answer: { kind: "score", score: 3 } })), step: kind });
      const sent = await call("POST", "/api/public/performance/submit", { expectedVersion: saved.version, confirm: true, step: kind });
      if (sent.done) break;
    }
  }
  // Hugo só começa (fica "iniciada").
  {
    const invite = issued.find((c) => c.employeeName === "[DEMO] Hugo Alves");
    let cookie = "";
    const call = async (method, path, body) => {
      const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      return r.json();
    };
    const opened = await call("POST", "/api/public/performance/session", { token: new URL(invite.url).hash.replace(/^#t=/, "") });
    if (opened.phase !== "form") await call("POST", "/api/public/performance/verify", { otp: invite.otp });
    const form = await call("GET", "/api/public/performance/form");
    await call("PUT", "/api/public/performance/answers", { expectedVersion: form.version, answers: [{ code: form.questions[0].code, answer: { kind: "score", score: 3 } }], step: "SELF" });
  }

  // ------------------------------------------------------------ RH Operacional
  const opCtx = await browser.newContext();
  const op = await browser.newPage(opCtx, { width: 1440, height: 900 });
  globalThis.__hr = op;
  await login(op, "rh.operacional@induscost.test");
  await openModule(op);
  const opTabs = await tabsOf(op);
  await op.shot("10-01-rh-operacional-abas");
  step(
    "10.01 RH Operacional: abas de operação, sem Nine-Box, devolutivas nem Minha equipe",
    opTabs.includes("Acompanhamento") && opTabs.includes("Calibração") && !opTabs.includes("Nine-Box") && !opTabs.includes("Devolutivas e PDI") && !opTabs.includes("Minha equipe"),
    opTabs.join(" | ")
  );

  await op.clickTestId("perf-tabs-tab-acompanhamento");
  await op.waitTestId("perf-tracking-cycle", 20000);
  await op.waitFor(`[...document.querySelectorAll('[data-testid="perf-tracking-cycle"] option')].some((o) => o.value === ${JSON.stringify(cycleId)})`, { label: "opção do ciclo", timeout: 20000 });
  await op.select('[data-testid="perf-tracking-cycle"]', cycleId);
  await op.waitFor(`document.querySelector('[data-testid="perf-tracking-row-[DEMO] Ana Souza"]')`, { label: "linhas", timeout: 20000 });
  await sleep(500);
  const kpis = await op.eval(`document.querySelector('[data-testid="perf-tracking-kpis"]').innerText.replace(/\\n+/g, " / ")`);
  const anaSelf = await op.eval(`document.querySelector('[data-testid="perf-tracking-[DEMO] Ana Souza-self"]').innerText`);
  const hugoSelf = await op.eval(`document.querySelector('[data-testid="perf-tracking-[DEMO] Hugo Alves-self"]').innerText`);
  const anaLeader = await op.eval(`document.querySelector('[data-testid="perf-tracking-[DEMO] Ana Souza-leader"]').innerText`);
  await op.fullShot("10-02-central-acompanhamento");
  step(
    "10.02 central: quem concluiu, quem começou, quem responde e prazo",
    /Enviada/.test(anaSelf) && /Iniciada/.test(hugoSelf) && /Pendente/.test(anaLeader) && /Bruno/.test(anaLeader),
    `Ana: ${anaSelf.replace(/\n/g, " ")} · Hugo: ${hugoSelf.replace(/\n/g, " ")} · líder da Ana: ${anaLeader.replace(/\n/g, " ")} · ${kpis.slice(0, 160)}`
  );

  await op.select('[data-testid="perf-tracking-filter-modality"]', "LIDERANCA");
  await op.select('[data-testid="perf-tracking-filter-status"]', "PENDING");
  await sleep(900);
  const filteredRows = await op.eval(`document.querySelectorAll('[data-testid^="perf-tracking-row-"]').length`);
  await op.fullShot("10-03-central-filtro-lideranca-pendente");
  step("10.03 filtros de modalidade e situação", filteredRows > 0, `${filteredRows} pessoa(s) com etapa de liderança pendente`);
  await op.select('[data-testid="perf-tracking-filter-modality"]', "");
  await op.select('[data-testid="perf-tracking-filter-status"]', "");
  await sleep(700);

  await op.clickTestId("perf-tracking-reissue-[DEMO] Gabi Rocha");
  await op.waitTestId("perf-tracking-issued", 20000);
  const issuedText = await op.eval(`document.querySelector('[data-testid="perf-tracking-issued"]').innerText`);
  await op.shot("10-04a-convite-reemitido");
  // Espera a central terminar de recarregar depois da reemissão (botões voltam a ficar ativos).
  await op.waitFor(`(() => { const b = document.querySelector('[data-testid="perf-tracking-revoke-[DEMO] Iris Melo"]'); return b && !b.disabled; })()`, { label: "botão ativo", timeout: 20000 });
  await sleep(400);
  await op.eval(`window.prompt = () => "Convite exposto no mural do setor"`);
  await op.clickTestId("perf-tracking-revoke-[DEMO] Iris Melo");
  await op.waitFor(`/revogado/i.test(document.querySelector('[data-testid="perf-tracking-[DEMO] Iris Melo-self"]')?.textContent ?? "")`, { label: "revogado na tela", timeout: 30000 }).catch(() => null);
  const irisSelf = await op.eval(`document.querySelector('[data-testid="perf-tracking-[DEMO] Iris Melo-self"]')?.textContent ?? ""`);
  await op.eval(`document.querySelector('[data-testid="perf-tracking-row-[DEMO] Iris Melo"]').scrollIntoView({ block: "center" })`);
  await op.shot("10-04b-convite-revogado");
  step("10.04 reemitir e revogar convite pela central", /\d{6}/.test(issuedText) && /revogado/i.test(irisSelf), `${issuedText.replace(/\n/g, " ").slice(0, 90)} · Iris: ${irisSelf}`);

  await op.waitTestId("perf-tracking-export", 20000);
  const csvHref = await op.eval(`document.querySelector('[data-testid="perf-tracking-export"]').getAttribute("href")`);
  const csv = await api(op, "GET", csvHref);
  step(
    "10.05 relatório operacional (CSV) sem notas nem comentários",
    csv.status === 200 && /obrigacao,situacao,responsavel,prazo,motivo/.test(csv.text) && !csv.text.includes(SECRET) && !/quadrante|cultura/.test(csv.text.split("\n")[0]),
    `${csv.text.split("\n").length - 1} linha(s)`
  );

  // Ciclo homologado: o operacional vê situação, não resultado.
  await op.clickTestId("perf-tabs-tab-ciclos");
  await op.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(homologated.id)})`);
  await op.goto(`${BASE}/performance-cycle`);
  await op.waitTestId("perf-page", 45000);
  await op.clickTestId("perf-tabs-tab-ciclos");
  await op.waitFor(`document.querySelector('[data-testid^="perf-result-restricted-"]')`, { label: "resultado restrito", timeout: 30000 });
  const restricted = await op.eval(`document.querySelectorAll('[data-testid^="perf-result-restricted-"]').length`);
  const deskText = await op.eval(`document.querySelector('[data-testid="perf-cycle-desk"]').innerText`);
  await op.fullShot("10-06-mesa-resultado-restrito");
  step("10.06 mesa do ciclo homologado: resultado restrito para o operacional", restricted >= 9 && !/Desempenho (alto|médio|baixo) · Potencial/i.test(deskText) && !deskText.includes(SECRET) && !(await op.eval(`Boolean(document.querySelector('[data-testid="perf-cycle-back"]'))`)), `${restricted} pessoa(s) com resultado restrito`);

  await op.clickTestId("perf-tabs-tab-calibracao");
  await op.waitTestId("perf-calibration-readonly", 30000);
  const calButtons = await op.eval(`document.querySelectorAll('[data-testid^="perf-cal-calibrate-"], [data-testid="perf-homologate"], [data-testid^="perf-leadership-open-"]').length`);
  await op.fullShot("10-07-calibracao-somente-situacao");
  step("10.07 calibração: só acompanha (sem calibrar, homologar ou abrir comparativo)", calButtons === 0, `${calButtons} botão(ões) de ação`);

  const opWs = await must(op, "GET", `/api/hr/performance/cycles/${homologated.id}/workspace`);
  const anyPid = opWs.people[0].participant.id;
  const bruno = opWs.people.find((p) => p.participant.employeeName.includes("Bruno")).participant.id;
  const probes = {
    versoes: await api(op, "GET", `/api/hr/performance/participants/${anyPid}/results`),
    csvNotas: await api(op, "GET", `/api/hr/performance/cycles/${homologated.id}/export`),
    comparativo: await api(op, "GET", `/api/hr/performance/participants/${bruno}/leadership`),
    ocorrencia: await api(op, "POST", "/api/hr/performance/conducts", { employeeId: opWs.people[0].participant.employeeId, summary: "teste" }),
    calibrar: await api(op, "POST", `/api/hr/performance/participants/${anyPid}/calibration`, { note: "teste de acesso" }),
    homologar: await api(op, "POST", `/api/hr/performance/cycles/${homologated.id}/homologate`),
  };
  const board = await must(op, "GET", `/api/hr/performance/cycles/${homologated.id}/dashboard`);
  step(
    "10.08 API direta: operacional recebe 403 em resultado, CSV com notas, comparativo, ocorrência, calibrar e homologar",
    Object.values(probes).every((r) => r.status === 403) && board.cells.length === 0,
    Object.entries(probes).map(([k, r]) => `${k}=${r.status}`).join(" ") + ` · Nine-Box nominal: ${board.cells.length}`
  );

  // ------------------------------------------------------------ RH Gestor
  const gCtx = await browser.newContext();
  const g = await browser.newPage(gCtx, { width: 1440, height: 900 });
  globalThis.__hr = g;
  await login(g, "rh.gestor@induscost.test");
  await g.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(homologated.id)})`);
  await openModule(g);
  const gTabs = await tabsOf(g);
  await g.clickTestId("perf-tabs-tab-ninebox");
  await sleep(1500);
  await g.fullShot("10-09a-gestor-ninebox");
  const gWs = await must(g, "GET", `/api/hr/performance/cycles/${homologated.id}/workspace`);
  const gComparison = await api(g, "GET", `/api/hr/performance/participants/${bruno}/leadership`);
  const gCsv = await api(g, "GET", `/api/hr/performance/cycles/${homologated.id}/export`);
  await g.clickTestId("perf-tabs-tab-calibracao");
  await g.waitTestId("perf-calibration-table", 30000);
  await g.fullShot("10-09b-gestor-calibracao");
  step(
    "10.09 RH Gestor: Nine-Box, resultados, comparativo de liderança e CSV com notas — sem comentário da equipe",
    gTabs.includes("Nine-Box") && gWs.redacted === false && gComparison.status === 200 && !gComparison.text.includes(SECRET) && gCsv.status === 200,
    `${gTabs.join(" | ")} · comparativo ${gComparison.status} · CSV ${gCsv.status}`
  );

  // ------------------------------------------------------------ líder e colaborador
  const lCtx = await browser.newContext();
  const l = await browser.newPage(lCtx, { width: 1366, height: 900 });
  await login(l, "lider.teste@induscost.test");
  await openModule(l);
  const lTabs = await tabsOf(l);
  const lTracking = await api(l, "GET", `/api/hr/performance/cycles/${cycleId}/tracking`);
  step("10.10 líder: sem central de acompanhamento (403 na API)", !lTabs.includes("Acompanhamento") && lTracking.status === 403, `${lTabs.join(" | ")} · central ${lTracking.status}`);

  console.log("logs:", JSON.stringify([...op.logs, ...g.logs].filter((x) => x.type !== "warning").slice(0, 8)));
} catch (error) {
  step("ERRO parte 10", false, error.message);
  try {
    console.log("alerts:", await globalThis.__hr?.eval(`[...document.querySelectorAll('[role="alert"]')].map(e => e.innerText).join(" | ")`));
    console.log(
      "diag:",
      await globalThis.__hr?.eval(
        `fetch("/api/hr/performance/me").then(r => r.json()).then(me => JSON.stringify({ caps: me.capabilities, path: location.pathname, tab: document.querySelector('[data-testid="perf-tabs"] [aria-selected="true"]')?.innerText, exportLinks: document.querySelectorAll('a[href*="tracking/export"]').length, trackingTab: Boolean(document.querySelector('[data-testid="perf-tracking-tab"]')), cycleSelect: document.querySelector('[data-testid="perf-tracking-cycle"]')?.value, revokeBtn: (() => { const b = document.querySelector('[data-testid="perf-tracking-revoke-[DEMO] Iris Melo"]'); return b ? { disabled: b.disabled } : null; })(), toast: document.body.innerText.match(/Convite revogado|Informe um motivo|Não foi possível[^\\n]*/g) }))`
      )
    );
    await globalThis.__hr?.shot("error-part10");
    await globalThis.__hr?.eval("window.scrollTo(0, 0)");
    await globalThis.__hr?.shot("error-part10-top");
    console.log("tabHtml:", await globalThis.__hr?.eval(`document.querySelector('[data-testid="perf-tracking-tab"]')?.innerText.slice(0, 600)`));
  } catch (e) {
    console.log("debug falhou", e.message);
  }
} finally {
  writeResults("part10");
  await browser.close();
}
