// Parte 9: avaliação 180° de liderança, do modelo à homologação, no Chrome real.
// Pré-requisito extra: npx tsx scripts/performance-e2e/seedLeadership180.mts (Bruno com 6 liderados, Marcos com 1).
// Telas reais para o que a pessoa vê (modelo, jornada no celular, superior, calibração, PDF, painel);
// a API (com a sessão do próprio usuário) só acelera o volume repetitivo: demais respondentes e avaliações individuais.
import { BASE, login, openModule, saveState, sleep, start, step, writeResults } from "./common.mjs";

const SECRET = "Comentário confidencial do liderado";
const browser = await start(9350);

/** Chamada à API com a sessão da própria página (sem atalho de permissão). */
const api = (page, method, path, body) =>
  page.eval(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, credentials: "same-origin", headers: { "content-type": "application/json" }${
      body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`
    } }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))`
  );
const must = async (page, method, path, body) => {
  const out = await api(page, method, path, body);
  if (out.status >= 300) throw new Error(`${method} ${path} → ${out.status} ${JSON.stringify(out.body).slice(0, 300)}`);
  return out.body;
};

/** Portal público fora do navegador, para os respondentes repetitivos (mesmas rotas do celular). */
async function answerByApi(invite, pick) {
  let cookie = "";
  const call = async (method, path, body) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const r = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      if (r.status === 429) {
        await sleep(15000);
        continue;
      }
      return { status: r.status, body: await r.json().catch(() => ({})) };
    }
    throw new Error("limite de tentativas");
  };
  const token = new URL(invite.url).hash.replace(/^#t=/, "");
  const opened = await call("POST", "/api/public/performance/session", { token });
  if (opened.body.phase !== "form") {
    const v = await call("POST", "/api/public/performance/verify", { otp: invite.otp });
    if (!v.body.ok) throw new Error(`código recusado para ${invite.employeeName}: ${JSON.stringify(v.body)}`);
  }
  const kinds = [];
  for (let guard = 0; guard < 4; guard += 1) {
    const form = (await call("GET", "/api/public/performance/form")).body;
    if (!form.ok) throw new Error(`formulário de ${invite.employeeName}: ${JSON.stringify(form).slice(0, 200)}`);
    const kind = form.step?.kind ?? "SELF";
    kinds.push(kind);
    const answers = form.questions.map((q, i) => ({ code: q.code, answer: pick(kind, i) }));
    const saved = await call("PUT", "/api/public/performance/answers", { expectedVersion: form.version, answers, step: kind });
    if (!saved.body.ok) throw new Error(`salvar ${kind} de ${invite.employeeName}: ${JSON.stringify(saved.body)}`);
    const sent = await call("POST", "/api/public/performance/submit", { expectedVersion: saved.body.version, confirm: true, step: kind });
    if (!sent.body.ok) throw new Error(`enviar ${kind} de ${invite.employeeName}: ${JSON.stringify(sent.body)}`);
    if (sent.body.done) return kinds;
  }
  throw new Error(`jornada de ${invite.employeeName} não terminou`);
}

/** Jornada inteira no celular simulado, tocando nas opções. */
async function phoneJourney(phone, invite, { onUpward } = {}) {
  await phone.goto(invite.url);
  await phone.waitFor(`document.querySelector('[data-testid="portal-code"],[data-testid="portal-intro"]')`, { timeout: 30000, label: "portal" });
  if (await phone.eval(`Boolean(document.querySelector('[data-testid="portal-code"]'))`)) {
    await phone.type('[data-testid="portal-otp"]', invite.otp);
    await phone.clickTestId("portal-otp-submit");
  }
  const seen = [];
  for (let guard = 0; guard < 4; guard += 1) {
    await phone.waitFor(`document.querySelector('[data-testid="portal-intro"],[data-testid="portal-step-intro"],[data-testid="portal-done"]')`, { timeout: 20000, label: "etapa" });
    if (await phone.eval(`Boolean(document.querySelector('[data-testid="portal-done"]'))`)) return seen;
    const label = await phone.eval(`document.querySelector('[data-testid="portal-step"]')?.innerText ?? ""`);
    const kind = (await phone.eval(`Boolean(document.querySelector('[data-testid="portal-step-intro"]'))`)) ? (/equipe|liderança de|lideran.a de/i.test(await phone.eval(`document.querySelector('[data-testid="portal-step-intro"] h1').innerText`)) ? "UPWARD" : "LEADERSHIP_SELF") : "SELF";
    seen.push({ kind, label });
    await phone.shot(`9-${invite.employeeName.replace(/\W+/g, "-")}-${seen.length}-intro`);
    await phone.clickTestId("portal-start");
    await phone.waitTestId("portal-question");
    const total = await phone.eval(`Number(document.querySelector('[data-testid="portal-progress"]').innerText.match(/de (\\d+)/)[1])`);
    for (let i = 0; i < total; i += 1) {
      if (kind === "UPWARD" && i === 0 && onUpward) await onUpward(phone);
      else {
        await phone.clickTestId("portal-option-3");
        await phone.waitFor(`document.querySelector('[data-testid="portal-save-state"]')?.innerText.includes("salva")`, { label: "salvo", timeout: 15000 });
      }
      await phone.clickTestId("portal-next");
      await sleep(120);
    }
    await phone.waitTestId("portal-review");
    await phone.clickTestId("portal-send");
    await sleep(800);
  }
  throw new Error("jornada não terminou no celular");
}

try {
  // ------------------------------------------------------------ RH: modelos e ciclo
  const hrCtx = await browser.newContext();
  const hr = await browser.newPage(hrCtx, { width: 1440, height: 900 });
  globalThis.__hr = hr;
  await login(hr, "rh.teste@induscost.test");
  await openModule(hr);

  // 9.01 modelo de liderança pela tela (LD-01..LD-08) e publicação
  await hr.clickTestId("perf-tabs-tab-modelos");
  await hr.waitTestId("perf-models-tab");
  await hr.clickTestId("perf-leadership-model-new");
  await hr.waitTestId("perf-leadership-model-create");
  await hr.type('[data-testid="perf-leadership-model-name"]', "Liderança 180° · piloto 2026");
  await hr.clickTestId("perf-leadership-model-create-save");
  await hr.waitTestId("perf-leadership-q-LD-08", 20000);
  const ldCount = await hr.eval(`document.querySelectorAll('[data-testid^="perf-leadership-q-LD-"]').length`);
  await hr.shot("9-01a-modelo-lideranca-rascunho");
  await hr.eval(`window.confirm = () => true`);
  await hr.clickTestId("perf-leadership-model-publish");
  await hr.waitFor(`document.querySelector('[data-testid="perf-leadership-model-editor"]').innerText.includes("somente leitura")`, { label: "publicado" });
  await hr.shot("9-01b-modelo-lideranca-publicado");
  step("9.01 modelo de liderança criado (8 competências) e publicado", ldCount === 8, `${ldCount} competências`);
  await hr.clickText("Fechar");
  await sleep(300);

  // modelo individual (mesmo caminho da parte 1, só o necessário para publicar)
  await hr.clickTestId("perf-model-new");
  await hr.waitTestId("perf-model-create");
  await hr.type('[data-testid="perf-model-create-name"]', "Avaliação individual 2026 · 180");
  await hr.clickTestId("perf-model-create-save");
  await hr.waitTestId("perf-model-editor", 20000);
  await hr.type('[data-testid="perf-rule-ruleSetId"]', "piloto-local-2026");
  await hr.clickTestId("perf-model-save");
  await hr.waitFor(`![...document.querySelectorAll('[data-testid="perf-model-save"]')].some(b => !b.disabled)`, { label: "salvou" });
  await hr.clickTestId("perf-model-publish");
  await hr.waitTestId("perf-model-publish-confirm");
  await hr.clickTestId("perf-model-publish-confirm-save");
  await hr.waitTestId("perf-model-readonly", 20000);
  await hr.clickText("Fechar");
  await sleep(300);
  const models = (await must(hr, "GET", "/api/hr/performance/models")).models;
  const leadershipModel = models.find((m) => m.kind === "LEADERSHIP" && m.status === "PUBLISHED");
  const standardModel = models.find((m) => m.kind !== "LEADERSHIP" && m.status === "PUBLISHED");

  // 9.02 ciclo com 180° pela tela
  await hr.clickTestId("perf-tabs-tab-ciclos");
  await hr.waitTestId("perf-cycles-tab");
  await hr.clickTestId("perf-cycle-new");
  await hr.waitTestId("perf-cycle-create");
  await hr.type('[data-testid="perf-cycle-create-name"]', "Ciclo piloto 180° 2026-S2");
  await hr.type('[data-testid="perf-cycle-create-period"]', "2º semestre de 2026");
  await hr.select('[data-testid="perf-cycle-create-classification"]', "OFFICIAL");
  await hr.select('[data-testid="perf-cycle-create-model"]', standardModel.id);
  await hr.select('[data-testid="perf-cycle-create-leadership"]', leadershipModel.id);
  await hr.shot("9-02a-ciclo-com-180");
  await hr.clickTestId("perf-cycle-create-save");
  await hr.waitTestId("perf-cycle-180", 20000);
  const cycleId = await hr.eval(`sessionStorage.getItem("ic-perf-cycle")`);
  step("9.02 ciclo criado com modelo de liderança", Boolean(cycleId));

  // participantes, preparação e abertura (mesmas rotas da mesa do RH)
  const people = ["Carla Gerente", "Bruno Líder", "Marcos Manutenção", "Ana Souza", "Bia Lima", "Gabi Rocha", "Hugo Alves", "Iris Melo", "João Pinto", "Otávio Pereira"];
  const dir = (await must(hr, "GET", `/api/hr/performance/directory?q=${encodeURIComponent("[DEMO]")}`)).employees;
  const ids = people.map((n) => dir.find((e) => e.name === `[DEMO] ${n}`)?.id).filter(Boolean);
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/participants`, { employeeIds: ids, exceptions: {} });
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "PREPARED" });
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "OPEN", pilotAck: true });
  const issued = (await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/invites`, { onlyMissing: true })).issued;
  const inviteOf = (name) => issued.find((c) => c.employeeName === `[DEMO] ${name}`);

  // 9.03 snapshot de liderança e tarefas criadas na abertura
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-cycle-180", 45000);
  await hr.fullShot("9-03-mesa-ciclo-180");
  const ws = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  const lead = Object.fromEntries(ws.people.map((p) => [p.participant.employeeName.replace("[DEMO] ", ""), p.leadership ?? null]));
  const top = ws.people.find((p) => p.participant.employeeName.includes("Carla"))?.participant.managerSource;
  step(
    "9.03 abertura: líderes pela hierarquia efetiva e topo da estrutura",
    lead["Bruno Líder"]?.isLeader && lead["Marcos Manutenção"]?.isLeader && lead["Carla Gerente"]?.isLeader && !lead["Ana Souza"]?.isLeader && top === "TOPO",
    `Bruno lidera ${lead["Bruno Líder"]?.directReportCount}, Marcos ${lead["Marcos Manutenção"]?.directReportCount}, Carla ${lead["Carla Gerente"]?.directReportCount} (${top})`
  );

  // ------------------------------------------------------------ celular: Ana (liderada) e Bruno (líder)
  const phoneCtx = await browser.newContext();
  const phone = await browser.newPage(phoneCtx, { width: 390, height: 844, mobile: true });
  let hintShort = "";
  let blockedShort = null;
  let privacy = "";
  let draftSaved = false;
  const anaSteps = await phoneJourney(phone, inviteOf("Ana Souza"), {
    onUpward: async (p) => {
      privacy = await p.eval(`document.querySelector('[data-testid="portal-step"]')?.innerText ?? ""`);
      await p.clickTestId("portal-option-1");
      await p.waitTestId("portal-comment");
      // A nota extrema é salva como rascunho já no toque; o comentário vem depois.
      await p.waitFor(`document.querySelector('[data-testid="portal-save-state"]')?.innerText.includes("salva")`, { label: "rascunho salvo", timeout: 15000 });
      draftSaved = !(await p.eval(`document.body.innerText.includes("Não salvou")`));
      await p.type('[data-testid="portal-comment"]', "ruim");
      await sleep(200);
      hintShort = await p.eval(`document.querySelector('[data-testid="portal-comment-hint"]')?.innerText ?? ""`);
      blockedShort = await p.eval(`document.querySelector('[data-testid="portal-next"]').disabled`);
      await p.shot("9-04a-celular-comentario-obrigatorio");
      await p.type('[data-testid="portal-comment"]', `${SECRET}: a escala mudou sem aviso duas vezes no mês.`);
      await p.eval(`document.querySelector('[data-testid="portal-comment"]').blur()`);
      await p.waitFor(`!document.querySelector('[data-testid="portal-next"]').disabled`, { label: "liberou" });
      await p.waitFor(`document.querySelector('[data-testid="portal-save-state"]')?.innerText.includes("salva")`, { label: "salvo", timeout: 15000 });
      await p.shot("9-04b-celular-comentario-ok");
    },
  });
  const ov = await phone.overflow();
  await phone.shot("9-04c-celular-ana-concluiu");
  step(
    "9.04 jornada da liderada no celular: autoavaliação → avaliação do líder, comentário obrigatório em nota extrema",
    anaSteps.map((s) => s.kind).join(">") === "SELF>UPWARD" && draftSaved && blockedShort === true && /\d/.test(hintShort) && !ov.overflow,
    `${anaSteps.map((s) => s.label || s.kind).join(" | ")} · aviso: "${hintShort}" · ${privacy}`
  );

  const phone2Ctx = await browser.newContext();
  const phone2 = await browser.newPage(phone2Ctx, { width: 390, height: 844, mobile: true });
  const brunoSteps = await phoneJourney(phone2, inviteOf("Bruno Líder"));
  await phone2.shot("9-05-celular-bruno-concluiu");
  step("9.05 jornada do líder no celular: 3 etapas na mesma sessão", brunoSteps.map((s) => s.kind).join(">") === "SELF>UPWARD>LEADERSHIP_SELF", brunoSteps.map((s) => s.label).join(" | "));

  // demais respondentes pela mesma API pública (João dá nota máxima com comentário)
  const pick = (name) => (kind, i) =>
    kind === "LEADERSHIP_UPWARD" && name === "João Pinto" && i === 1
      ? { kind: "score", score: 4, evidence: `${SECRET}: organizou a parada da linha com antecedência.` }
      : { kind: "score", score: kind === "LEADERSHIP_UPWARD" && i % 2 ? 2 : 3 };
  const journeys = {};
  for (const name of ["Bia Lima", "Gabi Rocha", "Hugo Alves", "Iris Melo", "João Pinto", "Marcos Manutenção", "Otávio Pereira", "Carla Gerente"]) {
    journeys[name] = (await answerByApi(inviteOf(name), pick(name))).join(">");
  }
  step("9.06 demais respondentes (jornada pela API pública)", journeys["Carla Gerente"] === "SELF>LEADERSHIP_SELF" && journeys["Marcos Manutenção"] === "SELF>LEADERSHIP_UPWARD>LEADERSHIP_SELF" && journeys["Otávio Pereira"] === "SELF>LEADERSHIP_UPWARD", JSON.stringify(journeys));

  // ------------------------------------------------------------ gerente (Carla): avaliação de liderança pela tela
  const carlaCtx = await browser.newContext();
  const carla = await browser.newPage(carlaCtx, { width: 1366, height: 900 });
  await login(carla, "gerente.teste@induscost.test");
  await openModule(carla);
  await carla.clickTestId("perf-tabs-tab-equipe");
  await carla.waitTestId("perf-team-leadership", 20000);
  await carla.shot("9-07a-gerente-minha-equipe");
  await carla.clickTestId("perf-team-leadership-evaluate-[DEMO] Bruno Líder");
  await carla.waitTestId("perf-superior-q-LD-08", 20000);
  const codes = await carla.eval(`[...document.querySelectorAll('[data-testid^="perf-superior-q-"]')].map(e => e.dataset.testid.replace("perf-superior-q-", ""))`);
  for (const [i, code] of codes.entries()) await carla.clickTestId(`perf-superior-${code}-${i === 2 ? 4 : 3}`);
  const blockedSuperior = await carla.eval(`document.querySelector('[data-testid="perf-superior-submit"]').disabled`);
  await carla.type(`[data-testid="perf-superior-comment-${codes[2]}"]`, "Conduziu a integração de dois novos operadores sem atraso.");
  await carla.shot("9-07b-gerente-avalia-lideranca");
  await carla.eval(`window.confirm = () => true`);
  await carla.clickTestId("perf-superior-submit");
  await carla.waitFor(`!document.querySelector('[data-testid="perf-superior-leadership"]')`, { label: "enviado", timeout: 20000 });
  step("9.07 superior avalia a liderança pela tela (comentário obrigatório na nota 4)", blockedSuperior === true && codes.length === 8, `${codes.length} competências`);
  // Marcos: mesma avaliação, pela API com a sessão da gerente
  const team = await must(carla, "GET", "/api/hr/performance/team");
  const marcosTask = team.leadership.find((t) => t.employeeName.includes("Marcos"));
  const form = await must(carla, "GET", `/api/hr/performance/assignments/${marcosTask.assignmentId}`);
  const saved = await must(carla, "PUT", `/api/hr/performance/assignments/${marcosTask.assignmentId}/answers`, { expectedVersion: form.assignment.version, answers: form.questions.map((q) => ({ code: q.code, answer: { kind: "score", score: 3 } })) });
  await must(carla, "POST", `/api/hr/performance/assignments/${marcosTask.assignmentId}/submit`, { expectedVersion: saved.version });

  // 9.08 confidencialidade durante a coleta: o líder não lê a avaliação da equipe
  const leaderCtx = await browser.newContext();
  const leader = await browser.newPage(leaderCtx, { width: 1366, height: 900 });
  await login(leader, "lider.teste@induscost.test");
  await openModule(leader);
  const brunoPid = ws.people.find((p) => p.participant.employeeName.includes("Bruno")).participant.id;
  const ownView = await api(leader, "GET", `/api/hr/performance/participants/${brunoPid}/leadership`);
  const leaderTeam = await api(leader, "GET", "/api/hr/performance/team");
  step("9.08 líder não lê avaliação da equipe nem a própria comparação durante a coleta", ownView.status >= 400 && !JSON.stringify(leaderTeam.body).includes(SECRET), `comparação → ${ownView.status}`);

  // ------------------------------------------------------------ RH: avaliações individuais, consolidação
  const ws2 = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  for (const p of ws2.people) {
    if (!p.leader || p.leader.status === "SUBMITTED") continue;
    const s = await must(hr, "PUT", `/api/hr/performance/assignments/${p.leader.id}/answers`, { expectedVersion: p.leader.version, answers: ws2.questions.map((q) => ({ code: q.code, answer: { kind: "score", score: 3 } })) });
    await must(hr, "POST", `/api/hr/performance/assignments/${p.leader.id}/submit`, { expectedVersion: s.version });
  }
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "CONSOLIDATION" });
  await must(hr, "POST", `/api/hr/performance/cycles/${cycleId}/transition`, { to: "CALIBRATION" });
  const ws3 = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  // Topo da estrutura não tem líder: a calibração individual registra a exceção (auditada).
  for (const p of ws3.people) {
    if (p.result?.technicalValidation === "PENDING_VALIDATION") {
      await must(hr, "POST", `/api/hr/performance/participants/${p.participant.id}/validation`, { decision: "VALIDATED", note: "Critério da função conferido no roteiro local" });
    }
    await must(hr, "POST", `/api/hr/performance/participants/${p.participant.id}/calibration`, { note: "Calibração individual conferida no roteiro local", decision: "CONFIRM", acceptMissingLeader: !p.leader });
  }

  // 9.09 homologação bloqueada sem calibração de liderança
  const early = await api(hr, "POST", `/api/hr/performance/cycles/${cycleId}/homologate`);
  step("9.09 homologação exige a calibração de liderança", early.status === 409 || early.body.error === "LEADERSHIP_CALIBRATION_REQUIRED", `${early.status} ${early.body.error}`);

  // ------------------------------------------------------------ calibração pela gerente: equipe suficiente e equipe pequena
  const calibrate = async (page, name, { exception = false } = {}) => {
    await page.waitTestId("perf-leadership-table", 20000);
    for (const code of codes) {
      await page.select(`[data-testid="perf-leadership-score-${code}"]`, "3");
      await page.type(`[data-testid="perf-leadership-note-${code}"]`, `Nota conferida com fatos do semestre (${code}).`);
    }
    if (exception) await page.type('[data-testid="perf-leadership-exception"]', "Topo da estrutura: não há superior para avaliar a liderança.");
    await page.type('[data-testid="perf-leadership-general"]', `Liderança de ${name} consistente com as entregas e a rotina da equipe.`);
    await page.clickTestId("perf-leadership-save");
    await page.waitTestId("perf-leadership-result", 20000);
  };
  await carla.goto(`${BASE}/performance-cycle`);
  await carla.waitTestId("perf-page", 45000);
  await carla.clickTestId("perf-tabs-tab-equipe");
  await carla.clickTestId("perf-team-leadership-calibrate-[DEMO] Bruno Líder", { timeout: 20000 });
  await carla.waitTestId("perf-leadership-summary", 20000);
  const brunoView = await carla.eval(`document.querySelector('[data-testid="perf-leadership-calibration-overlay"]').innerText`);
  await carla.fullShot("9-10a-calibracao-bruno-equipe-suficiente");
  await calibrate(carla, "Bruno");
  await carla.fullShot("9-10b-calibracao-bruno-salva");
  const pdfHref = await carla.eval(`document.querySelector('[data-testid="perf-leadership-pdf"]')?.getAttribute("href")`);
  step("9.10 equipe com amostra suficiente: média da equipe exibida, sem comentários", /6 de 6 responderam/.test(brunoView) && !brunoView.includes(SECRET) && !brunoView.includes("Amostra insuficiente"), brunoView.split("\n").slice(0, 8).join(" / "));
  await carla.click('[data-testid="perf-leadership-calibration-overlay"] button[aria-label^="Fechar"]').catch(() => carla.clickText("Fechar"));
  await sleep(400);
  await carla.clickTestId("perf-team-leadership-calibrate-[DEMO] Marcos Manutenção", { timeout: 20000 });
  await carla.waitTestId("perf-leadership-insufficient", 20000);
  const marcosView = await carla.eval(`document.querySelector('[data-testid="perf-leadership-calibration-overlay"]').innerText`);
  await carla.fullShot("9-11-calibracao-marcos-equipe-pequena");
  await calibrate(carla, "Marcos");
  step("9.11 equipe pequena: amostra insuficiente, sem média nem resposta individual", marcosView.includes("Amostra insuficiente") && !marcosView.includes(SECRET), marcosView.split("\n").slice(0, 6).join(" / "));
  const marcosApi = await must(carla, "GET", `/api/hr/performance/participants/${ws.people.find((p) => p.participant.employeeName.includes("Marcos")).participant.id}/leadership`);
  step("9.11b API da equipe pequena não devolve médias", marcosApi.team.disclosed === false && JSON.stringify(marcosApi.team).match(/"upward":\s*\d/) === null, JSON.stringify(marcosApi.team).slice(0, 160));

  // RH: Carla (topo) calibrada com exceção registrada, pela aba Calibração
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-page", 45000);
  await hr.clickTestId("perf-tabs-tab-calibracao");
  await hr.waitTestId("perf-leadership-calibration", 30000);
  await hr.fullShot("9-12a-rh-calibracao-lideranca");
  await hr.clickTestId("perf-leadership-open-[DEMO] Carla Gerente");
  await hr.waitTestId("perf-leadership-exception", 20000);
  await calibrate(hr, "Carla", { exception: true });
  await hr.fullShot("9-12b-rh-calibra-topo-com-excecao");
  const list = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/leadership`);
  step("9.12 calibração do topo com exceção registrada", list.rows.find((r) => r.employeeName.includes("Carla"))?.status === "EXCEPTION", list.rows.map((r) => `${r.employeeName.replace("[DEMO] ", "")}=${r.status}`).join(", "));

  // 9.13 homologação
  const homologated = await api(hr, "POST", `/api/hr/performance/cycles/${cycleId}/homologate`);
  const after = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/leadership`);
  step("9.13 homologação marca a liderança como oficial", homologated.status === 200 && after.rows.every((r) => r.status === "HOMOLOGATED"), `${homologated.status} · ${after.rows.map((r) => r.status).join(",")}`);

  // 9.14 PDF de liderança
  const pdfPage = await browser.newPage(carlaCtx, { width: 1000, height: 1200 });
  await pdfPage.goto(`${BASE}${pdfHref}`);
  await pdfPage.waitTestId("perf-print-document", 45000);
  await sleep(800);
  const pdfText = await pdfPage.text();
  await pdfPage.fullShot("9-14-pdf-lideranca-bruno");
  await pdfPage.pdf("lideranca-bruno");
  step("9.14 PDF de liderança emitido pelo superior, sem comentários da equipe", /lideran/i.test(pdfText) && !pdfText.includes(SECRET), pdfText.split("\n").slice(0, 5).join(" / "));
  await pdfPage.close();

  // 9.15 PDI com competência de liderança
  const brunoPerson = ws3.people.find((p) => p.participant.employeeName.includes("Bruno"));
  const fb = await must(hr, "POST", `/api/hr/performance/participants/${brunoPerson.participant.id}/feedback`, {
    strength: "Organiza bem a semana da equipe.",
    improvement: "Dar retorno à equipe mais cedo.",
    action: "Rodada quinzenal de retorno com a equipe.",
    ownerName: "Carla Gerente",
    dueAt: "2027-01-30",
    conversationAt: "2026-12-01",
  });
  const pdi = await api(hr, "POST", `/api/hr/performance/feedbacks/${fb.feedbackId}/pdi`, { title: "Rodada de retorno à equipe", competencyCode: "LD-06", priority: true, ownerName: "Bruno Líder", dueAt: "2027-02-28" });
  const anaPerson = ws3.people.find((p) => p.participant.employeeName.includes("Ana"));
  const fbAna = await must(hr, "POST", `/api/hr/performance/participants/${anaPerson.participant.id}/feedback`, { strength: "Cuida do posto.", improvement: "Pedir ajuda mais cedo.", action: "Conversa semanal com o líder.", ownerName: "Bruno Líder", dueAt: "2027-01-30", conversationAt: "2026-12-01" });
  const pdiAna = await api(hr, "POST", `/api/hr/performance/feedbacks/${fbAna.feedbackId}/pdi`, { title: "Liderar reunião", competencyCode: "LD-06", priority: true, ownerName: "Ana Souza", dueAt: "2027-02-28" });
  step("9.15 PDI com competência de liderança só para quem lidera", pdi.status < 300 && pdiAna.status >= 400, `Bruno ${pdi.status} · Ana ${pdiAna.status} ${pdiAna.body.error ?? ""}`);

  // 9.16 painel (recarrega: a calibração aberta antes da homologação fica para trás)
  await hr.goto(`${BASE}/performance-cycle`);
  await hr.waitTestId("perf-page", 45000);
  await hr.clickTestId("perf-tabs-tab-painel");
  await hr.waitTestId("perf-dashboard-leadership", 30000);
  const dash = await hr.eval(`document.querySelector('[data-testid="perf-dashboard-leadership"]').innerText`);
  await hr.fullShot("9-16-painel-lideranca");
  step("9.16 painel com bloco de liderança separado da Nine-Box", /Líderes no ciclo/i.test(dash) && !dash.includes(SECRET), dash.replace(/\n+/g, " / ").slice(0, 200));

  // 9.17 nenhuma rota devolve o comentário da equipe, nem ao RH
  const hrLeadership = await must(hr, "GET", `/api/hr/performance/participants/${brunoPid}/leadership`);
  const hrWs = await must(hr, "GET", `/api/hr/performance/cycles/${cycleId}/workspace`);
  const leaderAfter = await api(leader, "GET", `/api/hr/performance/participants/${brunoPid}/leadership`);
  step(
    "9.17 comentário do liderado não sai por nenhuma rota (RH, superior, líder)",
    ![hrLeadership, hrWs, leaderAfter.body, marcosApi].some((b) => JSON.stringify(b).includes(SECRET)),
    `líder depois da homologação → ${leaderAfter.status}`
  );

  saveState({ leadership180: { cycleId, brunoPid } });
  console.log("logs:", JSON.stringify([...hr.logs, ...carla.logs, ...phone.logs].filter((l) => l.type !== "warning").slice(0, 10)));
} catch (error) {
  step("ERRO parte 9", false, error.message);
  try {
    console.log("alerts:", await globalThis.__hr?.eval(`[...document.querySelectorAll('[role="alert"]')].map(e => e.innerText).join(" | ")`));
    await globalThis.__hr?.shot("error-part9");
  } catch (e) {
    console.log("debug falhou", e.message);
  }
} finally {
  writeResults("part9");
  await browser.close();
}
