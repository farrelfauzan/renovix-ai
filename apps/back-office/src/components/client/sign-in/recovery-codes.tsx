"use client";

/** The recovery codes the API returns once at the end of the TOTP enrolment (RX-94). */
export function RecoveryCodes({ codes, onContinue }: { codes: readonly string[]; onContinue: () => void }) {
  return (
    <div className="mt-4 flex max-w-sm flex-col gap-3">
      <p className="text-sm">Store these recovery codes somewhere safe. Each one signs you in once instead of the authenticator code. They are shown only now.</p>
      <ul aria-label="Recovery codes" className="font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <button type="button" onClick={onContinue} className="self-start rounded border border-neutral-300 px-3 py-1 text-sm">
        Continue
      </button>
    </div>
  );
}
