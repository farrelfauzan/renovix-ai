"use client";

import { useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@performa-ai/ui/components/dialog";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { Textarea } from "@performa-ai/ui/components/textarea";
import type { IntegrationProvider } from "@/components/agents/agent-detail/integration-provider-config";
import { IntegrationProviderLogo } from "@/components/agents/agent-detail/integration-provider-logo";

type IntegrationFormValues = Record<string, string>;

type IntegrationConnectDialogProps = {
  open: boolean;
  provider: IntegrationProvider | null;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: IntegrationFormValues, provider: IntegrationProvider) => Promise<void>;
};

function buildDefaultValues(provider: IntegrationProvider): IntegrationFormValues {
  return Object.fromEntries(provider.fields.map((field) => [field.key, ""]));
}

function buildValidationSchema(provider: IntegrationProvider) {
  const shape: Record<string, z.ZodString> = {};

  for (const field of provider.fields) {
    shape[field.key] = z
      .string()
      .trim()
      .min(1, `${field.label} is required`);
  }

  return z.object(shape);
}

export function IntegrationConnectDialog({
  open,
  provider,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: IntegrationConnectDialogProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const form = useForm<IntegrationFormValues>({
    defaultValues: provider ? buildDefaultValues(provider) : {},
    onSubmit: async ({ value }) => {
      if (!provider) return;

      const schema = buildValidationSchema(provider);
      const parsed = schema.safeParse(value);

      if (!parsed.success) {
        const nextErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path[0];
          if (typeof key === "string" && !nextErrors[key]) {
            nextErrors[key] = issue.message;
          }
        }
        setErrors(nextErrors);
        return;
      }

      setErrors({});
      await onSubmit(parsed.data, provider);
      form.reset(buildDefaultValues(provider));
    },
  });

  useEffect(() => {
    if (!provider) return;
    setErrors({});
    form.reset(buildDefaultValues(provider));
  }, [provider?.id, open]);

  if (!provider) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IntegrationProviderLogo
              name={provider.name}
              logoUrl={provider.logoUrl}
              size="sm"
            />
            Connect {provider.name}
          </DialogTitle>
          <DialogDescription>{provider.description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="space-y-3"
        >
          {provider.fields.map((fieldDef) => (
            <form.Field key={fieldDef.key} name={fieldDef.key}>
              {(field) => (
                <div>
                  <label className="text-xs font-medium mb-1 block">
                    {fieldDef.label}
                  </label>
                  {fieldDef.multiline ? (
                    <Textarea
                      placeholder={fieldDef.placeholder}
                      value={(field.state.value as string) || ""}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                        if (errors[fieldDef.key]) {
                          setErrors((prev) => ({ ...prev, [fieldDef.key]: "" }));
                        }
                      }}
                      rows={4}
                      className="text-xs"
                    />
                  ) : (
                    <Input
                      type={fieldDef.secret ? "password" : "text"}
                      placeholder={fieldDef.placeholder}
                      value={(field.state.value as string) || ""}
                      onChange={(e) => {
                        field.handleChange(e.target.value);
                        if (errors[fieldDef.key]) {
                          setErrors((prev) => ({ ...prev, [fieldDef.key]: "" }));
                        }
                      }}
                      className="text-xs"
                    />
                  )}
                  {errors[fieldDef.key] ? (
                    <p className="mt-1 text-xs text-destructive">{errors[fieldDef.key]}</p>
                  ) : null}
                </div>
              )}
            </form.Field>
          ))}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Connecting..." : "Connect"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
