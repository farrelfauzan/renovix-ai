import { render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { Providers } from '@/components/providers';

jest.mock('@/components/auth-hydrator', () => ({ AuthHydrator: () => null }));

beforeAll(() => {
  window.matchMedia = window.matchMedia ?? ((query: string) => ({ matches: false, media: query, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as unknown as MediaQueryList);
});

describe('Providers', () => {
  it('mounts the toaster with the light theme', async () => {
    render(<Providers><div /></Providers>);
    toast('Saved');
    const toaster = await screen.findByText('Saved');
    expect(toaster.closest('[data-sonner-toaster]')?.getAttribute('data-sonner-theme')).toBe('light');
  });
});
