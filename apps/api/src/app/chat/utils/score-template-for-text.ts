import type { PromptTemplate } from "../service/prompt-template.service";

export function scoreTemplateForText(template: PromptTemplate, text: string): number {
  let score = 0;

  for (const keyword of template.keywords) {
    if (text.includes(keyword.toLowerCase())) {
      score += keyword.includes(" ") ? 3 : 1;
    }
  }

  return score;
}
