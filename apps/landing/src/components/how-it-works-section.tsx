'use client';

import { motion } from 'framer-motion';
import { KeyRound, Wallet, Code2, BarChart3 } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: KeyRound,
    title: 'Create an Account & Get Your API Key',
    description:
      'Sign up in seconds. Your unique API key (sk_live_...) is generated instantly — copy it and you\'re ready to go.',
    code: 'Authorization: Bearer sk_live_abc123...',
  },
  {
    number: '02',
    icon: Wallet,
    title: 'Top Up Your Balance',
    description:
      'Add credits whenever you need them. Your balance is your spending limit — no surprise bills, ever.',
    code: 'POST /api/checkout → Stripe Checkout',
  },
  {
    number: '03',
    icon: Code2,
    title: 'Make API Requests',
    description:
      'Send requests to our OpenAI-compatible endpoint. Pick any model, send messages, get responses. Each request costs fractions of a cent.',
    code: `POST /v1/chat/completions
{
  "model": "llama-3.3-70b",
  "messages": [{ "role": "user", "content": "Hello!" }]
}`,
  },
  {
    number: '04',
    icon: BarChart3,
    title: 'Track Usage & Costs in Real-Time',
    description:
      'Every request is logged with token counts and cost. View detailed usage breakdowns by model, date, and cost in your dashboard.',
    code: 'GET /v1/usage → { totalCost, requests, tokens }',
  },
];

const stepVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: (i: number) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.5, delay: i * 0.15 },
  }),
};

export function HowItWorksSection() {
  return (
    <section className="relative bg-gray-950 py-28" id="how-it-works">
      {/* Subtle top divider */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gray-800 to-transparent" />

      <div className="mx-auto max-w-5xl px-6">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
            How It Works
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            From sign-up to your first API call in under 5 minutes. Pay per
            request — no subscriptions, no contracts.
          </p>
        </motion.div>

        <div className="relative space-y-12">
          {/* Vertical connecting line */}
          <div className="absolute top-0 bottom-0 left-[39px] hidden w-px bg-gradient-to-b from-indigo-500/30 via-violet-500/20 to-transparent sm:block" />

          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              className="relative flex flex-col gap-6 sm:flex-row sm:items-start"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={stepVariants}
            >
              {/* Step number circle */}
              <div className="relative z-10 flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900">
                <step.icon className="h-8 w-8 text-indigo-400" />
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="mb-1 text-xs font-medium tracking-widest text-indigo-400 uppercase">
                  Step {step.number}
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">
                  {step.title}
                </h3>
                <p className="mb-4 text-gray-400 leading-relaxed">
                  {step.description}
                </p>
                <div className="overflow-hidden rounded-lg border border-gray-800 bg-gray-900/80">
                  <pre className="overflow-x-auto p-4 text-sm text-gray-300">
                    <code>{step.code}</code>
                  </pre>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Pay-per-request callout */}
        <motion.div
          className="mt-20 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-8 text-center"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          <h3 className="mb-3 text-2xl font-bold text-white">
            Transparent Pay-Per-Request Pricing
          </h3>
          <p className="mx-auto max-w-xl text-gray-400">
            Every API call is metered by input and output tokens. We estimate
            the cost before processing, reserve credits from your balance, then
            refund any difference after the response. You never pay more than
            the actual usage.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
