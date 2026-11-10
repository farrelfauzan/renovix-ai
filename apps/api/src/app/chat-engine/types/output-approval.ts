/** The output approval's answer: the content to use (the safe text when blocked, never the raw output) and what was done. */
export type OutputApproval = {
  readonly status: "approved" | "transformed" | "blocked";
  readonly content: string;
};
