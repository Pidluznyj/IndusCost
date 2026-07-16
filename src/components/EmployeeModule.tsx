import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { 
  Plus, 
  Search, 
  Edit2, 
  UserMinus, 
  UserCheck, 
  X,
  Loader2,
  PieChart,
  Info,
  Settings,
  Eye,
  EyeOff,
  User
} from "lucide-react";
import { cn, formatCurrency, formatNumber } from "@/src/lib/utils";
import { fetchJsonOk, fetchOk, HttpError } from "@/src/lib/http";
import { Employee, Role, CreateEmployeeInput, PayrollComponent } from "@/src/types/employee";
import {
  CONTRACT_TYPE_OPTIONS,
  createEmptyEmployeeForm,
  displayText,
  employeeToFormData,
  EPI_GLOVE_SIZE_OPTIONS,
  EPI_PANTS_SIZE_OPTIONS,
  EPI_SHOE_SIZE_OPTIONS,
  EPI_TOP_SIZE_OPTIONS,
  formatContractType,
  formatEmployeeDate,
  type EmployeeFichaTabId,
} from "@/src/lib/employeeHrUi";
import {
  assertCorporateEmailFormat,
  CorporateEmailError,
  normalizeCorporateEmail,
} from "@/src/lib/employeeCorporateEmail";
import {
  formatCpfForDisplay,
  formatCpfMask,
  formatPhoneBrMask,
  formatPhoneForDisplay,
  normalizePersonalEmail,
  validateEmployeePersonalHrForm,
} from "@/src/lib/employeePersonalHr";
import {
  MAX_ADMIN_NOTES_LEN,
  MAX_EPI_NOTES_LEN,
  MAX_PROFESSIONAL_NOTES_LEN,
  validateEmployeeEpiAdminNotesForm,
} from "@/src/lib/employeeAdminHr";
import { EmployeeFichaTabNav } from "@/src/components/employee/EmployeeFichaTabNav";
import { EmployeePersonLinkField } from "@/src/components/employee/EmployeePersonLinkField";
import { EmployeeSystemAccessCard } from "@/src/components/employee/EmployeeSystemAccessCard";
import { EmployeeSystemLinksPanel } from "@/src/components/employee/EmployeeSystemLinksPanel";
import { motion } from "motion/react";
import { SearchableSelect } from "./shared/SearchableSelect";
import { GuidedTour } from "@/src/components/tour/GuidedTour";
import { TourHelpButton } from "@/src/components/tour/TourHelpButton";
import { EMPLOYEE_TOUR_STEPS } from "@/src/tours/employeeTourSteps";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  canCreateEmployees,
  canEditEmployees,
  canManageEmployeeEpi,
  canManageEmployeeLinks,
  canManageEmployeeUserLink,
  canViewEmployeeAdministrativeData,
  canViewEmployeeCompensation,
  canViewEmployeeEmergencyContacts,
  canViewEmployeeLinks,
  canViewEmployeePersonalData,
} from "@/src/lib/operationsAdminPermissions";
import {
  EMPLOYEES_ACTIONS,
  EMPLOYEES_RESOURCE_KEYS,
} from "@/src/lib/employeesAccess";
import type { PersonFieldKey } from "@/src/lib/canonicalPerson";

const EMPLOYEE_CLASSIFICATION_OPTIONS = [
  { value: "DIRETO", label: "Direto", searchTerms: "DIRETO direto" },
  { value: "INDIRETO", label: "Indireto", searchTerms: "INDIRETO indireto" },
  { value: "APOIO", label: "Apoio", searchTerms: "APOIO apoio" },
];

const PAYROLL_TYPE_OPTIONS = [
  { value: "BENEFIT", label: "Benefício", searchTerms: "BENEFIT beneficio benefício" },
  { value: "CHARGE", label: "Encargo", searchTerms: "CHARGE encargo" },
  { value: "PROVISION", label: "Provisão", searchTerms: "PROVISION provisão provisao" },
];

const PAYROLL_CALC_OPTIONS = [
  { value: "PERCENTAGE", label: "Percentual (%)", searchTerms: "PERCENTAGE percentual" },
  { value: "FIXED", label: "Valor Fixo (R$)", searchTerms: "FIXED fixo" },
];

const INPUT_CLASS =
  "w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm";

const TEXTAREA_CLASS =
  "w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm min-h-[88px] resize-y";

const FICHA_MODAL_CLASS =
  "bg-card w-full max-w-6xl rounded-2xl border border-border shadow-2xl overflow-hidden flex flex-col max-h-[92vh]";

function EpiSizeSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (next: string) => void;
}) {
  const normalized = value ?? "";
  const isLegacy = normalized.length > 0 && !options.includes(normalized);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-muted-foreground uppercase">{label}</label>
      <select
        className={INPUT_CLASS}
        value={normalized}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {isLegacy && <option value={normalized}>{normalized}</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}

function DetailField({
  label,
  value,
  className,
  multiline,
}: {
  label: string;
  value: string;
  className?: string;
  multiline?: boolean;
}) {
  return (
    <div className={className}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("font-medium", multiline && "whitespace-pre-wrap")}>{value}</p>
    </div>
  );
}

export const EmployeeModule = () => {
  const auth = useAuth();
  const permissions = usePermissions();
  const canEdit =
    canEditEmployees(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.update);
  const canCreate =
    canCreateEmployees(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.create);
  const canWrite = canEdit || canCreate;
  const canViewPersonalHr =
    canViewEmployeePersonalData(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.personalData, EMPLOYEES_ACTIONS.view);
  const canViewSensitiveHr =
    canViewEmployeeCompensation(auth) ||
    canViewEmployeeEmergencyContacts(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.sensitiveData, EMPLOYEES_ACTIONS.view);
  const canViewAdminHr =
    canViewEmployeeAdministrativeData(auth) ||
    permissions.canPerformAction(
      EMPLOYEES_RESOURCE_KEYS.administrativeData,
      EMPLOYEES_ACTIONS.view
    );
  const canViewLinksTab =
    canViewEmployeeLinks(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.links, EMPLOYEES_ACTIONS.view);
  const canManageLinks =
    canManageEmployeeLinks(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.links, EMPLOYEES_ACTIONS.manage);
  const canManageUserLink =
    canManageEmployeeUserLink(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.userLink, EMPLOYEES_ACTIONS.manage);
  const canManageEpi =
    canManageEmployeeEpi(auth) ||
    permissions.canPerformAction(EMPLOYEES_RESOURCE_KEYS.epi, EMPLOYEES_ACTIONS.manage);
  const visibleFichaTabs = useMemo((): EmployeeFichaTabId[] => {
    const tabs: EmployeeFichaTabId[] = ["professional"];
    if (canViewPersonalHr || canEdit) tabs.push("personal");
    if (canViewSensitiveHr || canEdit) tabs.push("emergency");
    if (canManageEpi || canEdit || canViewPersonalHr) tabs.push("epi");
    if (canViewAdminHr || canViewSensitiveHr || canEdit) tabs.push("admin");
    tabs.push("notes");
    if (canViewLinksTab) tabs.push("links");
    return tabs;
  }, [
    canEdit,
    canManageEpi,
    canViewAdminHr,
    canViewLinksTab,
    canViewPersonalHr,
    canViewSensitiveHr,
  ]);
  const canAccessOperationalSettings = auth.hasAnyPermission([
    "settings.operational.view",
    "settings.operational.manage",
    "settings.view",
  ]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [payrollComponents, setPayrollComponents] = useState<PayrollComponent[]>([]);
  const [costCenterOptions, setCostCenterOptions] = useState<
    { value: string; label: string; searchTerms?: string }[]
  >([]);
  const [managerOptions, setManagerOptions] = useState<
    { value: string; label: string; searchTerms?: string }[]
  >([]);
  const [roleLookupOptions, setRoleLookupOptions] = useState<
    { value: string; label: string; searchTerms?: string }[]
  >([]);
  const [departmentSuggestions, setDepartmentSuggestions] = useState<string[]>([]);
  const [searchingCostCenters, setSearchingCostCenters] = useState(false);
  const [searchingManagers, setSearchingManagers] = useState(false);
  const [searchingRoles, setSearchingRoles] = useState(false);
  const lookupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupContextRef = useRef<{
    excludeManagerId?: string;
    selectedCostCenterId?: string;
    selectedManagerId?: string;
    selectedRoleId?: string;
  }>({});
  const [personConflicts, setPersonConflicts] = useState<
    { field: string; formValue: string | null; personValue: string | null }[]
  >([]);
  const [corporateEmailHint, setCorporateEmailHint] = useState<string | null>(null);
  const [corporateEmailError, setCorporateEmailError] = useState<string | null>(null);
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formBaseline, setFormBaseline] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [listClassificationFilter, setListClassificationFilter] = useState<"" | CreateEmployeeInput["classification"]>("");
  const [listStatusFilter, setListStatusFilter] = useState<"" | "ACTIVE" | "INACTIVE">("");
  const [showLegacyEstimates, setShowLegacyEstimates] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [isComponentModalOpen, setIsComponentModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<Employee | null>(null);
  const [employeeFichaTab, setEmployeeFichaTab] = useState<EmployeeFichaTabId>("professional");
  const [viewFichaTab, setViewFichaTab] = useState<EmployeeFichaTabId>("professional");

  // Form State
  const [formData, setFormData] = useState<CreateEmployeeInput>(createEmptyEmployeeForm());

  const [compFormData, setCompFormData] = useState({
    name: "",
    type: "BENEFIT",
    calculationType: "PERCENTAGE",
    value: 0,
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const empData = await fetchJsonOk<Employee[]>("/api/employees");
      setEmployees(Array.isArray(empData) ? empData : []);

      try {
        const roleLookup = await fetchJsonOk<{ rows: { id: string; name: string }[] }>(
          "/api/employees/lookups/roles"
        );
        setRoles(
          (roleLookup.rows ?? []).map((r) => ({
            id: r.id,
            name: r.name,
            baseSalary: 0,
            monthlyHours: 220,
          }))
        );
      } catch {
        if (canAccessOperationalSettings) {
          const roleData = await fetchJsonOk<Role[]>("/api/roles");
          setRoles(Array.isArray(roleData) ? roleData : []);
        } else {
          setRoles([]);
        }
      }

      if (canAccessOperationalSettings || canEdit) {
        try {
          const compData = await fetchJsonOk<PayrollComponent[]>("/api/payroll-components");
          setPayrollComponents(Array.isArray(compData) ? compData : []);
        } catch {
          setPayrollComponents([]);
        }
      }
    } catch (error) {
      console.error("Erro ao buscar dados:", error);
      alert(error instanceof Error ? error.message : "Não foi possível carregar colaboradores.");
    } finally {
      setLoading(false);
    }
  };

  const loadProfessionalLookups = async (opts?: {
    excludeManagerId?: string;
    selectedCostCenterId?: string;
    selectedManagerId?: string;
    selectedRoleId?: string;
    costCenterQ?: string;
    managerQ?: string;
    roleQ?: string;
    departmentQ?: string;
  }) => {
    const ctx = {
      excludeManagerId: opts?.excludeManagerId ?? lookupContextRef.current.excludeManagerId,
      selectedCostCenterId:
        opts?.selectedCostCenterId ?? lookupContextRef.current.selectedCostCenterId,
      selectedManagerId: opts?.selectedManagerId ?? lookupContextRef.current.selectedManagerId,
      selectedRoleId: opts?.selectedRoleId ?? lookupContextRef.current.selectedRoleId,
    };
    lookupContextRef.current = ctx;
    try {
      const ccQs = new URLSearchParams();
      if (opts?.costCenterQ) ccQs.set("q", opts.costCenterQ);
      if (ctx.selectedCostCenterId) ccQs.set("selectedId", ctx.selectedCostCenterId);
      const mgrQs = new URLSearchParams();
      if (opts?.managerQ) mgrQs.set("q", opts.managerQ);
      if (ctx.excludeManagerId) mgrQs.set("excludeId", ctx.excludeManagerId);
      if (ctx.selectedManagerId) {
        mgrQs.set("selectedId", ctx.selectedManagerId);
        mgrQs.set("includeInactive", "1");
      }
      const roleQs = new URLSearchParams();
      if (opts?.roleQ) roleQs.set("q", opts.roleQ);
      const deptQs = new URLSearchParams();
      if (opts?.departmentQ) deptQs.set("q", opts.departmentQ);

      const [cc, mgr, roleLookup, depts] = await Promise.all([
        fetchJsonOk<{ rows: { id: string; label: string; code: string; name: string }[] }>(
          `/api/employees/lookups/cost-centers?${ccQs.toString()}`
        ),
        fetchJsonOk<{
          rows: { id: string; label: string; displayName: string; department: string }[];
        }>(`/api/employees/lookups/managers?${mgrQs.toString()}`),
        fetchJsonOk<{ rows: { id: string; name: string; label: string }[] }>(
          `/api/employees/lookups/roles?${roleQs.toString()}`
        ),
        fetchJsonOk<{ rows: { value: string; label: string }[] }>(
          `/api/employees/lookups/departments?${deptQs.toString()}`
        ),
      ]);
      setCostCenterOptions(
        (cc.rows ?? []).map((r) => ({
          value: r.id,
          label: r.label,
          searchTerms: `${r.code} ${r.name}`,
        }))
      );
      setManagerOptions(
        (mgr.rows ?? []).map((r) => ({
          value: r.id,
          label: r.label,
          searchTerms: `${r.displayName} ${r.department}`,
        }))
      );
      let roleOpts = (roleLookup.rows ?? []).map((r) => ({
        value: r.id,
        label: r.name,
        searchTerms: r.name,
      }));
      if (
        ctx.selectedRoleId &&
        !roleOpts.some((o) => o.value === ctx.selectedRoleId) &&
        roles.some((r) => r.id === ctx.selectedRoleId)
      ) {
        const pinned = roles.find((r) => r.id === ctx.selectedRoleId)!;
        roleOpts = [
          { value: pinned.id, label: pinned.name, searchTerms: pinned.name },
          ...roleOpts,
        ];
      }
      setRoleLookupOptions(roleOpts);
      setDepartmentSuggestions((depts.rows ?? []).map((r) => r.value));
    } catch (error) {
      console.error("Erro ao carregar lookups RH:", error);
    }
  };

  const scheduleLookupSearch = (
    kind: "costCenter" | "manager" | "role" | "department",
    term: string
  ) => {
    if (lookupDebounceRef.current) clearTimeout(lookupDebounceRef.current);
    const setSearching =
      kind === "costCenter"
        ? setSearchingCostCenters
        : kind === "manager"
          ? setSearchingManagers
          : kind === "role"
            ? setSearchingRoles
            : null;
    setSearching?.(true);
    lookupDebounceRef.current = setTimeout(() => {
      void (async () => {
        try {
          await loadProfessionalLookups({
            costCenterQ: kind === "costCenter" ? term : undefined,
            managerQ: kind === "manager" ? term : undefined,
            roleQ: kind === "role" ? term : undefined,
            departmentQ: kind === "department" ? term : undefined,
          });
        } finally {
          setSearching?.(false);
        }
      })();
    }, 300);
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    return () => {
      if (lookupDebounceRef.current) clearTimeout(lookupDebounceRef.current);
    };
  }, []);

  const validateCorporateEmailField = async (raw: string) => {
    const normalized = normalizeCorporateEmail(raw);
    setFormData((prev) => ({ ...prev, corporateEmail: normalized ?? "" }));
    setCorporateEmailHint(null);
    setCorporateEmailError(null);
    if (!normalized) return true;
    try {
      assertCorporateEmailFormat(normalized);
    } catch (e) {
      const msg =
        e instanceof CorporateEmailError
          ? e.message
          : "Informe um e-mail corporativo válido.";
      setCorporateEmailError(msg);
      return false;
    }
    try {
      const qs = new URLSearchParams({ email: normalized });
      if (editingEmployee?.id) qs.set("excludeEmployeeId", editingEmployee.id);
      const data = await fetchJsonOk<{
        ok: boolean;
        message: string | null;
        hint: string | null;
        code: string | null;
      }>(`/api/employees/lookups/corporate-email?${qs.toString()}`);
      if (!data.ok) {
        setCorporateEmailError(data.message || "E-mail corporativo inválido.");
        return false;
      }
      setCorporateEmailHint(data.hint);
      return true;
    } catch (e) {
      if (e instanceof HttpError) {
        setCorporateEmailError(e.message);
        return false;
      }
      console.error(e);
      return true;
    }
  };

  const handleOpenModal = (employee?: Employee) => {
    setEmployeeFichaTab("professional");
    setFormError(null);
    setPersonConflicts([]);
    setCorporateEmailHint(null);
    setCorporateEmailError(null);
    if (employee) {
      if (
        employee.personalPiiRedacted ||
        employee.emergencyContactRedacted ||
        employee.compensationRedacted
      ) {
        alert(
          "Sem permissão para editar dados pessoais/administrativos. É necessário employees.edit."
        );
        return;
      }
      setEditingEmployee(employee);
      const next = employeeToFormData(employee);
      setFormData(next);
      setFormBaseline(JSON.stringify(next));
      void loadProfessionalLookups({
        excludeManagerId: employee.id,
        selectedCostCenterId: employee.costCenterId ?? employee.financialCostCenter?.id,
        selectedManagerId: employee.managerId ?? employee.manager?.id,
        selectedRoleId: employee.roleId,
      });
    } else {
      setEditingEmployee(null);
      const next = createEmptyEmployeeForm(roles[0]?.id || "");
      setFormData(next);
      setFormBaseline(JSON.stringify(next));
      void loadProfessionalLookups({ selectedRoleId: next.roleId || undefined });
    }
    setIsModalOpen(true);
  };

  const closeEmployeeModal = () => {
    if (savingEmployee) return;
    const dirty = JSON.stringify(formData) !== formBaseline;
    if (dirty && !window.confirm("Há alterações não salvas. Deseja fechar mesmo assim?")) {
      return;
    }
    setIsModalOpen(false);
  };

  const openEmployeeView = (employee: Employee) => {
    setViewFichaTab("professional");
    setViewingEmployee(employee);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingEmployee) return;
    setFormError(null);
    const emailOk = await validateCorporateEmailField(formData.corporateEmail ?? "");
    if (!emailOk) {
      setEmployeeFichaTab("professional");
      setFormError("Corrija o e-mail corporativo antes de salvar.");
      return;
    }
    if (!formData.roleId) {
      setEmployeeFichaTab("professional");
      setFormError("Selecione um cargo oficial.");
      return;
    }
    if (!formData.costCenterId && (!editingEmployee || !formData.costCenter)) {
      setEmployeeFichaTab("professional");
      setFormError("Selecione um centro de custo oficial do financeiro.");
      return;
    }
    const personalErr = validateEmployeePersonalHrForm(
      {
        cpf: formData.cpf,
        phone: formData.phone,
        personalEmail: formData.personalEmail,
        birthDate: formData.birthDate,
        rg: formData.rg,
        address: formData.address,
        emergencyContactName: formData.emergencyContactName,
        emergencyContactPhone: formData.emergencyContactPhone,
        emergencyContactRelationship: formData.emergencyContactRelationship,
      },
      editingEmployee
        ? {
            allowLegacy: true,
            previous: {
              cpf: editingEmployee.cpf,
              phone: editingEmployee.phone,
              personalEmail: editingEmployee.personalEmail,
              emergencyContactPhone: editingEmployee.emergencyContactPhone,
            },
          }
        : { allowLegacy: false }
    );
    if (personalErr) {
      // Heurística: emergência vs pessoal
      const emergencyIssue =
        /emergência/i.test(personalErr) || /contato de emergência/i.test(personalErr);
      setEmployeeFichaTab(emergencyIssue ? "emergency" : "personal");
      setFormError(personalErr);
      return;
    }
    const adminErr = validateEmployeeEpiAdminNotesForm(
      {
        shirtSize: formData.shirtSize,
        pantsSize: formData.pantsSize,
        jacketSize: formData.jacketSize,
        gloveSize: formData.gloveSize,
        shoeSize: formData.shoeSize,
        epiNotes: formData.epiNotes,
        professionalNotes: formData.professionalNotes,
        adminNotes: formData.adminNotes,
        salary: formData.salary,
        monthlyHours: formData.monthlyHours,
        productivity: formData.productivity,
      },
      editingEmployee
        ? {
            allowLegacyEpi: true,
            previousEpi: {
              shirtSize: editingEmployee.shirtSize,
              pantsSize: editingEmployee.pantsSize,
              jacketSize: editingEmployee.jacketSize,
              gloveSize: editingEmployee.gloveSize,
              shoeSize: editingEmployee.shoeSize,
            },
          }
        : { allowLegacyEpi: false }
    );
    if (adminErr) {
      const tab: EmployeeFichaTabId = /EPI|tamanho|Camiseta|Calça|Jaqueta|Luva|Calçado/i.test(
        adminErr
      )
        ? "epi"
        : /salarial|Jornada|Produtividade/i.test(adminErr)
          ? "admin"
          : "notes";
      setEmployeeFichaTab(tab);
      setFormError(adminErr);
      return;
    }
    const method = editingEmployee ? "PUT" : "POST";
    const url = editingEmployee ? `/api/employees/${editingEmployee.id}` : "/api/employees";

    setSavingEmployee(true);
    try {
      await fetchJsonOk(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          costCenterId: formData.costCenterId || null,
          managerId: formData.managerId || null,
          corporateEmail: normalizeCorporateEmail(formData.corporateEmail) || null,
          personId:
            formData.personId && !String(formData.personId).includes(":")
              ? formData.personId
              : formData.personId?.startsWith("person:")
                ? formData.personId.slice("person:".length)
                : null,
          personSourceKind: formData.personSourceKind || null,
          personSourceId: formData.personSourceId || null,
          createNewPerson: formData.createNewPerson !== false && !formData.personId && !formData.personSourceId,
          personFieldResolutions: formData.personFieldResolutions || undefined,
        }),
      });
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      const msg =
        error instanceof Error ? error.message : "Não foi possível salvar o colaborador.";
      setFormError(msg);
      if (
        error instanceof HttpError &&
        (error.code === "DUPLICATE_CORPORATE_EMAIL" ||
          error.code === "CORPORATE_EMAIL_APPUSER_CONFLICT" ||
          error.code === "INVALID_CORPORATE_EMAIL")
      ) {
        setCorporateEmailError(msg);
        setEmployeeFichaTab("professional");
      }
      if (error instanceof HttpError && error.conflicts?.length) {
        setPersonConflicts(error.conflicts);
        setEmployeeFichaTab("professional");
      } else if (
        error instanceof HttpError &&
        (error.code === "FIELD_CONFLICTS" || msg.toLowerCase().includes("conflito"))
      ) {
        try {
          const preview = await fetchJsonOk<{
            conflicts: { field: string; formValue: string | null; personValue: string | null }[];
          }>("/api/people/preview-employee-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              personId: formData.personId || null,
              sourceKind: formData.personSourceKind,
              sourceId: formData.personSourceId,
              name: formData.name,
              socialName: formData.socialName,
              corporateEmail: formData.corporateEmail,
              personalEmail: formData.personalEmail,
              cpf: formData.cpf,
              phone: formData.phone,
            }),
          });
          setPersonConflicts(preview.conflicts ?? []);
          setEmployeeFichaTab("professional");
        } catch {
          /* ignore */
        }
      }
    } finally {
      setSavingEmployee(false);
    }
  };

  const handleComponentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetchJsonOk("/api/payroll-components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(compFormData),
      });
      setIsComponentModalOpen(false);
      fetchData();
    } catch (error) {
      console.error("Erro ao salvar componente:", error);
      alert(error instanceof Error ? error.message : "Não foi possível salvar o componente de folha.");
    }
  };

  const toggleComponent = (id: string) => {
    const current = formData.componentIds || [];
    if (current.includes(id)) {
      setFormData({ ...formData, componentIds: current.filter(c => c !== id) });
    } else {
      setFormData({ ...formData, componentIds: [...current, id] });
    }
  };

  const toggleStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await fetchOk(`/api/employees/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      fetchData();
    } catch (error) {
      console.error("Erro ao alterar status:", error);
      alert(error instanceof Error ? error.message : "Não foi possível alterar o status.");
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return employees.filter((emp) => {
      if (listClassificationFilter && emp.classification !== listClassificationFilter) return false;
      if (listStatusFilter && emp.status !== listStatusFilter) return false;
      if (!q) return true;
      return (
        (emp.name ?? "").toLowerCase().includes(q) ||
        (emp.socialName ?? "").toLowerCase().includes(q) ||
        (emp.corporateEmail ?? "").toLowerCase().includes(q) ||
        (emp.Role?.name ?? "").toLowerCase().includes(q) ||
        (emp.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [employees, searchTerm, listClassificationFilter, listStatusFilter]);

  const clearListFilters = () => {
    setSearchTerm("");
    setListClassificationFilter("");
    setListStatusFilter("");
  };

  const tableColSpan = 6 + (showLegacyEstimates && canViewSensitiveHr ? 3 : 0);

  return (
    <div className="space-y-6" data-tour="employees-root">
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 flex gap-3 items-start">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Módulo administrativo de Pessoas/RH</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            As informações desta tela não alteram o CIU, o custo dos produtos, o HH global, roteiros de produção,
            formação de preço ou integrações Nomus.
          </p>
        </div>
      </div>

      {canAccessOperationalSettings && (
        <div className="rounded-xl border border-dashed border-border bg-card px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Cargos e verbas (estrutura legada/operacional)</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cargos e verbas globais continuam em Configurações → Operacional. Alterações lá podem impactar
              roteiros e cálculos industriais existentes.
            </p>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent transition-colors text-sm font-medium shrink-0"
          >
            <Settings className="h-4 w-4" />
            Abrir Configurações
          </Link>
        </div>
      )}

      {/* Header Actions */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        data-tour="employees-toolbar"
      >
        <div className="flex-1 flex flex-col gap-2">
          <div className="flex flex-col lg:flex-row lg:items-center gap-2">
            <div className="relative flex-1 max-w-md min-w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Buscar por nome, cargo ou setor..."
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <select
              className="min-w-[170px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listClassificationFilter}
              onChange={(e) => setListClassificationFilter(e.target.value as any)}
            >
              <option value="">Todas as classificações</option>
              {EMPLOYEE_CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className="min-w-[150px] rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
              value={listStatusFilter}
              onChange={(e) => setListStatusFilter(e.target.value as any)}
            >
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativo</option>
              <option value="INACTIVE">Inativo</option>
            </select>

            <button
              type="button"
              onClick={clearListFilters}
              disabled={!searchTerm.trim() && !listClassificationFilter && !listStatusFilter}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium disabled:opacity-50 disabled:hover:bg-card"
              title="Limpar filtros"
            >
              <X className="h-4 w-4" />
              Limpar
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Exibindo <span className="font-bold text-foreground">{filteredEmployees.length}</span> de{" "}
            <span className="font-bold text-foreground">{employees.length}</span> colaborador(es).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <TourHelpButton onClick={() => setTourOpen(true)} />
          {canViewSensitiveHr ? (
          <button
            type="button"
            onClick={() => setShowLegacyEstimates((v) => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium"
            title="Mostrar ou ocultar colunas de estimativa legada"
          >
            {showLegacyEstimates ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showLegacyEstimates ? "Ocultar estimativas" : "Mostrar estimativas"}
          </button>
          ) : null}
          {canEdit && (
            <button
              onClick={() => setIsComponentModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-card hover:bg-accent transition-colors text-sm font-medium"
            >
              <PieChart className="h-4 w-4" />
              Configurar Verbas
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => handleOpenModal()}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:opacity-90 transition-opacity text-sm"
            >
              <Plus className="h-4 w-4" />
              Novo Colaborador
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div
        className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
        data-tour="employees-table"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-accent/50 border-b border-border">
                <th className="p-4 font-semibold text-sm">Colaborador</th>
                <th className="p-4 font-semibold text-sm">Cargo / Setor</th>
                <th className="p-4 font-semibold text-sm">Contrato</th>
                <th className="p-4 font-semibold text-sm">Admissão</th>
                {showLegacyEstimates && canViewSensitiveHr && (
                  <>
                    <th className="p-4 font-semibold text-sm text-muted-foreground">Ref. salarial</th>
                    <th className="p-4 font-semibold text-sm text-muted-foreground">Estimativa mensal</th>
                    <th className="p-4 font-semibold text-sm text-muted-foreground text-center">Estimativa /h prod.</th>
                  </>
                )}
                <th className="p-4 font-semibold text-sm">Status</th>
                <th className="p-4 font-semibold text-sm text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={tableColSpan} className="p-8 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
                    <p className="mt-2 text-sm text-muted-foreground">Carregando colaboradores...</p>
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={tableColSpan} className="p-8 text-center text-muted-foreground">
                    Nenhum colaborador encontrado.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map((emp) => (
                  <tr key={emp.id} className="hover:bg-accent/30 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-xs">
                          {emp.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{emp.name}</p>
                          {emp.socialName?.trim() && (
                            <p className="text-xs text-muted-foreground">Apelido: {emp.socialName}</p>
                          )}
                          <p className="text-xs text-muted-foreground">{emp.costCenter}</p>
                          {emp.corporateEmail ? (
                            <p className="text-[10px] text-muted-foreground mt-0.5">{emp.corporateEmail}</p>
                          ) : null}
                          {emp.appUser ? (
                            <p className="text-[10px] text-emerald-700 mt-0.5">
                              Usuário: {emp.appUser.email}
                              {!emp.appUser.isActive ? " (inativo)" : ""}
                            </p>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-0.5">Sem usuário de acesso</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <p className="text-sm font-medium">{emp.Role.name}</p>
                      <p className="text-xs text-muted-foreground">{emp.department}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">{formatContractType(emp.contractType)}</p>
                    </td>
                    <td className="p-4">
                      <p className="text-sm">{formatEmployeeDate(emp.admissionDate)}</p>
                    </td>
                    {showLegacyEstimates && canViewSensitiveHr && (
                      <>
                        <td className="p-4">
                          <p className="text-sm text-muted-foreground">{formatCurrency(emp.salary)}</p>
                          <p className="text-[10px] text-muted-foreground">{emp.monthlyHours}h/mês · ref. admin.</p>
                        </td>
                        <td className="p-4">
                          <p className="text-sm text-muted-foreground">{formatCurrency(emp.costs?.totalMonthlyCost || 0)}</p>
                          <p className="text-[10px] text-muted-foreground">Estimativa legada</p>
                        </td>
                        <td className="p-4 text-center">
                          <p className="text-sm text-muted-foreground">{formatCurrency(emp.costs?.costPerProductiveHour || 0, 5)}</p>
                          <p className="text-[10px] text-muted-foreground">{formatNumber(emp.productivity, 2)}% prod.</p>
                        </td>
                      </>
                    )}
                    <td className="p-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                        emp.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        <div className={cn("h-1.5 w-1.5 rounded-full", emp.status === "ACTIVE" ? "bg-green-600" : "bg-red-600")} />
                        {emp.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button 
                          onClick={() => openEmployeeView(emp)}
                          className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                          title="Ver ficha do colaborador"
                        >
                          <User className="h-4 w-4" />
                        </button>
                        {canEdit && (
                          <>
                            <button 
                              onClick={() => handleOpenModal(emp)}
                              className="p-2 rounded-md hover:bg-accent text-muted-foreground hover:text-primary transition-all"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button 
                              onClick={() => toggleStatus(emp.id, emp.status)}
                              className={cn(
                                "p-2 rounded-md hover:bg-accent transition-all",
                                emp.status === "ACTIVE" ? "text-red-500" : "text-green-500"
                              )}
                              title={emp.status === "ACTIVE" ? "Inativar" : "Ativar"}
                            >
                              {emp.status === "ACTIVE" ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Employee Form */}
      {isModalOpen && canWrite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={FICHA_MODAL_CLASS}
          >
            <div className="p-5 sm:p-6 border-b border-border flex items-center justify-between bg-accent/30 shrink-0">
              <h3 className="text-xl font-bold">{editingEmployee ? "Editar Colaborador" : "Novo Colaborador"}</h3>
              <button type="button" onClick={closeEmployeeModal} className="p-2 hover:bg-accent rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="flex flex-col lg:flex-row flex-1 min-h-0">
                <EmployeeFichaTabNav
                  activeTab={employeeFichaTab}
                  onTabChange={setEmployeeFichaTab}
                  layout="sidebar"
                  visibleTabIds={visibleFichaTabs}
                />

                <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6">
                  <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2 mb-5">
                    Dados pessoais e administrativos devem ser acessados apenas por pessoas autorizadas do RH.
                  </p>

                  {employeeFichaTab === "professional" && (
                    <div className="space-y-6">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-primary/80 mb-3">
                          Identificação profissional
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <EmployeePersonLinkField
                            inputClassName={INPUT_CLASS}
                            formSlice={{
                              name: formData.name,
                              socialName: formData.socialName,
                              corporateEmail: formData.corporateEmail,
                              personalEmail: formData.personalEmail,
                              cpf: formData.cpf,
                              phone: formData.phone,
                            }}
                            selection={{
                              personId: formData.personId || null,
                              personSourceKind: formData.personSourceKind || null,
                              personSourceId: formData.personSourceId || null,
                              createNewPerson: formData.createNewPerson !== false,
                            }}
                            fieldResolutions={formData.personFieldResolutions}
                            externalConflicts={personConflicts as {
                              field: PersonFieldKey | string;
                              formValue: string | null;
                              personValue: string | null;
                            }[]}
                            excludeEmployeeId={editingEmployee?.id}
                            editingLegacyWithoutPerson={Boolean(
                              editingEmployee && !editingEmployee.personId && !editingEmployee.person
                            )}
                            onSelectionChange={(next) =>
                              setFormData((prev) => ({
                                ...prev,
                                personId: next.personId ?? "",
                                personSourceKind: next.personSourceKind,
                                personSourceId: next.personSourceId,
                                createNewPerson: next.createNewPerson,
                                personFieldResolutions: next.createNewPerson
                                  ? undefined
                                  : prev.personFieldResolutions,
                              }))
                            }
                            onFormSliceChange={(patch) =>
                              setFormData((prev) => ({ ...prev, ...patch }))
                            }
                            onResolutionsChange={(next) =>
                              setFormData((prev) => ({
                                ...prev,
                                personFieldResolutions: next,
                              }))
                            }
                            onConflictsChange={setPersonConflicts}
                          />
                          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Nome completo *
                            </label>
                            <input
                              required
                              type="text"
                              className={INPUT_CLASS}
                              value={formData.name}
                              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Nome social / apelido
                            </label>
                            <input
                              type="text"
                              className={INPUT_CLASS}
                              value={formData.socialName ?? ""}
                              onChange={(e) =>
                                setFormData({ ...formData, socialName: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              E-mail corporativo
                            </label>
                            <input
                              type="email"
                              autoComplete="off"
                              className={INPUT_CLASS}
                              placeholder="nome.sobrenome@empresa.com"
                              value={formData.corporateEmail ?? ""}
                              onChange={(e) => {
                                setCorporateEmailError(null);
                                setCorporateEmailHint(null);
                                setFormData({ ...formData, corporateEmail: e.target.value });
                              }}
                              onBlur={() => {
                                void validateCorporateEmailField(formData.corporateEmail ?? "");
                              }}
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Fonte do vínculo profissional. Opcional em colaboradores antigos.
                              Não cria nem altera o login do sistema automaticamente. O vínculo com
                              AppUser é feito depois, na ficha (Acesso ao sistema), com confirmação.
                            </p>
                            {corporateEmailError && (
                              <p className="text-xs text-destructive">{corporateEmailError}</p>
                            )}
                            {!corporateEmailError && corporateEmailHint && (
                              <p className="text-xs text-amber-900 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1.5">
                                {corporateEmailHint}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-primary/80 mb-3">
                          Estrutura
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Cargo *
                            </label>
                            <SearchableSelect
                              required
                              placeholder="Selecione o cargo..."
                              options={
                                roleLookupOptions.length > 0
                                  ? roleLookupOptions
                                  : roles.map((role) => ({
                                      value: role.id,
                                      label: role.name,
                                      searchTerms: role.name,
                                    }))
                              }
                              value={formData.roleId}
                              onChange={(v) => {
                                lookupContextRef.current.selectedRoleId = v || undefined;
                                setFormData({ ...formData, roleId: v });
                              }}
                              remoteSearch
                              searching={searchingRoles}
                              onSearchTermChange={(term) => scheduleLookupSearch("role", term)}
                              unknownSelectionLabel="Cargo não listado"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Departamento / setor *
                            </label>
                            <input
                              required
                              type="text"
                              list="employee-department-suggestions"
                              className={INPUT_CLASS}
                              value={formData.department}
                              onChange={(e) => {
                                const next = e.target.value;
                                setFormData({ ...formData, department: next });
                                scheduleLookupSearch("department", next);
                              }}
                              onFocus={() => scheduleLookupSearch("department", formData.department)}
                              autoComplete="off"
                            />
                            <datalist id="employee-department-suggestions">
                              {departmentSuggestions.map((d) => (
                                <option key={d} value={d} />
                              ))}
                            </datalist>
                            <p className="text-[11px] text-muted-foreground">
                              Sem cadastro oficial de departamentos — texto livre com sugestões já
                              usadas.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Centro de custo *
                            </label>
                            <SearchableSelect
                              required={!formData.costCenterId && !formData.costCenter}
                              placeholder="Buscar centro de custo..."
                              options={costCenterOptions}
                              value={formData.costCenterId ?? ""}
                              onChange={(v) => {
                                const opt = costCenterOptions.find((o) => o.value === v);
                                lookupContextRef.current.selectedCostCenterId = v || undefined;
                                setFormData({
                                  ...formData,
                                  costCenterId: v,
                                  costCenter: opt?.label ?? formData.costCenter,
                                });
                              }}
                              remoteSearch
                              searching={searchingCostCenters}
                              onSearchTermChange={(term) =>
                                scheduleLookupSearch("costCenter", term)
                              }
                              unknownSelectionLabel={
                                formData.costCenter
                                  ? `${formData.costCenter} (legado — selecione o CC oficial)`
                                  : "Centro não listado"
                              }
                            />
                          </div>
                          <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Gestor responsável
                            </label>
                            <SearchableSelect
                              placeholder="Buscar colaborador ativo..."
                              options={[
                                { value: "", label: "— Sem gestor —", searchTerms: "sem" },
                                ...managerOptions,
                              ]}
                              value={formData.managerId ?? ""}
                              onChange={(v) => {
                                const opt = managerOptions.find((o) => o.value === v);
                                lookupContextRef.current.selectedManagerId = v || undefined;
                                setFormData({
                                  ...formData,
                                  managerId: v,
                                  managerName: opt?.label ?? "",
                                });
                              }}
                              remoteSearch
                              searching={searchingManagers}
                              onSearchTermChange={(term) => scheduleLookupSearch("manager", term)}
                              pinOptionValues={[""]}
                              unknownSelectionLabel={
                                formData.managerName
                                  ? `${formData.managerName} (histórico)`
                                  : "Gestor não listado"
                              }
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-primary/80 mb-3">
                          Vínculo
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Classificação *
                            </label>
                            <SearchableSelect
                              required
                              placeholder="Classificação..."
                              options={EMPLOYEE_CLASSIFICATION_OPTIONS}
                              value={formData.classification}
                              onChange={(v) => setFormData({ ...formData, classification: v })}
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Mão de obra: Direto / Indireto / Apoio.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Tipo de contrato
                            </label>
                            <SearchableSelect
                              placeholder="Tipo de contrato..."
                              options={CONTRACT_TYPE_OPTIONS}
                              value={formData.contractType ?? ""}
                              onChange={(v) => setFormData({ ...formData, contractType: v })}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Data de admissão
                            </label>
                            <input
                              type="date"
                              className={INPUT_CLASS}
                              value={formData.admissionDate ?? ""}
                              onChange={(e) =>
                                setFormData({ ...formData, admissionDate: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Data de desligamento
                            </label>
                            <input
                              type="date"
                              className={INPUT_CLASS}
                              value={formData.terminationDate ?? ""}
                              onChange={(e) =>
                                setFormData({ ...formData, terminationDate: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-xs font-bold text-muted-foreground uppercase">
                              Status
                            </label>
                            <select
                              className={INPUT_CLASS}
                              value={formData.status ?? "ACTIVE"}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  status: e.target.value as CreateEmployeeInput["status"],
                                })
                              }
                            >
                              <option value="ACTIVE">Ativo</option>
                              <option value="INACTIVE">Inativo</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {employeeFichaTab === "personal" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">CPF</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          className={INPUT_CLASS}
                          placeholder="000.000.000-00"
                          value={formData.cpf ?? ""}
                          onChange={(e) =>
                            setFormData({ ...formData, cpf: formatCpfMask(e.target.value) })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">RG</label>
                        <input
                          type="text"
                          autoComplete="off"
                          className={INPUT_CLASS}
                          maxLength={32}
                          value={formData.rg ?? ""}
                          onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Data de nascimento
                        </label>
                        <input
                          type="date"
                          className={INPUT_CLASS}
                          value={formData.birthDate ?? ""}
                          onChange={(e) =>
                            setFormData({ ...formData, birthDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Telefone
                        </label>
                        <input
                          type="tel"
                          autoComplete="tel"
                          className={INPUT_CLASS}
                          placeholder="(00) 00000-0000"
                          value={formData.phone ?? ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              phone: formatPhoneBrMask(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          E-mail pessoal
                        </label>
                        <input
                          type="email"
                          autoComplete="email"
                          className={INPUT_CLASS}
                          value={formData.personalEmail ?? ""}
                          onChange={(e) =>
                            setFormData({ ...formData, personalEmail: e.target.value })
                          }
                          onBlur={() => {
                            try {
                              const normalized = normalizePersonalEmail(formData.personalEmail);
                              setFormData((prev) => ({
                                ...prev,
                                personalEmail: normalized ?? "",
                              }));
                            } catch {
                              /* validação no save */
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Endereço
                        </label>
                        <textarea
                          className={TEXTAREA_CLASS}
                          maxLength={500}
                          value={formData.address ?? ""}
                          onChange={(e) =>
                            setFormData({ ...formData, address: e.target.value })
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Texto livre (sem consulta de CEP neste momento). Dados sensíveis —
                          visíveis só com permissão de edição de RH.
                        </p>
                      </div>
                    </div>
                  )}

                  {employeeFichaTab === "emergency" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
                      <div className="space-y-1.5 md:col-span-2">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Nome do contato
                        </label>
                        <input
                          type="text"
                          autoComplete="off"
                          className={INPUT_CLASS}
                          maxLength={120}
                          value={formData.emergencyContactName ?? ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              emergencyContactName: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Telefone
                        </label>
                        <input
                          type="tel"
                          autoComplete="off"
                          className={INPUT_CLASS}
                          placeholder="(00) 00000-0000"
                          value={formData.emergencyContactPhone ?? ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              emergencyContactPhone: formatPhoneBrMask(e.target.value),
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Grau / relação
                        </label>
                        <input
                          type="text"
                          autoComplete="off"
                          className={INPUT_CLASS}
                          maxLength={80}
                          value={formData.emergencyContactRelationship ?? ""}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              emergencyContactRelationship: e.target.value,
                            })
                          }
                        />
                      </div>
                      <p className="md:col-span-2 text-[11px] text-muted-foreground">
                        Se preencher o contato, nome e telefone são obrigatórios. Permanecem só no
                        colaborador (não na pessoa canônica).
                      </p>
                    </div>
                  )}

                  {employeeFichaTab === "epi" && (
                    <div className="space-y-4">
                      <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                        Preferência de tamanho do colaborador — <strong>não</strong> registra entrega,
                        estoque, almoxarifado nem movimentação. Não há vínculo com Inventário/PPE.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        <EpiSizeSelect label="Camiseta / camisa" value={formData.shirtSize ?? ""} options={EPI_TOP_SIZE_OPTIONS} onChange={(v) => setFormData({ ...formData, shirtSize: v })} />
                        <EpiSizeSelect label="Calça" value={formData.pantsSize ?? ""} options={EPI_PANTS_SIZE_OPTIONS} onChange={(v) => setFormData({ ...formData, pantsSize: v })} />
                        <EpiSizeSelect label="Jaqueta / blusa" value={formData.jacketSize ?? ""} options={EPI_TOP_SIZE_OPTIONS} onChange={(v) => setFormData({ ...formData, jacketSize: v })} />
                        <EpiSizeSelect label="Luva" value={formData.gloveSize ?? ""} options={EPI_GLOVE_SIZE_OPTIONS} onChange={(v) => setFormData({ ...formData, gloveSize: v })} />
                        <EpiSizeSelect label="Calçado / bota" value={formData.shoeSize ?? ""} options={EPI_SHOE_SIZE_OPTIONS} onChange={(v) => setFormData({ ...formData, shoeSize: v })} />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Observações de EPI / uniforme
                        </label>
                        <textarea
                          className={TEXTAREA_CLASS}
                          maxLength={MAX_EPI_NOTES_LEN}
                          value={formData.epiNotes ?? ""}
                          onChange={(e) => setFormData({ ...formData, epiNotes: e.target.value })}
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Máx. {MAX_EPI_NOTES_LEN} caracteres.
                        </p>
                      </div>
                    </div>
                  )}

                  {employeeFichaTab === "admin" && (
                    <div className="space-y-5">
                      <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                        Referência para estimativas de RH e para o rateio global de HH (quando a fábrica
                        usa salário dos colaboradores). Não cria folha oficial, matrícula bancária nem
                        dados bancários. Verbas vêm do cadastro oficial{" "}
                        <span className="font-medium">PayrollComponent</span> (Configurações →
                        Operacional).
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-muted-foreground uppercase">
                            Referência salarial (R$)
                          </label>
                          <input
                            required
                            type="number"
                            min={0}
                            step="0.00001"
                            className={INPUT_CLASS}
                            value={formData.salary}
                            onChange={(e) =>
                              setFormData({ ...formData, salary: parseFloat(e.target.value) })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-muted-foreground uppercase">
                            Jornada (horas/mês)
                          </label>
                          <input
                            required
                            type="number"
                            min={1}
                            max={744}
                            className={INPUT_CLASS}
                            value={formData.monthlyHours}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                monthlyHours: parseInt(e.target.value, 10),
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-muted-foreground uppercase">
                            Produtividade (%)
                          </label>
                          <input
                            required
                            type="number"
                            min={0}
                            max={200}
                            step="0.00001"
                            className={INPUT_CLASS}
                            value={formData.productivity}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                productivity: parseFloat(e.target.value),
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs font-bold text-muted-foreground uppercase">
                          Verbas / benefícios (cadastro oficial)
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                          {payrollComponents.map((comp) => (
                            <div
                              key={comp.id}
                              onClick={() => toggleComponent(comp.id)}
                              className={cn(
                                "p-3 rounded-xl border cursor-pointer transition-all flex items-center justify-between",
                                formData.componentIds?.includes(comp.id)
                                  ? "bg-primary/5 border-primary shadow-sm"
                                  : "bg-background border-border hover:border-primary/50"
                              )}
                            >
                              <div>
                                <p className="text-xs font-bold">{comp.name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {comp.calculationType === "PERCENTAGE"
                                    ? `${comp.value}%`
                                    : formatCurrency(comp.value)}
                                </p>
                              </div>
                              <div
                                className={cn(
                                  "h-4 w-4 rounded-full border flex items-center justify-center",
                                  formData.componentIds?.includes(comp.id)
                                    ? "bg-primary border-primary"
                                    : "border-border"
                                )}
                              >
                                {formData.componentIds?.includes(comp.id) && (
                                  <div className="h-1.5 w-1.5 rounded-full bg-white" />
                                )}
                              </div>
                            </div>
                          ))}
                          {payrollComponents.length === 0 && (
                            <p className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">
                              Nenhuma verba carregada. Cadastre em Configurações → Operacional (com
                              permissão settings.operational.*).
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {employeeFichaTab === "notes" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Observações profissionais
                        </label>
                        <textarea
                          className={TEXTAREA_CLASS}
                          maxLength={MAX_PROFESSIONAL_NOTES_LEN}
                          value={formData.professionalNotes ?? ""}
                          onChange={(e) =>
                            setFormData({ ...formData, professionalNotes: e.target.value })
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Máx. {MAX_PROFESSIONAL_NOTES_LEN} caracteres. Sem histórico de versões.
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-muted-foreground uppercase">
                          Observações administrativas
                        </label>
                        <textarea
                          className={TEXTAREA_CLASS}
                          maxLength={MAX_ADMIN_NOTES_LEN}
                          value={formData.adminNotes ?? ""}
                          onChange={(e) =>
                            setFormData({ ...formData, adminNotes: e.target.value })
                          }
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Máx. {MAX_ADMIN_NOTES_LEN} caracteres. Visível na API só com{" "}
                          <span className="font-mono">employees.edit</span>. Não use para dados
                          bancários completos.
                        </p>
                      </div>
                    </div>
                  )}

                  {employeeFichaTab === "links" && (
                    <div className="space-y-3">
                      {editingEmployee ? (
                        <EmployeeSystemLinksPanel employeeId={editingEmployee.id} />
                      ) : (
                        <p className="text-sm text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                          Salve o colaborador para consultar os vínculos no sistema.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-border bg-card px-5 sm:px-6 py-4 space-y-3">
                {formError ? (
                  <p className="text-sm text-red-600" role="alert">
                    {formError}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={closeEmployeeModal}
                    className="px-6 py-2 rounded-lg font-medium hover:bg-accent transition-colors text-sm"
                    disabled={savingEmployee}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingEmployee}
                    className="inline-flex items-center gap-2 px-8 py-2 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm disabled:opacity-60"
                  >
                    {savingEmployee ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {editingEmployee ? "Salvar alterações" : "Cadastrar colaborador"}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal: Payroll Component Form */}
      {isComponentModalOpen && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card w-full max-md rounded-2xl border border-border shadow-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex items-center justify-between bg-accent/30">
              <h3 className="text-lg font-bold">Nova Verba / Encargo</h3>
              <button onClick={() => setIsComponentModalOpen(false)} className="p-2 hover:bg-accent rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleComponentSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Descrição</label>
                <input
                  required
                  type="text"
                  className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                  value={compFormData.name}
                  onChange={(e) => setCompFormData({...compFormData, name: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Tipo</label>
                  <SearchableSelect
                    placeholder="Tipo..."
                    options={PAYROLL_TYPE_OPTIONS}
                    value={compFormData.type}
                    onChange={(v) => setCompFormData({ ...compFormData, type: v })}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-muted-foreground uppercase">Cálculo</label>
                  <SearchableSelect
                    placeholder="Cálculo..."
                    options={PAYROLL_CALC_OPTIONS}
                    value={compFormData.calculationType}
                    onChange={(v) => setCompFormData({ ...compFormData, calculationType: v })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground uppercase">Valor</label>
                <input
                  required
                  type="number"
                  step="0.00001"
                  className="w-full p-2 rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20 outline-none text-sm"
                  value={compFormData.value}
                  onChange={(e) => setCompFormData({...compFormData, value: parseFloat(e.target.value)})}
                />
              </div>
              <button 
                type="submit"
                className="w-full py-2.5 mt-4 rounded-lg font-bold bg-primary text-primary-foreground hover:opacity-90 transition-opacity text-sm"
              >
                Salvar Componente
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal: Ficha do colaborador */}
      {viewingEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-background/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={FICHA_MODAL_CLASS}
          >
            <div className="p-5 sm:p-6 border-b border-border flex items-center justify-between bg-accent/40 shrink-0">
              <div>
                <h3 className="text-xl font-bold">{viewingEmployee.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {viewingEmployee.socialName?.trim() ? `${viewingEmployee.socialName} · ` : ""}
                  {viewingEmployee.Role.name} · {viewingEmployee.department}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => {
                      const employee = viewingEmployee;
                      setViewingEmployee(null);
                      handleOpenModal(employee);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-accent text-sm font-medium"
                  >
                    <Edit2 className="h-4 w-4" />
                    Editar
                  </button>
                )}
                <button type="button" onClick={() => setViewingEmployee(null)} className="p-2 hover:bg-accent rounded-full transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex flex-col lg:flex-row flex-1 min-h-0">
              <EmployeeFichaTabNav
                activeTab={viewFichaTab}
                onTabChange={setViewFichaTab}
                layout="sidebar"
                visibleTabIds={visibleFichaTabs}
              />

              <div className="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6">
                <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2 mb-5">
                  Dados pessoais e administrativos devem ser acessados apenas por pessoas autorizadas do RH.
                </p>

                {viewFichaTab === "professional" && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <DetailField label="Nome social / apelido" value={displayText(viewingEmployee.socialName)} />
                    <DetailField
                      label="E-mail corporativo"
                      value={displayText(viewingEmployee.corporateEmail)}
                    />
                    <DetailField label="Cargo" value={displayText(viewingEmployee.Role.name)} />
                    <DetailField label="Departamento" value={displayText(viewingEmployee.department)} />
                    <DetailField
                      label="Centro de custo"
                      value={
                        viewingEmployee.financialCostCenter
                          ? `${viewingEmployee.financialCostCenter.code} — ${viewingEmployee.financialCostCenter.name}`
                          : displayText(viewingEmployee.costCenter)
                      }
                    />
                    <DetailField label="Classificação" value={displayText(viewingEmployee.classification)} />
                    <DetailField label="Tipo de contrato" value={formatContractType(viewingEmployee.contractType)} />
                    <DetailField label="Admissão" value={formatEmployeeDate(viewingEmployee.admissionDate)} />
                    <DetailField label="Desligamento" value={formatEmployeeDate(viewingEmployee.terminationDate)} />
                    <DetailField
                      label="Gestor responsável"
                      value={
                        viewingEmployee.manager
                          ? viewingEmployee.manager.socialName?.trim() ||
                            viewingEmployee.manager.name
                          : displayText(viewingEmployee.managerName)
                      }
                    />
                    <div>
                      <p className="text-muted-foreground text-xs">Status</p>
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1",
                        viewingEmployee.status === "ACTIVE" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"
                      )}>
                        {viewingEmployee.status === "ACTIVE" ? "Ativo" : "Inativo"}
                      </div>
                    </div>
                    <div className="col-span-2 md:col-span-3">
                      <EmployeeSystemAccessCard
                        employeeId={viewingEmployee.id}
                        canManageLink={canManageUserLink}
                        canOpenUsersAdmin={auth.hasPermission("users.manage")}
                        onLinked={(appUser) => {
                          if (!appUser) return;
                          const updated = { ...viewingEmployee, appUser };
                          setViewingEmployee(updated);
                          setEmployees((prev) =>
                            prev.map((e) =>
                              e.id === viewingEmployee.id ? { ...e, appUser } : e
                            )
                          );
                        }}
                        onUnlinked={() => {
                          const updated = { ...viewingEmployee, appUser: null };
                          setViewingEmployee(updated);
                          setEmployees((prev) =>
                            prev.map((e) =>
                              e.id === viewingEmployee.id ? { ...e, appUser: null } : e
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                )}

                {viewFichaTab === "personal" && (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                    <DetailField
                      label="CPF"
                      value={
                        canViewPersonalHr
                          ? formatCpfForDisplay(viewingEmployee.cpf)
                          : "•••••••••••"
                      }
                    />
                    <DetailField
                      label="RG"
                      value={canViewPersonalHr ? displayText(viewingEmployee.rg) : "••••••"}
                    />
                    <DetailField
                      label="Nascimento"
                      value={
                        canViewPersonalHr
                          ? formatEmployeeDate(viewingEmployee.birthDate)
                          : "••••••"
                      }
                    />
                    <DetailField
                      label="Telefone"
                      value={
                        canViewPersonalHr
                          ? formatPhoneForDisplay(viewingEmployee.phone)
                          : "••••••••"
                      }
                    />
                    <DetailField
                      label="E-mail pessoal"
                      value={
                        canViewPersonalHr
                          ? displayText(viewingEmployee.personalEmail)
                          : "••••••"
                      }
                      className="col-span-2 md:col-span-3"
                    />
                    <DetailField
                      label="Endereço"
                      value={
                        canViewPersonalHr ? displayText(viewingEmployee.address) : "••••••"
                      }
                      className="col-span-2 md:col-span-3"
                      multiline
                    />
                    {!canViewPersonalHr && (
                      <p className="col-span-2 md:col-span-3 text-xs text-muted-foreground rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
                        Dados pessoais restritos. A API também omite CPF e endereço sem{" "}
                        <span className="font-mono">employees.personal_data.view</span> (ou{" "}
                        <span className="font-mono">employees.edit</span>).
                      </p>
                    )}
                  </div>
                )}

                {viewFichaTab === "emergency" && (
                  <div className="grid grid-cols-2 gap-4 text-sm max-w-3xl">
                    {canViewSensitiveHr ? (
                      <>
                        <DetailField
                          label="Nome do contato"
                          value={displayText(viewingEmployee.emergencyContactName)}
                          className="col-span-2"
                        />
                        <DetailField
                          label="Telefone"
                          value={formatPhoneForDisplay(viewingEmployee.emergencyContactPhone)}
                        />
                        <DetailField
                          label="Grau / relação"
                          value={displayText(viewingEmployee.emergencyContactRelationship)}
                        />
                      </>
                    ) : (
                      <p className="col-span-2 text-sm text-muted-foreground rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
                        Contatos de emergência restritos. Solicite{" "}
                        <span className="font-mono">employees.sensitive_data.view</span> (ou{" "}
                        <span className="font-mono">employees.edit</span>).
                      </p>
                    )}
                  </div>
                )}

                {viewFichaTab === "epi" && (
                  <div className="space-y-4 text-sm">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <DetailField label="Camiseta / camisa" value={displayText(viewingEmployee.shirtSize)} />
                      <DetailField label="Calça" value={displayText(viewingEmployee.pantsSize)} />
                      <DetailField label="Jaqueta / blusa" value={displayText(viewingEmployee.jacketSize)} />
                      <DetailField label="Luva" value={displayText(viewingEmployee.gloveSize)} />
                      <DetailField label="Calçado / bota" value={displayText(viewingEmployee.shoeSize)} />
                    </div>
                    <DetailField label="Observações de EPI / uniforme" value={displayText(viewingEmployee.epiNotes)} multiline />
                  </div>
                )}

                {viewFichaTab === "admin" && (
                  <div className="space-y-5">
                    {!canViewSensitiveHr || viewingEmployee.compensationRedacted ? (
                      <p className="text-sm text-muted-foreground rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
                        Dados salariais e de custo restritos. Solicite{" "}
                        <span className="font-mono">employees.sensitive_data.view</span> (ou{" "}
                        <span className="font-mono">employees.edit</span>). A API também omite
                        salário e custos sem essa permissão.
                      </p>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground rounded-lg border border-border bg-muted/30 px-3 py-2">
                          Referência administrativa p/ estimativas RH e rateio global de HH. Não é
                          folha oficial nem dado bancário.
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <div className="p-3 rounded-lg bg-muted/20 border border-border">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">
                              Estimativa mensal
                            </p>
                            <p className="text-lg font-semibold">
                              {formatCurrency(viewingEmployee.costs?.totalMonthlyCost || 0)}
                            </p>
                          </div>
                          <div className="p-3 rounded-lg bg-muted/20 border border-border">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase mb-1">
                              Estimativa /h produtiva
                            </p>
                            <p className="text-lg font-semibold">
                              {formatCurrency(
                                viewingEmployee.costs?.costPerProductiveHour || 0,
                                5
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Referência salarial</span>
                            <span>{formatCurrency(viewingEmployee.costs?.salary || 0)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Jornada mensal</span>
                            <span>{viewingEmployee.monthlyHours}h</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Produtividade</span>
                            <span>{formatNumber(viewingEmployee.productivity, 2)}%</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Benefícios (estimativa)</span>
                            <span className="text-green-600">
                              {formatCurrency(viewingEmployee.costs?.totalBenefits || 0)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Encargos (estimativa)</span>
                            <span className="text-orange-600">
                              {formatCurrency(viewingEmployee.costs?.totalCharges || 0)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Provisões (estimativa)</span>
                            <span className="text-blue-600">
                              {formatCurrency(viewingEmployee.costs?.totalProvisions || 0)}
                            </span>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-muted-foreground uppercase mb-2">
                            Verbas vinculadas
                          </p>
                          {viewingEmployee.EmployeePayrollComponent.length === 0 ? (
                            <p className="text-sm text-muted-foreground">—</p>
                          ) : (
                            <ul className="space-y-1 text-sm">
                              {viewingEmployee.EmployeePayrollComponent.map((c) => (
                                <li
                                  key={c.PayrollComponent.id}
                                  className="flex justify-between gap-2"
                                >
                                  <span>{c.PayrollComponent.name}</span>
                                  <span className="text-muted-foreground text-xs">
                                    {c.PayrollComponent.type}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {viewFichaTab === "notes" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <DetailField
                      label="Observações profissionais"
                      value={displayText(viewingEmployee.professionalNotes)}
                      multiline
                    />
                    <DetailField
                      label="Observações administrativas"
                      value={
                        canViewAdminHr && !viewingEmployee.adminNotesRedacted
                      ? displayText(viewingEmployee.adminNotes)
                          : "••••••"
                      }
                      multiline
                    />
                    {(!canViewAdminHr || viewingEmployee.adminNotesRedacted) && (
                      <p className="md:col-span-2 text-xs text-muted-foreground rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2">
                        Observações administrativas omitidas sem{" "}
                        <span className="font-mono">employees.administrative_data.view</span> (ou{" "}
                        <span className="font-mono">employees.edit</span>).
                      </p>
                    )}
                  </div>
                )}

                {viewFichaTab === "links" && (
                  <div className="space-y-4 text-sm">
                    <EmployeeSystemAccessCard
                      employeeId={viewingEmployee.id}
                      canManageLink={canManageUserLink}
                      canOpenUsersAdmin={auth.hasPermission("users.manage")}
                      onLinked={(appUser) => {
                        if (!appUser) return;
                        setViewingEmployee({ ...viewingEmployee, appUser });
                        setEmployees((prev) =>
                          prev.map((e) =>
                            e.id === viewingEmployee.id ? { ...e, appUser } : e
                          )
                        );
                      }}
                      onUnlinked={() => {
                        setViewingEmployee({ ...viewingEmployee, appUser: null });
                        setEmployees((prev) =>
                          prev.map((e) =>
                            e.id === viewingEmployee.id ? { ...e, appUser: null } : e
                          )
                        );
                      }}
                    />
                    <EmployeeSystemLinksPanel
                      employeeId={viewingEmployee.id}
                      canUnlinkPerson={canManageLinks}
                      onUnlinkedPerson={() => {
                        setViewingEmployee({
                          ...viewingEmployee,
                          personId: null,
                          person: null,
                        });
                        fetchData();
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <GuidedTour
        open={tourOpen}
        onClose={() => setTourOpen(false)}
        steps={EMPLOYEE_TOUR_STEPS}
        tourName="Tour de Pessoas / RH"
      />
    </div>
  );
};
