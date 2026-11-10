/// <reference types="jest" />
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsLayout from './layout';
import { useAuthStore } from '@/lib/stores';

const mockGet = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiClient: { get: (...args: unknown[]) => mockGet(...args) } }));
jest.mock('next/navigation', () => ({ usePathname: () => '/settings/general' }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
Element.prototype.scrollIntoView = jest.fn();
afterEach(() => { cleanup(); mockGet.mockReset(); useAuthStore.setState({ sessionAuth: false }); });

it('renders the settings layout for a signed-in user across the hydration change without a hook-order error', async () => {
  const errorSpy = jest.spyOn(console, 'error');
  mockGet.mockResolvedValue([]);
  useAuthStore.setState({ sessionAuth: true });
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><SettingsLayout><p>General page</p></SettingsLayout></QueryClientProvider>);
  expect(screen.getByRole('link', { name: 'General' }).getAttribute('aria-current')).toBe('page');
  expect(screen.getByText('General page')).toBeTruthy();
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/workspaces'));
  expect(errorSpy.mock.calls.flat().join(' ')).not.toMatch(/more hooks|fewer hooks|Rules of Hooks/);
  errorSpy.mockRestore();
});
