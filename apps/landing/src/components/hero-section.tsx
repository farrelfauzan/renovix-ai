'use client';

import { motion } from 'framer-motion';
import { MessageSquare, ArrowRight, Bot, Sparkles } from 'lucide-react';
import { Button } from '@performa-ai/ui/components/button';
import { Badge } from '@performa-ai/ui/components/badge';
import { CircuitBackground } from './circuit-background';

export function HeroSection() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gray-950">
      <CircuitBackground />

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Badge variant="outline" className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-4 py-1.5 text-sm text-indigo-300 font-normal [&>svg]:size-4">
            <Sparkles className="h-4 w-4" />
            <span>Next-Generation AI Chat Platform</span>
          </Badge>
        </motion.div>

        <motion.h1
          className="mb-6 text-5xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          Chat. Create.{' '}
          <span className="bg-linear-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
            Automate.
          </span>
          <br />
          Your AI, Your Way.
        </motion.h1>

        <motion.p
          className="mx-auto mb-10 max-w-2xl text-lg text-gray-400 sm:text-xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          Renovix AI is your intelligent workspace — chat with powerful AI models,
          deploy custom agents that handle your daily tasks, and build personalized
          environments that work the way you do.
        </motion.p>

        <motion.div
          className="flex flex-col items-center justify-center gap-4 sm:flex-row"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          <Button asChild className="group inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 h-auto whitespace-normal has-[>svg]:px-6">
            <a href={process.env.NEXT_PUBLIC_CHAT_URL}>
              Start Chatting Free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </Button>
          <Button asChild variant="outline" className="inline-flex items-center gap-2 rounded-lg border border-gray-700 px-6 py-3 text-sm font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white h-auto whitespace-normal bg-transparent hover:bg-transparent has-[>svg]:px-6">
            <a href="#agents">
              <Bot className="h-4 w-4" />
              Explore AI Agents
            </a>
          </Button>
        </motion.div>

        {/* Chat UI Preview */}
        <motion.div
          className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-xl border border-gray-800 bg-gray-900/80 text-left shadow-2xl shadow-indigo-500/5 backdrop-blur"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
        >
          <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
            <span className="h-3 w-3 rounded-full bg-red-500/60" />
            <span className="h-3 w-3 rounded-full bg-yellow-500/60" />
            <span className="h-3 w-3 rounded-full bg-green-500/60" />
            <span className="ml-2 text-xs text-gray-500">Renovix AI Chat</span>
          </div>
          <div className="p-5 space-y-4">
            {/* User message */}
            <div className="flex justify-end">
              <div className="rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm text-white max-w-[70%]">
                Help me write a marketing email for our product launch
              </div>
            </div>
            {/* AI response */}
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20">
                <MessageSquare className="h-4 w-4 text-violet-400" />
              </div>
              <div className="rounded-2xl rounded-bl-md bg-gray-800 px-4 py-2.5 text-sm text-gray-300 max-w-[70%]">
                <p>Here&apos;s a compelling marketing email for your launch:</p>
                <p className="mt-2 text-indigo-300">Subject: Something big is coming...</p>
                <p className="mt-1 text-gray-400">Writing your personalized email...</p>
                <span className="inline-block mt-1 h-4 w-1 animate-pulse bg-indigo-400 rounded-full" />
              </div>
            </div>
          </div>
        </motion.div>

        {/* Trust badges */}
        <motion.div
          className="mt-12 flex flex-wrap items-center justify-center gap-6 text-sm text-gray-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.8 }}
        >
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            No credit card required
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Multiple AI models
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            Custom AI agents
          </span>
        </motion.div>
      </div>
    </section>
  );
}
