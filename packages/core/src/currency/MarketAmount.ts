/**
 * Whole-vs-smallest-unit conversion for marketplace prices. Mirrors
 * `TokenAmount` in @vsc.eco/token-core — magi-market carries every price
 * as an arbitrary-precision decimal string on the wire, so the host needs
 * the same decimals-aware parse/format helper to turn a user-entered
 * "12.345" into the smallest-unit string the contract expects (and back).
 */
export class MarketAmount {
	readonly raw: bigint;
	readonly decimals: number;

	constructor(raw: bigint | number | string, decimals: number) {
		if (decimals < 0 || !Number.isInteger(decimals)) {
			throw new Error(`MarketAmount: decimals must be a non-negative integer, got ${decimals}`);
		}
		this.raw = typeof raw === 'bigint' ? raw : BigInt(raw);
		this.decimals = decimals;
	}

	/**
	 * Parse a human "12.345" string at the given decimals into smallest units.
	 *
	 * - Rejects negatives: the contract treats every money field as unsigned;
	 *   a `-5` smallest-unit string would parse as the literal characters and
	 *   abort on the wire, but at the client boundary we can produce a clearer
	 *   error.
	 * - Rejects extra fractional precision: silently truncating "1.123456789"
	 *   to "1.123" for a 3-decimal token loses value the caller almost
	 *   certainly didn't mean to lose. Force them to round explicitly.
	 */
	static fromDecimal(value: string | number, decimals: number): MarketAmount {
		const s = String(value).trim();
		if (s === '') return new MarketAmount(0n, decimals);
		if (!/^-?\d*\.?\d*$/.test(s)) {
			throw new Error(`MarketAmount.fromDecimal: invalid number "${s}"`);
		}
		if (s.startsWith('-')) {
			throw new Error(`MarketAmount.fromDecimal: negative amounts are not supported, got "${s}"`);
		}
		const [intPart = '0', fracPart = ''] = s.split('.');
		if (fracPart.length > decimals) {
			throw new Error(
				`MarketAmount.fromDecimal: "${s}" has ${fracPart.length} fractional digits but the token only supports ${decimals} — round the value before passing it in`
			);
		}
		const fracPadded = fracPart + '0'.repeat(decimals - fracPart.length);
		const combined = `${intPart}${fracPadded}`.replace(/^0+(?=\d)/, '');
		const raw = BigInt(combined === '' ? '0' : combined);
		return new MarketAmount(raw, decimals);
	}

	/** The smallest-unit decimal string the contract wants on the wire. */
	toRawString(): string {
		return this.raw.toString();
	}

	/** Render as a decimal string. Trailing zeros are kept (no implicit trim). */
	toDecimalString(): string {
		const negative = this.raw < 0n;
		const abs = negative ? -this.raw : this.raw;
		if (this.decimals === 0) return (negative ? '-' : '') + abs.toString();
		const s = abs.toString().padStart(this.decimals + 1, '0');
		const intPart = s.slice(0, -this.decimals);
		const fracPart = s.slice(-this.decimals);
		return (negative ? '-' : '') + `${intPart}.${fracPart}`;
	}

	/** Trim trailing zeros from the decimal portion for display. */
	toDecimalStringTrimmed(): string {
		return this.toDecimalString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
	}
}
