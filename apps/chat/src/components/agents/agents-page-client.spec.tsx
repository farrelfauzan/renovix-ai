/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { apiClient } from '@/lib/api-client';
import AgentsPageClient from './agents-page-client';

let mockEntitlements: { data?: unknown } = {};
let mockSubscription: unknown = {};
let mockChannelAgents: unknown[] = [];
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
  useAgentSubscription: () => ({ data: { subscription: mockSubscription }, isLoading: false }),
}));
jest.mock('@/hooks/use-channels', () => {
  const mutation = () => ({ mutate: jest.fn(), mutateAsync: jest.fn(), isPending: false });
  return {
    useChannels: () => ({ data: [], isLoading: false }),
    useChannel: () => ({ data: { id: 's1', name: 'Server', agents: mockChannelAgents, color: null, icon: null }, isLoading: false }),
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

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});

afterEach(() => {
  cleanup();
  mockSubscription = {};
  mockChannelAgents = [];
  jest.restoreAllMocks();
});

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

// RNX-251: a package is permanent (D37), so the redemption answers daysGranted null; the message names the package only.
it('a package code redeemed: says the package is activated, never "for null days"', async () => {
  mockSubscription = null;
  const mockPost = jest.spyOn(apiClient, 'post').mockResolvedValue({ success: true, creditsGranted: null, planGranted: 'Starter', daysGranted: null });
  render(<AgentsPageClient />);

  fireEvent.change(screen.getByPlaceholderText('RNX-XXXX-XXXX'), { target: { value: 'PERF-AAAA-BBBB' } });
  fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

  const actualMessage = await screen.findByText(/Code redeemed!/);
  expect(mockPost).toHaveBeenCalledWith('/codes/redeem', { code: 'PERF-AAAA-BBBB' });
  expect(actualMessage.textContent).toBe('Code redeemed!  Starter package activated.');
  expect(actualMessage.textContent).not.toMatch(/null|days/);
});

it('Delete Server is an icon-only button with that tooltip and asks before deleting', () => {
  mockEntitlements = { data: undefined };
  render(<AgentsPageClient />);
  const actualButton = screen.getByRole('button', { name: 'Delete Server' });
  expect(actualButton.textContent).toBe('');
  expect(actualButton.nextElementSibling?.textContent).toBe('Delete Server');
  fireEvent.click(actualButton);
  expect(screen.getByRole('alertdialog').textContent).toContain('Delete server?');
});

it('the team sidebar Configure and Remove buttons are named by their agent, show a tooltip, and Remove asks first', () => {
  mockEntitlements = { data: undefined };
  mockChannelAgents = [{ id: 'l1', agentId: 'a1', role: 'main', agent: { id: 'a1', name: 'Nova' } }];
  render(<AgentsPageClient />);
  const configureButton = screen.getByRole('button', { name: 'Configure Nova' });
  expect(configureButton.textContent).toBe('');
  expect(configureButton.nextElementSibling?.textContent).toBe('Configure agent');
  const removeButton = screen.getByRole('button', { name: 'Remove Nova' });
  expect(removeButton.textContent).toBe('');
  expect(removeButton.nextElementSibling?.textContent).toBe('Remove agent');
  expect(removeButton.hasAttribute('title')).toBe(false);
  fireEvent.click(removeButton);
  expect(screen.getByRole('alertdialog').textContent).toContain('Remove agent?');
});
