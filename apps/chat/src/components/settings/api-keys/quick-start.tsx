"use client";

import { useApiQuickStart } from "@/hooks/use-api-quick-start";
import { config } from "@/lib/config";

/** The API in short: base URL, model names by tier, a curl example, the out-of-credits 402 and the rate limit. */
export function QuickStart() {
  const { models, requestsPerMinute } = useApiQuickStart();
  const tiers = [...new Set(models.map((model) => model.tier))];
  const exampleModel = models[0]?.id ?? "model-name";
  const curl = [
    `curl ${config.apiUrl}/chat/completions \\`,
    `  -H "Authorization: Bearer $RENOVIX_API_KEY" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model": "${exampleModel}", "messages": [{"role": "user", "content": "Hello"}]}'`,
  ].join("\n");
  return (
    <section className="space-y-3 rounded-lg border border-border p-4" aria-label="Quick start">
      <h2 className="text-base font-semibold">Quick start</h2>
      <p className="text-sm text-muted-foreground">Send the key as a Bearer token and name a model by its slug.</p>
      <p className="text-sm">
        <span className="text-muted-foreground">Base URL </span>
        <code className="font-mono">{config.apiUrl}</code>
      </p>
      {tiers.map((tier) => (
        <p key={tier} className="text-sm">
          <span className="capitalize text-muted-foreground">{tier} </span>
          {models.filter((model) => model.tier === tier).map((model) => (
            <code key={model.id} className="mr-2 font-mono">{model.id}</code>
          ))}
        </p>
      ))}
      <pre className="overflow-x-auto rounded bg-secondary/40 p-3 font-mono text-xs">{curl}</pre>
      <p className="text-sm">
        <span className="text-muted-foreground">Out of credits </span>
        <code className="font-mono">402 {`{"code": "CREDITS_EXHAUSTED"}`}</code>
      </p>
      {requestsPerMinute !== undefined && (
        <p className="text-sm">
          <span className="text-muted-foreground">Rate limit </span>
          <code className="font-mono">{requestsPerMinute} requests per minute per key</code>
        </p>
      )}
    </section>
  );
}
