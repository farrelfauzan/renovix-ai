"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthStore, useHydrated } from "@/lib/stores";
import { apiClient } from "@/lib/api-client";
import { usePortalUsage } from "@/hooks/use-portal";
import { ArrowLeft, Gift, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";

export function BillingSettings() {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    creditAmount?: number;
    planName?: string;
  } | null>(null);
  const hydrated = useHydrated();
  const { isLoggedIn } = useAuthStore();
  const queryClient = useQueryClient();
  // The balance is the ledger's paid wallet, read from GET /chat/portal/usage (RNX-186: no local copy).
  const { data: usage } = usePortalUsage();

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await apiClient.post<{
        success: boolean;
        creditsGranted?: number | null;
        planGranted?: string | null;
        daysGranted?: number | null;
      }>("/codes/redeem", { code: code.trim().toUpperCase() });

      queryClient.invalidateQueries({ queryKey: ["portal-usage"] });

      setResult({
        success: true,
        message: "Code redeemed successfully!",
        creditAmount: res.creditsGranted ?? undefined,
        planName: res.planGranted ?? undefined,
      });
      setCode("");
    } catch (err: any) {
      const message =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to redeem code";
      setResult({
        success: false,
        message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isLoggedIn()) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-muted-foreground">
            Please sign in to top up your account.
          </p>
          <Link href="/login">
            <Button>Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Top Up</h1>
            <p className="text-sm text-muted-foreground">
              Redeem an invitation code to add credits to your account
            </p>
          </div>
        </div>

        {/* Current balance */}
        <div className="rounded-lg border bg-secondary/30 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Current Balance
            </span>
            <span className="text-lg font-semibold">
              ${Number(usage?.balance ?? 0).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Redeem form */}
        <form onSubmit={handleRedeem} className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Invitation Code</label>
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="PERF-XXXX-XXXX"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono tracking-wider"
                maxLength={14}
                required
              />
              <Button type="submit" disabled={loading || !code.trim()}>
                {loading ? "Redeeming..." : "Redeem"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter your invitation code to receive $5.00 credit and a free
              subscription plan.
            </p>
          </div>
        </form>

        {/* Result feedback */}
        {result && (
          <div
            className={`flex items-start gap-3 rounded-lg border p-4 ${
              result.success
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-destructive/30 bg-destructive/5"
            }`}
          >
            {result.success ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <p
                className={`text-sm font-medium ${
                  result.success ? "text-emerald-600" : "text-destructive"
                }`}
              >
                {result.success ? "Success!" : "Error"}
              </p>
              <p className="text-sm text-muted-foreground">
                {result.message}
              </p>
              {result.success && result.creditAmount && (
                <p className="text-sm text-muted-foreground">
                  +${result.creditAmount.toFixed(2)} added to your balance
                </p>
              )}
              {result.success && result.planName && (
                <p className="text-sm text-muted-foreground">
                  {result.planName} package activated
                </p>
              )}
            </div>
          </div>
        )}

        {/* How it works */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">How it works</span>
          </div>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="font-mono bg-secondary rounded px-1">1</span>
              Enter your invitation code (format: PERF-XXXX-XXXX)
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-secondary rounded px-1">2</span>
              Credits are instantly added to your balance
            </li>
            <li className="flex items-start gap-2">
              <span className="font-mono bg-secondary rounded px-1">3</span>
              Use credits for pay-per-request AI model access
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
