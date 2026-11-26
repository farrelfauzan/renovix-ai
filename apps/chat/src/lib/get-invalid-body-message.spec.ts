/// <reference types="jest" />
import { getInvalidBodyMessage } from './get-invalid-body-message';

describe('getInvalidBodyMessage', () => {
  it('names the failing fields in their own key order', () => {
    const inputBody = {
      error: { message: 'Invalid request body', type: 'invalid_request_error', details: { name: ['Required'], instructions: ['Too long'] } },
    };
    expect(getInvalidBodyMessage(inputBody)).toBe('Invalid request body: name, instructions');
  });

  it('returns only the message when details is missing', () => {
    expect(getInvalidBodyMessage({ error: { message: 'Invalid request body', type: 'invalid_request_error' } })).toBe(
      'Invalid request body',
    );
  });

  it('returns only the message when details has no keys', () => {
    expect(getInvalidBodyMessage({ error: { message: 'Invalid request body', details: {} } })).toBe('Invalid request body');
  });

  it('returns null when error is not an object', () => {
    expect(getInvalidBodyMessage({ error: 'Invalid request body' })).toBeNull();
  });

  it('returns null when error.message is not a string', () => {
    expect(getInvalidBodyMessage({ error: { message: 42, details: { name: ['Required'] } } })).toBeNull();
  });

  it('returns null for null', () => {
    expect(getInvalidBodyMessage(null)).toBeNull();
  });

  it('returns null for a string body', () => {
    expect(getInvalidBodyMessage('Invalid request body')).toBeNull();
  });
});
