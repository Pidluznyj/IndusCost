import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  TEST_USER_NAME,
  createFakeDb,
  requestJson,
  seedEmployee,
  startCompetencyTestApp,
  type CompetencyTestApp,
} from "./competencyTestSupport";
import { hashCertificatePayload } from "./trainingCertificate.server";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";
const SETTINGS = { signerName: "Diretor Exemplo", signerRole: "Diretor Executivo", issuePlace: "Curitiba – PR", numberPrefix: "lk-tr" };

type Scenario = { trainingId: string; ana: string; bruno: string; carla: string; competencyId: string };

async function seed(app: CompetencyTestApp, opts: { complete?: boolean; syllabus?: unknown; instructorName?: string | null } = {}): Promise<Scenario> {
  const db = app.db;
  db.tables.brandingSettings.push({
    id: "b1",
    companyName: "Lazarios Koppetel",
    slogan: "Soluções e qualidade em plásticos",
    website: "https://lazarios.com.br",
    proposalLogoDataUrl: LOGO,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  const ana = seedEmployee(db, "Ana Ribeiro");
  const bruno = seedEmployee(db, "Bruno Costa");
  const carla = seedEmployee(db, "Carla Mendes");
  const competencyId = (
    await requestJson(app, "POST", "/api/hr/competencies/catalog", {
      name: "Interpretação de desenho mecânico",
      category: "TECHNICAL",
      description: "Lê vistas, cotas e tolerâncias.",
    })
  ).json.id as string;
  const created = await requestJson(app, "POST", "/api/hr/competencies/trainings", {
    title: "Desenho mecânico aplicado",
    competencyId,
    modality: "IN_PERSON",
    workloadHours: 8,
    startDate: "2026-10-05",
    validityMonths: 12,
    participantIds: [carla, ana, bruno],
    ...(opts.syllabus !== undefined ? { syllabus: opts.syllabus } : {}),
    ...(opts.instructorName !== undefined ? { instructorName: opts.instructorName } : {}),
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const trainingId = created.json.id as string;
  if (opts.complete !== false) {
    const done = await requestJson(app, "PATCH", `/api/hr/competencies/trainings/${trainingId}/status`, {
      status: "COMPLETED",
      completedOn: "2026-10-10",
    });
    assert.equal(done.status, 200);
  }
  return { trainingId, ana, bruno, carla, competencyId };
}

describe("certificados de treinamento — rotas", () => {
  let app: CompetencyTestApp;
  before(async () => {
    app = await startCompetencyTestApp({ db: createFakeDb() });
  });
  after(async () => {
    await app.close();
  });
  beforeEach(() => {
    for (const rows of Object.values(app.db.tables)) rows.length = 0;
    app.setGranted("all");
    app.setScope({ accessScope: "ALL", actorEmployeeId: null });
  });

  it("configuração: começa vazia, valida e grava com autoria da sessão", async () => {
    const empty = await requestJson(app, "GET", "/api/hr/competencies/certificate-settings");
    assert.deepEqual(empty.json, { signerName: null, signerRole: null, issuePlace: null, numberPrefix: null, updatedAt: null, updatedByName: null });
    const bad = await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", { ...SETTINGS, numberPrefix: "LK_TR" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error, "INVALID_PREFIX");
    const saved = await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    assert.equal(saved.status, 200);
    assert.equal(saved.json.numberPrefix, "LK-TR");
    assert.equal(saved.json.updatedByName, TEST_USER_NAME);
    const again = await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", { ...SETTINGS, signerName: "Outro" });
    assert.equal(again.json.signerName, "Outro");
    assert.equal(app.db.tables.hrTrainingCertificateSettings.length, 1);
  });

  it("líder (escopo limitado) não altera o signatário da empresa", async () => {
    const leader = seedEmployee(app.db, "Líder");
    app.setScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: leader });
    const res = await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    assert.equal(res.status, 403);
  });

  it("treinamento não concluído e sem configuração: impedimentos e emissão bloqueada", async () => {
    const s = await seed(app, { complete: false });
    const board = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates`);
    assert.equal(board.status, 200);
    assert.equal(board.json.blockers.length, 2);
    assert.match(board.json.blockers[0], /não foi concluído/);
    assert.match(board.json.blockers[1], /signatário/);
    const issue = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {});
    assert.equal(issue.status, 409);
    assert.equal(issue.json.error, "CERTIFICATE_BLOCKED");
    assert.equal(app.db.tables.hrTrainingCertificate.length, 0);
  });

  it("emite um certificado por participante com os dados do sistema, numeração sequencial e integridade", async () => {
    const s = await seed(app, {
      syllabus: [
        { title: "Vistas e cortes", hours: 4 },
        { title: "Cotas e tolerâncias", hours: 4 },
      ],
      instructorName: "Carlos Instrutor",
    });
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    const issue = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {});
    assert.equal(issue.status, 201, JSON.stringify(issue.json));
    assert.deepEqual(
      issue.json.issued.map((c: any) => [c.number, c.employeeId]),
      [
        ["LK-TR-2026/0001", s.ana],
        ["LK-TR-2026/0002", s.bruno],
        ["LK-TR-2026/0003", s.carla],
      ],
    );
    const doc = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates/document`);
    assert.equal(doc.json.certificates.length, 3);
    const first = doc.json.certificates[0];
    assert.equal(first.integrity.verified, true);
    assert.deepEqual(first.payload, {
      version: 1,
      number: "LK-TR-2026/0001",
      issuedOn: "2026-10-15",
      company: { name: "Lazarios Koppetel", slogan: "Soluções e qualidade em plásticos", website: "https://lazarios.com.br", logoDataUrl: LOGO },
      participant: { employeeId: s.ana, name: "Ana Ribeiro" },
      training: {
        id: s.trainingId,
        title: "Desenho mecânico aplicado",
        competencyName: "Interpretação de desenho mecânico",
        competencyDescription: "Lê vistas, cotas e tolerâncias.",
        modality: "IN_PERSON",
        workloadHours: 8,
        startDate: "2026-10-05",
        completedOn: "2026-10-10",
        instructorName: "Carlos Instrutor",
      },
      syllabus: [
        { title: "Vistas e cortes", hours: 4 },
        { title: "Cotas e tolerâncias", hours: 4 },
      ],
      signer: { name: "Diretor Exemplo", role: "Diretor Executivo" },
      issuePlace: "Curitiba – PR",
    });
    const row = app.db.tables.hrTrainingCertificate[0];
    assert.equal(row.issuedByName, TEST_USER_NAME);
    assert.equal(row.payloadSha256, hashCertificatePayload(row.payload));

    const board = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates`);
    assert.deepEqual(board.json.blockers, []);
    assert.equal(board.json.training.contentLocked, true);
    assert.ok(board.json.participants.every((p: any) => p.certificate));
    const list = await requestJson(app, "GET", "/api/hr/competencies/trainings");
    assert.equal(list.json.trainings[0].activeCertificateCount, 3);
    assert.equal(list.json.trainings[0].instructorName, "Carlos Instrutor");

    // Reemitir não duplica.
    const again = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {});
    assert.equal(again.status, 200);
    assert.equal(again.json.issued.length, 0);
    assert.deepEqual(again.json.skipped.map((x: any) => x.reason), ["ALREADY_ISSUED", "ALREADY_ISSUED", "ALREADY_ISSUED"]);
  });

  it("emissão congelada: mudar cadastro ou identidade visual não altera o certificado; adulteração é detectada", async () => {
    const s = await seed(app);
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, { employeeIds: [s.ana] });
    app.db.tables.employee.find((e) => e.id === s.ana)!.name = "Ana Ribeiro Nova";
    app.db.tables.brandingSettings[0].companyName = "Outra Empresa";
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", { ...SETTINGS, signerName: "Novo Diretor" });
    const doc = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates/document`);
    assert.equal(doc.json.certificates.length, 1);
    assert.equal(doc.json.certificates[0].payload.participant.name, "Ana Ribeiro");
    assert.equal(doc.json.certificates[0].payload.company.name, "Lazarios Koppetel");
    assert.equal(doc.json.certificates[0].payload.signer.name, "Diretor Exemplo");
    assert.equal(doc.json.certificates[0].payload.syllabus.length, 0);
    (app.db.tables.hrTrainingCertificate[0].payload as any).participant.name = "Adulterado";
    const tampered = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates/document`);
    assert.equal(tampered.json.certificates[0].integrity.verified, false);
  });

  it("conteúdo travado com certificado vigente; cancelar libera, reemissão ganha novo número", async () => {
    const s = await seed(app);
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    // Concluído e sem certificado: conteúdo ainda editável (com soma validada).
    const mismatch = await requestJson(app, "PUT", `/api/hr/competencies/trainings/${s.trainingId}/certificate-content`, {
      instructorName: "Carlos",
      syllabus: [{ title: "Único", hours: 6 }],
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.json.error, "SYLLABUS_WORKLOAD_MISMATCH");
    const content = await requestJson(app, "PUT", `/api/hr/competencies/trainings/${s.trainingId}/certificate-content`, {
      instructorName: "Carlos",
      syllabus: [{ title: "Único", hours: 8 }],
    });
    assert.equal(content.status, 200);

    const issued = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, { employeeIds: [s.bruno] });
    assert.equal(issued.json.issued[0].number, "LK-TR-2026/0001");
    const locked = await requestJson(app, "PUT", `/api/hr/competencies/trainings/${s.trainingId}/certificate-content`, {
      instructorName: null,
      syllabus: [],
    });
    assert.equal(locked.status, 409);
    assert.equal(locked.json.error, "CERTIFICATE_CONTENT_LOCKED");

    const certId = issued.json.issued[0].id;
    assert.equal((await requestJson(app, "POST", `/api/hr/competencies/certificates/${certId}/cancel`, { reason: " " })).status, 400);
    const canceled = await requestJson(app, "POST", `/api/hr/competencies/certificates/${certId}/cancel`, { reason: "Nome incorreto no cadastro" });
    assert.equal(canceled.status, 200);
    assert.equal((await requestJson(app, "POST", `/api/hr/competencies/certificates/${certId}/cancel`, { reason: "de novo" })).json.error, "CERTIFICATE_ALREADY_CANCELED");
    const row = app.db.tables.hrTrainingCertificate[0];
    assert.equal(row.status, "CANCELED");
    assert.equal(row.canceledByName, TEST_USER_NAME);

    const board = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates`);
    assert.equal(board.json.training.contentLocked, false);
    assert.deepEqual(board.json.canceled.map((c: any) => [c.number, c.employeeName, c.reason]), [["LK-TR-2026/0001", "Bruno Costa", "Nome incorreto no cadastro"]]);

    const reissued = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, { employeeIds: [s.bruno] });
    assert.equal(reissued.json.issued[0].number, "LK-TR-2026/0002");
    // Documento padrão = só vigentes; por id devolve também o cancelado (com status).
    const doc = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates/document`);
    assert.deepEqual(doc.json.certificates.map((c: any) => c.number), ["LK-TR-2026/0002"]);
    const byId = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates/document?ids=${certId}`);
    assert.equal(byId.json.certificates[0].status, "CANCELED");
  });

  it("numeração reinicia por ano de emissão e ignora participante sem conclusão", async () => {
    const s = await seed(app);
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    app.db.tables.hrTrainingCertificate.push({
      id: "old",
      number: "LK-TR-2026/0041",
      year: 2026,
      sequence: 41,
      trainingId: "outro",
      employeeId: "outro",
      status: "ACTIVE",
      payload: {},
      payloadSha256: "",
    });
    app.db.tables.hrTrainingParticipant.find((p) => p.employeeId === s.carla)!.completedAt = null;
    const res = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {});
    assert.deepEqual(res.json.issued.map((c: any) => c.number), ["LK-TR-2026/0042", "LK-TR-2026/0043"]);
    assert.deepEqual(res.json.skipped, [{ employeeId: s.carla, reason: "NOT_COMPLETED" }]);

    const nextYear = await startCompetencyTestApp({ db: app.db, now: new Date("2027-01-04T12:00:00Z") });
    try {
      app.db.tables.hrTrainingParticipant.find((p) => p.employeeId === s.carla)!.completedAt = new Date("2026-10-10T00:00:00Z");
      const r2 = await requestJson(nextYear, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {});
      assert.deepEqual(r2.json.issued.map((c: any) => c.number), ["LK-TR-2027/0001"]);
    } finally {
      await nextYear.close();
    }
  });

  it("criar treinamento com conteúdo que não fecha a carga horária é rejeitado", async () => {
    const ana = seedEmployee(app.db, "Ana");
    const competencyId = (await requestJson(app, "POST", "/api/hr/competencies/catalog", { name: "C", category: "TECHNICAL" })).json.id;
    const res = await requestJson(app, "POST", "/api/hr/competencies/trainings", {
      title: "T",
      competencyId,
      modality: "ONLINE",
      workloadHours: 8,
      startDate: "2026-10-05",
      validityMonths: 0,
      participantIds: [ana],
      syllabus: [{ title: "A", hours: 2 }],
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "SYLLABUS_WORKLOAD_MISMATCH");
  });

  it("participante fora do treinamento → 400; sem permissão de gestão → 403; flag desligada → 404", async () => {
    const s = await seed(app);
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    const stranger = seedEmployee(app.db, "Fora");
    const bad = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, { employeeIds: [stranger] });
    assert.equal(bad.status, 400);
    app.setGranted(["admin.employees.competencies.trainings:view"]);
    assert.equal((await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {})).status, 403);
    assert.equal((await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates`)).status, 200);
    app.setEnabled(false);
    try {
      assert.equal((await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates`)).status, 404);
    } finally {
      app.setEnabled(true);
    }
  });

  it("líder vê e emite só para a própria equipe", async () => {
    const s = await seed(app);
    await requestJson(app, "PUT", "/api/hr/competencies/certificate-settings", SETTINGS);
    const leader = seedEmployee(app.db, "Líder");
    app.db.tables.employee.find((e) => e.id === s.ana)!.managerId = leader;
    app.setScope({ accessScope: "DIRECT_REPORTS", actorEmployeeId: leader });
    const board = await requestJson(app, "GET", `/api/hr/competencies/trainings/${s.trainingId}/certificates`);
    assert.deepEqual(board.json.participants.map((p: any) => p.employeeName), ["Ana Ribeiro"]);
    assert.equal((await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, { employeeIds: [s.bruno] })).status, 400);
    const res = await requestJson(app, "POST", `/api/hr/competencies/trainings/${s.trainingId}/certificates`, {});
    assert.deepEqual(res.json.issued.map((c: any) => c.employeeId), [s.ana]);
  });
});
