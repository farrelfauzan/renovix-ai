/** What `useSignOut` gives the shell: the action, and the message of a failed sign-out (null otherwise). */
export type SignOutState = {
  readonly signOut: () => Promise<void>;
  readonly failure: string | null;
};
