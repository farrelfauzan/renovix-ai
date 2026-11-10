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

  it('maps the toaster colors to the theme tokens', async () => {
    render(<Providers><div /></Providers>);
    toast('Styled');
    const toaster = (await screen.findByText('Styled')).closest('[data-sonner-toaster]') as HTMLElement;
    expect(toaster.style.getPropertyValue('--normal-bg')).toBe('var(--background)');
    expect(toaster.style.getPropertyValue('--normal-text')).toBe('var(--foreground)');
    expect(toaster.style.getPropertyValue('--normal-border')).toBe('var(--border)');
  });
});
