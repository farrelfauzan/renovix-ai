/// <reference types="jest" />
import { formatCreditEstimate } from './format-credit-estimate';

describe('formatCreditEstimate', () => {
  it.each([
    ['0.013319', '0.02'],
    ['1.5', '1.50'],
    ['12.000000', '12.00'],
    ['1234.561', '1,234.57'],
  ])('%s is shown as %s: two decimals, rounded up so "up to" holds', (inputCredits, expectedText) => {
    const actualText = formatCreditEstimate(inputCredits);

    expect(actualText).toBe(expectedText);
  });
});
