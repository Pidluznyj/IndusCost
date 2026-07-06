import React from "react";
import {
  PROJECT_INTAKE_FORM_PENDING_LABEL,
  PROJECT_INTAKE_FORM_TITLE,
  type IntakeChecklistRow,
  type IntakeFieldRow,
  type IntakeSignatureRow,
  type IntakeTableRow,
  type ProjectIntakeFormPayload,
} from "@/src/lib/projectsIntakeForm";

function displayValue(value: string | null | undefined, mode: "blank" | "prefilled"): string {
  if (value?.trim()) return value;
  return mode === "blank" ? "" : PROJECT_INTAKE_FORM_PENDING_LABEL;
}

function FieldGrid({
  fields,
  mode,
}: {
  fields: IntakeFieldRow[];
  mode: "blank" | "prefilled";
}) {
  return (
    <div className="project-intake-form-grid">
      {fields.map((f) => (
        <div
          key={f.key}
          className={f.fullWidth ? "project-intake-form-field project-intake-form-field-full" : "project-intake-form-field"}
        >
          <div className="project-intake-form-label">
            {f.label}
            {f.required ? <span className="project-intake-form-required"> *</span> : null}
          </div>
          <div className="project-intake-form-value">{displayValue(f.value, mode)}</div>
        </div>
      ))}
    </div>
  );
}

function DataTable({
  columns,
  rows,
  mode,
}: {
  columns: Array<{ key: string; label: string; width?: string }>;
  rows: IntakeTableRow[];
  mode: "blank" | "prefilled";
}) {
  return (
    <table className="project-intake-form-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th key={col.key} style={col.width ? { width: col.width } : undefined}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, idx) => (
          <tr key={idx}>
            {columns.map((col) => (
              <td key={col.key}>{displayValue(row[col.key], mode)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChecklistTable({ rows, mode }: { rows: IntakeChecklistRow[]; mode: "blank" | "prefilled" }) {
  return (
    <table className="project-intake-form-table">
      <thead>
        <tr>
          <th>Documento</th>
          <th>Obrigatório?</th>
          <th>Recebido?</th>
          <th>Observação</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            <td>{row.required ? "Sim" : "Não"}</td>
            <td>
              {row.received == null
                ? mode === "blank"
                  ? "☐ Sim ☐ Não"
                  : PROJECT_INTAKE_FORM_PENDING_LABEL
                : row.received
                  ? "Sim"
                  : "Não"}
            </td>
            <td>{displayValue(row.notes, mode)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignatureTable({ rows }: { rows: IntakeSignatureRow[] }) {
  return (
    <table className="project-intake-form-table">
      <thead>
        <tr>
          <th>Área</th>
          <th>Nome</th>
          <th>Assinatura</th>
          <th>Data</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.area}>
            <td>{row.area}</td>
            <td>{row.name ?? ""}</td>
            <td className="project-intake-form-signature-cell">{row.signature ?? ""}</td>
            <td>{row.date ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Props = {
  payload: ProjectIntakeFormPayload;
};

export function ProjectIntakeFormDocument({ payload }: Props) {
  const generatedDate = new Date(payload.generatedAt).toLocaleDateString("pt-BR");
  const mode = payload.mode;

  return (
    <article className="project-intake-form-document">
      <header className="project-intake-form-header project-intake-form-section">
        <div className="project-intake-form-brand">
          <div className="project-intake-form-brand-title">INDUSCOST</div>
          <div className="project-intake-form-brand-subtitle">{PROJECT_INTAKE_FORM_TITLE}</div>
          <div className="project-intake-form-brand-meta">
            {mode === "blank" ? "Formulário em branco para preenchimento manual" : "Formulário preenchido a partir do projeto"}
          </div>
        </div>
        <div className="project-intake-form-header-grid">
          <div>
            <span className="project-intake-form-header-label">Projeto</span>
            <div>{displayValue(payload.header.projectName, mode)}</div>
          </div>
          <div>
            <span className="project-intake-form-header-label">Código</span>
            <div>{displayValue(payload.header.projectCode, mode)}</div>
          </div>
          <div>
            <span className="project-intake-form-header-label">Cliente</span>
            <div>{displayValue(payload.header.customerName, mode)}</div>
          </div>
          <div>
            <span className="project-intake-form-header-label">Tipo</span>
            <div>{displayValue(payload.header.projectTypeLabel, mode)}</div>
          </div>
          <div>
            <span className="project-intake-form-header-label">Data</span>
            <div>{displayValue(payload.header.openedAt, mode)}</div>
          </div>
          <div>
            <span className="project-intake-form-header-label">Responsável</span>
            <div>{displayValue(payload.header.commercialOwner, mode)}</div>
          </div>
          <div>
            <span className="project-intake-form-header-label">Status</span>
            <div>{displayValue(payload.header.statusLabel, mode)}</div>
          </div>
        </div>
      </header>

      {payload.pendingMinimumFields.length > 0 ? (
        <section className="project-intake-form-section project-intake-form-alert">
          <h2 className="project-intake-form-section-title">Dados mínimos pendentes</h2>
          <p className="project-intake-form-help">
            O projeto pode permanecer em <strong>Rascunho</strong>, mas não deve avançar para análise/orçamento
            sem os campos abaixo:
          </p>
          <ul className="project-intake-form-pending-list">
            {payload.pendingMinimumFields.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {payload.sections.map((section) => (
        <section
          key={section.id}
          className={`project-intake-form-section${section.pageBreakBefore ? " page-break-before" : ""}`}
        >
          <h2 className="project-intake-form-section-title">{section.title}</h2>
          <FieldGrid fields={section.fields} mode={mode} />

          {section.id === "materials" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Tabela de materiais e componentes</h3>
              <DataTable
                mode={mode}
                rows={payload.materialsTable}
                columns={[
                  { key: "type", label: "Tipo" },
                  { key: "code", label: "Código" },
                  { key: "description", label: "Descrição" },
                  { key: "quantity", label: "Qtd." },
                  { key: "unit", label: "Un." },
                  { key: "estimatedCost", label: "Custo est." },
                  { key: "supplier", label: "Fornecedor" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "bom" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Estrutura / BOM prevista</h3>
              <DataTable
                mode={mode}
                rows={payload.bomTable}
                columns={[
                  { key: "level", label: "Nível" },
                  { key: "itemType", label: "Tipo" },
                  { key: "code", label: "Código" },
                  { key: "description", label: "Descrição" },
                  { key: "quantity", label: "Qtd." },
                  { key: "unit", label: "Un." },
                  { key: "lossPercent", label: "Perda %" },
                  { key: "unitCost", label: "Custo un." },
                  { key: "origin", label: "Origem" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "process" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Processos / HH</h3>
              <DataTable
                mode={mode}
                rows={payload.processesTable}
                columns={[
                  { key: "process", label: "Processo" },
                  { key: "internalExternal", label: "Interno/Externo" },
                  { key: "machine", label: "Máquina/Setor" },
                  { key: "timeHh", label: "Tempo/HH" },
                  { key: "hourlyRate", label: "Valor hora" },
                  { key: "totalCost", label: "Custo total" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "mold" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Investimentos em molde/ferramenta</h3>
              <DataTable
                mode={mode}
                rows={payload.moldInvestmentsTable}
                columns={[
                  { key: "item", label: "Item" },
                  { key: "description", label: "Descrição" },
                  { key: "internalExternal", label: "Interno/Externo" },
                  { key: "supplier", label: "Fornecedor" },
                  { key: "estimatedCost", label: "Custo est." },
                  { key: "amortizes", label: "Amortiza?" },
                  { key: "amortizationQty", label: "Qtd. amort." },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "additional-costs" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Custos adicionais</h3>
              <DataTable
                mode={mode}
                rows={payload.additionalCostsTable}
                columns={[
                  { key: "category", label: "Categoria" },
                  { key: "description", label: "Descrição" },
                  { key: "estimatedValue", label: "Valor est." },
                  { key: "recurring", label: "Recorrente?" },
                  { key: "amortizes", label: "Amortiza?" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "commercial" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Cenários comerciais</h3>
              <DataTable
                mode={mode}
                rows={payload.scenariosTable}
                columns={[
                  { key: "scenario", label: "Cenário" },
                  { key: "volume", label: "Volume" },
                  { key: "estimatedCost", label: "Custo est." },
                  { key: "margin", label: "Margem" },
                  { key: "suggestedPrice", label: "Preço sugerido" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "schedule" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Cronograma de marcos</h3>
              <DataTable
                mode={mode}
                rows={payload.milestonesTable}
                columns={[
                  { key: "milestone", label: "Marco" },
                  { key: "owner", label: "Responsável" },
                  { key: "plannedDate", label: "Data prevista" },
                  { key: "status", label: "Status" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "quality" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Testes e validações</h3>
              <DataTable
                mode={mode}
                rows={payload.testsTable}
                columns={[
                  { key: "test", label: "Teste/validação" },
                  { key: "required", label: "Obrigatório?" },
                  { key: "owner", label: "Responsável" },
                  { key: "acceptanceCriteria", label: "Critério de aceite" },
                  { key: "notes", label: "Obs." },
                ]}
              />
            </div>
          ) : null}

          {section.id === "documents" ? (
            <div className="project-intake-form-table-wrap">
              <ChecklistTable rows={payload.documentsChecklist} mode={mode} />
            </div>
          ) : null}

          {section.id === "risks" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Riscos e pendências</h3>
              <DataTable
                mode={mode}
                rows={payload.risksTable}
                columns={[
                  { key: "risk", label: "Risco/Pendência" },
                  { key: "ownerArea", label: "Área responsável" },
                  { key: "impact", label: "Impacto" },
                  { key: "resolveBy", label: "Prazo p/ resolver" },
                  { key: "status", label: "Status" },
                ]}
              />
            </div>
          ) : null}

          {section.id === "approval" ? (
            <div className="project-intake-form-table-wrap">
              <h3 className="project-intake-form-subtitle">Assinaturas</h3>
              <SignatureTable rows={payload.signatures} />
            </div>
          ) : null}
        </section>
      ))}

      <footer className="project-intake-form-footer project-intake-form-section">
        <div>
          Documento gerado pelo IndusCost — uso interno
          {payload.generatedBy ? ` · ${payload.generatedBy}` : ""}
        </div>
        <div>
          Emissão: {generatedDate}
          {payload.header.projectCode ? ` · ${payload.header.projectCode}` : ""}
        </div>
      </footer>
    </article>
  );
}
