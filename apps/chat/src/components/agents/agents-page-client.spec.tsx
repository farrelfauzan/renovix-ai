/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import AgentsPageClient from './agents-page-client';

let mockEntitlements: { data?: unknown } = {};
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('server=s1'),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => null }));
jest.mock('framer-motion', () => {
  const React = require('react');
  const passthrough = ({ children }: any) => React.createElement('div', null, children);
  return { motion: { div: passthrough }, AnimatePresence: passthrough };
});
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true }),
}));
jest.mock('@/hooks/use-my-entitlements', () => ({ useMyEntitlements: () => mockEntitlements }));
jest.mock('@/hooks/use-agents', () => ({
  useAgents: () => ({ data: [] }),
  useAgentSubscription: () => ({ data: { subscription: {} }, isLoading: false }),
}));
jest.mock('@/hooks/use-channels', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    useChannels: () => ({ data: [], isLoading: false }),
    useChannel: () => ({ data: { id: 's1', name: 'Server', agents: [], color: null, icon: null }, isLoading: false }),
    useDeleteChannel: mutation, useAddChannelAgent: mutation, useRemoveChannelAgent: mutation,
    useChannelMessages: () => ({ data: [] }), useClearMessages: mutation,
  };
});
jest.mock('@/hooks/use-channel-chat', () => ({ useChannelChat: () => ({}) }));
jest.mock('@/components/code-block', () => ({ CodeBlock: () => null }));
jest.mock('@/components/document-card', () => ({ DocumentCard: () => null }));
jest.mock('@/components/agents/create-server-dialog', () => ({ CreateServerDialog: () => null }));
jest.mock('@/components/workspace/server-team-sidebar', () => ({ ServerTeamSidebar: () => null }));
jest.mock('@/components/settings/workspace-settings', () => ({ WorkspaceSettings: () => null }));
jest.mock('@/components/settings/agent-settings-panel', () => ({ AgentSettingsPanel: () => null }));

afterEach(cleanup);

it('shows used of limit agents on the agents list', () => {
  mockEntitlements = { data: { agents: { used: 3, limit: 10 } } };
  render(<AgentsPageClient />);
  expect(screen.getByText('3 of 10 agents')).toBeTruthy();
});

it('shows no agents pill when the entitlements are unavailable', () => {
  mockEntitlements = { data: undefined };
  render(<AgentsPageClient />);
  expect(screen.getByText('Server')).toBeTruthy();
  expect(screen.queryByText(/of \d+ agents/)).toBeNull();
});
