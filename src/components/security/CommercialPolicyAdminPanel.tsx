import React, { useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";

type QuestionDraft = {
  prompt: string;
  options: string;
  correctIndex: number;
  explanation: string;
};

const emptyQuestion = (): QuestionDraft => ({
  prompt: "",
  options: "",
  correctIndex: 0,
  explanation: "",
});

const DEFAULT_DECLARATIONS = [
  "Declaro que li integralmente a Política Comercial desta versão.",
  "Declaro que compreendi suas regras.",
  "Comprometo-me a seguir os procedimentos comerciais definidos pela empresa e registrados no IndusCost.",
  "Reconheço que este aceite será registrado eletronicamente com evidências técnicas.",
];

export const CommercialPolicyAdminPanel: React.FC = () => {
  const [title, setTitle] = useState("Política Comercial");
  const [content, setContent] = useState("");
  const [rules, setRules] = useState("");
  const [declarations, setDeclarations] = useState(DEFAULT_DECLARATIONS.join("\n"));
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<Array<{ id: string; version: number; status: string; title: string; contentHash: string }>>([]);
  const [acceptances, setAcceptances] = useState<Array<{ id: string; userNameSnapshot: string; userEmailSnapshot?: string; acceptedAt: string; evidenceHash: string; policyVersionId?: string }>>([]);
  const [coverage, setCoverage] = useState<{ required: number; signed: number; pending: number; percent: number } | null>(null);
  const [integrity, setIntegrity] = useState<{
    status: string;
    publication: string;
    findings: Array<{ code: string; document: string; system: string }>;
  } | null>(null);

  const reload = () => {
    void fetchJsonOk<{ versions: Array<{ id: string; version: number; status: string; title: string; contentHash: string }> }>(
      "/api/admin/commercial-policy/versions"
    ).then((data) => setRows(data.versions));
    void fetchJsonOk<{
      coverage: { required: number; signed: number; pending: number; percent: number } | null;
      acceptances: Array<{ id: string; userNameSnapshot: string; userEmailSnapshot?: string; acceptedAt: string; evidenceHash: string }>;
    }>("/api/admin/commercial-policy/acceptances").then((data) => {
      setAcceptances(data.acceptances);
      setCoverage(data.coverage);
    });
    void fetchJsonOk<{
      status: string;
      publication: string;
      findings: Array<{ code: string; document: string; system: string }>;
    }>("/api/admin/commercial-policy/integrity").then(setIntegrity);
  };

  useEffect(() => {
    reload();
  }, []);

  const publishOfficial = async () => {
    setMessage(null);
    try {
      const result = await fetchJsonOk<{ alreadyPublished: boolean }>("/api/admin/commercial-policy/official/pol-com-001", {
        method: "POST",
      });
      setMessage(
        result.alreadyPublished
          ? "A POL-COM-001 versão 1.0 já estava publicada. Nenhum texto foi alterado."
          : "POL-COM-001 versão 1.0 publicada a partir do documento oficial. Vendedores sem aceite desta versão serão bloqueados no próximo acesso."
      );
      reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "A publicação foi recusada.");
    }
  };

  const publish = async () => {
    setMessage(null);
    const summaryRules = rules.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const declarationLines = declarations.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const payloadQuestions = questions.map((question, index) => {
      const options = question.options.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return {
        id: `q${index + 1}`,
        prompt: question.prompt.trim(),
        explanation: question.explanation.trim(),
        correctOptionId: `q${index + 1}o${question.correctIndex + 1}`,
        options: options.map((text, optionIndex) => ({ id: `q${index + 1}o${optionIndex + 1}`, text })),
      };
    });
    const created = await fetchJsonOk<{ version: { id: string } }>("/api/admin/commercial-policy/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        content,
        summaryRules,
        declarations: declarationLines,
        questions: payloadQuestions,
      }),
    });
    await fetchJsonOk(`/api/admin/commercial-policy/versions/${created.version.id}/publish`, { method: "POST" });
    setMessage("Versão publicada. Vendedores que ainda não aceitaram esta versão serão bloqueados no próximo acesso.");
    reload();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-bold">Políticas e aceites</h2>
        <p className="text-xs text-muted-foreground">
          A publicação oficial usa o texto integral da POL-COM-001. Uma versão publicada não é editada: correção vira nova versão.
        </p>
        <button type="button" className="mt-3 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" onClick={() => void publishOfficial()}>
          Publicar POL-COM-001 versão 1.0
        </button>
      </div>
      <section className="rounded-lg border border-border p-3">
        <h3 className="text-xs font-bold">Integridade normativa</h3>
        <p className="mt-1 text-xs">Situação: {integrity?.status ?? "carregando"}</p>
        <p className="text-xs">Publicação da V1.0: {integrity?.publication ?? "—"}</p>
        {integrity?.findings?.length ? (
          <ul className="mt-2 space-y-2">
            {integrity.findings.map((finding) => (
              <li key={finding.code} className="text-xs">
                <span className="font-semibold">{finding.code}</span>
                <span className="block">Documento: {finding.document}</span>
                <span className="block">Sistema: {finding.system}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      {coverage ? (
        <div className="grid gap-2 sm:grid-cols-4">
          <p className="rounded-lg border border-border p-3 text-xs">Obrigados: {coverage.required}</p>
          <p className="rounded-lg border border-border p-3 text-xs">Assinados: {coverage.signed}</p>
          <p className="rounded-lg border border-border p-3 text-xs">Pendentes: {coverage.pending}</p>
          <p className="rounded-lg border border-border p-3 text-xs">Aceite: {coverage.percent}%</p>
        </div>
      ) : null}
      {message ? <p className="text-xs text-emerald-800">{message}</p> : null}
      <label className="block space-y-1 text-xs">
        Título
        <input value={title} onChange={(event) => setTitle(event.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-xs">
        Texto oficial
        <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={8} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-xs">
        Principais regras (uma por linha)
        <textarea value={rules} onChange={(event) => setRules(event.target.value)} rows={4} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      <label className="block space-y-1 text-xs">
        Declarações (uma por linha)
        <textarea value={declarations} onChange={(event) => setDeclarations(event.target.value)} rows={4} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
      </label>
      {questions.map((question, index) => (
        <div key={index} className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold">Pergunta {index + 1}</p>
          <input value={question.prompt} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, prompt: event.target.value } : item))} placeholder="Enunciado" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
          <textarea value={question.options} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, options: event.target.value } : item))} placeholder="Opções, uma por linha" rows={3} className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
          <input type="number" min={1} value={question.correctIndex + 1} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, correctIndex: Math.max(0, Number(event.target.value) - 1) } : item))} className="w-24 rounded-lg border border-border px-3 py-2 text-sm" />
          <input value={question.explanation} onChange={(event) => setQuestions((current) => current.map((item, i) => i === index ? { ...item, explanation: event.target.value } : item))} placeholder="Explicação se errar" className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold" onClick={() => setQuestions((current) => [...current, emptyQuestion()])}>
          Adicionar pergunta
        </button>
        <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" onClick={() => void publish().catch((err: unknown) => setMessage(err instanceof Error ? err.message : "Falha ao publicar."))}>
          Publicar nova versão
        </button>
      </div>
      <div>
        <h3 className="text-xs font-bold">Versões</h3>
        <ul className="mt-2 space-y-1 text-xs">
          {rows.map((row) => (
            <li key={row.id}>v{row.version} · {row.status} · {row.title} · {row.contentHash.slice(0, 12)}</li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-bold">Aceites</h3>
        <ul className="mt-2 space-y-1 text-xs">
          {acceptances.map((row) => (
            <li key={row.id}>
              {row.userNameSnapshot}{row.userEmailSnapshot ? ` · ${row.userEmailSnapshot}` : ""} · {new Date(row.acceptedAt).toLocaleString("pt-BR")} · {row.id} · {row.evidenceHash.slice(0, 12)}
              {" "}
              <a className="font-semibold text-primary" href={`/api/commercial-policy/acceptances/${row.id}/receipt`}>comprovante</a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
