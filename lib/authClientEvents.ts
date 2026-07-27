export const AUTH_STATE_CHANGED_EVENT = "interview-app-auth-state-changed";

export type AuthStateUser = {
  id: string;
  email?: string | null;
};

export type AuthStateChangedDetail = {
  user: AuthStateUser | null;
};

export function notifyAuthStateChanged(user: AuthStateUser | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AuthStateChangedDetail>(AUTH_STATE_CHANGED_EVENT, {
      detail: { user },
    })
  );
}
