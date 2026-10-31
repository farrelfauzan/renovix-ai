/** RNX-33: the `users` columns the profile step writes (role is `jobTitle`, language is `locale`). */
export interface ProfileStepData {
  readonly name: string;
  readonly jobTitle: string;
  readonly country: string;
  readonly timezone: string;
  readonly locale: string;
  readonly signupGoal: string;
}
