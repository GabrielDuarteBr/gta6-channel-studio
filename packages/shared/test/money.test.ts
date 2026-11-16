import { describe, expect, it } from 'vitest';
import { effectiveBrlPerUsd, formatBrl, usdToBrl } from '../src';

describe('reais', () => {
  const fx = { rate: 5.5606, iofPercent: 3.5, spreadPercent: 4 };

  it('cotação efetiva = câmbio + spread, e o IOF sobre o valor já convertido', () => {
    expect(effectiveBrlPerUsd(fx)).toBeCloseTo(5.5606 * 1.04 * 1.035, 6);
    expect(usdToBrl(1, { rate: 5, iofPercent: 0, spreadPercent: 0 })).toBe(5);
    expect(usdToBrl(10, fx)).toBeCloseTo(59.855, 2);
  });

  it('formata em reais; valores pequenos com 3 casas', () => {
    expect(formatBrl(1234.5)).toBe('R$ 1.234,50');
    expect(formatBrl(5)).toBe('R$ 5,00');
    expect(formatBrl(0.0123)).toBe('R$ 0,012');
    expect(formatBrl(0)).toBe('R$ 0,00');
    expect(formatBrl(Number.NaN)).toBe('R$ 0,00');
  });
});

describe('cotação', () => {
  it('4 casas, como o Banco Central', async () => {
    const { formatBrlRate } = await import('../src');
    expect(formatBrlRate(5.5606)).toBe('R$ 5,5606');
  });
});
