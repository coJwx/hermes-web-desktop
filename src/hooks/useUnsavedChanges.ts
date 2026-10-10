import { useContext, useId, useLayoutEffect } from "react";
import { UnsavedChangesContext } from "@/contexts/unsaved-changes-context";

/** Register only edit state, never the potentially sensitive draft contents. */
export function useUnsavedChanges(dirty: boolean, busy = false) {
  const id = useId();
  const { setDraft, confirmDiscard } = useContext(UnsavedChangesContext);
  useLayoutEffect(() => { setDraft(id, { dirty, busy }); }, [id, dirty, busy, setDraft]);
  useLayoutEffect(() => () => setDraft(id, null), [id, setDraft]);
  return confirmDiscard;
}
