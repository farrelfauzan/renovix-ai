import { useEffect, useState } from "react";
import type { AdminProfile } from "./admin-profile";
import type { SessionApi } from "./session-api";

/** The signed-in admin's profile (their permissions decide which controls show); null while loading or when it failed. */
export function useAdminProfile(sessionApi: SessionApi): AdminProfile | null {
  const [profile, setProfile] = useState<AdminProfile | null>(null);
  useEffect(() => {
    sessionApi.me().then(setProfile, () => setProfile(null));
  }, [sessionApi]);
  return profile;
}
