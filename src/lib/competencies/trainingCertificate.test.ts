import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCertificateNumber,
  formatHoursLong,
  formatHoursShort,
  formatLongDatePtBr,
  parseCertificateSettingsBody,
  parseInstructorName,
  parseSyllabus,
  renderTrainingCertificatesHtml,
  syllabusMatchesWorkload,
  trainingCertificateBlockers,
  websiteLabel,
  type TrainingCertificatePayload,
} from "./trainingCertificate";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

function payload(over: Partial<TrainingCertificatePayload> = {}): TrainingCertificatePayload {
  return {
    version: 1,
    number: "LK-TR-2026/0001",
    issuedOn: "2026-10-16",
    company: { name: "Lazarios Koppetel", slogan: "Soluções e qualidade em plásticos", website: "https://lazarios.com.br/", logoDataUrl: LOGO },
    participant: { employeeId: "e1", name: "Mariana Alves de Souza" },
    training: {
      id: "t1",
      title: "Interpretação de desenho mecânico",
      competencyName: "Leitura de desenho técnico",
      competencyDescription: "Lê cotas e tolerâncias.",
      modality: "IN_PERSON",
      workloadHours: 8,
      startDate: "2026-10-16",
      completedOn: "2026-10-10",
      instructorName: null,
    },
    syllabus: [],
    signer: { name: "Diretor Exemplo", role: "Diretor Executivo" },
    issuePlace: "Curitiba – PR",
    ...over,
  };
}

describe("conteúdo programático", () => {
  it("aceita horas em passos de 0,5 h (número ou texto com vírgula)", () => {
    const r = parseSyllabus([
      { title: "  Fundamentos  ", hours: 3 },
      { title: "Prática", hours: "1,5" },
      { title: "Avaliação", hours: 0.5 },
    ]);
    assert.ok(r.ok);
    assert.deepEqual(r.value, [
      { title: "Fundamentos", hours: 3 },
      { title: "Prática", hours: 1.5 },
      { title: "Avaliação", hours: 0.5 },
    ]);
    assert.equal(syllabusMatchesWorkload(r.value, 5), true);
    assert.equal(syllabusMatchesWorkload(r.value, 6), false);
  });

  it("rejeita título vazio, zero horas, frações fora de 0,5 h e excesso de módulos", () => {
    assert.equal(parseSyllabus([{ title: "", hours: 1 }]).ok, false);
    assert.equal(parseSyllabus([{ title: "A", hours: 0 }]).ok, false);
    assert.equal(parseSyllabus([{ title: "A", hours: 0.3 }]).ok, false);
    assert.equal(parseSyllabus("x").ok, false);
    assert.equal(parseSyllabus(Array.from({ length: 13 }, (_, i) => ({ title: `M${i}`, hours: 1 }))).ok, false);
  });

  it("sem módulos não exige soma (o certificado mostra a competência)", () => {
    const r = parseSyllabus(null);
    assert.ok(r.ok);
    assert.deepEqual(r.value, []);
    assert.equal(syllabusMatchesWorkload([], 8), true);
  });

  it("instrutor é opcional e limitado", () => {
    assert.deepEqual(parseInstructorName("  "), { ok: true, value: null });
    assert.deepEqual(parseInstructorName(" Ana  Paula "), { ok: true, value: "Ana Paula" });
    assert.equal(parseInstructorName("x".repeat(121)).ok, false);
  });
});

describe("configuração dos certificados", () => {
  it("exige signatário, cargo, local e prefixo; prefixo vira maiúsculo", () => {
    const ok = parseCertificateSettingsBody({ signerName: "Diretor", signerRole: "Diretor Executivo", issuePlace: "Curitiba – PR", numberPrefix: "lk-tr" });
    assert.ok(ok.ok);
    assert.equal(ok.value.numberPrefix, "LK-TR");
    for (const bad of [
      { signerRole: "x", issuePlace: "x", numberPrefix: "LK" },
      { signerName: "x", issuePlace: "x", numberPrefix: "LK" },
      { signerName: "x", signerRole: "x", numberPrefix: "LK" },
      { signerName: "x", signerRole: "x", issuePlace: "x", numberPrefix: "LK_TR" },
      { signerName: "x", signerRole: "x", issuePlace: "x", numberPrefix: "-LK" },
      { signerName: "x", signerRole: "x", issuePlace: "x", numberPrefix: "" },
    ]) {
      assert.equal(parseCertificateSettingsBody(bad).ok, false, JSON.stringify(bad));
    }
  });
});

describe("formatação", () => {
  it("numera, escreve datas por extenso e horas", () => {
    assert.equal(formatCertificateNumber("LK-TR", 2026, 147), "LK-TR-2026/0147");
    assert.equal(formatLongDatePtBr("2026-10-10"), "10 de outubro de 2026");
    assert.equal(formatLongDatePtBr("2026-03-01"), "1 de março de 2026");
    assert.equal(formatHoursShort(16), "16h");
    assert.equal(formatHoursShort(1.5), "1,5h");
    assert.equal(formatHoursLong(16), "16 horas");
    assert.equal(formatHoursLong(1), "1 hora");
    assert.equal(websiteLabel("https://lazarios.com.br/"), "lazarios.com.br");
    assert.equal(websiteLabel("  "), null);
  });
});

describe("impedimentos de emissão", () => {
  const settings = { signerName: "D", signerRole: "R", issuePlace: "P", numberPrefix: "LK" };
  it("sem impedimentos quando concluído, configurado e com empresa", () => {
    assert.deepEqual(
      trainingCertificateBlockers({ training: { status: "COMPLETED", workloadHours: 8, syllabus: [] }, settings, companyName: "Empresa" }),
      [],
    );
  });
  it("lista cada impedimento", () => {
    const out = trainingCertificateBlockers({
      training: { status: "IN_PROGRESS", workloadHours: 8, syllabus: [{ title: "A", hours: 3 }] },
      settings: null,
      companyName: null,
    });
    assert.equal(out.length, 4);
    assert.match(out[0], /não foi concluído/);
    assert.match(out[1], /3h.*8h/);
    assert.match(out[2], /signatário/);
    assert.match(out[3], /Identidade Visual/);
    assert.match(
      trainingCertificateBlockers({ training: { status: "COMPLETED", workloadHours: 0, syllabus: [] }, settings, companyName: "E" })[0],
      /carga horária/,
    );
  });
});

describe("HTML do certificado", () => {
  it("traz os dados do sistema e escapa o conteúdo", () => {
    const html = renderTrainingCertificatesHtml(
      [payload({ participant: { employeeId: "e1", name: "Ana <script>alert(1)</script>" } })],
      { title: "Certificados" },
    );
    assert.ok(!html.includes("<script>alert"));
    assert.ok(html.includes("Ana &lt;script&gt;"));
    for (const text of [
      "LK-TR-2026/0001",
      "Interpretação de desenho mecânico",
      "8 horas",
      "10 de outubro de 2026",
      "Diretor Exemplo",
      "Diretor Executivo",
      "A Lazarios Koppetel certifica que",
      "LAZARIOS KOPPETEL ◆ DESENVOLVIMENTO DE PESSOAS ◆",
      "Soluções e qualidade em plásticos",
      "lazarios.com.br",
      "Curitiba – PR, 16 de outubro de 2026",
      "Local e data",
      "Competência desenvolvida",
      "Leitura de desenho técnico",
      "Lê cotas e tolerâncias.",
      `src="${LOGO}"`,
    ]) {
      assert.ok(html.includes(text), text);
    }
    assert.ok(html.includes("size: A4 landscape"));
  });

  it("com instrutor: 2ª assinatura do instrutor e local/data no rodapé; com módulos: conteúdo programático", () => {
    const html = renderTrainingCertificatesHtml(
      [
        payload({
          training: { ...payload().training, instructorName: "Carlos Instrutor" },
          syllabus: [
            { title: "Vistas e cortes", hours: 4 },
            { title: "Tolerâncias", hours: 4 },
          ],
        }),
      ],
      { title: "x" },
    );
    assert.ok(html.includes("Carlos Instrutor"));
    assert.ok(html.includes("Instrutor responsável"));
    assert.ok(html.includes("Curitiba – PR · 16 de outubro de 2026"));
    assert.ok(!html.includes("Local e data"));
    assert.ok(html.includes("Conteúdo programático"));
    assert.ok(html.includes("Vistas e cortes") && html.includes("Tolerâncias"));
    assert.ok(!html.includes("Competência desenvolvida"));
  });

  it("uma página por certificado, com id de selo exclusivo; logo externo nunca entra", () => {
    const html = renderTrainingCertificatesHtml(
      [payload(), payload({ number: "LK-TR-2026/0002", company: { ...payload().company, logoDataUrl: "https://evil.example/x.png" } })],
      { title: "x" },
    );
    assert.equal(html.match(/<section class="page"/g)?.length, 2);
    assert.ok(html.includes('id="sealRing-1"') && html.includes('id="sealRing-2"'));
    assert.ok(!html.includes("evil.example"));
    assert.equal(html.match(/<img /g)?.length, 1);
  });
});
