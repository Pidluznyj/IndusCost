// Parte 14: a experiência inteira depois da reorganização — abas por intenção, guia do primeiro ciclo,
// mesa por etapa com menu "Mais", líder com "Fazer a próxima", calibrar dentro do dossiê com "próxima pessoa",
// entrega de convite e exceções na Central, e o portal acolhedor. Usa os dados das partes 9–13.
import { BASE, login, openModule, sleep, start, step, writeResults } from "./common.mjs";

const browser = await start(9410);
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

  // 14.01 abas agrupadas por intenção, todas presentes
  const groups = await hr.eval(`[...document.querySelectorAll('[data-testid^="perf-tab-group-"]')].map((g) => g.dataset.testid.replace("perf-tab-group-", "") + ": " + [...g.querySelectorAll('[role="tab"]')].map((b) => b.innerText.trim()).join(", "))`);
  await hr.shot("14-01-abas-agrupadas");
  step("14.01 abas agrupadas: Operar · Avaliar e calibrar · Resultados · Configurar", groups.length === 4 && /Configurar: Modelos/.test(groups.join(" | ")), groups.join(" | "));

  // 14.02 guia do primeiro ciclo num ciclo em rascunho (parte 13 deixou um aberto; cria um rascunho novo)
  const models = (await must(hr, "GET", "/api/hr/performance/models")).models;
  const draft = await must(hr, "POST", "/api/hr/performance/cycles", {
    name: "Ciclo experiência 2028",
    periodLabel: "2028",
    modelId: models.find((m) => m.kind !== "LEADERSHIP" && m.status === "PUBLISHED").id,
    leadershipModelId: models.find((m) => m.kind === "LEADERSHIP" && m.status === "PUBLISHED").id,
    selfDueAt: "2028-03-30",
    leaderDueAt: "2028-04-15",
    classification: "TEST",
  });
  await hr.eval(`sessionStorage.setItem("ic-perf-tab", "ciclos"); sessionStorage.removeItem("ic-perf-guide-hidden")`);
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-cycle-list", 45000);
  await hr.clickText("Ciclo experiência 2028", "button");
  await hr.waitFor(`document.querySelector('[data-testid="perf-cycle-title"]')?.innerText.includes("Ciclo experiência 2028")`, { label: "ciclo", timeout: 30000 });
  await hr.waitTestId("perf-first-cycle-guide", 20000);
  await sleep(600);
  const guide = await hr.eval(`document.querySelector('[data-testid="perf-first-cycle-guide"]').innerText.replace(/\\n+/g, " / ")`);
  const kpisHidden = await hr.eval(`getComputedStyle(document.querySelector('[data-testid="perf-cycle-kpis"]')).display === "none"`);
  const hint = await hr.eval(`document.querySelector('[data-testid="perf-stage-hint"]')?.innerText ?? ""`);
  const moreClosed = await hr.eval(`!document.querySelector('[data-testid="perf-cycle-more"]').open`);
  await hr.fullShot("14-02-guia-e-mesa-por-etapa");
  step(
    "14.02 guia do primeiro ciclo mostra o próximo passo; mesa em rascunho sem KPIs, com dica da etapa e menu Mais fechado",
    /próximo: incluir as pessoas/i.test(guide) && kpisHidden && /inclua as pessoas/i.test(hint) && moreClosed,
    `${guide.slice(0, 90)} · kpis ocultos=${kpisHidden} · ${hint.slice(0, 50)}`
  );
  await hr.click('[data-testid="perf-cycle-more"] summary');
  await sleep(300);
  const moreItems = await hr.eval(`[...document.querySelectorAll('[data-testid="perf-cycle-more"] button')].map((b) => b.innerText.trim())`);
  await hr.shot("14-03-menu-mais");
  step("14.03 menu Mais guarda as ações secundárias", moreItems.some((t) => /Ciclo de vida/.test(t)) && moreItems.some((t) => /Atualizar líderes/.test(t)), moreItems.join(" | "));
  await hr.clickTestId("perf-guide-hide");
  await sleep(300);
  step("14.04 guia pode ser escondido e não volta na mesma sessão", !(await hr.eval(`Boolean(document.querySelector('[data-testid="perf-first-cycle-guide"]'))`)));

  // 14.05 Calibração: dossiê com decisão inline e "próxima pessoa", no ciclo aberto da parte 13 levado à calibração
  const cycles = (await must(hr, "GET", "/api/hr/performance/cycles")).cycles;
  const open = cycles.find((c) => c.name === "Ciclo hierarquia 2027" && c.status === "OPEN");
  if (!open) throw new Error("ciclo da parte 13 não está aberto");
  await must(hr, "POST", `/api/hr/performance/cycles/${open.id}/transition`, { to: "CONSOLIDATION", acceptPending: true });
  await must(hr, "POST", `/api/hr/performance/cycles/${open.id}/transition`, { to: "CALIBRATION" });
  await hr.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(open.id)}); sessionStorage.setItem("ic-perf-tab", "calibracao")`);
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-calibration-table", 45000);
  const homologateLabel = await hr.eval(`document.querySelector('[data-testid="perf-homologate"]')?.innerText ?? ""`);
  await hr.clickTestId("perf-cal-dossier-[DEMO] Ana Souza");
  await hr.waitTestId("perf-dossier", 20000);
  await hr.waitTestId("perf-dossier-decision-block", 20000);
  await sleep(500);
  const hasValidateOrCalibrate = await hr.eval(`Boolean(document.querySelector('[data-testid="perf-dossier-validate"], [data-testid="perf-dossier-calibrate"]'))`);
  await hr.fullShot("14-05-dossie-com-decisao");
  step("14.05 dossiê abre com a decisão ao lado e o botão de homologar fala em tornar oficial", hasValidateOrCalibrate && /Tornar os resultados oficiais/.test(homologateLabel), homologateLabel);
  // Calibrar sem avaliação do líder (ninguém respondeu neste ciclo): exceção dentro do dossiê
  if (await hr.eval(`Boolean(document.querySelector('[data-testid="perf-dossier-validate"]'))`)) {
    await hr.type('[data-testid="perf-dossier-validate-note"]', "Critério da função conferido na sessão do comitê.");
    await hr.clickTestId("perf-dossier-validate-ok");
    await hr.waitTestId("perf-dossier-calibrate", 20000);
  }
  await hr.waitTestId("perf-dossier-calibrate", 20000);
  if (await hr.eval(`Boolean(document.querySelector('[data-testid="perf-dossier-accept-missing-leader"]'))`)) await hr.click('[data-testid="perf-dossier-accept-missing-leader"]');
  await hr.type('[data-testid="perf-dossier-committee"]', "Carla (diretora), Rita (RH)");
  await hr.type('[data-testid="perf-dossier-note"]', "Leitura do comitê: sem avaliação do líder no ciclo de teste.");
  await hr.clickTestId("perf-dossier-save");
  await hr.waitTestId("perf-dossier-calibrated", 20000);
  const pos = await hr.eval(`document.querySelector('[data-testid="perf-dossier"] footer, [data-testid="perf-dossier"]').innerText.match(/\\d+ de \\d+/)?.[0] ?? ""`);
  await hr.clickTestId("perf-dossier-next");
  await sleep(800);
  const nextName = await hr.eval(`document.querySelector('[data-testid="perf-dossier"] h2, [data-testid="perf-dossier"] h1')?.innerText ?? document.querySelector('[data-testid="perf-dossier"]').innerText.split("\\n")[1]`);
  await hr.fullShot("14-06-proxima-pessoa");
  step("14.06 calibrou dentro do dossiê (comitê registrado) e passou para a próxima pessoa", Boolean(pos) && !/Ana Souza/.test(nextName ?? ""), `${pos} → ${nextName}`);
  await hr.click('[data-testid="perf-dossier"] button[aria-label^="Fechar"]').catch(() => hr.clickText("Fechar"));
  const audits = await must(hr, "GET", `/api/hr/performance/cycles/${open.id}/exceptions`);
  step("14.07 a exceção aparece na lista de exceções do ciclo", audits.exceptions.some((e) => e.kind === "CALIBRATION_WITHOUT_LEADER" && /Ana/.test(e.person ?? "")), audits.exceptions.map((e) => `${e.kind}:${e.person}`).join(", "));

  // 14.08 Central: "Entreguei", aviso na reemissão e seção de exceções (ciclo aberto da parte 10)
  const openCycle = cycles.find((c) => c.name === "Ciclo acompanhamento 2027-S1" && c.status === "OPEN" && c.activation === "ACTIVE") ?? cycles.find((c) => c.status === "OPEN" && c.activation === "ACTIVE");
  await hr.eval(`sessionStorage.setItem("ic-perf-cycle", ${JSON.stringify(openCycle.id)}); sessionStorage.setItem("ic-perf-tab", "acompanhamento")`);
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-tracking-table", 45000);
  await hr.waitFor(`[...document.querySelectorAll('[data-testid="perf-tracking-cycle"] option')].some((o) => o.value === ${JSON.stringify(openCycle.id)})`, { label: "ciclo", timeout: 20000 });
  await hr.select('[data-testid="perf-tracking-cycle"]', openCycle.id);
  await hr.waitFor(`document.querySelector('[data-testid^="perf-tracking-deliver-"]')`, { label: "botão entreguei", timeout: 20000 });
  const deliverName = await hr.eval(`document.querySelector('[data-testid^="perf-tracking-deliver-"]').dataset.testid.replace("perf-tracking-deliver-", "")`);
  const before = await hr.eval(`document.querySelector('[data-testid="perf-kpi-delivered"]').innerText`);
  await hr.click(`[data-testid="perf-tracking-deliver-${deliverName}"]`);
  await hr.waitFor(`!document.querySelector('[data-testid="perf-tracking-deliver-${deliverName}"]')`, { label: "entregue", timeout: 20000 });
  await sleep(500);
  const after = await hr.eval(`document.querySelector('[data-testid="perf-kpi-delivered"]').innerText`);
  const reason = await hr.eval(`document.querySelector('[data-testid="perf-tracking-${deliverName}-self"]').innerText`);
  await hr.eval(`window.confirm = (m) => { window.__confirmMsg = m; return false; }`);
  await hr.click(`[data-testid="perf-tracking-reissue-${deliverName}"]`);
  await sleep(300);
  const confirmMsg = await hr.eval(`window.__confirmMsg ?? ""`);
  const exceptionsPanel = await hr.eval(`document.querySelector('[data-testid="perf-tracking-exceptions"]')?.innerText ?? ""`);
  await hr.fullShot("14-08-central-entrega-excecoes");
  step(
    "14.08 Central: entrega registrada sobe o contador e o motivo; reemitir avisa que a folha anterior deixa de valer; exceções do ciclo listadas",
    /\d/.test(after) && after !== before && /entregue/i.test(reason) && /deixa de valer/.test(confirmMsg) && /Exceções deste ciclo/.test(exceptionsPanel),
    `${before.replace(/\n/g, " ")} → ${after.replace(/\n/g, " ")} · ${reason.replace(/\n/g, " ").slice(0, 60)}`
  );

  // 14.09 líder: um cartão por liderado com a liderança dentro, e "Fazer a próxima"
  const lCtx = await browser.newContext();
  const carla = await browser.newPage(lCtx, { width: 1366, height: 900 });
  await login(carla, "gerente.teste@induscost.test");
  await openModule(carla);
  await carla.clickTestId("perf-tabs-tab-equipe");
  await carla.waitTestId("perf-team-todo", 20000);
  await sleep(500);
  const brunoCard = await carla.eval(`document.querySelector('[data-testid="perf-team-item-[DEMO] Bruno Líder"]')?.innerText ?? ""`);
  const hasNext = await carla.eval(`Boolean(document.querySelector('[data-testid="perf-team-do-next"]'))`);
  await carla.fullShot("14-09-lider-cartao-unico");
  step("14.09 líder vê Bruno num cartão só: trabalho e liderança juntos, com Fazer a próxima", /Avaliar o trabalho|Ver avaliação|Continuar/.test(brunoCard) && /lidera/.test(brunoCard) && hasNext, brunoCard.replace(/\n/g, " ").slice(0, 120));
  await carla.clickTestId("perf-team-do-next");
  await sleep(800);
  const opened = await carla.eval(`Boolean(document.querySelector('[data-testid="perf-leader-panel"], [data-testid="perf-superior-leadership"], [role="dialog"]'))`);
  step("14.10 Fazer a próxima abre a primeira avaliação pendente", opened);

  // 14.11 portal: acolhimento e encerramento
  const issued = (await must(hr, "POST", `/api/hr/performance/cycles/${openCycle.id}/invites`, { onlyMissing: true })).issued;
  const ws = await must(hr, "GET", `/api/hr/performance/cycles/${openCycle.id}/workspace`);
  const pending = ws.people.find((p) => p.self && p.self.status !== "SUBMITTED" && issued.some((i) => i.participantId === p.participant.id)) ?? null;
  const invite = pending ? issued.find((i) => i.participantId === pending.participant.id) : null;
  if (!invite) throw new Error("sem convite pendente para o portal");
  const pCtx = await browser.newContext();
  const phone = await browser.newPage(pCtx, { width: 390, height: 844, mobile: true });
  await phone.goto(invite.url);
  await phone.waitFor(`document.querySelector('[data-testid="portal-code"],[data-testid="portal-intro"]')`, { timeout: 30000, label: "portal" });
  if (await phone.eval(`Boolean(document.querySelector('[data-testid="portal-code"]'))`)) {
    await phone.type('[data-testid="portal-otp"]', invite.otp);
    await phone.clickTestId("portal-otp-submit");
  }
  await phone.waitTestId("portal-intro", 20000);
  const intro = await phone.eval(`document.querySelector('[data-testid="portal-intro"]').innerText`);
  await phone.shot("14-11-portal-acolhimento");
  step("14.11 portal recebe pelo primeiro nome e explica que a percepção da pessoa é o que vale", /Que bom ter você aqui/.test(intro) && /sua percepção/.test(intro), intro.split("\n")[0]);
} catch (error) {
  step("ERRO parte 14", false, error.message);
  try {
    console.log("alerts:", await globalThis.__hr?.eval(`[...document.querySelectorAll('[role="alert"]')].map(e => e.innerText).join(" | ")`));
    await globalThis.__hr?.shot("error-part14");
  } catch {
    /* sem captura */
  }
} finally {
  writeResults("part14");
  await browser.close();
}
