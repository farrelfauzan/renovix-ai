/** What the session gate does with a gated route: send the admin elsewhere, or show it (with or without the side navigation). */
export type GateDecision = { readonly redirectTo: string } | { readonly showsNavigation: boolean };
