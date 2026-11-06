import { describe, expect, it } from 'vitest';
import { MarketAmount } from './MarketAmount';

describe('MarketAmount.fromDecimal', () => {
	it('parses into the smallest-unit wire string', () => {
		expect(MarketAmount.fromDecimal('12.345', 3).toRawString()).toBe('12345');
		expect(MarketAmount.fromDecimal('.5', 3).raw).toBe(500n);
		expect(MarketAmount.fromDecimal('0', 3).raw).toBe(0n);
	});

	it('rejects empty input instead of reading it as zero', () => {
		for (const v of ['', ' ', '.', '-', '-.']) {
			expect(() => MarketAmount.fromDecimal(v, 3)).toThrow(/amount is required/);
		}
	});

	it('still rejects negatives and extra precision', () => {
		expect(() => MarketAmount.fromDecimal('-1', 3)).toThrow(/negative/);
		expect(() => MarketAmount.fromDecimal('1.2345', 3)).toThrow(/fractional digits/);
	});
});
