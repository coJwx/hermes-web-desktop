import { createContext } from "react";

export interface DraftState {
  dirty: boolean;
  busy: boolean;
  retainOnRouteChange?: boolean;
  profileScope?: string;
}

export interface UnsavedChangesContextValue {
  setDraft: (id: string, state: DraftState | null) => void;
  confirmDiscard: (action: () => void) => void;
}

export const UnsavedChangesContext = createContext<UnsavedChangesContextValue>({
  setDraft: () => {},
  confirmDiscard: (action) => action(),
});
