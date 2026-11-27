/** An admin write waiting for its reason (RNX-370): the reason dialog's title, and the write to run with the reason. */
export type ReasonRequest = {
  readonly title: string;
  readonly confirm: (reason: string) => void;
};
