/** RNX-33: the `users` columns the profile step writes (language is `locale`; the role is `role` since RNX-77a). */
export interface ProfileStepData {
  readonly name: string;
  readonly role: string;
  readonly country: string;
  readonly timezone: string;
  readonly locale: string;
  readonly signupGoal: string;
}
