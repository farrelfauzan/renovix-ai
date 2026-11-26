/// <reference types="jest" />
import type React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { IntegrationsTab } from './integrations-tab';

// jsdom cannot hover or focus-visible, so the shared tooltip always shows its content, as a sibling of the trigger.
jest.mock('@performa-ai/ui/components/tooltip', () => {
  const Container = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return { TooltipProvider: Container, Tooltip: Container, TooltipTrigger: Container, TooltipContent: ({ children }: { children: React.ReactNode }) => <span role="tooltip">{children}</span> };
});
const mockTest = jest.fn();
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/components/agents/agent-detail/integration-provider-logo', () => ({ IntegrationProviderLogo: () => null }));
jest.mock('@/hooks/use-mcp', () => ({
  useMcpServers: () => ({ data: [{ id: 'c1', displayName: 'Gmail', provider: 'google-gmail', status: 'connected', toolCount: 2 }], isLoading: false }),
  useTestMcpConnection: () => ({ mutateAsync: mockTest }),
}));

afterEach(() => { cleanup(); jest.clearAllMocks(); });

it('Test connection is an icon-only button named by its provider, with that tooltip, and tests it', async () => {
  render(<IntegrationsTab agent={{}} agentId="a1" />);
  const actualButton = screen.getByRole('button', { name: 'Test connection Gmail' });
  expect(actualButton.textContent).toBe('');
  expect(actualButton.nextElementSibling?.textContent).toBe('Test connection');
  fireEvent.click(actualButton);
  await waitFor(() => expect(mockTest).toHaveBeenCalledWith('c1'));
});
