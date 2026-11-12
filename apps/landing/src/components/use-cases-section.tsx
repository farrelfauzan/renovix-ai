'use client';

import { motion } from 'framer-motion';
import { Badge } from '@performa-ai/ui/components/badge';
import {
  Briefcase,
  GraduationCap,
  Palette,
  Rocket,
  Users,
  Lightbulb,
} from 'lucide-react';

const useCases = [
  {
    icon: Briefcase,
    role: 'For Professionals',
    title: 'Automate Your Daily Workflow',
    points: [
      'Draft emails and reports in seconds',
      'Summarize long documents instantly',
      'Schedule and manage tasks with AI',
      'Prepare meeting agendas and notes',
    ],
  },
  {
    icon: Rocket,
    role: 'For Developers',
    title: 'Ship Code Faster',
    points: [
      'Debug and fix code with explanations',
      'Generate boilerplate and tests',
      'Review pull requests automatically',
      'Create documentation from code',
    ],
  },
  {
    icon: Palette,
    role: 'For Creators',
    title: 'Create Content at Scale',
    points: [
      'Write blog posts and social media',
      'Brainstorm creative campaign ideas',
      'Generate product descriptions',
      'Translate and localize content',
    ],
  },
  {
    icon: GraduationCap,
    role: 'For Students',
    title: 'Learn and Research Smarter',
    points: [
      'Explain complex topics simply',
      'Generate study guides and flashcards',
      'Research and summarize papers',
      'Practice problem-solving with AI tutor',
    ],
  },
  {
    icon: Users,
    role: 'For Teams',
    title: 'Collaborate with AI',
    points: [
      'Shared workspaces with team agents',
      'Consistent brand voice across content',
      'Centralized knowledge base access',
      'Track usage and costs per team member',
    ],
  },
  {
    icon: Lightbulb,
    role: 'For Entrepreneurs',
    title: 'Validate Ideas Quickly',
    points: [
      'Generate business plans and pitches',
      'Analyze market and competitors',
      'Create MVP specifications',
      'Draft investor communications',
    ],
  },
];

const cardVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, delay: i * 0.08 },
  }),
};

export function UseCasesSection() {
  return (
    <section className="relative bg-gray-950 py-28" id="use-cases">
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gray-800 to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 text-sm text-emerald-300 font-normal [&>svg]:size-4">
            <Users className="h-4 w-4" />
            <span>Use Cases</span>
          </Badge>
          <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
            Built for Everyone Who Wants to Do More
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Whether you&apos;re a developer, marketer, student, or entrepreneur —
            Renovix AI adapts to your needs and amplifies your productivity.
          </p>
        </motion.div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((useCase, i) => (
            <motion.div
              key={useCase.title}
              className="group rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-emerald-500/30 hover:bg-gray-900/80"
              custom={i}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={cardVariants}
            >
              <div className="mb-3 inline-flex rounded-lg bg-emerald-500/10 p-2.5">
                <useCase.icon className="h-5 w-5 text-emerald-400" />
              </div>
              <p className="mb-1 text-xs font-medium text-emerald-400 uppercase tracking-wider">
                {useCase.role}
              </p>
              <h3 className="mb-3 text-lg font-semibold text-white">
                {useCase.title}
              </h3>
              <ul className="space-y-2">
                {useCase.points.map((point) => (
                  <li
                    key={point}
                    className="flex items-start gap-2 text-sm text-gray-400"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/60" />
                    {point}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
