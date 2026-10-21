'use client';

import { motion } from 'framer-motion';
import { Check, Sparkles, Zap, Crown } from 'lucide-react';

const plans = [
  {
    name: 'Free',
    description: 'Perfect for trying out Renovix AI',
    icon: Zap,
    features: [
      '50 messages per day',
      'Access to base models',
      '1 custom agent',
      'Basic chat history',
      'Community support',
    ],
    cta: 'Get Started Free',
    highlighted: false,
  },
  {
    name: 'Pro',
    description: 'For power users who need more',
    icon: Sparkles,
    features: [
      'Unlimited messages',
      'All premium models',
      'Unlimited custom agents',
      'Advanced memory & context',
      'Priority response speed',
      'File uploads & analysis',
      'API access included',
      'Priority support',
    ],
    cta: 'Start Pro Trial',
    highlighted: true,
  },
  {
    name: 'Team',
    description: 'For teams that ship together',
    icon: Crown,
    features: [
      'Everything in Pro',
      'Shared team workspaces',
      'Team agent library',
      'Admin & usage dashboard',
      'SSO & security controls',
      'Custom model fine-tuning',
      'Dedicated account manager',
      'SLA guarantee',
    ],
    cta: 'Contact Sales',
    highlighted: false,
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.12 },
  }),
};

export function PricingSection() {
  return (
    <section className="relative bg-gray-950 py-28" id="pricing">
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gray-800 to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
            Simple, Transparent Pricing
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Start free, upgrade when you need more. No hidden fees, no surprises.
            Cancel anytime.
          </p>
        </motion.div>

        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              className={`relative overflow-hidden rounded-2xl border p-8 transition-all ${
                plan.highlighted
                  ? 'border-indigo-500/50 bg-gray-900/80 shadow-lg shadow-indigo-500/10'
                  : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
              }`}
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={cardVariants}
            >
              {plan.highlighted && (
                <div className="absolute top-0 right-0 left-0 h-1 bg-linear-to-r from-indigo-500 to-violet-500" />
              )}

              <div className="mb-6">
                <div className="mb-3 inline-flex rounded-lg bg-indigo-500/10 p-2.5">
                  <plan.icon className="h-5 w-5 text-indigo-400" />
                </div>
                <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{plan.description}</p>
              </div>

              <ul className="mb-8 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-3 text-sm text-gray-300">
                    <Check className="h-4 w-4 shrink-0 text-indigo-400" />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href="#"
                className={`block w-full rounded-lg px-4 py-3 text-center text-sm font-semibold transition-colors ${
                  plan.highlighted
                    ? 'bg-indigo-600 text-white hover:bg-indigo-500'
                    : 'border border-gray-700 text-gray-300 hover:border-gray-500 hover:text-white'
                }`}
              >
                {plan.cta}
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
