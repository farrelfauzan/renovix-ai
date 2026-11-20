/// <reference types="jest" />
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { GeneralSettings } from './general-settings';

jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));
jest.mock('@/lib/stores', () => ({
  useHydrated: () => true,
  useAuthStore: () => ({ isLoggedIn: () => true, email: 'dewi@example.test' }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
// The Radix select does not open in jsdom: each option is a button that chooses it, inside its field.
jest.mock('@performa-ai/ui/components/select', () => {
  const React = require('react');
  const SelectContext = React.createContext({ value: '', onValueChange: (_value: string) => undefined });
  return {
    Select: ({ value, onValueChange, children }: any) => React.createElement(SelectContext.Provider, { value: { value, onValueChange } }, children),
    SelectTrigger: ({ children }: any) => React.createElement('div', null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => React.createElement('div', null, children),
    SelectItem: ({ value, disabled, children }: any) => {
      const select = React.useContext(SelectContext);
      return React.createElement(
        'button',
        { type: 'button', role: 'option', 'aria-selected': select.value === value, disabled, onClick: () => select.onValueChange(value) },
        children,
      );
    },
  };
});

const savedProfile = {
  id: 'u1',
  email: 'dewi@example.test',
  name: 'Dewi Anggraini',
  avatar: null,
  role: 'Finance',
  jobTitle: 'Controller',
  phone: '+62 811 0000 1111',
  signupGoal: 'Data analysis',
  locale: 'en',
  country: 'ID',
  timezone: 'Asia/Jakarta',
  defaultModelTier: 'standard',
  profileCompletedAt: '2026-11-01T00:00:00Z',
  profileCompleted: true,
};
const proEntitlements = {
  tiers: ['standard', 'advanced'],
  lockedTiers: [
    { tier: 'premium', nextPackage: 'Enterprise' },
    { tier: 'frontier', nextPackage: null },
  ],
};

let serverProfile: Record<string, unknown>;
let requests: { method: string; url: string; body?: unknown }[];

beforeEach(() => {
  serverProfile = { ...savedProfile };
  requests = [];
  apiClient.defaults.adapter = (config: any) => {
    const body = config.data ? JSON.parse(config.data) : undefined;
    requests.push({ method: config.method, url: config.url, body });
    if (config.method === 'patch') serverProfile = { ...serverProfile, ...body };
    const data = config.url === '/entitlements/me' ? proEntitlements : serverProfile;
    return Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config });
  };
});
afterEach(cleanup);
// Each test renders the page twice (before and after a reload), with every country and timezone as an option.
jest.setTimeout(30000);

/** Renders the page as after a reload: a fresh query cache, so everything shown comes from the API. */
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GeneralSettings />
    </QueryClientProvider>,
  );

/** The field whose label is `label`: its input, options and hint. */
const field = (label: string) => screen.getByText(label, { selector: 'label' }).parentElement as HTMLElement;
const optionOf = (label: string, option: string) => within(field(label)).getByText(option, { selector: '[role="option"]' }) as HTMLButtonElement;
const chooseOption = (label: string, option: string) => fireEvent.click(optionOf(label, option));
const selectedOption = (label: string) => field(label).querySelector('[aria-selected="true"]')?.textContent;
const patches = () => requests.filter((request) => request.method === 'patch');

it('RNX-82 AC4: renders no API Token block and calls no key route (control: it does load the profile)', async () => {
  renderPage();
  await screen.findByText('Save profile');
  expect(screen.queryByText('API Token')).toBeNull();
  expect(screen.queryByText('Regenerate Key')).toBeNull();
  expect(requests.filter((request) => request.url.includes('/auth/keys'))).toEqual([]);
  expect(requests.map((request) => `${request.method} ${request.url}`)).toContain('get /auth/me');
});

it('RNX-82: links to the API keys page', async () => {
  renderPage();
  const link = await screen.findByRole('link', { name: 'API keys page' });
  expect(link.getAttribute('href')).toBe('/settings/api-keys');
});

describe('RNX-77a AC1: each section saves its own fields, shown again after a reload', () => {
  it('Save profile sends exactly the Profile fields; after a reload they are shown', async () => {
    renderPage();
    await screen.findByText('Save profile');
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: '  Rina Wulandari ' } });
    chooseOption('Role', 'Operations');
    fireEvent.change(screen.getByLabelText('Job title (optional)'), { target: { value: 'Operations Manager' } });
    fireEvent.change(screen.getByLabelText('Phone or WhatsApp (optional)'), { target: { value: '+62 812 3456 4471' } });
    fireEvent.click(screen.getByText('Data analysis', { selector: 'button' }));
    fireEvent.click(screen.getByText('Automation and reminders', { selector: 'button' }));
    fireEvent.click(screen.getByText('Reports and documents', { selector: 'button' }));

    fireEvent.click(screen.getByText('Save profile', { selector: 'button' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      method: 'patch',
      url: '/auth/me',
      body: {
        name: 'Rina Wulandari',
        role: 'Operations',
        jobTitle: 'Operations Manager',
        phone: '+62 812 3456 4471',
        signupGoal: 'Reports and documents, Automation and reminders',
      },
    });
    cleanup();
    renderPage();
    await screen.findByText('Save profile');
    expect((screen.getByLabelText('Full name') as HTMLInputElement).value).toBe('Rina Wulandari');
    expect(selectedOption('Role')).toBe('Operations');
    expect((screen.getByLabelText('Job title (optional)') as HTMLInputElement).value).toBe('Operations Manager');
    expect((screen.getByLabelText('Phone or WhatsApp (optional)') as HTMLInputElement).value).toBe('+62 812 3456 4471');
    expect(screen.getByText('Reports and documents', { selector: 'button' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Automation and reminders', { selector: 'button' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Data analysis', { selector: 'button' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Save preferences sends exactly the Preferences fields; after a reload they are shown and the UI text is unchanged', async () => {
    renderPage();
    await screen.findByText('Save preferences');
    chooseOption('Interface and agent language', 'Bahasa Indonesia');
    chooseOption('Country', 'Singapore');
    chooseOption('Timezone', 'Asia/Makassar (WITA)');
    chooseOption('Default model tier for new chats', 'Advanced');

    fireEvent.click(screen.getByText('Save preferences', { selector: 'button' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]).toEqual({
      method: 'patch',
      url: '/auth/me',
      body: { locale: 'id', country: 'SG', timezone: 'Asia/Makassar', defaultModelTier: 'advanced' },
    });
    cleanup();
    renderPage();
    await screen.findByText('Save preferences');
    expect(selectedOption('Interface and agent language')).toBe('Bahasa Indonesia');
    expect(selectedOption('Country')).toBe('Singapore');
    expect(selectedOption('Timezone')).toBe('Asia/Makassar (WITA)');
    expect(selectedOption('Default model tier for new chats')).toBe('Advanced');
    // The interface language is stored and shown only: no UI text is translated.
    expect(screen.getByText('Profile', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByText('Preferences', { selector: 'h2' })).toBeTruthy();
    expect(screen.getByText('Save profile', { selector: 'button' })).toBeTruthy();
  });

  it('negative: a tier the package does not allow is shown disabled with the package that grants it', async () => {
    renderPage();
    await screen.findByText('Save preferences');
    const tier = 'Default model tier for new chats';
    expect(optionOf(tier, 'Premium · Available on Enterprise').disabled).toBe(true);
    expect(optionOf(tier, 'Frontier · Not in your package').disabled).toBe(true);
    expect(optionOf(tier, 'Advanced').disabled).toBe(false);
  });

  it('negative: a saved default tier the package no longer allows is not sent with the other preferences', async () => {
    serverProfile = { ...savedProfile, defaultModelTier: 'premium' };
    renderPage();
    await screen.findByText('Save preferences');

    fireEvent.click(screen.getByText('Save preferences', { selector: 'button' }));

    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toEqual({ locale: 'en', country: 'ID', timezone: 'Asia/Jakarta' });
  });
});
