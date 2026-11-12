'use client';

import { motion } from 'framer-motion';
import { Cpu, Zap, Brain, Layers } from 'lucide-react';
import { Badge } from '@performa-ai/ui/components/badge';

const models = [
  {
    name: 'Llama 3.3 70B',
    provider: 'Meta',
    tag: 'Best Value',
    description: 'Excellent for general tasks, coding, and reasoning at incredible speed.',
    speed: '95',
    quality: '90',
  },
  {
    name: 'Qwen 2.5 72B',
    provider: 'Alibaba',
    tag: 'Multilingual',
    description: 'Outstanding multilingual capabilities with strong coding performance.',
    speed: '88',
    quality: '92',
  },
  {
    name: 'Mistral Large',
    provider: 'Mistral AI',
    tag: 'Enterprise',
    description: 'Top-tier reasoning and instruction following for complex workflows.',
    speed: '82',
    quality: '95',
  },
  {
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    tag: 'Coding',
    description: 'Specialized in code generation, debugging, and technical tasks.',
    speed: '90',
    quality: '93',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function ModelsSection() {
  return (
    <section className="relative bg-gray-950 py-28" id="models">
      <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-gray-800 to-transparent" />

      <div className="mx-auto max-w-6xl px-6">
        <motion.div
          className="mb-16 text-center"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <Badge variant="outline" className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-300 font-normal [&>svg]:size-4">
            <Brain className="h-4 w-4" />
            <span>Powerful Models</span>
          </Badge>
          <h2 className="mb-4 text-3xl font-bold text-white sm:text-4xl">
            Access the World&apos;s Best AI Models
          </h2>
          <p className="mx-auto max-w-2xl text-gray-400">
            Switch between leading AI models seamlessly. Choose the right model
            for each task — from creative writing to complex code generation.
          </p>
        </motion.div>

        <motion.div
          className="grid gap-6 sm:grid-cols-2"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
        >
          {models.map((model) => (
            <motion.div
              key={model.name}
              className="group relative overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/50 p-6 transition-all hover:border-cyan-500/30 hover:bg-gray-900/80"
              variants={itemVariants}
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-white">{model.name}</h3>
                  <p className="text-sm text-gray-500">{model.provider}</p>
                </div>
                <Badge variant="outline" className="rounded-full bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-300 border border-cyan-500/20">
                  {model.tag}
                </Badge>
              </div>
              <p className="text-sm text-gray-400 mb-4">{model.description}</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Zap className="h-3.5 w-3.5 text-gray-500" />
                  <span className="text-xs text-gray-500 w-12">Speed</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-cyan-500 to-blue-500"
                      style={{ width: `${model.speed}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Layers className="h-3.5 w-3.5 text-gray-500" />
                  <span className="text-xs text-gray-500 w-12">Quality</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-linear-to-r from-violet-500 to-purple-500"
                      style={{ width: `${model.quality}%` }}
                    />
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          className="mt-8 text-center text-sm text-gray-500"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
        >
          <Cpu className="inline h-4 w-4 mr-1 text-gray-600" />
          More models added regularly — GPT-4o, Claude, Gemini coming soon
        </motion.p>
      </div>
    </section>
  );
}
