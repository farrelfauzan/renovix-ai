"use client";

import type { FormApi } from "@tanstack/react-form";
import type { AgentFormValues } from "./identity-step";
import { useAvailableTools } from "@/hooks/use-agents";
import { Badge } from "@performa-ai/ui/components/badge";
import { Check } from "lucide-react";

interface ToolsStepProps {
  form: FormApi<AgentFormValues, any>;
}

export function ToolsStep({ form }: ToolsStepProps) {
  const { data: availableTools } = useAvailableTools();

  return (
    <form.Field name="agentType">
      {(agentTypeField) => {
        const agentType = agentTypeField.state.value;
        return (
          <form.Field name="tools">
            {(field) => (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Select tools your agent can use. They will be automatically
                  attached when the agent is created.
                </p>
                <div className="grid gap-3">
                  {(availableTools || [])
                    .filter(
                      (tool: any) =>
                        tool.type !== "delegate_to_subagent" ||
                        agentType === "parent",
                    )
                    .map((tool: any) => {
                      const isSelected = field.state.value.includes(tool.type);
                      return (
                        <div
                          key={tool.type}
                          className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/5"
                              : "hover:border-muted-foreground/30"
                          }`}
                          onClick={() => {
                            const next = isSelected
                              ? field.state.value.filter(
                                  (t) => t !== tool.type,
                                )
                              : [...field.state.value, tool.type];
                            field.handleChange(next);
                          }}
                        >
                          <div>
                            <p className="text-sm font-medium">{tool.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {tool.description}
                            </p>
                          </div>
                          <div
                            className={`h-5 w-5 rounded border flex items-center justify-center ${
                              isSelected
                                ? "bg-primary border-primary"
                                : "border-muted-foreground/30"
                            }`}
                          >
                            {isSelected && (
                              <Check className="h-3 w-3 text-primary-foreground" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
                {field.state.value.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {field.state.value.map((t) => (
                      <Badge key={t} variant="secondary">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
          </form.Field>
        );
      }}
    </form.Field>
  );
}
