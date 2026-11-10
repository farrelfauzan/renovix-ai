"use client";

import { Button } from "@performa-ai/ui/components/button";
import {
  ArrowLeft,
  MessageSquare,
  CreditCard,
  Key,
  Bot,
  BookOpen,
  Mail,
} from "lucide-react";
import Link from "next/link";

const faqs = [
  {
    icon: MessageSquare,
    question: "How do I start a conversation?",
    answer:
      "Simply type your message in the chat input at the bottom of the screen. You can ask questions, request code help, or have general conversations with the AI.",
  },
  {
    icon: Bot,
    question: "What AI models are available?",
    answer:
      "We support multiple AI models. You can select your preferred model from the model selector in the chat interface. Available models depend on your account tier.",
  },
  {
    icon: CreditCard,
    question: "How does billing work?",
    answer:
      "Free tier users get a limited number of daily requests. Paid users have a credit balance that is consumed per request. You can top up your balance using redemption codes on the Top Up page.",
  },
  {
    icon: Key,
    question: "Where can I find my API key?",
    answer:
      'Your API key is available in your Profile Settings page. Navigate to Profile from the user menu and scroll to the "API Token" section. You can copy or regenerate your key there.',
  },
  {
    icon: BookOpen,
    question: "Can I use a knowledge base?",
    answer:
      "Yes! You can upload documents and create knowledge bases that the AI can reference during conversations. Visit the Knowledge section from the sidebar to manage your documents.",
  },
  {
    icon: Bot,
    question: "What are agents?",
    answer:
      "Agents are specialized AI assistants configured for specific tasks. You can create custom agents with tailored system prompts, knowledge bases, and tool access from the Agents section.",
  },
];

export default function HelpPage() {
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
          <h1 className="text-xl font-semibold">Help & Support</h1>
        </div>

        {/* FAQ Section */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Frequently Asked Questions
          </h2>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <details
                key={i}
                className="group rounded-lg border border-border/50 bg-secondary/20 overflow-hidden"
              >
                <summary className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/40 transition-colors">
                  <faq.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">{faq.question}</span>
                </summary>
                <div className="px-4 pb-3 pt-0 pl-11">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Quick Links */}
        <section className="space-y-4">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Quick Links
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/profile">
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 hover:bg-secondary/40 transition-colors cursor-pointer">
                <Key className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Profile Settings</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Manage your account
                </p>
              </div>
            </Link>
            <Link href="/top-up">
              <div className="rounded-lg border border-border/50 bg-secondary/20 p-4 hover:bg-secondary/40 transition-colors cursor-pointer">
                <CreditCard className="h-5 w-5 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Top Up</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add credits to your account
                </p>
              </div>
            </Link>
          </div>
        </section>

        {/* Contact */}
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Contact Support
          </h2>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-4">
            <div className="flex items-start gap-3">
              <Mail className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm">
                  Need more help? Reach out to our support team.
                </p>
                <a
                  href="mailto:support@renovix.ai"
                  className="text-sm text-primary hover:underline mt-1 inline-block"
                >
                  support@renovix.ai
                </a>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
