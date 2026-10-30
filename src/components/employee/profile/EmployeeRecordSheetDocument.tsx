import React from "react";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { EMPLOYEE_SHEET_MASK, type EmployeeRecordSheet, type EmployeeSheetSection } from "@/src/lib/employeeRecordSheet";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { initialsFromName } from "./profileUi";
import "@/src/components/print/print-document.css";
import "./employee-record-sheet.css";

function Cell({ value }: { value: string }) {
  return value === EMPLOYEE_SHEET_MASK ? <span className="ers-mask">{value}</span> : <>{value}</>;
}

function SectionBody({ section }: { section: EmployeeSheetSection }) {
  if (section.unavailable) return <p className="ers-unavailable">{section.unavailable}</p>;
  return (
    <>
      {section.fields?.length ? (
        <dl className="ers-grid">
          {section.fields.map((field) => (
            <div key={field.label} className={`ers-field ers-span-${field.span ?? 1}`}>
              <dt>{field.label}</dt>
              <dd>
                <Cell value={field.value} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {section.tables?.map((table, index) => (
        <div key={table.title ?? index} className="ers-table-block">
          {table.title ? <h4 className="ers-table-title">{table.title}</h4> : null}
          {table.rows.length === 0 ? (
            <p className="ers-empty">{table.empty}</p>
          ) : (
            <table className="ers-table">
              <thead>
                <tr>
                  {table.columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((value, cellIndex) => (
                      <td key={cellIndex}>
                        <Cell value={value} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </>
  );
}

/** Mesmo documento na tela e no PDF: o que se vê é o que sai, com remuneração mascarada. */
export function EmployeeRecordSheetDocument({
  sheet,
  branding = DEFAULT_BRANDING,
  issuedAt,
}: {
  sheet: EmployeeRecordSheet;
  branding?: BrandingSettingsDTO;
  issuedAt: Date;
}) {
  const { identity } = sheet;
  const issuedLabel = issuedAt.toLocaleString("pt-BR");
  return (
    <article className="ers-sheet" data-testid="employee-record-sheet" lang="pt-BR">
      <PrintHeader
        branding={branding}
        documentKind="Recursos Humanos"
        documentTitle="Ficha do colaborador"
        metaLines={[
          { label: "Matrícula", value: identity.registrationId },
          { label: "Emissão", value: issuedLabel },
        ]}
      />

      <section className="ers-identity" aria-label="Identificação">
        <div className="ers-photo">
          {identity.photoUrl ? <img src={identity.photoUrl} alt="" /> : <span>{initialsFromName(identity.fullName)}</span>}
        </div>
        <dl className="ers-grid ers-identity-grid">
          <div className="ers-field ers-span-3">
            <dt>Colaborador</dt>
            <dd className="ers-name">{identity.fullName}</dd>
          </div>
          <div className="ers-field">
            <dt>Situação</dt>
            <dd>{identity.statusLabel}</dd>
          </div>
          <div className="ers-field ers-span-2">
            <dt>Cargo</dt>
            <dd>{identity.roleName ?? "—"}</dd>
          </div>
          <div className="ers-field ers-span-2">
            <dt>Departamento</dt>
            <dd>{identity.department ?? "—"}</dd>
          </div>
          <div className="ers-field ers-span-4">
            <dt>Nome social</dt>
            <dd>{identity.socialName ?? "—"}</dd>
          </div>
        </dl>
      </section>

      {sheet.sections.map((section, index) => (
        <section key={section.id} className="ers-section" data-testid={`employee-record-sheet-${section.id}`}>
          <h3 className="ers-section-title">
            <span>{index + 1}.</span> {section.title}
          </h3>
          <SectionBody section={section} />
        </section>
      ))}

      <section className="ers-signatures" aria-label="Assinaturas">
        <div>
          <span />
          Colaborador
        </div>
        <div>
          <span />
          Recursos Humanos
        </div>
      </section>
      <p className="ers-footnote">
        Documento confidencial. Valores de remuneração omitidos ({EMPLOYEE_SHEET_MASK}). Emitido em {issuedLabel}.
      </p>
    </article>
  );
}
