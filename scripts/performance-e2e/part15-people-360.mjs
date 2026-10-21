// Parte 15: Pessoas 360° — jornadas 1 a 5 no Chrome real (DevTools Protocol), só em ambiente LOCAL
// com dados fictícios. Usa o caso real reproduzido localmente: Person A "[DEMO] Carla Gerente"
// (CPF + colaborador) e Person B "Carla" (criada ao vincular a conta), e a conta gerente.teste.
//
// J1 consulta (lista e ficha) · J2 correção do caso real (conta B → A, com prévia e auditoria)
// J3 unificação A ← B com step-up e reversão · J4 motorista pendente por CPF e comissionável
// (vincular/desvincular) · J5 matriz de autorização e E2–E4 pela API.
//
// Pré-requisitos: servidor local em PERF_E2E_BASE (padrão http://localhost:3100) contra o PG
// descartável; PERF_DEMO_PASSWORD = senha do seed (mesma para todas as contas fictícias).
import { BASE, login, sleep, start, step, writeResults } from "./common.mjs";

const PASSWORD = process.env.PERF_DEMO_PASSWORD;
const A_ID = process.env.PEOPLE_E2E_PERSON_A ?? "03d86662-24dd-4de8-b49c-c9be11144d11";
const B_ID = process.env.PEOPLE_E2E_PERSON_B ?? "eb9d429c-0cd9-4657-9481-c0c0769160de";
const CARLA_CPF = "529.982.247-25"; // CPF fictício com dígitos verificadores válidos (seed local)
const BRUNO_PERSON = process.env.PEOPLE_E2E_PERSON_BRUNO ?? "51a42bea-580e-4680-9f9c-caf50c3d3694";

const browser = await start(9415);
const api = (page, method, path, body) =>
  page.eval(
    `fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { "content-type": "application/json" }${body === undefined ? "" : `, body: ${JSON.stringify(JSON.stringify(body))}`} }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`
  );
const must = async (page, method, path, body) => {
  const out = await api(page, method, path, body);
  if (out.status >= 300) throw new Error(`${method} ${path} → ${out.status} ${JSON.stringify(out.body).slice(0, 300)}`);
  return out.body;
};
const profile = (page, id) => must(page, "GET", `/api/people/${id}`);
const openProfile = async (page, id) => {
  await page.goto(`${BASE}/people/${id}`);
  await page.waitTestId("person-profile", 45000);
  await sleep(400);
};
const cardState = (page, role) => page.eval(`document.querySelector('[data-testid="person-card-${role}"]')?.innerText ?? ""`);
const fillReason = async (page, text) => {
  await page.waitFor(`document.querySelector('[role="dialog"] textarea')`, { label: "textarea do diálogo" });
  await page.type('[role="dialog"] textarea', text);
};
const stepUp = async (page) => {
  await page.waitFor(`document.querySelector('input[type="password"]')`, { timeout: 15000, label: "step-up" });
  await page.type('input[type="password"]', PASSWORD);
  await page.clickText("Confirmar", "button");
};

const cleanup = { driverId: null, commissionId: null, createdUserId: null, marcosId: null, opUserId: null };

try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__hr = hr;
  await login(hr, "rh.teste@induscost.test");

  // ---------- Preparação (API): estado inicial determinístico do caso real ----------
  let a = await profile(hr, A_ID);
  let b = await profile(hr, B_ID);
  if (b.person.status === "MERGED") {
    const ev = a.events.find((e) => e.eventKind === "MERGED" && e.reversible && !e.revertedAt);
    if (ev) {
      await must(hr, "POST", "/api/auth/admin-elevation/confirm", { password: PASSWORD });
      await must(hr, "POST", `/api/people/${A_ID}/merge/revert`, { eventId: ev.id, reason: "E2E: restaurar estado inicial" });
    }
  }
  a = await profile(hr, A_ID);
  let userLink = a.linkedEntities.find((l) => l.kind === "app_user");
  if (userLink) {
    // Conta volta para a Pessoa B para reproduzir o caso real (conta numa Pessoa, colaborador+CPF noutra).
    await must(hr, "POST", `/api/people/${B_ID}/links`, { entityKind: "app_user", entityId: userLink.id, expectedCurrentPersonId: A_ID, reason: "E2E: reproduzir o caso real (conta na Pessoa B)" });
  } else {
    b = await profile(hr, B_ID);
    userLink = b.linkedEntities.find((l) => l.kind === "app_user");
    if (!userLink) throw new Error("preparação: conta da Carla não está nem na Pessoa A nem na B");
  }
  a = await profile(hr, A_ID);
  step("15.00 preparação: conta da Carla na Pessoa B, colaborador e CPF na Pessoa A", a.linkStates.appUser !== "LINKED" && a.flags.includes("USER_ON_OTHER_PERSON"), `appUser=${a.linkStates.appUser} flags=${a.flags.join(",")}`);

  // ---------- J1: consulta ----------
  await hr.goto(`${BASE}/people`);
  await hr.waitTestId("people-list-page", 45000);
  await hr.waitTestId("people-table", 30000);
  await hr.type('[data-testid="people-search-input"]', "Carla");
  await hr.clickTestId("people-search-submit");
  await hr.waitFor(`[...document.querySelectorAll('[data-testid^="people-row-"]')].length === 2`, { timeout: 20000, label: "2 linhas Carla" });
  const rowsText = await hr.eval(`[...document.querySelectorAll('[data-testid^="people-row-"]')].map((r) => r.innerText.replace(/\\n+/g, " | ")).join(" || ")`);
  await hr.shot("15-01-lista-busca-carla");
  step("15.01 J1 lista: busca por nome traz as duas Pessoas e sinaliza conflito", /Carla Gerente/.test(rowsText) && /Conflito|aponta para outra Pessoa/i.test(rowsText), rowsText.slice(0, 160));

  await hr.clickTestId(`people-open-${A_ID.slice(0, 8)}`);
  await hr.waitTestId("person-profile", 30000);
  await sleep(400);
  const headerName = await hr.eval(`document.querySelector('[data-testid="person-display-name"]')?.innerText ?? ""`);
  const empCard = await cardState(hr, "employee");
  const dupBox = await hr.eval(`document.querySelector('[data-testid="person-duplicates"]')?.innerText ?? ""`);
  await hr.fullShot("15-02-ficha-carla-a");
  step("15.02 J1 ficha: cabeçalho, cartão Funcionário vinculado, duplicidade e conta pendente visíveis", /Carla Gerente/.test(headerName) && /Vinculado/.test(empCard) && /mesmo CPF/i.test(dupBox) && (await hr.eval(`Boolean(document.querySelector('[data-testid="person-relink-open-app_user-${userLink.id}"]'))`)), `${headerName} · ${empCard.slice(0, 40)}`);

  // ---------- J2: corrigir o vínculo da conta (B → A) pela ficha, com prévia e justificativa ----------
  await hr.clickTestId(`person-relink-open-app_user-${userLink.id}`);
  await hr.waitTestId("person-relink-preview", 20000);
  const previewText = await hr.eval(`document.querySelector('[role="dialog"]').innerText`);
  await hr.shot("15-03-previa-correcao");
  const confirmDisabledBefore = await hr.eval(`document.querySelector('[data-testid="person-relink-confirm"]').disabled`);
  await fillReason(hr, "E2E: conta criada em Pessoa separada; colaborador e CPF estão nesta Pessoa.");
  await hr.clickTestId("person-relink-confirm");
  await hr.waitFor(`!document.querySelector('[data-testid="person-relink-preview"]')`, { timeout: 20000, label: "diálogo fechado" });
  await hr.waitFor(`/Vinculado/.test(document.querySelector('[data-testid="person-card-appUser"]')?.innerText ?? "")`, { timeout: 20000, label: "conta vinculada" });
  a = await profile(hr, A_ID);
  const relinked = a.events.find((e) => e.eventKind === "RELINKED" && e.entityKind === "app_user");
  await hr.fullShot("15-04-ficha-apos-correcao");
  step("15.03 J2 prévia mostra origem/destino e exige justificativa", /Carla/.test(previewText) && confirmDisabledBefore === true, previewText.slice(0, 120));
  step("15.04 J2 correção: conta volta para a Pessoa A, evento RELINKED com autor e motivo", a.linkStates.appUser === "LINKED" && Boolean(relinked?.actorName) && /E2E/.test(relinked?.reason ?? "") && relinked?.fromPersonId === B_ID, `${relinked?.actorName} · ${relinked?.evidence}`);

  // ---------- J3: unificar A ← B (step-up) e reverter ----------
  const mergeDenied = await api(hr, "POST", `/api/people/${A_ID}/merge`, { loserPersonId: B_ID, reason: "E2E sem step-up", expectedMoveCount: 0 });
  step("15.05 J3 unificar sem confirmação de senha é recusado (403 ADMIN_ELEVATION_REQUIRED)", mergeDenied.status === 403 && mergeDenied.body?.code === "ADMIN_ELEVATION_REQUIRED", `${mergeDenied.status} ${mergeDenied.body?.code}`);

  await openProfile(hr, A_ID);
  await hr.clickTestId("person-merge-open");
  await hr.waitTestId("person-merge-preview", 20000);
  const mergePreview = await hr.eval(`document.querySelector('[role="dialog"]').innerText`);
  await hr.shot("15-05-previa-unificacao");
  await fillReason(hr, "E2E: Pessoa B criada ao vincular a conta; CPF igual ao da Pessoa A.");
  await hr.clickTestId("person-merge-confirm");
  await stepUp(hr);
  await hr.waitFor(`!document.querySelector('[data-testid="person-merge-preview"]') && document.querySelector('[data-testid="person-revert-open"]')`, { timeout: 30000, label: "unificação concluída" });
  b = await profile(hr, B_ID);
  a = await profile(hr, A_ID);
  await hr.fullShot("15-06-ficha-apos-unificacao");
  step("15.06 J3 prévia da unificação: CPF igual, pessoa que fica, o que não muda", /CPF/.test(mergePreview) && /Não muda/i.test(mergePreview), mergePreview.slice(0, 120));
  step("15.07 J3 unificação com step-up: B fica MERGED apontando para A; A sem pendência; evento MERGED reversível", b.person.status === "MERGED" && b.person.mergedInto?.id === A_ID && !a.pending.some((p) => p.kind === "person") && a.events.some((e) => e.eventKind === "MERGED" && e.reversible), `B=${b.person.status} → ${b.person.mergedInto?.id?.slice(0, 8)}`);
  step("15.08 J3 Pessoa unificada não propõe unificar com a vencedora", b.pending.length === 0, `pendências B=${b.pending.length}`);

  await hr.clickTestId("person-revert-open");
  await fillReason(hr, "E2E: teste de reversibilidade.");
  await hr.clickTestId("person-revert-confirm");
  await hr.waitFor(`!document.querySelector('[data-testid="person-revert-confirm"]')`, { timeout: 30000, label: "reversão" });
  await sleep(600);
  b = await profile(hr, B_ID);
  a = await profile(hr, A_ID);
  await hr.fullShot("15-07-ficha-apos-reversao");
  step("15.09 J3 reversão: B volta a ACTIVE, evento MERGED marcado como revertido, MERGE_REVERTED gravado", b.person.status === "ACTIVE" && a.events.some((e) => e.eventKind === "MERGED" && e.revertedAt) && a.events.some((e) => e.eventKind === "MERGE_REVERTED"), `B=${b.person.status}`);

  // ---------- J4: motorista pendente por CPF (vincular pela ficha) e comissionável (desvincular) ----------
  const badDriver = await api(hr, "POST", "/api/fleet/drivers", { name: "[E2E] Motorista CPF inválido", cpf: "123.456.789-01" });
  step("15.10 J4 Frota recusa CPF sem dígitos verificadores válidos", badDriver.status === 400 && /verificadores/.test(badDriver.body?.error ?? ""), `${badDriver.status}`);
  const driver = (await must(hr, "POST", "/api/fleet/drivers", { name: "[E2E] Motorista Carla", cpf: CARLA_CPF, status: "PENDING" })).driver;
  cleanup.driverId = driver.id;
  step("15.11 J4 CPF com duas Pessoas candidatas (A e B): motorista nasce sem vínculo, nada é escolhido sozinho", driver.personId === null, `personId=${driver.personId}`);
  await openProfile(hr, A_ID);
  const pendingDriver = await hr.eval(`document.querySelector('[data-testid="person-pending-fleetDriver"]')?.innerText ?? ""`);
  await hr.shot("15-08-motorista-pendente");
  step("15.12 J4 ficha da Pessoa A mostra o motorista como pendência por CPF igual", /Motorista Carla/.test(pendingDriver) && /CPF igual/i.test(pendingDriver), pendingDriver.slice(0, 100));
  await hr.clickTestId(`person-relink-open-fleet_driver-${driver.id}`);
  await hr.waitTestId("person-relink-preview", 20000);
  await fillReason(hr, "E2E: motorista é a própria colaboradora (CPF igual).");
  await hr.clickTestId("person-relink-confirm");
  await hr.waitFor(`/Vinculado/.test(document.querySelector('[data-testid="person-card-fleetDriver"]')?.innerText ?? "")`, { timeout: 20000, label: "motorista vinculado" });
  a = await profile(hr, A_ID);
  const drvEvent = a.events.find((e) => e.eventKind === "LINKED" && e.entityKind === "fleet_driver");
  step("15.13 J4 vincular motorista pela ficha: cartão Motorista vinculado, evento LINKED com evidência CPF_EXACT", a.linkStates.fleetDriver === "LINKED" && drvEvent?.evidence === "CPF_EXACT", `${drvEvent?.evidence}`);

  const commission = await must(hr, "POST", "/api/commissions/persons", { name: `[E2E] Comissionado Bruno ${Date.now()}`, type: "SELLER", personId: BRUNO_PERSON });
  cleanup.commissionId = commission.id;
  const commissionList = await must(hr, "GET", "/api/commissions/persons?page=1&pageSize=5&search=%5BE2E%5D");
  await openProfile(hr, BRUNO_PERSON);
  const commCardBefore = await cardState(hr, "commissionPerson");
  await hr.clickTestId("person-unlink-open-commission_person");
  await fillReason(hr, "E2E: desvincular comissionável para teste.");
  await hr.clickTestId("person-unlink-confirm");
  await hr.waitFor(`/Não vinculado/.test(document.querySelector('[data-testid="person-card-commissionPerson"]')?.innerText ?? "")`, { timeout: 20000, label: "comissionável desvinculado" });
  const bruno = await profile(hr, BRUNO_PERSON);
  const afterUnlink = await must(hr, "GET", "/api/commissions/persons?page=1&pageSize=5&search=%5BE2E%5D");
  const rowAfter = (afterUnlink.items ?? []).find((r) => r.id === commission.id);
  await hr.fullShot("15-09-bruno-comissionavel-desvinculado");
  step("15.14 J4 comissionável com vínculo explícito aparece na ficha; desvincular remove só o vínculo (cadastro, tipo e nome intactos) e grava UNLINKED", /Vinculado/.test(commCardBefore) && commission.personId === BRUNO_PERSON && rowAfter && rowAfter.personId === null && rowAfter.name === commission.name && rowAfter.type === "SELLER" && bruno.events.some((e) => e.eventKind === "UNLINKED" && e.entityKind === "commission_person"), `lista=${(commissionList.items ?? []).length}`);

  // ---------- J5: autorização (matriz) e E2–E4 pela API ----------
  const users = (await must(hr, "GET", "/api/admin/users")).users ?? (await must(hr, "GET", "/api/admin/users"));
  const byEmail = (email) => (Array.isArray(users) ? users : []).find((u) => u.email === email);
  const marcos = byEmail("marcos.teste@induscost.test");
  const op = byEmail("rh.operacional@induscost.test");
  cleanup.marcosId = marcos?.id ?? null;

  // E2: SUPER_ADMIN só por SUPER_ADMIN elevado; ninguém se promove.
  // Sessão nova (sem step-up): a sessão principal já foi elevada pela unificação em J3.
  const freshCtx = await browser.newContext();
  const fresh = await browser.newPage(freshCtx, { width: 1200, height: 800 });
  await login(fresh, "rh.teste@induscost.test");
  const selfPromote = await api(fresh, "PATCH", `/api/admin/users/${marcos.id}`, { role: "SUPER_ADMIN" });
  step("15.15 E2 conceder SUPER_ADMIN sem step-up é recusado e auditado (403 ADMIN_ELEVATION_REQUIRED)", selfPromote.status === 403 && selfPromote.body?.code === "ADMIN_ELEVATION_REQUIRED", `${selfPromote.status} ${selfPromote.body?.code}`);
  await must(hr, "PATCH", `/api/admin/users/${marcos.id}`, { role: "ADMIN" });

  // E3: exclusão vira inativação lógica.
  const del = await api(hr, "DELETE", `/api/admin/users/${op.id}`);
  const opAfter = (await must(hr, "GET", "/api/admin/users"));
  const opRow = (Array.isArray(opAfter) ? opAfter : opAfter.users ?? []).find((u) => u.id === op.id);
  step("15.16 E3 DELETE de usuário não apaga: conta continua existindo, inativa, com histórico", del.status === 200 && del.body?.physicallyDeleted === false && opRow && opRow.isActive === false, `${del.status} physicallyDeleted=${del.body?.physicallyDeleted}`);
  await must(hr, "PATCH", `/api/admin/users/${op.id}`, { isActive: true });

  // E4: conta nasce com a Pessoa do colaborador.
  // Colaborador ativo com Pessoa e sem conta (escolhido pela própria API de Pessoas, para o roteiro ser repetível).
  const candidates = (await must(hr, "GET", "/api/people?has=employee&missing=appUser&status=ACTIVE&limit=20")).items ?? [];
  let ana = null;
  for (const c of candidates) {
    const prof = await profile(hr, c.id);
    const emp = prof.linkedEntities.find((l) => l.kind === "employee");
    if (emp && prof.linkStates.employee === "LINKED" && prof.linkStates.appUser === "NOT_LINKED") { ana = { id: emp.id, personId: c.id, name: c.displayName }; break; }
  }
  if (ana) {
    const email = `ana.e2e.${Date.now()}@induscost.test`;
    const created = await api(hr, "POST", "/api/admin/users", { name: "[E2E] Ana", email, password: PASSWORD, employeeId: ana.id, role: "VIEWER" });
    const createdUser = created.body?.user ?? created.body;
    cleanup.createdUserId = createdUser?.id ?? null;
    const anaProfile = ana.personId ? await profile(hr, ana.personId) : null;
    const anaUserLinked = anaProfile?.linkedEntities.some((l) => l.kind === "app_user" && l.id === createdUser?.id);
    step("15.17 E4 criar conta a partir do colaborador copia a Pessoa: a ficha da Pessoa do colaborador mostra a conta nova vinculada", created.status === 201 && Boolean(ana.personId) && anaProfile?.linkStates.appUser === "LINKED" && anaUserLinked === true, `${created.status} person=${String(ana.personId).slice(0, 8)} linked=${anaUserLinked}`);
  } else {
    step("15.17 E4 criar conta a partir do colaborador copia a Pessoa", false, "nenhum colaborador ativo sem conta encontrado via /api/people");
  }

  // Matriz: cada perfil × /api/people e operações.
  const matrix = [];
  const probe = async (page, label) => {
    const list = await api(page, "GET", "/api/people?limit=1");
    const ficha = await api(page, "GET", `/api/people/${A_ID}`);
    const link = await api(page, "POST", `/api/people/${A_ID}/links/preview`, { entityKind: "app_user", entityId: userLink.id });
    const merge = await api(page, "POST", `/api/people/${A_ID}/merge/preview`, { loserPersonId: B_ID });
    // Execução (não a prévia) é o que exige SUPER_ADMIN com step-up; sessões sem step-up recebem 403 e nada é unificado.
    const exec = await api(page, "POST", `/api/people/${A_ID}/merge`, { loserPersonId: B_ID, reason: "E2E matriz (deve ser recusado)", expectedMoveCount: 0 });
    matrix.push({ label, list: list.status, ficha: ficha.status, link: link.status, mergePreview: merge.status, merge: exec.status, mergeCode: exec.body?.code ?? null });
  };
  await probe(fresh, "SUPER_ADMIN (rh.teste, sem step-up)");
  await fresh.close();
  for (const [email, label] of [["marcos.teste@induscost.test", "ADMIN (marcos.teste)"], ["rh.gestor@induscost.test", "RH gestor (perfil Desempenho)"], ["rh.operacional@induscost.test", "RH operacional (perfil Desempenho)"], ["lider.teste@induscost.test", "comum (líder de produção)"]]) {
    const c = await browser.newContext();
    const p = await browser.newPage(c, { width: 1200, height: 800 });
    await login(p, email);
    await probe(p, label);
    if (label.startsWith("ADMIN")) {
      const adminElevate = await api(p, "POST", "/api/auth/admin-elevation/confirm", { password: PASSWORD });
      const adminMerge = await api(p, "POST", `/api/people/${A_ID}/merge`, { loserPersonId: B_ID, reason: "E2E admin elevado", expectedMoveCount: 0 });
      const adminSelf = await api(p, "PATCH", `/api/admin/users/${marcos.id}`, { role: "SUPER_ADMIN" });
      matrix.push({ label: "ADMIN elevado → unificar", merge: adminMerge.status, mergeCode: adminMerge.body?.code ?? null });
      step("15.18 J5 ADMIN não eleva (403), não unifica (403) nem se promove a SUPER_ADMIN (403)", adminElevate.status === 403 && adminMerge.status === 403 && adminSelf.status === 403, `elevate=${adminElevate.status} merge=${adminMerge.status}/${adminMerge.body?.code} self=${adminSelf.status}/${adminSelf.body?.code}`);
      await p.goto(`${BASE}/people`);
      await sleep(1500);
      await p.shot("15-10-admin-people");
    }
    if (label.startsWith("comum")) {
      await p.goto(`${BASE}/people/${A_ID}`);
      await sleep(2000);
      const text = await p.text();
      await p.shot("15-11-comum-people");
      matrix[matrix.length - 1].uiBlocked = !/Histórico de identidade/.test(text);
    }
    await p.close();
  }
  console.log("matriz:", JSON.stringify(matrix));
  const sa = matrix[0];
  const others = matrix.filter((m) => !m.label.startsWith("SUPER_ADMIN") && !m.label.startsWith("ADMIN elevado"));
  step("15.19 J5 matriz: SUPER_ADMIN vê lista e ficha, prepara vínculo e prévia de unificação; executar unificação exige step-up", sa.list === 200 && sa.ficha === 200 && sa.link === 200 && sa.mergePreview === 200 && sa.merge === 403 && sa.mergeCode === "ADMIN_ELEVATION_REQUIRED", JSON.stringify(sa));
  step("15.20 J5 matriz: perfis sem permissão do módulo Pessoas recebem 403 em lista, ficha, vínculo e unificação (nunca 500)", others.every((m) => [m.list, m.ficha, m.link, m.mergePreview, m.merge].every((s) => s === 403 || s === 200) && m.link !== 200 && m.mergePreview !== 200 && m.merge !== 200) && others.filter((m) => !m.label.startsWith("ADMIN")).every((m) => m.list === 403 && m.ficha === 403), JSON.stringify(others));
} catch (error) {
  step("15.ERR exceção na jornada", false, String(error?.stack ?? error).slice(0, 600));
  try { await globalThis.__hr?.shot("15-ERR"); } catch { /* ignore */ }
} finally {
  try {
    const hr = globalThis.__hr;
    if (hr) {
      if (cleanup.marcosId) await api(hr, "PATCH", `/api/admin/users/${cleanup.marcosId}`, { role: "VIEWER" });
      if (cleanup.createdUserId) await api(hr, "DELETE", `/api/admin/users/${cleanup.createdUserId}`);
      if (cleanup.commissionId) await api(hr, "PATCH", `/api/commissions/persons/${cleanup.commissionId}/toggle-active`);
      if (cleanup.driverId) {
        await api(hr, "DELETE", `/api/people/${A_ID}/links/fleet_driver/${cleanup.driverId}`, { reason: "E2E: limpeza do motorista de teste" });
        await api(hr, "PUT", `/api/fleet/drivers/${cleanup.driverId}`, { status: "INACTIVE", notes: "[E2E] inativado na limpeza" });
      }
    }
  } catch { /* limpeza best-effort */ }
  writeResults("part15-people-360");
  await browser.close();
  console.log("logs:", JSON.stringify(cleanup));
}
