/** @jest-environment node */
/// <reference types="jest" />
import { config, proxy } from './proxy';
import { NextRequest } from 'next/server';

it.each(['/agents', '/settings', '/profile', '/top-up', '/knowledge', '/memory', '/onboarding'])('keeps %s protected and redirects missing sessions to login', (path) => {
  expect(config.matcher).toContain(`${path}/:path*`);
  const result = proxy(new NextRequest(`http://localhost:4300${path}`));
  expect(result.status).toBe(307);
  const location = new URL(result.headers.get('location')!);
  expect(location.pathname).toBe('/login');
  expect(location.searchParams.get('redirect')).toBe(path);
});

it.each(['better-auth.session_token', '__Secure-better-auth.session_token'])('allows navigation with %s', (cookie) => {
  const result = proxy(new NextRequest('http://localhost:4300/settings', { headers: { cookie: `${cookie}=test-only-session` } }));
  expect(result.headers.get('location')).toBeNull();
  expect(result.headers.get('x-middleware-next')).toBe('1');
});
