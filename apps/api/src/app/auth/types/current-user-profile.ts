/** RNX-33: GET /auth/me's answer. `profileCompleted` is true once the profile step has been saved. */
export interface CurrentUserProfile {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly avatar: string | null;
  readonly phone: string | null;
  readonly company: string | null;
  readonly jobTitle: string | null;
  readonly timezone: string | null;
  readonly locale: string | null;
  readonly country: string | null;
  readonly signupGoal: string | null;
  readonly profileCompletedAt: Date | null;
  readonly profileCompleted: boolean;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
