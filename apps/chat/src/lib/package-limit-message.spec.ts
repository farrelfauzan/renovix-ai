/// <reference types="jest" />
import { getPackageLimitMessage } from './package-limit-message';
import { isPackageLimitError } from './is-package-limit-error';

const refusal = (feature: string, extra: Record<string, unknown> = {}) => ({
  error: { type: 'PACKAGE_LIMIT_REACHED', feature, nextPackage: 'Pro', ...extra },
});

describe('getPackageLimitMessage', () => {
  it('names the agent limit and the next package for maxAgents', () => {
    expect(getPackageLimitMessage(refusal('maxAgents', { used: 3, limit: 3 }))).toBe(
      "You've used all 3 agents in your package. Upgrade to Pro for more.",
    );
  });

  it('names the connected tool limit for maxConnectedTools', () => {
    expect(getPackageLimitMessage(refusal('maxConnectedTools', { used: 2, limit: 2 }))).toBe(
      'This agent already has 2 connected tools, the most your package allows. Upgrade to Pro for more.',
    );
  });

  it('says API keys are not included for apiAccess', () => {
    expect(getPackageLimitMessage(refusal('apiAccess'))).toBe(
      "API keys aren't included in your package. Upgrade to Pro to use the API.",
    );
  });

  it('names the requested tiers for tier', () => {
    expect(getPackageLimitMessage(refusal('tier', { requested: ['premium', 'flagship'] }))).toBe(
      "premium, flagship models aren't included in your package. Upgrade to Pro to use them.",
    );
  });

  it('says the channel is not included for channel', () => {
    expect(getPackageLimitMessage(refusal('channel'))).toBe(
      "This channel isn't included in your package. Upgrade to Pro to deploy here.",
    );
  });

  it('says inviting needs collaboration for collaboration', () => {
    expect(getPackageLimitMessage(refusal('collaboration'))).toBe(
      'Inviting members needs a package with collaboration. Upgrade to Pro to work as a team.',
    );
  });

  it('ends with the contact sentence when there is no next package', () => {
    expect(getPackageLimitMessage(refusal('apiAccess', { nextPackage: null }))).toBe(
      "API keys aren't included in your package. Contact us to raise your limits.",
    );
  });

  it('returns null for an ordinary error body', () => {
    expect(getPackageLimitMessage({ message: 'Bad request' })).toBeNull();
  });

  it('returns null for a refusal of another type or an unknown feature', () => {
    expect(getPackageLimitMessage({ error: { type: 'OTHER', feature: 'maxAgents' } })).toBeNull();
    expect(getPackageLimitMessage(refusal('somethingElse'))).toBeNull();
    expect(getPackageLimitMessage(undefined)).toBeNull();
  });
});

describe('isPackageLimitError', () => {
  it('is true for an axios error that carries a refusal body', () => {
    expect(isPackageLimitError({ response: { status: 400, data: refusal('maxAgents', { limit: 3 }) } })).toBe(true);
  });

  it('is false for other errors', () => {
    expect(isPackageLimitError({ response: { status: 400, data: { message: 'x' } } })).toBe(false);
    expect(isPackageLimitError(new Error('network'))).toBe(false);
    expect(isPackageLimitError(null)).toBe(false);
  });
});
