"use client";

import { useState, useEffect } from "react";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { useAuthStore, useHydrated } from "@/lib/stores";
import { apiClient } from "@/lib/api-client";
import { ArrowLeft, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  phone: string | null;
  company: string | null;
  jobTitle: string | null;
  timezone: string | null;
  locale: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function GeneralSettings() {
  const { isLoggedIn } = useAuthStore();
  const hydrated = useHydrated();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    firstName: "",
    lastName: "",
    phone: "",
    company: "",
    jobTitle: "",
    timezone: "",
    locale: "",
  });

  useEffect(() => {
    if (!hydrated || !isLoggedIn()) return;

    apiClient
      .get<UserProfile>("/auth/me")
      .then((data) => {
        setProfile(data);
        setForm({
          name: data.name || "",
          firstName: data.firstName || "",
          lastName: data.lastName || "",
          phone: data.phone || "",
          company: data.company || "",
          jobTitle: data.jobTitle || "",
          timezone: data.timezone || "",
          locale: data.locale || "",
        });
      })
      .catch(() => {
        toast.error("Failed to load profile");
      })
      .finally(() => setLoading(false));
  }, [hydrated, isLoggedIn]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiClient.patch("/auth/me", form);
      toast.success("Profile updated successfully");
    } catch {
      toast.error("Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  if (!hydrated) return null;

  if (!isLoggedIn()) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-muted-foreground">
            Please sign in to view your profile.
          </p>
          <Link href="/login">
            <Button>Sign In</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg space-y-8">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-xl font-semibold">Profile Settings</h1>
        </div>

        {/* Account Info (read-only) */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Account
          </h2>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email</span>
              <span>{profile?.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <span className="capitalize">{profile?.status}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Member since</span>
              <span>
                {profile?.createdAt
                  ? new Date(profile.createdAt).toLocaleDateString()
                  : "—"}
              </span>
            </div>
          </div>
        </section>

        {/* Editable Profile */}
        <form onSubmit={handleSave} className="space-y-6">
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Personal Information
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Display Name
                </label>
                <Input
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  placeholder="Your display name"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    First Name
                  </label>
                  <Input
                    value={form.firstName}
                    onChange={(e) =>
                      setForm({ ...form, firstName: e.target.value })
                    }
                    placeholder="First name"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Last Name
                  </label>
                  <Input
                    value={form.lastName}
                    onChange={(e) =>
                      setForm({ ...form, lastName: e.target.value })
                    }
                    placeholder="Last name"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Phone
                </label>
                <Input
                  value={form.phone}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value })
                  }
                  placeholder="+1 (555) 000-0000"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Work
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Company
                </label>
                <Input
                  value={form.company}
                  onChange={(e) =>
                    setForm({ ...form, company: e.target.value })
                  }
                  placeholder="Company name"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Job Title
                </label>
                <Input
                  value={form.jobTitle}
                  onChange={(e) =>
                    setForm({ ...form, jobTitle: e.target.value })
                  }
                  placeholder="Job title"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Preferences
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Timezone
                </label>
                <Input
                  value={form.timezone}
                  onChange={(e) =>
                    setForm({ ...form, timezone: e.target.value })
                  }
                  placeholder="e.g. America/New_York"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Locale
                </label>
                <Input
                  value={form.locale}
                  onChange={(e) =>
                    setForm({ ...form, locale: e.target.value })
                  }
                  placeholder="e.g. en-US"
                />
              </div>
            </div>
          </section>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? (
              "Saving..."
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" /> Save Changes
              </>
            )}
          </Button>
        </form>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            API keys
          </h2>
          <p className="text-xs text-muted-foreground">
            Create and revoke keys for your own software on the{" "}
            <Link href="/settings/api-keys" className="underline">
              API keys page
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
