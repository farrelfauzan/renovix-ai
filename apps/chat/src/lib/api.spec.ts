/// <reference types="jest" />
import { portalError, PortalError } from './api';

jest.mock('./api-client', () => ({ apiClient: {} }));

describe('portalError', () => {
  it('turns a package refusal into the package copy with the PACKAGE_LIMIT_REACHED code', () => {
    const actual = portalError({
      error: { type: 'PACKAGE_LIMIT_REACHED', feature: 'tier', requested: ['premium'], nextPackage: 'Pro' },
    });
    expect(actual).toBeInstanceOf(PortalError);
    expect(actual.message).toBe("The premium models aren't included in your package. Upgrade to Pro to use them.");
    expect(actual.code).toBe('PACKAGE_LIMIT_REACHED');
  });

  it('keeps the envelope message and code for an ordinary portal error', () => {
    const actual = portalError({ error: { code: 'free_limit_reached', message: 'Daily cap reached' } });
    expect(actual.message).toBe('Daily cap reached');
    expect(actual.code).toBe('free_limit_reached');
  });
});
