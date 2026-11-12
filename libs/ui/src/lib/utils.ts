import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge that knows the shared radius tokens (rounded-rx, rounded-rx-pill), so they replace a primitive's rounded-md instead of both staying (RNX-291). */
const twMerge = extendTailwindMerge({ extend: { theme: { radius: ["rx", "rx-pill"] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
