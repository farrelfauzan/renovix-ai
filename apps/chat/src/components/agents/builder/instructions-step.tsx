"use client";

import type { FormApi } from "@tanstack/react-form";
import type { AgentFormValues } from "./identity-step";
import { useGeneratePrompt } from "@/hooks/use-agents";
import { usePortalModels } from "@/hooks/use-portal";
import { Button } from "@performa-ai/ui/components/button";
import { Input } from "@performa-ai/ui/components/input";
import { Textarea } from "@performa-ai/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@performa-ai/ui/components/select";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

interface InstructionsStepProps {
  form: FormApi<AgentFormValues, any>;
}

export function InstructionsStep({ form }: InstructionsStepProps) {
  const generatePrompt = useGeneratePrompt();
  const { data: models = [] } = usePortalModels();

  const handleGeneratePrompt = () => {
    const name = form.getFieldValue("name");
    const description = form.getFieldValue("description");

    if (!name?.trim()) {
      toast.error("Please set an agent name first (Step 1)");
      return;
    }

    generatePrompt.mutate(
      { name, description: description || undefined },
      {
        onSuccess: (data) => {
          form.setFieldValue("systemPrompt", data.prompt);
          toast.success("Prompt generated!");
        },
        onError: () => {
          toast.error("Failed to generate prompt");
        },
      },
    );
  };

  return (
    <div className="space-y-5">
      {/* System Prompt */}
      <form.Field name="systemPrompt">
        {(field) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">System Prompt *</label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGeneratePrompt}
                disabled={generatePrompt.isPending}
              >
                {generatePrompt.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                )}
                {generatePrompt.isPending
                  ? "Generating..."
                  : "Generate with AI"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Define your agent&apos;s behavior, or let AI generate a prompt
              based on the identity you set up.
            </p>
            <Textarea
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder="You are a helpful project manager bot. Your job is to help users create tickets, plan sprints, and organize work..."
              rows={8}
              maxLength={10000}
            />
            <p className="text-xs text-muted-foreground">
              {field.state.value.length}/10000
            </p>
          </div>
        )}
      </form.Field>

      {/* Model */}
      <form.Field name="model">
        {(field) => (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Model *</label>
            <Select
              value={field.state.value}
              onValueChange={(val) => field.handleChange(val)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m: any) => (
                  <SelectItem key={m.slug} value={m.slug}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      {/* Temperature */}
      <form.Field name="temperature">
        {(field) => (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Temperature: {field.state.value}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={field.state.value}
              onChange={(e) => field.handleChange(parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Precise</span>
              <span>Creative</span>
            </div>
          </div>
        )}
      </form.Field>

      {/* Max Tokens */}
      <form.Field name="maxTokens">
        {(field) => (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Max Tokens (optional)
            </label>
            <Input
              type="number"
              value={field.state.value ?? ""}
              onChange={(e) =>
                field.handleChange(
                  e.target.value ? parseInt(e.target.value) : undefined,
                )
              }
              onBlur={field.handleBlur}
              placeholder="4096"
              min={1}
              max={128000}
            />
          </div>
        )}
      </form.Field>
    </div>
  );
}
