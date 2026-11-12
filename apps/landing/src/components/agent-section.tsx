'use client';

import { motion } from 'framer-motion';
import { Badge } from '@performa-ai/ui/components/badge';
import {
  Bot,
  Calendar,
  FileText,
  Code2,
  Mail,
  Database,
  Workflow,
  Puzzle,
} from 'lucide-react';

const agents = [
  {
    icon: Calendar,
    title: 'Schedule Manager',
    description:
      'Automate meeting scheduling, reminders, and calendar optimization. Your AI assistant keeps your day organized.',
    color: 'from-blue-500 to-cyan-500',
  },
  {
    icon: FileText,
    title: 'Content Creator',
    description:
      'Generate blog posts, social media content, marketing copy, and documentation with context-aware writing.',
    color: 'from-violet-500 to-purple-500',
  },
  {
    icon: Code2,
    title: 'Code Assistant',
    description:
      'Debug code, generate functions, review PRs, and explain complex codebases. Your pair programmer that never sleeps.',
    color: 'from-emerald-500 to-green-500',
  },
  {
    icon: Mail,
    title: 'Email Composer',
    description:
      'Draft professional emails, summarize threads, and auto-respond to common queries with your voice and tone.',
    color: 'from-amber-500 to-orange-500',
  },
  {
    icon: Database,
    title: 'Data Analyst',
    description:
      'Analyze datasets, generate reports, create visualizations, and extract insights from your business data.',
    color: 'from-pink-500 to-rose-500',
  },
  {
    icon: Workflow,
    title: 'Workflow Builder',
    description:
      'Create custom automation pipelines that connect your tools. Trigger actions based on events and conditions.',
    color: 'from-indigo-500 to-blue-500',
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1 },
  }),
};

export function AgentSection() {
  return (
    <section className="relative bg-gray-950 py-28" id="agents">
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gray-800 to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-4 py-1.5 text-sm text-violet-300 font-normal [&>svg]:size-4">
            <Bot className="h-4 w-4" />
            <span>AI Agents</span>
          </Badge>
          <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
            Deploy AI Agents That Work for You
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Pre-built and customizable AI agents that handle your routine tasks.
            Set them up once and let them run — freeing you to focus on what matters.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent, i) => (
            <motion.div
              key={agent.title}
              className="group relative overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-indigo-500/40 hover:bg-gray-900/80"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={cardVariants}
            >
              <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl" />
              </div>

              <div className="relative z-10">
                <div
                  className={`mb-4 inline-flex rounded-lg bg-linear-to-br ${agent.color} p-2.5`}
                >
                  <agent.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">
                  {agent.title}
                </h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {agent.description}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Custom agent CTA */}
        <motion.div
          className="mt-12 text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="inline-flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/50 px-6 py-4">
            <Puzzle className="h-5 w-5 text-indigo-400" />
            <span className="text-sm text-gray-300">
              Need a custom agent?{' '}
              <a href="#" className="font-medium text-indigo-400 hover:text-indigo-300 transition-colors">
                Build your own in minutes →
              </a>
            </span>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
