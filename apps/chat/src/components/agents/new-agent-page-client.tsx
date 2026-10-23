"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useAgentStore } from "@/lib/agent-store";
import { useCreateAgent, useAttachTool } from "@/hooks/use-agents";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Brain,
  Wrench,
  Rocket,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { IdentityStep } from "./builder/identity-step";
import { InstructionsStep } from "./builder/instructions-step";
import { ToolsStep } from "./builder/tools-step";
import { ReviewStep } from "./builder/review-step";
import type { AgentFormValues } from "./builder/identity-step";

const STEPS = [
  { title: "Identity", icon: Bot },
  { title: "Instructions", icon: Brain },
  { title: "Tools", icon: Wrench },
  { title: "Deploy", icon: Rocket },
];

export default function NewAgentPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedAgentType = searchParams.get("agentType");
  const requestedParentAgentId = searchParams.get("parentAgentId");
  const {
    builderStep,
    setBuilderStep,
    builderDraft,
    updateBuilderDraft,
    resetBuilderDraft,
  } = useAgentStore();
  const createAgent = useCreateAgent();
  const attachTool = useAttachTool();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm({
    defaultValues: {
      name: builderDraft.name,
      description: builderDraft.description || "",
      avatar: builderDraft.avatar || "",
      systemPrompt: builderDraft.systemPrompt,
      model: builderDraft.model,
      temperature: builderDraft.temperature,
      maxTokens: builderDraft.maxTokens,
      isPublic: builderDraft.isPublic,
      agentType: builderDraft.agentType,
      parentAgentId: builderDraft.parentAgentId || "",
      tools: builderDraft.tools,
    } as AgentFormValues,
    onSubmit: async ({ value }) => {
      await handleCreate(value);
    },
  });

  // Sync form changes back to persisted store
  useEffect(() => {
    const sub = form.store.subscribe(() => {
      const v = form.state.values;
      updateBuilderDraft({
        name: v.name,
        description: v.description || undefined,
        avatar: v.avatar || undefined,
        systemPrompt: v.systemPrompt,
        model: v.model,
        temperature: v.temperature,
        maxTokens: v.maxTokens,
        isPublic: v.isPublic,
        agentType: v.agentType,
        parentAgentId: v.parentAgentId || undefined,
        tools: v.tools,
      });
    });
    return () => sub.unsubscribe();
  }, [form, updateBuilderDraft]);

  // Set sub-agent fields from URL params
  useEffect(() => {
    if (requestedAgentType === "sub_agent" && requestedParentAgentId) {
      form.setFieldValue("agentType", "sub_agent");
      form.setFieldValue("parentAgentId", requestedParentAgentId);
    }
  }, [requestedAgentType, requestedParentAgentId, form]);

  // Reset draft when leaving the page
  useEffect(() => {
    return () => {
      resetBuilderDraft();
    };
  }, [resetBuilderDraft]);

  const handleNext = () => {
    const values = form.state.values;
    if (builderStep === 0) {
      if (!values.name.trim()) {
        toast.error("Agent name is required");
        return;
      }
      if (values.agentType === "sub_agent" && !values.parentAgentId) {
        toast.error("Sub-agent requires a parent agent");
        return;
      }
    }
    if (builderStep === 1) {
      if (!values.systemPrompt.trim()) {
        toast.error("System prompt is required");
        return;
      }
      if (!values.model) {
        toast.error("Please select a model");
        return;
      }
    }
    setBuilderStep(Math.min(builderStep + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setBuilderStep(Math.max(builderStep - 1, 0));
  };

  const handleCreate = async (values: AgentFormValues) => {
    setIsSubmitting(true);
    try {
      const agent = await createAgent.mutateAsync({
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        avatar: values.avatar || undefined,
        systemPrompt: values.systemPrompt.trim(),
        model: values.model,
        temperature: values.temperature,
        maxTokens: values.maxTokens || undefined,
        isPublic: values.isPublic,
      });

      // Auto-attach selected tools
      if (values.tools.length > 0) {
        const toolPromises = values.tools.map((toolType) =>
          attachTool.mutateAsync({
            agentId: agent.id,
            data: { toolType, enabled: true },
          }),
        );
        await Promise.allSettled(toolPromises);
      }

      const parentAgentId = values.parentAgentId;
      const createdAsSubAgent = values.agentType === "sub_agent";

      resetBuilderDraft();
      toast.success("Agent created successfully!");
      if (createdAsSubAgent && parentAgentId) {
        router.push(`/agents/${parentAgentId}`);
      } else {
        router.push(`/agents/${agent.id}`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to create agent");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Create New Agent</h1>
            <p className="text-sm text-muted-foreground">
              Step {builderStep + 1} of {STEPS.length}:{" "}
              {STEPS[builderStep].title}
            </p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8">
          {STEPS.map((step, idx) => {
            const Icon = step.icon;
            const isActive = idx === builderStep;
            const isCompleted = idx < builderStep;
            return (
              <div
                key={step.title}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : isCompleted
                      ? "bg-green-500/10 text-green-500"
                      : "text-muted-foreground"
                }`}
              >
                {isCompleted ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                <span className="text-sm font-medium hidden sm:inline">
                  {step.title}
                </span>
              </div>
            );
          })}
        </div>

        {/* Step Content */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="border rounded-lg p-6 bg-card">
            {builderStep === 0 && <IdentityStep form={form} />}
            {builderStep === 1 && <InstructionsStep form={form} />}
            {builderStep === 2 && <ToolsStep form={form} />}
            {builderStep === 3 && <ReviewStep form={form} />}
          </div>

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              disabled={builderStep === 0}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            {builderStep < STEPS.length - 1 ? (
              <Button type="button" onClick={handleNext}>
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Agent"}
                <Rocket className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

