/**
 * Glossário de uma linha para os termos do módulo. O termo aparece sublinhado com pontilhado e a
 * explicação no toque ou no passar do mouse. Para quem não é do RH (líder, operador).
 */
import React from "react";

export const GLOSSARY = {
  calibrar: ["Calibrar", "Conferir a nota preliminar com fatos e, se for o caso, ajustar com justificativa. Nada muda sem motivo registrado."],
  homologar: ["Tornar oficial", "Depois de todos calibrados, o resultado vira oficial e congela. Só uma revisão formal reabre."],
  consolidacao: ["Fechar a coleta", "Encerra o prazo das respostas. A partir daqui o sistema calcula o resultado preliminar."],
  elegibilidade: ["Elegibilidade", "Quem responde neste ciclo: vínculo ativo e período mínimo do ciclo cumprido. Mudança de cargo, setor ou liderança vira observação do RH e não tira o questionário."],
  ascendente: ["Avaliação do seu líder", "A equipe avalia como a pessoa lidera. Só a média aparece, e só com 5 ou mais respostas."],
  evidencia: ["Evidência da resposta", "Nota extrema do líder pede um relato curto. Sem respostas válidas o bastante, o resultado não é homologado. Não é nota baixa."],
  ninebox: ["Nine-Box", "Quadro de nove posições que cruza desempenho técnico com potencial. A cultura fica fora dele."],
  devolutiva: ["Devolutiva", "A conversa do líder com a pessoa sobre o resultado, registrada no sistema e com ciência dela."],
  pdi: ["PDI", "Plano de desenvolvimento individual: ações ligadas a competências, com prazo e acompanhamento."],
  topo: ["Topo da estrutura", "Pessoa sem superior no organograma. Faz as autoavaliações e é avaliada pela equipe. Não avalia um superior inexistente."],
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

export function Term({ k, children, className }: { k: GlossaryKey; children?: React.ReactNode; className?: string }) {
  const [label, text] = GLOSSARY[k];
  return (
    <abbr title={text} className={`cursor-help underline decoration-dotted underline-offset-2 ${className ?? ""}`} data-testid={`perf-term-${k}`}>
      {children ?? label}
    </abbr>
  );
}

export function GlossaryList({ keys }: { keys: GlossaryKey[] }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-2" data-testid="perf-glossary">
      {keys.map((k) => (
        <div key={k} className="rounded-lg border border-border bg-card p-3">
          <dt className="font-semibold">{GLOSSARY[k][0]}</dt>
          <dd className="text-xs text-muted-foreground">{GLOSSARY[k][1]}</dd>
        </div>
      ))}
    </dl>
  );
}
