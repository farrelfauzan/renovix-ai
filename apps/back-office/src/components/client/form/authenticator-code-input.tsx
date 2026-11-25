"use client";

import { InputOTP, InputOTPGroup, InputOTPSlot } from "@performa-ai/ui/components/input-otp";
import { AUTHENTICATOR_CODE_LENGTH } from "@/lib/sign-in/authenticator-code-length";

type AuthenticatorCodeInputProps = {
  readonly value: string;
  readonly onChange: (value: string) => void;
};

/** Any change that would put a non-digit in the code is dropped (input-otp tests the whole new value); input-otp's REGEXP_ONLY_DIGITS. */
const DIGITS_ONLY = "^\\d+$";

/** Removes what an authenticator app may copy around the digits (e.g. "123 456"), so a pasted code fills the boxes. */
const keepDigits = (pasted: string): string => pasted.replace(/\D/g, "");

/**
 * The authenticator code as six boxes (RNX-332): one input underneath, named "Authenticator code", digits only.
 * Typing and pasting both fill it; `value` is the digits entered so far.
 */
export function AuthenticatorCodeInput({ value, onChange }: AuthenticatorCodeInputProps) {
  return (
    <InputOTP
      name="totp"
      aria-label="Authenticator code"
      autoComplete="one-time-code"
      maxLength={AUTHENTICATOR_CODE_LENGTH}
      pattern={DIGITS_ONLY}
      pasteTransformer={keepDigits}
      value={value}
      onChange={onChange}
      containerClassName="w-full"
    >
      <InputOTPGroup className="grid w-full grid-cols-6 gap-2">
        {Array.from({ length: AUTHENTICATOR_CODE_LENGTH }, (_, index) => (
          <InputOTPSlot key={index} index={index} className="h-[52px] w-full rounded-rx border border-rx-line bg-rx-white font-mono text-[22px] text-rx-ink first:rounded-rx last:rounded-rx data-[active=true]:border-rx-accent data-[active=true]:ring-2 data-[active=true]:ring-rx-accent/30" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
