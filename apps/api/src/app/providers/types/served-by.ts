/** RNX-179: the model and provider record that answered a chat call (the requested one, or a fallback). */
export interface ServedBy {
  readonly slug: string;
  readonly providerName: string;
}
