'use client';

import { motion } from 'framer-motion';
import { ArrowRight, MessageSquare, Bot, Sparkles } from 'lucide-react';
import { Button } from '@performa-ai/ui/components/button';

export function CtaSection() {
  return (
    <section className="relative bg-gray-950 py-28" id="get-started">
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gray-800 to-transparent" />

      <div className="mx-auto max-w-4xl px-6">
        <motion.div
          className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-linear-to-b from-indigo-500/10 to-transparent p-12 text-center sm:p-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          {/* Background decorative elements */}
          <div className="pointer-events-none absolute -top-32 -left-32 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-32 -right-32 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />

          <div className="relative z-10">
            <div className="mb-6 flex items-center justify-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
                <MessageSquare className="h-5 w-5 text-white" />
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
            </div>

            <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
              Ready to Transform How You Work?
            </h2>
            <p className="mx-auto mb-8 max-w-xl text-lg text-gray-400">
              Join thousands of users already using Renovix AI to chat smarter,
              automate faster, and achieve more every day.
            </p>

            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button asChild className="group inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-8 py-4 text-base font-semibold text-white transition-colors hover:bg-indigo-500 h-auto whitespace-normal has-[>svg]:px-8">
                <a href={process.env.NEXT_PUBLIC_CHAT_URL}>
                  Start Free — No Credit Card
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
              </Button>
              <Button asChild variant="outline" className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-8 py-4 text-base font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white h-auto whitespace-normal bg-transparent hover:bg-transparent">
                <a href="#">
                  Watch Demo
                </a>
              </Button>
            </div>

            <p className="mt-6 text-sm text-gray-500">
              Free tier includes 50 messages/day • No credit card required • Upgrade anytime
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
