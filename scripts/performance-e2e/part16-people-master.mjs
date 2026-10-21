// Parte 16: Pessoas 360° como cadastro mestre — só ambiente LOCAL com dados fictícios do
// seedPeopleLegacy.mts (PEOPLE_LEGACY_STATE aponta para o JSON gravado pelo seed).
//
// J1 criar Pessoa pela lista e editar pela ficha · J2 habilitar acesso (sem colaborador) ·
// J3 habilitar motorista · J4 regularizar os 7 casos legados (L1–L7) pela ficha/API ·
// J5 matriz de autorização das rotas novas · J6 invariância de Comissões/Nomus · J7 auditoria ANTES×DEPOIS.
import { readFileSync } from "node:fs";
import { BASE, login, sleep, start, step, writeResults } from "./common.mjs";

const PASSWORD = process.env.PERF_DEMO_PASSWORD;
const STATE = JSON.parse(readFileSync(process.env.PEOPLE_LEGACY_STATE ?? "", "utf8"));
const RUN = String(Date.now()).slice(-6);
// CPF fictício válido e único por execução (dígitos verificadores calculados).
const cpfFrom = (base9) => {
  const calc = (b, f) => { let sum = 0; for (let i = 0; i < b.length; i += 1) sum += parseInt(b[i], 10) * (f - i); const m = (sum * 10) % 11; return m === 10 ? 0 : m; };
  const d1 = calc(base9, 10); const d2 = calc(base9 + d1, 11); return base9 + d1 + d2;
};
const NEW_CPF = cpfFrom((`9${RUN}` + "00").slice(0, 9));
const NEW_CPF_MASKED = `${NEW_CPF.slice(0, 3)}.${NEW_CPF.slice(3, 6)}.${NEW_CPF.slice(6, 9)}-${NEW_CPF.slice(9)}`;

const browser = await start(9416);
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
const typeReason = async (page, testId, text) => {
  await page.waitFor(`document.querySelector('[data-testid="${testId}"]')`, { label: testId });
  await page.type(`[data-testid="${testId}"]`, text);
};
const stepUp = async (page) => {
  await page.waitFor(`document.querySelector('input[type="password"]')`, { timeout: 15000, label: "step-up" });
  await page.type('input[type="password"]', PASSWORD);
  // O botão do step-up é o submit do formulário que contém a senha (o diálogo de trás também tem "Confirmar…").
  await page.click('form:has(input[type="password"]) button[type="submit"]');
};
const linkedUserOf = async (page, personId) => (await profile(page, personId)).linkedEntities.find((l) => l.kind === "app_user")?.id ?? null;
const users = async (page) => {
  const r = await must(page, "GET", "/api/admin/users");
  return Array.isArray(r) ? r : r.users ?? [];
};
const userById = async (page, id) => (await users(page)).find((u) => u.id === id) ?? null;

try {
  const ctx = await browser.newContext();
  const hr = await browser.newPage(ctx, { width: 1440, height: 900 });
  globalThis.__hr = hr;
  await login(hr, "rh.teste@induscost.test");

  // ---------- J7 (antes): auditoria somente leitura ----------
  const before = await must(hr, "GET", `/api/people?limit=1&missing=app_user`);
  step("16.00 preparação: lista de Pessoas responde", Boolean(before.meta), `total=${before.meta?.total}`);

  // ---------- J1: criar Pessoa pela lista, editar pela ficha ----------
  await hr.goto(`${BASE}/people`);
  await hr.waitTestId("people-list-page", 45000);
  await hr.clickTestId("people-new-person");
  await hr.waitTestId("person-form-dialog", 15000);
  await hr.type('[data-testid="person-form-name"]', `[E2E] Pessoa Nova ${RUN}`);
  await hr.type('[data-testid="person-form-cpf"]', NEW_CPF_MASKED);
  await hr.type('[data-testid="person-form-email"]', `e2e.nova.${RUN}@induscost.test`);
  await hr.clickTestId("person-form-submit");
  await hr.waitTestId("person-profile", 30000);
  await sleep(500);
  const newId = await hr.eval(`location.pathname.split("/").pop()`);
  let nova = await profile(hr, newId);
  await hr.fullShot("16-01-pessoa-criada");
  step("16.01 J1 criar Pessoa pela lista: ficha abre, origem MANUAL, evento PERSON_CREATED", nova.person.origin === "MANUAL" && nova.events.some((e) => e.eventKind === "PERSON_CREATED") && nova.person.cpfMasked === `***.***.${NEW_CPF.slice(6, 9)}-${NEW_CPF.slice(9)}`, `${newId.slice(0, 8)} ${nova.person.origin}`);

  const dup = await api(hr, "POST", "/api/people", { displayName: `[E2E] Dup ${RUN}`, cpf: NEW_CPF_MASKED });
  step("16.02 J1 duplicidade: Pessoa nova com o mesmo CPF → 409 DUPLICATE_CPF (nada criado)", dup.status === 409 && dup.body?.code === "DUPLICATE_CPF", `${dup.status} ${dup.body?.code}`);

  await hr.clickTestId("person-edit-open");
  await hr.waitTestId("person-form-dialog", 15000);
  await sleep(600);
  await hr.type('[data-testid="person-form-social"]', `Nova ${RUN}`);
  await hr.type('[data-testid="person-form-phone"]', "(11) 97777-6666");
  await hr.type('[data-testid="person-form-reason"]', "E2E: inclusão de nome social e telefone");
  await hr.clickTestId("person-form-submit");
  await hr.waitFor(`!document.querySelector('[data-testid="person-form-dialog"]')`, { timeout: 20000, label: "edição salva" });
  await sleep(500);
  nova = await profile(hr, newId);
  const upd = nova.events.find((e) => e.eventKind === "IDENTITY_UPDATED");
  step("16.03 J1 editar pela ficha: nome social aplicado, evento IDENTITY_UPDATED com autor e motivo", nova.person.socialName === `Nova ${RUN}` && Boolean(upd?.actorName) && /E2E/.test(upd?.reason ?? ""), `${nova.person.displayName}`);

  // ---------- J2: habilitar acesso (Pessoa sem colaborador) ----------
  await openProfile(hr, newId);
  await hr.clickTestId("person-enable-access-open");
  await hr.waitTestId("person-enable-access-dialog", 15000);
  await hr.type('[data-testid="enable-access-password"]', `E2eSenha#${RUN}x`);
  await hr.clickTestId("enable-access-confirm");
  await hr.waitFor(`/Vinculado/.test(document.querySelector('[data-testid="person-card-appUser"]')?.innerText ?? "")`, { timeout: 20000, label: "conta criada" });
  nova = await profile(hr, newId);
  const novaUserId = nova.linkedEntities.find((l) => l.kind === "app_user")?.id ?? null;
  const novaUser = novaUserId ? await userById(hr, novaUserId) : null;
  await hr.fullShot("16-02-acesso-habilitado");
  step("16.04 J2 habilitar acesso: conta nasce VIEWER, sem perfil, ligada à Pessoa e sem colaborador; evento LINKED", Boolean(novaUser) && novaUser.role === "VIEWER" && !novaUser.employeeId && novaUserId === novaUser.id && nova.events.some((e) => e.eventKind === "LINKED" && e.entityKind === "app_user"), `${novaUser?.email} role=${novaUser?.role}`);
  const elev = await api(hr, "POST", `/api/people/${newId}/access`, { password: `Outra#${RUN}xx`, email: `e2e.nova2.${RUN}@induscost.test`, role: "SUPER_ADMIN" });
  step("16.05 J2 segunda conta para a mesma Pessoa → 409 PERSON_ALREADY_HAS_USER (campo role ignorado)", elev.status === 409 && elev.body?.code === "PERSON_ALREADY_HAS_USER", `${elev.status} ${elev.body?.code}`);

  // ---------- J3: habilitar motorista ----------
  await openProfile(hr, newId);
  await hr.clickTestId("person-enable-driver-open");
  await hr.waitTestId("driver-preview", 15000);
  const planAction = await hr.eval(`document.querySelector('[data-testid="driver-plan"]')?.dataset.action`);
  await hr.type('[data-testid="driver-cnh"]', "12345678901");
  await hr.select('[data-testid="driver-cnh-category"]', "B");
  await typeReason(hr, "driver-reason", "E2E: habilitar motorista pela ficha");
  await hr.clickTestId("driver-confirm");
  await hr.waitFor(`/Vinculado/.test(document.querySelector('[data-testid="person-card-fleetDriver"]')?.innerText ?? "")`, { timeout: 20000, label: "motorista criado" });
  nova = await profile(hr, newId);
  const driverId = nova.linkedEntities.find((l) => l.kind === "fleet_driver")?.id ?? null;
  const drv = driverId ? (await must(hr, "GET", `/api/fleet/drivers/${driverId}`)).driver : null;
  await hr.fullShot("16-03-motorista-habilitado");
  step("16.06 J3 habilitar motorista: ação CREATE, motorista PENDING com CPF/nome da Pessoa e personId; evento LINKED CPF_EXACT", planAction === "CREATE" && Boolean(drv) && drv.status === "PENDING" && drv.cpf === NEW_CPF && drv.personId === newId && nova.events.some((e) => e.entityKind === "fleet_driver" && e.evidence === "CPF_EXACT"), `${planAction} ${drv?.status}`);
  const again = await must(hr, "GET", `/api/people/${newId}/driver/preview`);
  step("16.07 J3 segunda habilitação → ALREADY_ENABLED (uma identidade, um motorista ativo)", again.plan.action === "ALREADY_ENABLED", again.plan.action);

  // ---------- J4: os 7 casos legados ----------
  // L4 — caso simples pela ficha (botão "Vincular a esta pessoa" da pendência)
  await openProfile(hr, STATE.L4.person);
  await hr.clickTestId(`person-relink-open-app_user-${STATE.L4.user}`);
  await hr.waitTestId("person-relink-preview", 20000);
  await hr.type('[role="dialog"] textarea', "E2E L4: conta do colaborador sem Pessoa, e-mails iguais");
  await hr.clickTestId("person-relink-confirm");
  await hr.waitFor(`/Vinculado/.test(document.querySelector('[data-testid="person-card-appUser"]')?.innerText ?? "")`, { timeout: 20000, label: "L4 vinculado" });
  const l4 = await userById(hr, STATE.L4.user);
  const l4sessions = (await must(hr, "GET", `/api/people/${STATE.L4.person}`)).events.length;
  step("16.08 L4 caso simples: personId copiado; role SELLER, permissões e colaborador intactos", (await linkedUserOf(hr, STATE.L4.person)) === STATE.L4.user && l4.role === "SELLER" && l4.employeeId === STATE.L4.employee, `${l4.role} eventos=${l4sessions}`);

  // L3 — e-mails divergentes: regularizar exige confirmação
  await openProfile(hr, STATE.L3.person);
  const l3Preview = await must(hr, "POST", `/api/people/${STATE.L3.person}/access/attach/preview`, { appUserId: STATE.L3.user });
  const l3Denied = await api(hr, "POST", `/api/people/${STATE.L3.person}/access/attach`, { appUserId: STATE.L3.user, expected: l3Preview.expected, confirmEmailMismatch: false, reason: "E2E L3 sem confirmar" });
  await hr.clickTestId("person-attach-account-open");
  await hr.waitTestId("person-attach-dialog", 15000);
  await hr.type('[data-testid="attach-search"]', "legado.email");
  await hr.waitFor(`document.querySelector('[data-testid="attach-pick-${STATE.L3.user}"]')`, { timeout: 15000, label: "L3 candidato" });
  await hr.clickTestId(`attach-pick-${STATE.L3.user}`);
  await hr.waitTestId("attach-preview", 20000);
  await hr.clickTestId("attach-confirm-mismatch");
  await typeReason(hr, "attach-reason", "E2E L3: colaborador vinculado comprova a identidade; login pessoal preservado");
  await hr.shot("16-04-l3-previa-email-divergente");
  await hr.clickTestId("attach-confirm");
  await hr.waitFor(`!document.querySelector('[data-testid="person-attach-dialog"]')`, { timeout: 20000, label: "L3 confirmado" });
  const l3 = await userById(hr, STATE.L3.user);
  step("16.09 L3 e-mails divergentes: sem confirmação → 409; com confirmação explícita vincula e o login não muda", l3Preview.emailMismatch === true && l3Denied.status === 409 && l3Denied.body?.code === "EMAIL_MISMATCH_CONFIRMATION_REQUIRED" && (await linkedUserOf(hr, STATE.L3.person)) === STATE.L3.user && l3.email === "legado.email@induscost.test", `${l3Denied.status} ${l3Denied.body?.code}`);

  // L1 — SUPER_ADMIN sem vínculos: regularizar pela ficha com step-up
  await openProfile(hr, STATE.L1.person);
  await hr.clickTestId("person-attach-account-open");
  await hr.waitTestId("person-attach-dialog", 15000);
  await hr.type('[data-testid="attach-search"]', "legado.superadmin");
  await hr.waitFor(`document.querySelector('[data-testid="attach-pick-${STATE.L1.user}"]')`, { timeout: 15000, label: "L1 candidato" });
  await hr.clickTestId(`attach-pick-${STATE.L1.user}`);
  await hr.waitTestId("attach-preview", 20000);
  await typeReason(hr, "attach-reason", "E2E L1: caso real do super admin — conta sem colaborador e sem Pessoa");
  await hr.shot("16-05-l1-previa-super-admin");
  await hr.clickTestId("attach-confirm");
  await stepUp(hr);
  await hr.waitFor(`!document.querySelector('[data-testid="person-attach-dialog"]')`, { timeout: 30000, label: "L1 confirmado após step-up" });
  const l1 = await userById(hr, STATE.L1.user);
  const l1events = (await profile(hr, STATE.L1.person)).events;
  await hr.fullShot("16-06-l1-regularizado");
  step("16.10 L1 SUPER_ADMIN sem vínculos: após step-up, personId + employeeId gravados; papel SUPER_ADMIN preservado; evento com autor", (await linkedUserOf(hr, STATE.L1.person)) === STATE.L1.user && l1.employeeId === STATE.L1.employee && l1.role === "SUPER_ADMIN" && l1events.some((e) => e.entityKind === "app_user" && e.actorName), `${l1.role} emp=${String(l1.employeeId).slice(0, 8)}`);

  // L2 — Pessoa INACTIVE: recusa, reativar, regularizar
  const l2Try = await api(hr, "POST", `/api/people/${STATE.L2.person}/access/attach`, { appUserId: STATE.L2.user, expected: {}, confirmEmailMismatch: true, reason: "E2E L2 tentativa com Pessoa inativa" });
  await openProfile(hr, STATE.L2.person);
  const l2Flag = await hr.eval(`Boolean(document.querySelector('[data-testid="person-inactive-conflict"]'))`);
  await hr.shot("16-07-l2-pessoa-inativa");
  await hr.clickTestId("person-reactivate-open");
  await typeReason(hr, "person-status-reason", "E2E L2: identidade inativada por erro no legado; colaborador segue ativo");
  await hr.clickTestId("person-status-confirm");
  await hr.waitFor(`document.querySelector('[data-testid="person-inactivate-open"]')`, { timeout: 20000, label: "L2 reativada" });
  await hr.clickTestId(`person-relink-open-app_user-${STATE.L2.user}`);
  await hr.waitTestId("person-relink-preview", 20000);
  await hr.type('[role="dialog"] textarea', "E2E L2: regularizar após reativar a Pessoa");
  await hr.clickTestId("person-relink-confirm");
  await hr.waitFor(`/Vinculado/.test(document.querySelector('[data-testid="person-card-appUser"]')?.innerText ?? "")`, { timeout: 20000, label: "L2 vinculado" });
  const l2 = await userById(hr, STATE.L2.user);
  const l2p = await profile(hr, STATE.L2.person);
  step("16.11 L2 Pessoa inativa: 409 TARGET_INACTIVE; aviso na ficha; reativação auditada; depois regulariza", l2Try.status === 409 && l2Try.body?.code === "TARGET_INACTIVE" && l2Flag && l2p.person.status === "ACTIVE" && l2p.events.some((e) => e.eventKind === "PERSON_REACTIVATED") && (await linkedUserOf(hr, STATE.L2.person)) === STATE.L2.user && Boolean(l2), `${l2Try.status} ${l2Try.body?.code} flag=${l2Flag}`);

  // L5 — colaborador sem Pessoa: Pessoa nova + regularização preenche o colaborador
  const l5Person = await must(hr, "POST", "/api/people", { displayName: `[E2E] Maria SemPessoa ${RUN}`, cpf: cpfFrom((`8${RUN}` + "11").slice(0, 9)), corporateEmail: `legado.semperson.${RUN}@induscost.test` });
  const l5 = await must(hr, "POST", `/api/people/${l5Person.id}/access/attach`, { appUserId: STATE.L5.user, employeeId: STATE.L5.employee, expected: { personId: null, employeeId: STATE.L5.employee }, confirmEmailMismatch: true, reason: "E2E L5: criar Pessoa e ligar conta + colaborador" });
  const l5u = await userById(hr, STATE.L5.user);
  const l5p = await profile(hr, l5Person.id);
  step("16.12 L5 colaborador sem Pessoa: Pessoa criada pela ficha, conta e colaborador ligados na mesma transação (evento do colaborador)", Boolean(l5.employeeEventId) && (await linkedUserOf(hr, l5Person.id)) === STATE.L5.user && Boolean(l5u) && l5p.linkStates.employee === "LINKED" && l5p.linkStates.appUser === "LINKED", `${String(l5.employeeEventId).slice(0, 8)}`);

  // L6 — Pessoa já ocupada
  const l6 = await api(hr, "POST", `/api/people/${STATE.L6.person}/access/attach`, { appUserId: STATE.L6.user, expected: {}, confirmEmailMismatch: true, reason: "E2E L6 conflito" });
  const l6u = await userById(hr, STATE.L6.user);
  const holder = await userById(hr, STATE.L6.holder);
  step("16.13 L6 Pessoa já com outra conta: 409 TARGET_HAS_USER, nada muda (dono preservado)", l6.status === 409 && l6.body?.code === "TARGET_HAS_USER" && (await linkedUserOf(hr, STATE.L6.person)) === STATE.L6.holder && Boolean(l6u) && Boolean(holder), `${l6.status} ${l6.body?.code}`);

  // L7 — CPF duplicado entre Pessoas: ficha mostra a duplicidade; regularizar pelo colaborador continua explícito
  await openProfile(hr, STATE.L7.person);
  const l7dup = await hr.eval(`document.querySelector('[data-testid="person-duplicates"]')?.innerText ?? ""`);
  const l7driver = await must(hr, "GET", `/api/people/${STATE.L7.person}/driver/preview`);
  await hr.shot("16-08-l7-duplicidade");
  step("16.14 L7 CPF repetido: ficha sinaliza duplicidade; habilitar motorista fica BLOQUEADO (DUPLICATE_PERSON_CPF) até unificar", /mesmo CPF/i.test(l7dup) && l7driver.plan.action === "BLOCKED" && l7driver.plan.blockers.some((b) => b.code === "DUPLICATE_PERSON_CPF"), `${l7driver.plan.action}`);

  // ---------- J5: matriz de autorização das rotas novas ----------
  const matrix = [];
  const probe = async (page, label) => {
    const r = {
      label,
      createPerson: (await api(page, "POST", "/api/people", { displayName: `[E2E] probe ${label} ${RUN}` })).status,
      editPerson: (await api(page, "PATCH", `/api/people/${newId}`, { socialName: "probe" })).status,
      status: (await api(page, "POST", `/api/people/${newId}/status`, { status: "INACTIVE", reason: "probe" })).status,
      access: (await api(page, "POST", `/api/people/${STATE.L7.person}/access`, { password: `Probe#${RUN}xx`, email: `probe.${label.replace(/\W+/g, "")}.${RUN}@induscost.test` })).status,
      attachPreview: (await api(page, "POST", `/api/people/${STATE.L7.person}/access/attach/preview`, { appUserId: STATE.L7.user })).status,
      driverPreview: (await api(page, "GET", `/api/people/${STATE.L7.person}/driver/preview`)).status,
    };
    matrix.push(r);
    return r;
  };
  const saRow = await probe(hr, "SUPER_ADMIN");
  for (const [email, label] of [["rh.gestor@induscost.test", "RH gestor (perfil Desempenho)"], ["lider.teste@induscost.test", "comum"]]) {
    const c = await browser.newContext();
    const p = await browser.newPage(c, { width: 1200, height: 800 });
    await login(p, email);
    await probe(p, label);
    await p.close();
  }
  console.log("matriz:", JSON.stringify(matrix));
  const others = matrix.filter((m) => m.label !== "SUPER_ADMIN");
  step("16.15 J5 SUPER_ADMIN: cria (201), edita (200), inativar com vínculos ativos recusa (409), habilitar acesso para Pessoa cujo colaborador já tem conta recusa (409 EMPLOYEE_ALREADY_LINKED), prévias 200", saRow.createPerson === 201 && saRow.editPerson === 200 && saRow.status === 409 && saRow.access === 409 && saRow.attachPreview === 200 && saRow.driverPreview === 200, JSON.stringify(saRow));
  step("16.16 J5 perfis sem permissão: 403 em todas as rotas novas (nunca 500)", others.every((m) => [m.createPerson, m.editPerson, m.status, m.access, m.attachPreview, m.driverPreview].every((s) => s === 403)), JSON.stringify(others));

  // ---------- J6: invariância de Comissões/Nomus ----------
  const sellerBefore = await userById(hr, STATE.seller.user);
  const cpBefore = (await must(hr, "GET", `/api/commissions/persons?page=1&pageSize=5&search=VENDEDOR%20LEGADO`)).items?.find?.((c) => c.id === STATE.seller.commissionPerson) ?? null;
  await must(hr, "POST", `/api/people/${STATE.seller.person}/access/attach`, { appUserId: STATE.seller.user, expected: { personId: null, employeeId: sellerBefore.employeeId }, confirmEmailMismatch: true, reason: "E2E J6: regularizar vendedor" });
  await must(hr, "PATCH", `/api/people/${STATE.seller.person}`, { displayName: `[LEGADO] Vendedor Legado Renomeado ${RUN}`, reason: "E2E J6: editar Pessoa do vendedor" });
  const sellerAfter = await userById(hr, STATE.seller.user);
  const cpAfter = (await must(hr, "GET", `/api/commissions/persons?page=1&pageSize=5&search=VENDEDOR%20LEGADO`)).items?.find?.((c) => c.id === STATE.seller.commissionPerson) ?? null;
  const pick = (u) => JSON.stringify({ externalSellerId: u.externalSellerId, externalSellerIds: u.externalSellerIds, sellerResponsibleName: u.sellerResponsibleName, role: u.role, permissions: u.permissions });
  const pickCp = (c) => (c ? JSON.stringify({ name: c.name, type: c.type, source: c.source, nomusPersonId: c.nomusPersonId, active: c.active }) : null);
  step("16.17 J6 Comissões/Nomus intactos após regularizar e renomear a Pessoa: externalSellerId(s), sellerResponsibleName, papel, CommissionPerson (nome, nomusPersonId, ativo)", (await linkedUserOf(hr, STATE.seller.person)) === STATE.seller.user && pick(sellerBefore) === pick(sellerAfter) && pickCp(cpBefore) === pickCp(cpAfter) && cpAfter?.personId === STATE.seller.person, `${pick(sellerAfter)}`);

  // ---------- J7: depois — contas dos casos resolvidos têm Pessoa ----------
  const pairs = [[STATE.L1.person, STATE.L1.user], [STATE.L2.person, STATE.L2.user], [STATE.L3.person, STATE.L3.user], [STATE.L4.person, STATE.L4.user], [l5Person.id, STATE.L5.user], [STATE.seller.person, STATE.seller.user]];
  let withPerson = 0;
  for (const [pid, uid] of pairs) if ((await linkedUserOf(hr, pid)) === uid) withPerson += 1;
  const l6Linked = (await linkedUserOf(hr, STATE.L6.person)) === STATE.L6.holder;
  const l7Linked = await linkedUserOf(hr, STATE.L7.person);
  step("16.18 J7 ANTES×DEPOIS: 6 contas legadas regularizadas apontam para a Pessoa certa; L6 (ocupada) e L7 (CPF repetido) ficam como pendência explícita", withPerson === 6 && l6Linked && l7Linked === null, `${withPerson}/6`);
} catch (error) {
  step("16.ERR exceção na jornada", false, String(error?.stack ?? error).slice(0, 600));
  try { await globalThis.__hr?.shot("16-ERR"); } catch { /* ignore */ }
} finally {
  writeResults("part16-people-master");
  await browser.close();
}
