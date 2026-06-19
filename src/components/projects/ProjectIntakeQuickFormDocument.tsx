import React from "react";
import {
  PROJECT_INTAKE_QUICK_FORM_TITLE,
  PROJECT_INTAKE_QUICK_PENDING_LABEL,
  PROJECT_INTAKE_QUICK_PRIORITIES,
  type ProjectIntakeQuickFormPayload,
  type QuickChecklistItem,
} from "@/src/lib/projectsIntakeQuickForm";

function displayValue(value: string | null | undefined, mode: "blank" | "prefilled"): string {
  if (value?.trim()) return value;
  return mode === "blank" ? "" : PROJECT_INTAKE_QUICK_PENDING_LABEL;
}

function CheckBox({ checked, label }: { checked: boolean; label: string }) {
  return (
    <span className="project-intake-quick-checkbox">
      <span className="project-intake-quick-checkbox-box" aria-hidden>
        {checked ? "X" : ""}
      </span>
      <span>{label}</span>
    </span>
  );
}

function ChecklistGrid({ items }: { items: QuickChecklistItem[] }) {
  return (
    <div className="project-intake-quick-checklist">
      {items.map((item) => (
        <div key={item.label} className="project-intake-quick-checklist-item">
          <CheckBox checked={item.checked} label={item.label} />
          {item.label === "Outro" ? (
            <span className="project-intake-quick-inline-line">{item.otherText ?? ""}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function FieldLine({ label, value, mode }: { label: string; value: string | null; mode: "blank" | "prefilled" }) {
  return (
    <div className="project-intake-quick-field">
      <span className="project-intake-quick-field-label">{label}:</span>
      <span className="project-intake-quick-field-value">{displayValue(value, mode)}</span>
    </div>
  );
}

type Props = {
  payload: ProjectIntakeQuickFormPayload;
};

export function ProjectIntakeQuickFormDocument({ payload }: Props) {
  const { mode, header } = payload;

  return (
    <article className="project-intake-form-document project-intake-quick-form-document">
      <header className="project-intake-form-header project-intake-quick-header">
        <div className="project-intake-form-brand">
          <div className="project-intake-form-brand-title">INDUSCOST</div>
          <div className="project-intake-form-brand-subtitle">{PROJECT_INTAKE_QUICK_FORM_TITLE}</div>
        </div>
        <div className="project-intake-quick-header-grid">
          <FieldLine label="Projeto" value={header.projectName} mode={mode} />
          <FieldLine label="Cliente" value={header.customerName} mode={mode} />
          <FieldLine label="Data" value={header.date} mode={mode} />
          <FieldLine label="Responsável comercial" value={header.commercialOwner} mode={mode} />
          <FieldLine label="Responsável técnico" value={header.technicalOwner} mode={mode} />
          <FieldLine label="Prazo desejado" value={header.desiredDeadline} mode={mode} />
        </div>
        <div className="project-intake-quick-priority">
          <span className="project-intake-quick-field-label">Prioridade:</span>
          {PROJECT_INTAKE_QUICK_PRIORITIES.map((p) => (
            <span key={p}>
              <CheckBox checked={header.priority === p} label={p} />
            </span>
          ))}
        </div>
      </header>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">1. Tipo de projeto</h2>
        <ChecklistGrid items={payload.projectTypes} />
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">2. Entregáveis esperados</h2>
        <ChecklistGrid items={payload.deliverables} />
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">3. Dados do item/produto</h2>
        <table className="project-intake-form-table project-intake-quick-table">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Informação</th>
            </tr>
          </thead>
          <tbody>
            {payload.productFields.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{displayValue(row.value, mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">4. O que precisa estimar</h2>
        <table className="project-intake-form-table project-intake-quick-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Marcar</th>
              <th className="project-intake-quick-money-col">Valor estimado</th>
            </tr>
          </thead>
          <tbody>
            {payload.estimateItems.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td className="project-intake-quick-mark-col">
                  <span className="project-intake-quick-checkbox-box">{row.checked ? "X" : ""}</span>
                </td>
                <td className="project-intake-quick-money-col">{displayValue(row.estimatedValue, mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">5. Composição preliminar</h2>
        <table className="project-intake-form-table project-intake-quick-table">
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Código</th>
              <th>Descrição</th>
              <th>Qtde</th>
              <th>Unidade</th>
              <th>Custo est.</th>
              <th>Obs.</th>
            </tr>
          </thead>
          <tbody>
            {payload.compositionRows.map((row, i) => (
              <tr key={`${row.type}-${i}`}>
                <td>{row.type}</td>
                <td>{displayValue(row.code, mode)}</td>
                <td>{displayValue(row.description, mode)}</td>
                <td>{displayValue(row.quantity, mode)}</td>
                <td>{displayValue(row.unit, mode)}</td>
                <td>{displayValue(row.estimatedCost, mode)}</td>
                <td>{displayValue(row.notes, mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">6. Molde / ferramenta, se aplicável</h2>
        <div className="project-intake-quick-mold-row">
          <span>Exige molde/ferramenta?</span>
          <CheckBox checked={payload.mold.requiresTooling === true} label="Sim" />
          <CheckBox checked={payload.mold.requiresTooling === false} label="Não" />
        </div>
        <p className="project-intake-quick-subheading">Tipo:</p>
        <ChecklistGrid items={payload.mold.types} />
        <div className="project-intake-quick-inline-grid">
          <FieldLine label="Cavidades" value={payload.mold.cavities} mode={mode} />
          <FieldLine label="Material previsto" value={payload.mold.material} mode={mode} />
          <FieldLine label="Fornecedor" value={payload.mold.supplier} mode={mode} />
          <FieldLine label="Custo estimado" value={payload.mold.estimatedCost} mode={mode} />
        </div>
        <div className="project-intake-quick-mold-row">
          <span>Amortizar no preço?</span>
          <CheckBox checked={payload.mold.amortize === true} label="Sim" />
          <CheckBox checked={payload.mold.amortize === false} label="Não" />
          <FieldLine label="Qtd. amortização" value={payload.mold.amortizationQty} mode={mode} />
        </div>
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">7. Processos / HH</h2>
        <table className="project-intake-form-table project-intake-quick-table">
          <thead>
            <tr>
              <th>Processo</th>
              <th>Interno/Externo</th>
              <th>Tempo/HH</th>
              <th>Valor hora</th>
              <th>Custo est.</th>
            </tr>
          </thead>
          <tbody>
            {payload.processRows.map((row, i) => (
              <tr key={i}>
                <td>{displayValue(row.process, mode)}</td>
                <td>{displayValue(row.internalExternal, mode)}</td>
                <td>{displayValue(row.timeHh, mode)}</td>
                <td>{displayValue(row.hourRate, mode)}</td>
                <td>{displayValue(row.estimatedCost, mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">8. Pendências para estimar</h2>
        <ChecklistGrid items={payload.pendingItems} />
      </section>

      <section className="project-intake-form-section project-intake-quick-section">
        <h2 className="project-intake-form-section-title">9. Decisão inicial</h2>
        <ChecklistGrid items={payload.decisions} />
        <div className="project-intake-quick-signatures">
          {payload.signatures.map((sig) => (
            <div key={sig.role} className="project-intake-quick-signature">
              <span className="project-intake-quick-field-label">{sig.role}:</span>
              <span className="project-intake-quick-signature-line">
                {mode === "prefilled" && sig.line ? sig.line : ""}
              </span>
              <span className="project-intake-quick-date-line">Data: ___/___/______</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="project-intake-form-footer project-intake-quick-footer">
        <span>Documento gerado pelo IndusCost — uso interno</span>
        <span>Página</span>
      </footer>
    </article>
  );
}
