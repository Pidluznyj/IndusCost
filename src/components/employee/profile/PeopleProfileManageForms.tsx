import React, { useEffect, useState } from "react";
import {
  HR_ABSENCE_STATUSES,
  HR_ABSENCE_TYPE_LABELS,
  HR_ABSENCE_TYPES,
  HR_COMPENSATION_ADJUSTMENT_TYPES,
  HR_COMPENSATION_TYPE_LABELS,
  HR_HISTORY_EVENT_LABELS,
  HR_NOTE_CATEGORIES,
  HR_NOTE_CATEGORY_LABELS,
  PEOPLE_CAREER_POST_EVENT_TYPES,
  type PeopleCareerPostEventType,
} from "@/src/lib/peopleProfileTypes";
import { CONTRACT_TYPE_OPTIONS } from "@/src/lib/employeeHrUi";
import { ProfileHttpError, profileFetchJson, profilePostJson } from "./profileClient";
import { PROFILE_INPUT_CLASS, PROFILE_LABEL_CLASS, ProfileManageSection } from "./profileUi";

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

type LookupRow = { id: string; label: string; name?: string };

async function loadLookupRows(url: string): Promise<LookupRow[]> {
  const body = (await profileFetchJson(url)) as { rows?: LookupRow[] };
  return Array.isArray(body.rows) ? body.rows : [];
}

export function CompensationManageForm({
  employeeId,
  currentSalary,
  onSaved,
}: {
  employeeId: string;
  currentSalary?: number | null;
  onSaved: () => void;
}) {
  const [type, setType] = useState("MERIT");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate);
  const [previousAmount, setPreviousAmount] = useState(
    currentSalary != null ? String(currentSalary) : ""
  );
  const [newAmount, setNewAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (currentSalary != null) setPreviousAmount(String(currentSalary));
  }, [currentSalary]);

  return (
    <ProfileManageSection title="Registrar reajuste">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            await profilePostJson(`/api/employees/${employeeId}/compensation-adjustments`, {
              type,
              effectiveDate,
              expectedPreviousAmount: Number(previousAmount),
              newAmount: Number(newAmount),
              reason: reason.trim() || null,
            });
            setOk(true);
            setNewAmount("");
            setReason("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar o reajuste.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Tipo">
          <select className={PROFILE_INPUT_CLASS} value={type} onChange={(e) => setType(e.target.value)}>
            {HR_COMPENSATION_ADJUSTMENT_TYPES.filter((t) => t !== "MANUAL_EDIT").map((t) => (
              <option key={t} value={t}>
                {HR_COMPENSATION_TYPE_LABELS[t]}
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
        <Field label="Salário anterior (R$)">
          <input
            type="number"
            required
            min={0}
            step="0.01"
            className={PROFILE_INPUT_CLASS}
            value={previousAmount}
            onChange={(e) => setPreviousAmount(e.target.value)}
          />
        </Field>
        <Field label="Novo salário (R$)">
          <input
            type="number"
            required
            min={0}
            step="0.01"
            className={PROFILE_INPUT_CLASS}
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
          />
        </Field>
        <Field label="Motivo">
          <input
            className={PROFILE_INPUT_CLASS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <SubmitButton saving={saving} label="Registrar reajuste" />
      </form>
    </ProfileManageSection>
  );
}

export function CareerManageForm({
  employeeId,
  onSaved,
}: {
  employeeId: string;
  onSaved: () => void;
}) {
  const [eventType, setEventType] = useState<PeopleCareerPostEventType>("PROMOTION");
  const [effectiveDate, setEffectiveDate] = useState(todayIsoDate);
  const [newRoleId, setNewRoleId] = useState("");
  const [newDepartmentId, setNewDepartmentId] = useState("");
  const [newManagerId, setNewManagerId] = useState("");
  const [newContractType, setNewContractType] = useState("");
  const [newCostCenterId, setNewCostCenterId] = useState("");
  const [newWorkSchedule, setNewWorkSchedule] = useState("");
  const [reason, setReason] = useState("");
  const [roles, setRoles] = useState<LookupRow[]>([]);
  const [departments, setDepartments] = useState<LookupRow[]>([]);
  const [managers, setManagers] = useState<LookupRow[]>([]);
  const [costCenters, setCostCenters] = useState<LookupRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
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
  }, [employeeId]);

  return (
    <ProfileManageSection title="Registrar movimentação">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            const dept = departments.find((d) => d.id === newDepartmentId);
            const cc = costCenters.find((c) => c.id === newCostCenterId);
            await profilePostJson(`/api/employees/${employeeId}/career-events`, {
              eventType,
              effectiveDate,
              reason: reason.trim() || null,
              newRoleId: newRoleId || null,
              newDepartmentId: newDepartmentId || null,
              newDepartment: dept?.name || dept?.label || null,
              newManagerId: newManagerId || null,
              newContractType: newContractType || null,
              newCostCenterId: newCostCenterId || null,
              newCostCenter: cc?.label || cc?.name || null,
              newWorkSchedule: newWorkSchedule.trim() || null,
            });
            setOk(true);
            setReason("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar a movimentação.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Tipo">
          <select
            className={PROFILE_INPUT_CLASS}
            value={eventType}
            onChange={(e) => setEventType(e.target.value as PeopleCareerPostEventType)}
          >
            {PEOPLE_CAREER_POST_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {HR_HISTORY_EVENT_LABELS[t]}
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
        {(eventType === "PROMOTION" || eventType === "ROLE_CHANGE") && (
          <Field label="Novo cargo">
            <select
              required={eventType === "PROMOTION" || eventType === "ROLE_CHANGE"}
              className={PROFILE_INPUT_CLASS}
              value={newRoleId}
              onChange={(e) => setNewRoleId(e.target.value)}
            >
              <option value="">Selecione</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || r.name}
                </option>
              ))}
            </select>
            {roles.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Cadastre em Administração → Configurações → Estrutura Operacional (Cargos e
                Salários).
              </p>
            ) : null}
          </Field>
        )}
        {eventType === "DEPARTMENT_CHANGE" && (
          <Field label="Novo departamento">
            <select
              className={PROFILE_INPUT_CLASS}
              value={newDepartmentId}
              onChange={(e) => setNewDepartmentId(e.target.value)}
            >
              <option value="">Selecione</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label || d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {eventType === "COST_CENTER_CHANGE" && (
          <Field label="Novo centro de custo">
            <select
              className={PROFILE_INPUT_CLASS}
              value={newCostCenterId}
              onChange={(e) => setNewCostCenterId(e.target.value)}
            >
              <option value="">Selecione</option>
              {costCenters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {eventType === "MANAGER_CHANGE" && (
          <Field label="Novo gestor">
            <select
              className={PROFILE_INPUT_CLASS}
              value={newManagerId}
              onChange={(e) => setNewManagerId(e.target.value)}
            >
              <option value="">Selecione</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label || m.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {eventType === "CONTRACT_CHANGE" && (
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
        )}
        {eventType === "WORK_SCHEDULE_CHANGE" && (
          <Field label="Nova jornada">
            <input
              className={PROFILE_INPUT_CLASS}
              value={newWorkSchedule}
              onChange={(e) => setNewWorkSchedule(e.target.value)}
              placeholder="Ex.: 220 h/mês"
            />
          </Field>
        )}
        <Field label="Motivo">
          <input className={PROFILE_INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormStatus error={error} ok={ok} />
        <SubmitButton saving={saving} label="Registrar movimentação" />
      </form>
    </ProfileManageSection>
  );
}

export function BenefitsManageForm({
  employeeId,
  canViewValues,
  onSaved,
}: {
  employeeId: string;
  canViewValues: boolean;
  onSaved: () => void;
}) {
  const [benefitId, setBenefitId] = useState("");
  const [startDate, setStartDate] = useState(todayIsoDate);
  const [endDate, setEndDate] = useState("");
  const [planName, setPlanName] = useState("");
  const [amount, setAmount] = useState("");
  const [catalog, setCatalog] = useState<
    Array<{ id: string; name: string; isFinancial?: boolean; typeLabel?: string }>
  >([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    profileFetchJson("/api/hr/benefits")
      .then((body) => {
        if (cancelled) return;
        const items =
          (
            body as {
              items?: Array<{
                id: string;
                name: string;
                isFinancial?: boolean;
                typeLabel?: string;
              }>;
            }
          ).items ?? [];
        setCatalog(items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ProfileHttpError ? err.message : "Não foi possível carregar o catálogo.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = catalog.find((c) => c.id === benefitId);

  return (
    <ProfileManageSection title="Registrar benefício">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            await profilePostJson(`/api/employees/${employeeId}/benefits`, {
              benefitId,
              startDate,
              endDate: endDate || null,
              planName: planName.trim() || null,
              amount: canViewValues && amount ? Number(amount) : null,
            });
            setOk(true);
            setPlanName("");
            setAmount("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar o benefício.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Encargo ou benefício">
          <select
            required
            className={PROFILE_INPUT_CLASS}
            value={benefitId}
            onChange={(e) => setBenefitId(e.target.value)}
          >
            <option value="">Selecione</option>
            {catalog.map((item) => (
              <option key={item.id} value={item.id}>
                {item.typeLabel ? `${item.name} · ${item.typeLabel}` : item.name}
              </option>
            ))}
          </select>
          {catalog.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Cadastre em Administração → Configurações → Estrutura Operacional (Encargos e
              Benefícios).
            </p>
          ) : null}
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
        <Field label="Fim (opcional)">
          <input
            type="date"
            className={PROFILE_INPUT_CLASS}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </Field>
        <Field label="Plano">
          <input className={PROFILE_INPUT_CLASS} value={planName} onChange={(e) => setPlanName(e.target.value)} />
        </Field>
        {canViewValues && selected?.isFinancial ? (
          <Field label="Valor (R$)">
            <input
              type="number"
              min={0}
              step="0.01"
              className={PROFILE_INPUT_CLASS}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        ) : null}
        <FormStatus error={error} ok={ok} />
        <SubmitButton
          saving={saving}
          disabled={catalog.length === 0}
          label="Registrar benefício"
        />
      </form>
    </ProfileManageSection>
  );
}

export function AbsencesManageForm({
  employeeId,
  onSaved,
}: {
  employeeId: string;
  onSaved: () => void;
}) {
  const [type, setType] = useState<(typeof HR_ABSENCE_TYPES)[number]>("VACATION");
  const [startDate, setStartDate] = useState(todayIsoDate);
  const [endDate, setEndDate] = useState("");
  const [expectedReturn, setExpectedReturn] = useState("");
  const [status, setStatus] = useState<(typeof HR_ABSENCE_STATUSES)[number]>("SCHEDULED");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <ProfileManageSection title="Registrar férias ou afastamento">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            await profilePostJson(`/api/employees/${employeeId}/absences`, {
              type,
              startDate,
              endDate: endDate || null,
              expectedReturn: expectedReturn || null,
              status,
              reason: reason.trim() || null,
            });
            setOk(true);
            setReason("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar o afastamento.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Tipo">
          <select
            className={PROFILE_INPUT_CLASS}
            value={type}
            onChange={(e) => setType(e.target.value as (typeof HR_ABSENCE_TYPES)[number])}
          >
            {HR_ABSENCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {HR_ABSENCE_TYPE_LABELS[t]}
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
        <Field label="Situação">
          <select
            className={PROFILE_INPUT_CLASS}
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof HR_ABSENCE_STATUSES)[number])}
          >
            {HR_ABSENCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Observação">
          <input className={PROFILE_INPUT_CLASS} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <FormStatus error={error} ok={ok} />
        <SubmitButton saving={saving} label="Registrar afastamento" />
      </form>
    </ProfileManageSection>
  );
}

export function NotesManageForm({
  employeeId,
  canRestricted,
  onSaved,
}: {
  employeeId: string;
  canRestricted: boolean;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<(typeof HR_NOTE_CATEGORIES)[number]>("GERAL");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const categories = HR_NOTE_CATEGORIES.filter((c) => c !== "RESTRITA" || canRestricted);

  return (
    <ProfileManageSection title="Nova observação">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            await profilePostJson(`/api/employees/${employeeId}/notes`, {
              category,
              body,
            });
            setOk(true);
            setBody("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar a observação.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Categoria">
          <select
            className={PROFILE_INPUT_CLASS}
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof HR_NOTE_CATEGORIES)[number])}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {HR_NOTE_CATEGORY_LABELS[c]}
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
        <SubmitButton saving={saving} label="Registrar observação" />
      </form>
    </ProfileManageSection>
  );
}

export function EmergencyManageForm({
  employeeId,
  onSaved,
}: {
  employeeId: string;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <ProfileManageSection title="Adicionar contato">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            await profilePostJson(`/api/employees/${employeeId}/emergency-contacts`, {
              name,
              phone,
              relationship: relationship.trim() || null,
            });
            setOk(true);
            setName("");
            setPhone("");
            setRelationship("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar o contato.");
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
        <Field label="Relação">
          <input className={PROFILE_INPUT_CLASS} value={relationship} onChange={(e) => setRelationship(e.target.value)} />
        </Field>
        <FormStatus error={error} ok={ok} />
        <SubmitButton saving={saving} label="Adicionar contato" />
      </form>
    </ProfileManageSection>
  );
}

export function EpiManageForm({
  employeeId,
  onSaved,
}: {
  employeeId: string;
  onSaved: () => void;
}) {
  const [item, setItem] = useState("");
  const [deliveredAt, setDeliveredAt] = useState(todayIsoDate);
  const [quantity, setQuantity] = useState("1");
  const [size, setSize] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <ProfileManageSection title="Registrar entrega">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            await profilePostJson(`/api/employees/${employeeId}/epi-deliveries`, {
              item,
              deliveredAt,
              quantity: Number(quantity || 1),
              size: size.trim() || null,
            });
            setOk(true);
            setItem("");
            setSize("");
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível registrar a entrega.");
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
          <input className={PROFILE_INPUT_CLASS} value={size} onChange={(e) => setSize(e.target.value)} />
        </Field>
        <FormStatus error={error} ok={ok} />
        <SubmitButton saving={saving} label="Registrar entrega" />
      </form>
    </ProfileManageSection>
  );
}

export function DocumentsManageForm({
  employeeId,
  onSaved,
}: {
  employeeId: string;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [documentType, setDocumentType] = useState("OTHER");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  return (
    <ProfileManageSection title="Anexar documento">
      <form
        className="grid gap-3 max-w-xl"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!file) {
            setError("Selecione um arquivo.");
            return;
          }
          setSaving(true);
          setError(null);
          setOk(false);
          try {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("documentType", documentType);
            fd.append("displayName", displayName.trim() || file.name);
            await profileFetchJson(`/api/employees/${employeeId}/documents`, {
              method: "POST",
              body: fd,
            });
            setOk(true);
            setDisplayName("");
            setFile(null);
            onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Não foi possível anexar o documento.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <Field label="Nome de exibição">
          <input className={PROFILE_INPUT_CLASS} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Tipo">
          <input
            className={PROFILE_INPUT_CLASS}
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
          />
        </Field>
        <Field label="Arquivo">
          <input
            type="file"
            required
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        <FormStatus error={error} ok={ok} />
        <SubmitButton saving={saving} label="Anexar" />
      </form>
    </ProfileManageSection>
  );
}
