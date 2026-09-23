import React, { useEffect, useRef, useState } from "react";
import {
  HR_ABSENCE_STATUS_LABELS,
  HR_ABSENCE_STATUSES,
  HR_ABSENCE_TYPE_LABELS,
  HR_ABSENCE_TYPES,
  HR_COMPENSATION_ADJUSTMENT_TYPES,
  HR_COMPENSATION_TYPE_LABELS,
  HR_HISTORY_EVENT_LABELS,
  HR_NOTE_CATEGORIES,
  HR_NOTE_CATEGORY_LABELS,
  PEOPLE_CAREER_POST_EVENT_TYPES,
  PEOPLE_CAREER_RECLASSIFIABLE_EVENT_TYPES,
  type PeopleCareerPostEventType,
} from "@/src/lib/peopleProfileTypes";
import { CONTRACT_TYPE_OPTIONS, EPI_DELIVERY_SIZE_SUGGESTIONS } from "@/src/lib/employeeHrUi";
import {
  profileFetchJson,
  profilePatchJson,
  profilePostJson,
} from "./profileClient";
import {
  PROFILE_INPUT_CLASS,
  PROFILE_LABEL_CLASS,
  ProfileManageSection,
  toProfileDateInput,
} from "./profileUi";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className={PROFILE_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className={PROFILE_LABEL_CLASS}>{label}</span>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function CheckboxField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-start gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function FormStatus({ error, ok }: { error: string | null; ok: boolean }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (ok) return <p className="text-sm text-muted-foreground">Registro gravado.</p>;
  return null;
}

function SubmitButton({
  saving,
  label,
  disabled,
}: {
  saving: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={saving || disabled}
      className="inline-flex items-center px-3 py-1.5 rounded-md border border-border bg-background hover:bg-accent text-sm font-medium disabled:opacity-60"
    >
      {saving ? "Gravando…" : label}
    </button>
  );
}

/** Inclusão: só o botão de gravar. Edição: "Salvar" + "Cancelar". */
function FormActions({
  saving,
  label,
  disabled,
  onCancel,
}: {
  saving: boolean;
  label: string;
  disabled?: boolean;
  onCancel?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SubmitButton saving={saving} label={label} disabled={disabled} />
      {onCancel ? (
        <button
          type="button"
          disabled={saving}
          onClick={onCancel}
          className="inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-60"
        >
          Cancelar
        </button>
      ) : null}
    </div>
  );
}

type LookupRow = { id: string; label: string; name?: string };

async function loadLookupRows(url: string): Promise<LookupRow[]> {
  const body = (await profileFetchJson(url)) as { rows?: LookupRow[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

function LookupSelect({
  label,
  value,
  onChange,
  rows,
  required,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: LookupRow[];
  required?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Field label={label}>
      <select
        required={required}
        className={PROFILE_INPUT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Selecione</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.label || row.name}
          </option>
        ))}
      </select>
      {children}
    </Field>
  );
}

function trimOrNull(value: string): string | null {
  return value.trim() || null;
}

function amountOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

/** Mantém no select um valor legado do registro que não esteja na lista oficial. */
function optionsWithCurrent(options: readonly string[], current: string | null | undefined): string[] {
  const list = [...options];
  if (current && !list.includes(current)) list.push(current);
  return list;
}

function labelFrom(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

/**
 * Correção de registro: o PATCH leva só o que mudou, para não regravar campo que o usuário
 * não tocou (ex.: telefone que o DTO devolve formatado).
 */
function diffPayload(
  initial: Record<string, unknown>,
  next: Record<string, unknown>
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(next)) {
    if (next[key] !== initial[key]) changes[key] = next[key];
  }
  return changes;
}

/** Foto do payload de edição no primeiro render (estado ainda igual ao registro). */
function useInitialPayload(enabled: boolean, build: () => Record<string, unknown>) {
  const ref = useRef<Record<string, unknown> | null>(null);
  if (enabled && ref.current === null) ref.current = build();
  return ref;
}

/** Devolve false quando nada mudou (nenhuma chamada é feita). */
async function patchChangedFields(
  url: string,
  initial: Record<string, unknown> | null,
  next: Record<string, unknown>
): Promise<boolean> {
  const changes = diffPayload(initial ?? {}, next);
  if (Object.keys(changes).length === 0) return false;
  await profilePatchJson(url, changes);
  return true;
}

type EditProps = {
  /** Fecha a edição sem gravar (só no modo edição). */
  onCancel?: () => void;
};

export type CompensationRecord = {
  id: string;
  type?: string | null;
  effectiveDate: string;
  previousAmount?: number | null;
  newAmount?: number | null;
  reason?: string | null;
  notes?: string | null;
};

export function CompensationManageForm({
  employeeId,
  currentSalary,
  canViewValues = true,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  currentSalary?: number | null;
  /** Sem acesso a valores os campos de R$ não aparecem nem são enviados. */
  canViewValues?: boolean;
  onSaved: () => void;
  record?: CompensationRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [type, setType] = useState<string>(record?.type || "MERIT");
  const [effectiveDate, setEffectiveDate] = useState(() =>
    record ? toProfileDateInput(record.effectiveDate) : todayIsoDate()
  );
  const [historicalOnly, setHistoricalOnly] = useState(false);
  const [previousAmount, setPreviousAmount] = useState(() => {
    if (record) return record.previousAmount != null ? String(record.previousAmount) : "";
    return currentSalary != null ? String(currentSalary) : "";
  });
  const [newAmount, setNewAmount] = useState(
    record?.newAmount != null ? String(record.newAmount) : ""
  );
  const [reason, setReason] = useState(record?.reason ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Reajuste normal parte do salário atual; registro histórico deixa o valor anterior livre.
  useEffect(() => {
    if (isEdit) return;
    if (historicalOnly) setPreviousAmount("");
    else if (currentSalary != null) setPreviousAmount(String(currentSalary));
  }, [currentSalary, historicalOnly, isEdit]);

  const buildEditPayload = (): Record<string, unknown> => ({
    type,
    effectiveDate,
    ...(canViewValues
      ? { previousAmount: amountOrNull(previousAmount), newAmount: amountOrNull(newAmount) }
      : {}),
    reason: trimOrNull(reason),
    notes: trimOrNull(notes),
  });
  const initialPayload = useInitialPayload(isEdit, buildEditPayload);

  const typeOptions = optionsWithCurrent(
    HR_COMPENSATION_ADJUSTMENT_TYPES.filter(
      (t) => t !== "MANUAL_EDIT" || record?.type === "MANUAL_EDIT"
    ),
    record?.type
  );
  const previousOptional = isEdit || historicalOnly;

  return (
    <ProfileManageSection title={isEdit ? "Editar reajuste" : "Registrar reajuste"} inline={isEdit}>
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/compensation-adjustments/${record.id}`,
                initialPayload.current,
                buildEditPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            await profilePostJson(`/api/employees/${employeeId}/compensation-adjustments`, {
              type,
              effectiveDate,
              ...(historicalOnly
                ? { historicalOnly: true, previousAmount: amountOrNull(previousAmount) }
                : { expectedPreviousAmount: Number(previousAmount) }),
              newAmount: Number(newAmount),
              reason: trimOrNull(reason),
              notes: trimOrNull(notes),
            });
            setOk(true);
            if (historicalOnly) setPreviousAmount("");
            setNewAmount("");
            setReason("");
            setNotes("");
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar o reajuste."
                  : "Não foi possível registrar o reajuste."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {isEdit ? (
          <p className="text-xs text-muted-foreground">
            Correção apenas do registro no histórico: o salário atual do cadastro NÃO é alterado.
          </p>
        ) : (
          <CheckboxField
            label="Registro histórico (não altera o salário atual)"
            hint="Use para cadastrar um reajuste que já aconteceu: ele entra no histórico e no indicador “Último reajuste” com a vigência informada, sem mexer no salário atual do cadastro."
            checked={historicalOnly}
            onChange={setHistoricalOnly}
          />
        )}
        <Field label="Tipo">
          <select className={PROFILE_INPUT_CLASS} value={type} onChange={(e) => setType(e.target.value)}>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {labelFrom(HR_COMPENSATION_TYPE_LABELS, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Vigência">
          <input
            type="date"
            required
            className={PROFILE_INPUT_CLASS}
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </Field>
        {canViewValues ? (
          <>
            <Field label={previousOptional ? "Salário anterior (R$) — opcional" : "Salário anterior (R$)"}>
              <input
                type="number"
                required={!previousOptional}
                min={0}
                step="any"
                className={PROFILE_INPUT_CLASS}
                value={previousAmount}
                onChange={(e) => setPreviousAmount(e.target.value)}
              />
            </Field>
            <Field label="Novo salário (R$)">
              <input
                type="number"
                required={!isEdit || record?.newAmount != null}
                min={0}
                step="any"
                className={PROFILE_INPUT_CLASS}
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="Motivo">
          <input
            className={PROFILE_INPUT_CLASS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field label="Observação">
          <textarea
            rows={2}
            className={PROFILE_INPUT_CLASS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Registrar reajuste"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}

export type CareerRecord = {
  id: string;
  eventType: string;
  eventLabel?: string | null;
  effectiveDate: string;
  summary?: string | null;
  reason?: string | null;
  notes?: string | null;
};

export function CareerManageForm({
  employeeId,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  onSaved: () => void;
  record?: CareerRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [eventType, setEventType] = useState<string>(record?.eventType ?? "PROMOTION");
  const [effectiveDate, setEffectiveDate] = useState(() =>
    record ? toProfileDateInput(record.effectiveDate) : todayIsoDate()
  );
  const [recordOnly, setRecordOnly] = useState(false);
  const [newRoleId, setNewRoleId] = useState("");
  const [newDepartmentId, setNewDepartmentId] = useState("");
  const [newManagerId, setNewManagerId] = useState("");
  const [newContractType, setNewContractType] = useState("");
  const [newCostCenterId, setNewCostCenterId] = useState("");
  const [newWorkSchedule, setNewWorkSchedule] = useState("");
  const [previousRoleId, setPreviousRoleId] = useState("");
  const [previousDepartmentId, setPreviousDepartmentId] = useState("");
  const [previousManagerId, setPreviousManagerId] = useState("");
  const [previousContractType, setPreviousContractType] = useState("");
  const [previousCostCenterId, setPreviousCostCenterId] = useState("");
  const [previousWorkSchedule, setPreviousWorkSchedule] = useState("");
  const [reason, setReason] = useState(record?.reason ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [roles, setRoles] = useState<LookupRow[]>([]);
  const [departments, setDepartments] = useState<LookupRow[]>([]);
  const [managers, setManagers] = useState<LookupRow[]>([]);
  const [costCenters, setCostCenters] = useState<LookupRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // A correção de um registro não troca cargo/departamento: as listas só servem à inclusão.
  useEffect(() => {
    if (isEdit) return;
    let cancelled = false;
    Promise.all([
      loadLookupRows("/api/employees/lookups/roles"),
      loadLookupRows("/api/employees/lookups/org-departments"),
      loadLookupRows(`/api/employees/lookups/managers?excludeId=${encodeURIComponent(employeeId)}`),
      loadLookupRows("/api/employees/lookups/cost-centers"),
    ])
      .then(([r, d, m, c]) => {
        if (cancelled) return;
        setRoles(r);
        setDepartments(d);
        setManagers(m);
        setCostCenters(c);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar listas de cargo/departamento.");
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, isEdit]);

  const reclassifiable =
    record != null &&
    (PEOPLE_CAREER_RECLASSIFIABLE_EVENT_TYPES as readonly string[]).includes(record.eventType);
  // Correção só troca o tipo entre promoção e alteração de cargo (mesma forma de dado).
  const typeOptions: readonly PeopleCareerPostEventType[] = isEdit
    ? PEOPLE_CAREER_RECLASSIFIABLE_EVENT_TYPES
    : PEOPLE_CAREER_POST_EVENT_TYPES;

  const buildEditPayload = (): Record<string, unknown> => ({
    effectiveDate,
    reason: trimOrNull(reason),
    notes: trimOrNull(notes),
    ...(reclassifiable ? { eventType } : {}),
  });
  const initialPayload = useInitialPayload(isEdit, buildEditPayload);

  const isRoleEvent = eventType === "PROMOTION" || eventType === "ROLE_CHANGE";

  // Só viajam os campos do tipo escolhido — seleção esquecida de outro tipo não entra no registro.
  const buildCreatePayload = (): Record<string, unknown> => {
    const dept = departments.find((d) => d.id === newDepartmentId);
    const cc = costCenters.find((c) => c.id === newCostCenterId);
    const isDepartment = eventType === "DEPARTMENT_CHANGE";
    const isCostCenter = eventType === "COST_CENTER_CHANGE";
    const payload: Record<string, unknown> = {
      eventType,
      effectiveDate,
      reason: trimOrNull(reason),
      notes: trimOrNull(notes),
      newRoleId: isRoleEvent ? newRoleId || null : null,
      newDepartmentId: isDepartment ? newDepartmentId || null : null,
      newDepartment: isDepartment ? dept?.name || dept?.label || null : null,
      newManagerId: eventType === "MANAGER_CHANGE" ? newManagerId || null : null,
      newContractType: eventType === "CONTRACT_CHANGE" ? newContractType || null : null,
      newCostCenterId: isCostCenter ? newCostCenterId || null : null,
      newCostCenter: isCostCenter ? cc?.label || cc?.name || null : null,
      newWorkSchedule: eventType === "WORK_SCHEDULE_CHANGE" ? trimOrNull(newWorkSchedule) : null,
    };
    if (!recordOnly) return payload;
    const prevDept = departments.find((d) => d.id === previousDepartmentId);
    const prevCc = costCenters.find((c) => c.id === previousCostCenterId);
    return {
      ...payload,
      recordOnly: true,
      previousRoleId: isRoleEvent ? previousRoleId || null : null,
      previousDepartmentId: isDepartment ? previousDepartmentId || null : null,
      previousDepartment: isDepartment ? prevDept?.name || prevDept?.label || null : null,
      previousManagerId: eventType === "MANAGER_CHANGE" ? previousManagerId || null : null,
      previousContractType: eventType === "CONTRACT_CHANGE" ? previousContractType || null : null,
      previousCostCenterId: isCostCenter ? previousCostCenterId || null : null,
      previousCostCenter: isCostCenter ? prevCc?.label || prevCc?.name || null : null,
      previousWorkSchedule:
        eventType === "WORK_SCHEDULE_CHANGE" ? trimOrNull(previousWorkSchedule) : null,
    };
  };

  return (
    <ProfileManageSection
      title={isEdit ? "Editar movimentação" : "Registrar movimentação"}
      inline={isEdit}
    >
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/career-events/${record.id}`,
                initialPayload.current,
                buildEditPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            await profilePostJson(`/api/employees/${employeeId}/career-events`, buildCreatePayload());
            setOk(true);
            setReason("");
            setNotes("");
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar a movimentação."
                  : "Não foi possível registrar a movimentação."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {isEdit ? (
          <p className="text-xs text-muted-foreground">
            Correção apenas do registro na linha do tempo: cargo, departamento e gestor atuais do
            cadastro não são alterados.
          </p>
        ) : (
          <CheckboxField
            label="Registro histórico (não altera o cadastro atual)"
            hint="Use para cadastrar uma movimentação que já aconteceu (ex.: uma promoção antiga): ela entra na linha do tempo e no indicador “Última promoção” com a vigência informada, sem mudar o cadastro atual."
            checked={recordOnly}
            onChange={setRecordOnly}
          />
        )}
        {isEdit && !reclassifiable ? (
          <ReadOnlyField
            label="Tipo"
            value={record?.eventLabel || labelFrom(HR_HISTORY_EVENT_LABELS, eventType)}
          />
        ) : (
          <Field label="Tipo">
            <select
              className={PROFILE_INPUT_CLASS}
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
            >
              {typeOptions.map((t) => (
                <option key={t} value={t}>
                  {HR_HISTORY_EVENT_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
        )}
        {isEdit && record?.summary ? <ReadOnlyField label="Movimentação" value={record.summary} /> : null}
        <Field label="Vigência">
          <input
            type="date"
            required
            className={PROFILE_INPUT_CLASS}
            value={effectiveDate}
            onChange={(e) => setEffectiveDate(e.target.value)}
          />
        </Field>
        {!isEdit && isRoleEvent ? (
          <>
            {recordOnly ? (
              <LookupSelect
                label="Cargo anterior"
                value={previousRoleId}
                onChange={setPreviousRoleId}
                rows={roles}
              />
            ) : null}
            <LookupSelect label="Novo cargo" required value={newRoleId} onChange={setNewRoleId} rows={roles}>
              {roles.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Cadastre em Administração → Configurações → Estrutura Operacional (Cargos e
                  Salários).
                </p>
              ) : null}
            </LookupSelect>
          </>
        ) : null}
        {!isEdit && eventType === "DEPARTMENT_CHANGE" ? (
          <>
            {recordOnly ? (
              <LookupSelect
                label="Departamento anterior"
                value={previousDepartmentId}
                onChange={setPreviousDepartmentId}
                rows={departments}
              />
            ) : null}
            <LookupSelect
              label="Novo departamento"
              value={newDepartmentId}
              onChange={setNewDepartmentId}
              rows={departments}
            />
          </>
        ) : null}
        {!isEdit && eventType === "COST_CENTER_CHANGE" ? (
          <>
            {recordOnly ? (
              <LookupSelect
                label="Centro de custo anterior"
                value={previousCostCenterId}
                onChange={setPreviousCostCenterId}
                rows={costCenters}
              />
            ) : null}
            <LookupSelect
              label="Novo centro de custo"
              value={newCostCenterId}
              onChange={setNewCostCenterId}
              rows={costCenters}
            />
          </>
        ) : null}
        {!isEdit && eventType === "MANAGER_CHANGE" ? (
          <>
            {recordOnly ? (
              <LookupSelect
                label="Gestor anterior"
                value={previousManagerId}
                onChange={setPreviousManagerId}
                rows={managers}
              />
            ) : null}
            <LookupSelect
              label="Novo gestor"
              value={newManagerId}
              onChange={setNewManagerId}
              rows={managers}
            />
          </>
        ) : null}
        {!isEdit && eventType === "CONTRACT_CHANGE" ? (
          <>
            {recordOnly ? (
              <Field label="Contrato anterior">
                <select
                  className={PROFILE_INPUT_CLASS}
                  value={previousContractType}
                  onChange={(e) => setPreviousContractType(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {CONTRACT_TYPE_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Field label="Novo contrato">
              <select
                className={PROFILE_INPUT_CLASS}
                value={newContractType}
                onChange={(e) => setNewContractType(e.target.value)}
              >
                <option value="">Selecione</option>
                {CONTRACT_TYPE_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : null}
        {!isEdit && eventType === "WORK_SCHEDULE_CHANGE" ? (
          <>
            {recordOnly ? (
              <Field label="Jornada anterior">
                <input
                  className={PROFILE_INPUT_CLASS}
                  value={previousWorkSchedule}
                  onChange={(e) => setPreviousWorkSchedule(e.target.value)}
                  placeholder="Ex.: 220 h/mês"
                />
              </Field>
            ) : null}
            <Field label="Nova jornada">
              <input
                className={PROFILE_INPUT_CLASS}
                maxLength={80}
                value={newWorkSchedule}
                onChange={(e) => setNewWorkSchedule(e.target.value)}
                placeholder="Ex.: 220 h/mês"
              />
            </Field>
          </>
        ) : null}
        <Field label="Motivo">
          <input className={PROFILE_INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Observação">
          <textarea
            rows={2}
            className={PROFILE_INPUT_CLASS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Registrar movimentação"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}

export type AbsenceRecord = {
  id: string;
  type: string;
  startDate: string;
  endDate: string | null;
  expectedReturn?: string | null;
  actualReturn?: string | null;
  status: string;
  reason: string | null;
  notes?: string | null;
};

export function AbsencesManageForm({
  employeeId,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  onSaved: () => void;
  record?: AbsenceRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [type, setType] = useState<string>(record?.type || "VACATION");
  const [startDate, setStartDate] = useState(() =>
    record ? toProfileDateInput(record.startDate) : todayIsoDate()
  );
  const [endDate, setEndDate] = useState(() => toProfileDateInput(record?.endDate));
  const [expectedReturn, setExpectedReturn] = useState(() =>
    toProfileDateInput(record?.expectedReturn)
  );
  const [actualReturn, setActualReturn] = useState(() => toProfileDateInput(record?.actualReturn));
  const [status, setStatus] = useState<string>(record?.status || "SCHEDULED");
  const [reason, setReason] = useState(record?.reason ?? "");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const buildEditPayload = (): Record<string, unknown> => ({
    type,
    startDate,
    endDate: endDate || null,
    expectedReturn: expectedReturn || null,
    actualReturn: actualReturn || null,
    status,
    reason: trimOrNull(reason),
    notes: trimOrNull(notes),
  });
  const initialPayload = useInitialPayload(isEdit, buildEditPayload);

  return (
    <ProfileManageSection
      title={isEdit ? "Editar férias ou afastamento" : "Registrar férias ou afastamento"}
      inline={isEdit}
    >
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/absences/${record.id}`,
                initialPayload.current,
                buildEditPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            await profilePostJson(`/api/employees/${employeeId}/absences`, {
              type,
              startDate,
              endDate: endDate || null,
              expectedReturn: expectedReturn || null,
              status,
              reason: trimOrNull(reason),
              notes: trimOrNull(notes),
            });
            setOk(true);
            setReason("");
            setNotes("");
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar o afastamento."
                  : "Não foi possível registrar o afastamento."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Tipo">
          <select className={PROFILE_INPUT_CLASS} value={type} onChange={(e) => setType(e.target.value)}>
            {optionsWithCurrent(HR_ABSENCE_TYPES, record?.type).map((t) => (
              <option key={t} value={t}>
                {labelFrom(HR_ABSENCE_TYPE_LABELS, t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Início">
          <input
            type="date"
            required
            className={PROFILE_INPUT_CLASS}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Fim">
          <input
            type="date"
            className={PROFILE_INPUT_CLASS}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label="Retorno previsto">
          <input
            type="date"
            className={PROFILE_INPUT_CLASS}
            value={expectedReturn}
            onChange={(e) => setExpectedReturn(e.target.value)}
          />
        </Field>
        {isEdit ? (
          <Field label="Retorno real">
            <input
              type="date"
              className={PROFILE_INPUT_CLASS}
              value={actualReturn}
              onChange={(e) => setActualReturn(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Situação">
          <select className={PROFILE_INPUT_CLASS} value={status} onChange={(e) => setStatus(e.target.value)}>
            {optionsWithCurrent(HR_ABSENCE_STATUSES, record?.status).map((s) => (
              <option key={s} value={s}>
                {labelFrom(HR_ABSENCE_STATUS_LABELS, s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Motivo">
          <input className={PROFILE_INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Observação">
          <textarea
            rows={2}
            className={PROFILE_INPUT_CLASS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Registrar afastamento"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}

export type NoteRecord = {
  id: string;
  category: string;
  body: string;
};

export function NotesManageForm({
  employeeId,
  canRestricted,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  canRestricted: boolean;
  onSaved: () => void;
  record?: NoteRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [category, setCategory] = useState<string>(record?.category || "GERAL");
  const [body, setBody] = useState(record?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const categories = optionsWithCurrent(
    HR_NOTE_CATEGORIES.filter((c) => c !== "RESTRITA" || canRestricted),
    record?.category
  );

  const buildEditPayload = (): Record<string, unknown> => ({ category, body });
  const initialPayload = useInitialPayload(isEdit, buildEditPayload);

  return (
    <ProfileManageSection title={isEdit ? "Editar observação" : "Nova observação"} inline={isEdit}>
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/notes/${record.id}`,
                initialPayload.current,
                buildEditPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            await profilePostJson(`/api/employees/${employeeId}/notes`, {
              category,
              body,
            });
            setOk(true);
            setBody("");
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar a observação."
                  : "Não foi possível registrar a observação."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Categoria">
          <select
            className={PROFILE_INPUT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {labelFrom(HR_NOTE_CATEGORY_LABELS, c)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Texto">
          <textarea
            required
            rows={4}
            className={PROFILE_INPUT_CLASS}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Registrar observação"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}

export type EmergencyContactRecord = {
  id: string;
  name: string;
  phone: string;
  relationship?: string | null;
  alternatePhone?: string | null;
  priority?: number | null;
  notes?: string | null;
};

export function EmergencyManageForm({
  employeeId,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  onSaved: () => void;
  record?: EmergencyContactRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [name, setName] = useState(record?.name ?? "");
  const [phone, setPhone] = useState(record?.phone ?? "");
  const [relationship, setRelationship] = useState(record?.relationship ?? "");
  const [alternatePhone, setAlternatePhone] = useState(record?.alternatePhone ?? "");
  const [priority, setPriority] = useState(record?.priority != null ? String(record.priority) : "2");
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const buildPayload = (): Record<string, unknown> => ({
    name: name.trim(),
    phone: phone.trim(),
    relationship: trimOrNull(relationship),
    alternatePhone: trimOrNull(alternatePhone),
    priority: Number.parseInt(priority, 10) || 2,
    notes: trimOrNull(notes),
  });
  const initialPayload = useInitialPayload(isEdit, buildPayload);

  return (
    <ProfileManageSection title={isEdit ? "Editar contato" : "Adicionar contato"} inline={isEdit}>
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/emergency-contacts/${record.id}`,
                initialPayload.current,
                buildPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            await profilePostJson(`/api/employees/${employeeId}/emergency-contacts`, buildPayload());
            setOk(true);
            setName("");
            setPhone("");
            setRelationship("");
            setAlternatePhone("");
            setPriority("2");
            setNotes("");
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar o contato."
                  : "Não foi possível registrar o contato."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Nome">
          <input required className={PROFILE_INPUT_CLASS} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Telefone">
          <input required className={PROFILE_INPUT_CLASS} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="Telefone alternativo">
          <input
            className={PROFILE_INPUT_CLASS}
            value={alternatePhone}
            onChange={(e) => setAlternatePhone(e.target.value)}
          />
        </Field>
        <Field label="Relação">
          <input className={PROFILE_INPUT_CLASS} value={relationship} onChange={(e) => setRelationship(e.target.value)} />
        </Field>
        <Field label="Prioridade (1 = acionar primeiro)">
          <input
            type="number"
            min={1}
            step={1}
            className={PROFILE_INPUT_CLASS}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          />
        </Field>
        <Field label="Observação">
          <textarea
            rows={2}
            className={PROFILE_INPUT_CLASS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Adicionar contato"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}

export type EpiDeliveryRecord = {
  id: string;
  item: string;
  deliveredAt: string;
  quantity?: number | null;
  size?: string | null;
  validUntil?: string | null;
  responsibleName?: string | null;
  returnedAt?: string | null;
  notes?: string | null;
};

export function EpiManageForm({
  employeeId,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  onSaved: () => void;
  record?: EpiDeliveryRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [item, setItem] = useState(record?.item ?? "");
  const [deliveredAt, setDeliveredAt] = useState(() =>
    record ? toProfileDateInput(record.deliveredAt) : todayIsoDate()
  );
  const [quantity, setQuantity] = useState(record?.quantity != null ? String(record.quantity) : "1");
  const [size, setSize] = useState(record?.size ?? "");
  const sizeListId = `epi-size-suggestions-${record?.id ?? "new"}`;
  const [validUntil, setValidUntil] = useState(() => toProfileDateInput(record?.validUntil));
  const [responsibleName, setResponsibleName] = useState(record?.responsibleName ?? "");
  const [returnedAt, setReturnedAt] = useState(() => toProfileDateInput(record?.returnedAt));
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const buildCreatePayload = (): Record<string, unknown> => ({
    item: item.trim(),
    deliveredAt,
    quantity: Number(quantity || 1),
    size: trimOrNull(size),
    validUntil: validUntil || null,
    responsibleName: trimOrNull(responsibleName),
    notes: trimOrNull(notes),
  });
  // A devolução só existe depois da entrega: entra apenas na correção do registro.
  const buildEditPayload = (): Record<string, unknown> => ({
    ...buildCreatePayload(),
    returnedAt: returnedAt || null,
  });
  const initialPayload = useInitialPayload(isEdit, buildEditPayload);

  return (
    <ProfileManageSection title={isEdit ? "Editar entrega" : "Registrar entrega"} inline={isEdit}>
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/epi-deliveries/${record.id}`,
                initialPayload.current,
                buildEditPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            await profilePostJson(`/api/employees/${employeeId}/epi-deliveries`, buildCreatePayload());
            setOk(true);
            setItem("");
            setSize("");
            setValidUntil("");
            setNotes("");
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar a entrega."
                  : "Não foi possível registrar a entrega."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Item">
          <input required className={PROFILE_INPUT_CLASS} value={item} onChange={(e) => setItem(e.target.value)} />
        </Field>
        <Field label="Data">
          <input
            type="date"
            required
            className={PROFILE_INPUT_CLASS}
            value={deliveredAt}
            onChange={(e) => setDeliveredAt(e.target.value)}
          />
        </Field>
        <Field label="Quantidade">
          <input
            type="number"
            min={1}
            className={PROFILE_INPUT_CLASS}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <Field label="Tamanho">
          <input
            className={PROFILE_INPUT_CLASS}
            list={sizeListId}
            placeholder="PP a 5XG, numeração ou Único"
            value={size}
            onChange={(e) => setSize(e.target.value)}
          />
          <datalist id={sizeListId}>
            {EPI_DELIVERY_SIZE_SUGGESTIONS.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </Field>
        <Field label="Validade">
          <input
            type="date"
            className={PROFILE_INPUT_CLASS}
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </Field>
        <Field label="Responsável pela entrega">
          <input
            className={PROFILE_INPUT_CLASS}
            value={responsibleName}
            onChange={(e) => setResponsibleName(e.target.value)}
          />
        </Field>
        {isEdit ? (
          <Field label="Devolvido em">
            <input
              type="date"
              className={PROFILE_INPUT_CLASS}
              value={returnedAt}
              onChange={(e) => setReturnedAt(e.target.value)}
            />
          </Field>
        ) : null}
        <Field label="Observação">
          <textarea
            rows={2}
            className={PROFILE_INPUT_CLASS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Registrar entrega"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}

export type DocumentRecord = {
  id: string;
  displayName: string;
  documentType: string;
  issuedAt?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
};

export function DocumentsManageForm({
  employeeId,
  onSaved,
  record,
  onCancel,
}: {
  employeeId: string;
  onSaved: () => void;
  record?: DocumentRecord;
} & EditProps) {
  const isEdit = Boolean(record);
  const [displayName, setDisplayName] = useState(record?.displayName ?? "");
  const [documentType, setDocumentType] = useState(record?.documentType || "OTHER");
  const [issuedAt, setIssuedAt] = useState(() => toProfileDateInput(record?.issuedAt));
  const [expiresAt, setExpiresAt] = useState(() => toProfileDateInput(record?.expiresAt));
  const [notes, setNotes] = useState(record?.notes ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Edição é só de metadados: o arquivo anexado não é trocado.
  const buildEditPayload = (): Record<string, unknown> => ({
    displayName: displayName.trim(),
    documentType: documentType.trim(),
    issuedAt: issuedAt || null,
    expiresAt: expiresAt || null,
    notes: trimOrNull(notes),
  });
  const initialPayload = useInitialPayload(isEdit, buildEditPayload);

  return (
    <ProfileManageSection title={isEdit ? "Editar documento" : "Anexar documento"} inline={isEdit}>
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!record && !file) {
            setError("Selecione um arquivo.");
            return;
          }
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            if (record) {
              const changed = await patchChangedFields(
                `/api/employees/${employeeId}/documents/${record.id}`,
                initialPayload.current,
                buildEditPayload()
              );
              if (changed || !onCancel) onSaved();
              else onCancel();
              return;
            }
            if (!file) return;
            const fd = new FormData();
            fd.append("file", file);
            fd.append("documentType", documentType);
            fd.append("displayName", displayName.trim() || file.name);
            if (issuedAt) fd.append("issuedAt", issuedAt);
            if (expiresAt) fd.append("expiresAt", expiresAt);
            if (notes.trim()) fd.append("notes", notes.trim());
            await profileFetchJson(`/api/employees/${employeeId}/documents`, {
              method: "POST",
              body: fd,
            });
            setOk(true);
            setDisplayName("");
            setIssuedAt("");
            setExpiresAt("");
            setNotes("");
            setFile(null);
            setFileInputKey((k) => k + 1);
            onSaved();
          } catch (err) {
            setError(
              err instanceof Error
                ? err.message
                : isEdit
                  ? "Não foi possível salvar o documento."
                  : "Não foi possível anexar o documento."
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Nome de exibição">
          <input
            required={isEdit}
            className={PROFILE_INPUT_CLASS}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        <Field label="Tipo">
          <input
            required={isEdit}
            className={PROFILE_INPUT_CLASS}
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          />
        </Field>
        <Field label="Emissão">
          <input
            type="date"
            className={PROFILE_INPUT_CLASS}
            value={issuedAt}
            onChange={(e) => setIssuedAt(e.target.value)}
          />
        </Field>
        <Field label="Validade">
          <input
            type="date"
            className={PROFILE_INPUT_CLASS}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </Field>
        <Field label="Observação">
          <textarea
            rows={2}
            className={PROFILE_INPUT_CLASS}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        {isEdit ? (
          <p className="text-xs text-muted-foreground">
            O arquivo anexado não é alterado aqui. Para trocar o arquivo, exclua o documento e anexe
            novamente.
          </p>
        ) : (
          <Field label="Arquivo">
            <input
              key={fileInputKey}
              type="file"
              required
              className="block w-full text-sm"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
        )}
        <FormStatus error={error} ok={ok} />
        <FormActions
          saving={saving}
          label={isEdit ? "Salvar" : "Anexar"}
          onCancel={isEdit ? onCancel : undefined}
        />
      </form>
    </ProfileManageSection>
  );
}
