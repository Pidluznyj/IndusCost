import { useCallback, useRef, useState } from "react";
import { NomusParentCodePickerModal } from "@/src/components/product/NomusParentCodePickerModal";
import {
  NOMUS_PARENT_CODE_NOT_FOUND_MSG,
  resolveNomusParentCode,
} from "@/src/lib/resolveNomusParentCode";
import type { NomusParentCodeOption } from "@/src/lib/nomusParentCodeOptionsTypes";

type ResolveThenOptions = {
  title?: string;
  description?: string;
  selectLabel?: string;
  /** Se true, termo vazio chama onResolved("") sem consultar API. */
  allowEmpty?: boolean;
};

export function useNomusParentCodeResolver() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerOptions, setPickerOptions] = useState<NomusParentCodeOption[]>([]);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerTitle, setPickerTitle] = useState<string | undefined>();
  const [pickerDescription, setPickerDescription] = useState<string | undefined>();
  const [pickerSelectLabel, setPickerSelectLabel] = useState<string | undefined>();
  const pendingRef = useRef<((parentCode: string) => void | Promise<void>) | null>(null);

  const resolveThen = useCallback(
    async (
      search: string,
      onResolved: (parentCode: string) => void | Promise<void>,
      options?: ResolveThenOptions
    ): Promise<{ ok: true; parentCode: string } | { ok: false; reason: "picker" | "none" }> => {
      const term = search.trim();
      if (!term) {
        if (options?.allowEmpty) {
          await onResolved("");
          return { ok: true, parentCode: "" };
        }
        throw new Error("Informe o SKU / parentCode.");
      }

      const result = await resolveNomusParentCode(term);
      if (result.kind === "none") {
        return { ok: false, reason: "none" };
      }
      if (result.kind === "single") {
        await onResolved(result.parentCode);
        return { ok: true, parentCode: result.parentCode };
      }
      if (result.kind !== "multiple") {
        return { ok: false, reason: "none" };
      }

      pendingRef.current = onResolved;
      setPickerOptions(result.options);
      setPickerSearch(result.search);
      setPickerTitle(options?.title);
      setPickerDescription(options?.description);
      setPickerSelectLabel(options?.selectLabel);
      setPickerOpen(true);
      return { ok: false, reason: "picker" };
    },
    []
  );

  const handlePickerSelect = useCallback(async (option: NomusParentCodeOption) => {
    setPickerOpen(false);
    const fn = pendingRef.current;
    pendingRef.current = null;
    if (fn) await fn(option.parentCode);
  }, []);

  const closePicker = useCallback(() => {
    setPickerOpen(false);
    pendingRef.current = null;
  }, []);

  const pickerModal = (
    <NomusParentCodePickerModal
      open={pickerOpen}
      onClose={closePicker}
      search={pickerSearch}
      options={pickerOptions}
      onSelect={(option) => void handlePickerSelect(option)}
      title={pickerTitle}
      description={pickerDescription}
      selectLabel={pickerSelectLabel}
    />
  );

  return {
    resolveThen,
    pickerModal,
    closePicker,
    notFoundMessage: NOMUS_PARENT_CODE_NOT_FOUND_MSG,
  };
}
