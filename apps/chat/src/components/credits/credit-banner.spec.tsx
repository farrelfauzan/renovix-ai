/// <reference types="jest" />
import { render, screen, cleanup, within } from '@testing-library/react';
import { CreditBanner } from './credit-banner';

let mockMeter: { data?: unknown } = {};
jest.mock('@/hooks/use-credit-meter', () => ({ useCreditMeter: () => mockMeter }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));

const DATE_PROJECTION = { status: 'date', runOutAt: '2026-11-22T07:00:00.000Z', runOutLabel: '22/11/2026 14:00', timeZone: 'Asia/Jakarta' };
const meter = (overrides: Record<string, unknown> = {}) => ({
  data: { paidAvailable: '28', weeklyFreeAvailable: '0', projection: DATE_PROJECTION, level: 'none', belowFloor: false, dueReminders: [], ...overrides },
});
const banner = () => screen.queryByRole('status', { name: 'Credit warning' });

afterEach(cleanup);

describe('AC2: the banner shows the state the API returns', () => {
  it('shows the amber banner with the credits left and a top-up link', () => {
    mockMeter = meter({ level: 'amber' });
    render(<CreditBanner />);
    expect(banner()?.getAttribute('data-kind')).toBe('amber');
    expect(banner()?.textContent).toBe('Credits are running low: 28 left. Top up');
    expect(screen.getByRole('link', { name: 'Top up' }).getAttribute('href')).toBe('/settings/billing');
  });

  it('adds the scheduled-runs warning to the amber banner when the floor flag is set', () => {
    mockMeter = meter({ level: 'amber', belowFloor: true });
    render(<CreditBanner />);
    expect(banner()?.textContent).toBe('Credits are running low: 28 left. Scheduled runs may not complete. Top up');
  });

  it('shows the red banner and lists the due runs it receives, in the profile timezone', () => {
    mockMeter = meter({
      level: 'red',
      paidAvailable: '6.8',
      dueReminders: [
        { id: 'r1', description: 'Weekly finance summary', nextRunAt: '2026-11-21T01:00:00.000Z' },
        { id: 'r2', description: null, nextRunAt: '2026-11-21T18:30:00.000Z' },
      ],
    });
    render(<CreditBanner />);
    expect(banner()?.getAttribute('data-kind')).toBe('red');
    expect(banner()?.textContent).toContain('Almost out: 6.8 credits left. Scheduled runs may not complete. Top up now');
    const runs = within(screen.getByRole('list', { name: 'Scheduled runs at risk' })).getAllByRole('listitem');
    expect(runs.map((run) => run.textContent)).toEqual(['Weekly finance summary · 21/11/2026 08:00', 'Scheduled run · 22/11/2026 01:30']);
  });

  it('shows the red banner without a list when no run is due', () => {
    mockMeter = meter({ level: 'red', paidAvailable: '6.8' });
    render(<CreditBanner />);
    expect(banner()?.getAttribute('data-kind')).toBe('red');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows the floor warning when only the floor flag is set', () => {
    mockMeter = meter({ belowFloor: true, projection: { status: 'not_enough_use' } });
    render(<CreditBanner />);
    expect(banner()?.getAttribute('data-kind')).toBe('floor');
    expect(banner()?.textContent).toBe('Credits are below the minimum for your scheduled runs: 28 left. Scheduled runs may not complete. Top up');
  });

  it.each(['amber', 'red'])('shows the %s banner every time the page renders, not only once, and offers no dismiss', (level) => {
    mockMeter = meter({ level });
    const first = render(<CreditBanner />);
    expect(banner()).toBeTruthy();
    first.rerender(<CreditBanner />);
    expect(banner()).toBeTruthy();
    first.unmount();
    render(<CreditBanner />);
    expect(banner()).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the floor warning every time the page renders too', () => {
    mockMeter = meter({ belowFloor: true });
    render(<CreditBanner />).unmount();
    render(<CreditBanner />);
    expect(banner()).toBeTruthy();
  });

  it('shows nothing when the state is fine, and nothing while loading or on error', () => {
    mockMeter = meter();
    render(<CreditBanner />);
    expect(banner()).toBeNull();
    cleanup();
    mockMeter = { data: undefined };
    const { container } = render(<CreditBanner />);
    expect(container.textContent).toBe('');
  });
});

describe('AC3 (D360): a free user (paid available = 0) sees no banner', () => {
  it.each([
    ['the floor flag', { belowFloor: true }],
    ['amber', { level: 'amber', belowFloor: true }],
    ['red', { level: 'red', belowFloor: true, dueReminders: [{ id: 'r1', description: 'Run', nextRunAt: '2026-11-21T01:00:00.000Z' }] }],
  ])('shows no banner even when the API returns %s', (_name, state) => {
    mockMeter = meter({ paidAvailable: '0', ...state });
    const { container } = render(<CreditBanner />);
    expect(banner()).toBeNull();
    expect(container.textContent).toBe('');
  });
});
