/// <reference types="jest" />
import { render, screen, cleanup } from '@testing-library/react';
import { SidebarCreditMeter } from './sidebar-credit-meter';

let mockMeter: { data?: unknown } = {};
jest.mock('@/hooks/use-credit-meter', () => ({ useCreditMeter: () => mockMeter }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, ...props }: any) => <a {...props}>{children}</a> }));

const meter = (overrides: Record<string, unknown> = {}) => ({
  data: {
    paidAvailable: '128.4',
    weeklyFreeAvailable: '3.5',
    projection: { status: 'date', runOutAt: '2026-12-03T07:00:00.000Z', runOutLabel: '03/12/2026 14:00', timeZone: 'Asia/Jakarta' },
    level: 'none',
    belowFloor: false,
    dueReminders: [],
    ...overrides,
  },
});

afterEach(cleanup);

describe('AC1: paid credits left and the projected run-out', () => {
  it('shows the paid credits and the run-out date in the HH:00 format the API gives for the profile timezone', () => {
    mockMeter = meter();
    render(<SidebarCreditMeter />);
    expect(screen.getByText('Credits')).toBeTruthy();
    expect(screen.getByText('128.4')).toBeTruthy();
    expect(screen.getByText('At this rate your credits run out on 03/12/2026 14:00')).toBeTruthy();
  });

  it('says not enough use yet when there is no projection', () => {
    mockMeter = meter({ projection: { status: 'not_enough_use' } });
    render(<SidebarCreditMeter />);
    expect(screen.getByText('Not enough use yet to estimate')).toBeTruthy();
    expect(screen.queryByText(/run out on/)).toBeNull();
  });

  it('says more than a year when the pace is that slow', () => {
    mockMeter = meter({ projection: { status: 'more_than_a_year' } });
    render(<SidebarCreditMeter />);
    expect(screen.getByText('More than a year at your current pace')).toBeTruthy();
  });

  it('links to the billing page to top up', () => {
    mockMeter = meter();
    render(<SidebarCreditMeter />);
    expect(screen.getByRole('link', { name: 'Top up' }).getAttribute('href')).toBe('/settings/billing');
  });

  it('renders nothing while loading or on error, not an invented balance', () => {
    mockMeter = { data: undefined };
    const { container } = render(<SidebarCreditMeter />);
    expect(container.textContent).toBe('');
  });
});

describe('AC3: the free view (paid available = 0)', () => {
  it('shows the weekly allowance left and the paid credits separately', () => {
    mockMeter = meter({ paidAvailable: '0', projection: { status: 'not_enough_use' }, belowFloor: true });
    render(<SidebarCreditMeter />);
    expect(screen.getByText('Free allowance').parentElement?.textContent).toBe('Free allowance3.5');
    expect(screen.getByText('Left this week')).toBeTruthy();
    expect(screen.getByText('Paid credits').parentElement?.textContent).toBe('Paid credits0');
  });

  it.each([
    [{ status: 'not_enough_use' }],
    [{ status: 'more_than_a_year' }],
    [{ status: 'date', runOutAt: '2026-12-03T07:00:00.000Z', runOutLabel: '03/12/2026 14:00', timeZone: 'Asia/Jakarta' }],
  ])('shows no run-out projection, whatever the API returns (%j)', (projection) => {
    mockMeter = meter({ paidAvailable: '0', projection });
    render(<SidebarCreditMeter />);
    expect(screen.queryByText(/run out on|Not enough use|More than a year/)).toBeNull();
  });
});
