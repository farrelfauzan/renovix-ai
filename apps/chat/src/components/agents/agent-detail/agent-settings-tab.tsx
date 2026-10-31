"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useUpdateAgent } from "@/hooks/use-agents";
import { usePortalModels } from "@/hooks/use-portal";
import { useMyEntitlements } from "@/hooks/use-my-entitlements";
import { ModelSelectItem } from "@/components/model-select-item";
import { isPackageLimitError } from "@/lib/is-package-limit-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AgentSettingsTabProps = {
  agent: any;
  agentId: string;
};

export function AgentSettingsTab({ agent, agentId }: AgentSettingsTabProps) {
  const updateAgent = useUpdateAgent();
  const { data: portalModels } = usePortalModels();
  const { data: entitlements } = useMyEntitlements();
  const [form, setForm] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!agent) return;

    setForm({
      name: agent.name,
      description: agent.description || "",
      avatar: agent.avatar || "",
      avatarColor: agent.avatarColor || "#6366f1",
      systemPrompt: agent.systemPrompt,
      model: agent.model,
      temperature: agent.temperature,
      maxTokens: agent.maxTokens || "",
      isPublic: agent.isPublic,
    });
  }, [agent]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateAgent.mutateAsync({
        id: agentId,
        data: {
          name: form.name,
          description: form.description || null,
          avatar: form.avatar || null,
          avatarColor: form.avatarColor || null,
          systemPrompt: form.systemPrompt,
          model: form.model,
          temperature: form.temperature,
          maxTokens: form.maxTokens ? parseInt(form.maxTokens, 10) : null,
          isPublic: form.isPublic,
        },
      });
      toast.success("Agent saved");
    } catch (err) {
      if (!isPackageLimitError(err)) toast.error("Failed to save agent");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Name</label>
        <Input
          value={form.name || ""}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Description</label>
        <Textarea
          value={form.description || ""}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Avatar</label>
        <div className="flex items-center gap-4">
          <div
            className="h-12 w-12 rounded-full flex items-center justify-center text-lg text-white font-bold"
            style={{ backgroundColor: form.avatarColor || "#6366f1" }}
          >
            {form.avatar || form.name?.slice(0, 2)?.toUpperCase() || "🤖"}
          </div>
          <div className="space-y-2">
            <Input
              value={form.avatar || ""}
              onChange={(e) => setForm({ ...form, avatar: e.target.value })}
              className="w-24"
              placeholder="Emoji"
            />
            <div className="flex gap-1.5 flex-wrap">
              {[
                "#6366f1",
                "#8b5cf6",
                "#ec4899",
                "#ef4444",
                "#f97316",
                "#eab308",
                "#22c55e",
                "#14b8a6",
                "#06b6d4",
                "#3b82f6",
                "#6b7280",
                "#1f2937",
              ].map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setForm({ ...form, avatarColor: color })}
                  className={`h-6 w-6 rounded-full border-2 transition-transform ${
                    form.avatarColor === color
                      ? "border-white scale-110"
                      : "border-transparent hover:scale-110"
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">System Prompt</label>
        <Textarea
          value={form.systemPrompt || ""}
          onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
          rows={8}
        />
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">Model</label>
        <Select
          value={form.model || ""}
          onValueChange={(value) => setForm({ ...form, model: value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {(portalModels || []).map((m) => (
              <ModelSelectItem key={m.slug} model={m} entitlements={entitlements} />
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">
          Temperature: {form.temperature}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={form.temperature || 0.7}
          onChange={(e) =>
            setForm({ ...form, temperature: parseFloat(e.target.value) })
          }
          className="w-full"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Controls randomness. Lower (0.1-0.3) = focused and deterministic.
          Higher (0.7-1.0) = creative and varied. Default: 0.7
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="editPublic"
          checked={form.isPublic || false}
          onChange={(e) => setForm({ ...form, isPublic: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="editPublic" className="text-sm">
          Public agent
        </label>
      </div>
      <p className="text-xs text-muted-foreground -mt-2 ml-6">
        When enabled, other users can browse and clone this agent as a template
        from the Explore page. Your system prompt will be visible.
      </p>
      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? "Saving..." : "Save Changes"}
      </Button>
    </div>
  );
}
