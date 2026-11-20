import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignedOutError } from "@/lib/api/signed-out-error";
import { describeFailure } from "@/lib/sign-in/describe-failure";
import type { SessionApi } from "./session-api";
import type { SignOutState } from "./sign-out-state";

/**
 * Sign-out from the shell (RNX-312a): the API ends the session and clears the cookies, then sign-in. A session
 * that is over already also goes to sign-in; any other failure stays and gives the API's message.
 */
export function useSignOut(api: SessionApi): SignOutState {
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const signOut = async (): Promise<void> => {
    setFailure(null);
    try {
      await api.signOut();
      router.replace("/sign-in");
    } catch (err) {
      if (err instanceof SignedOutError) router.replace("/sign-in");
      else setFailure(describeFailure(err));
    }
  };
  return { signOut, failure };
}
