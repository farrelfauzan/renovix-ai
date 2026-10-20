import { GitBranch, MessageCircle } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="relative border-t border-gray-800 bg-gray-950">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="mb-4 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
                <span className="text-sm font-bold text-white">R</span>
              </div>
              <span className="text-lg font-bold text-white">Renovix AI</span>
            </div>
            <p className="max-w-xs text-sm text-gray-400 leading-relaxed">
              Your intelligent AI chat platform. Chat with powerful models,
              deploy custom agents, and automate your workflow.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Product</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="#services" className="text-gray-400 transition-colors hover:text-white">
                  Features
                </a>
              </li>
              <li>
                <a href="#agents" className="text-gray-400 transition-colors hover:text-white">
                  AI Agents
                </a>
              </li>
              <li>
                <a href="#pricing" className="text-gray-400 transition-colors hover:text-white">
                  Pricing
                </a>
              </li>
              <li>
                <a href="#models" className="text-gray-400 transition-colors hover:text-white">
                  Models
                </a>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Company</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  About
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  Blog
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  Careers
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="mb-4 text-sm font-semibold text-white">Legal</h4>
            <ul className="space-y-3 text-sm">
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  Terms of Service
                </a>
              </li>
              <li>
                <a href="#" className="text-gray-400 transition-colors hover:text-white">
                  Cookie Policy
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-gray-800 pt-8 sm:flex-row">
          <p className="text-sm text-gray-500">
            &copy; {currentYear} Renovix AI. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-gray-500 transition-colors hover:text-white"
              aria-label="GitHub"
            >
              <GitBranch className="h-5 w-5" />
            </a>
            <a
              href="#"
              className="text-gray-500 transition-colors hover:text-white"
              aria-label="Twitter"
            >
              <MessageCircle className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
