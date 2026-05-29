import { useEffect, useMemo, useState } from 'react';
import {
	gqlFetchFailover,
	resolveIndexerUrls,
	type MagiConfig
} from '@vsc.eco/market-sdk';

/** Native assets aren't in `magi_token_overview`; resolve them statically.
 * Native HBD/HIVE use precision 3 on the L2 ledger (1000 raw = 1.000). */
const NATIVE: Record<string, { symbol: string; name: string; decimals: number }> = {
	hbd: { symbol: 'HBD', name: 'Hive Dollar', decimals: 3 },
	hive: { symbol: 'HIVE', name: 'Hive', decimals: 3 }
};

/**
 * Payment tokens the market whitelists that are NOT magi_tokens, so they
 * never appear in `magi_token_overview` and the indexer can't tell us their
 * decimals. Resolve them statically, keyed by network → contract id. The
 * market reads their balances via the UTXO-mapping `a-<acct>` layout and
 * moves them through standard `transferFrom`/`transfer`, so once whitelisted
 * on-chain they behave like any other ERC-20-style payment token.
 */
const EXTRA_TOKENS: Record<string, Record<string, { symbol: string; name: string; decimals: number }>> = {
	'vsc-testnet': {
		// BTC UTXO-mapping contract (sats, 8 decimals). Whitelisted on the
		// testnet market via addPaymentToken.
		vsc1BYBwMvsSFwqvwzio352VWp6fGkjVs7t3Dp: { symbol: 'BTC', name: 'Bitcoin (mapped)', decimals: 8 }
	}
};

interface OverviewRow {
	contract_id: string;
	name: string | null;
	symbol: string | null;
	decimals: number | null;
}

export interface TokenMetaRow {
	id: string;
	symbol: string;
	name: string;
	decimals: number;
}

export interface TokenMeta {
	/** Ticker for an id (`hbd`/`hive` or a vsc1… contract). Falls back to a
	 * shortened id when the token is unknown to the indexer. */
	symbol: (id: string) => string;
	/** Human name for an id; falls back to the raw id. */
	name: (id: string) => string;
	/** Decimals (precision) of the token: 3 for native HBD/HIVE, the
	 * indexer's value for known magi_tokens, 3 as a sensible fallback. */
	decimals: (id: string) => number;
	/** The smallest positive human value for a token's precision —
	 * "0.001" (3 dp), "0.00000001" (8 dp / BTC), "1" (0 dp). Handy as a
	 * price-input placeholder so users see the minimum unit they can enter. */
	smallestUnit: (id: string) => string;
	/** Format a raw smallest-unit amount (the form the contract stores
	 * and the indexer returns) as a human-readable decimal string. */
	format: (id: string, raw: string | number | bigint | undefined) => string;
	/** Parse a human decimal string into raw smallest-unit integer string
	 * for the contract's `parseMoney`. Returns "" on invalid input. */
	toMicro: (id: string, human: string) => string;
	/** Sorted list of every token the indexer knows (excluding natives).
	 * Exposed so a single hook covers both the lookups (`symbol`/`name`)
	 * and the dropdown lists (`TokenPicker`) — one fetch, one cache. */
	tokens: TokenMetaRow[];
	/** True once the overview fetch has settled (success or failure). */
	ready: boolean;
}

const short = (id: string) => (id && id.length > 14 ? `${id.slice(0, 10)}…` : id || '');

/** Format a raw smallest-unit value (what the contract stores) as a human
 * decimal string, trimming trailing zeros. Native HBD/HIVE use 3 decimals;
 * magi_tokens vary (the indexer's `decimals` column). */
export function microToHuman(
	raw: string | number | bigint | undefined | null,
	decimals: number
): string {
	if (raw === undefined || raw === null || raw === '') return '0';
	let n: bigint;
	try {
		n = typeof raw === 'bigint' ? raw : BigInt(raw);
	} catch {
		return String(raw);
	}
	if (decimals <= 0) return n.toString();
	const divisor = 10n ** BigInt(decimals);
	const whole = n / divisor;
	const frac = n % divisor;
	if (frac === 0n) return whole.toString();
	const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
	return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

/** Parse a human decimal (e.g. "0.500") into the raw smallest-unit
 * integer string the contract's `parseMoney` expects. Returns "" on
 * invalid input so callers can disable Submit instead of broadcasting a
 * bad payload. */
export function humanToMicro(human: string, decimals: number): string {
	const s = (human || '').trim();
	if (!s) return '';
	const re = decimals > 0 ? new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`) : /^\d+$/;
	if (!re.test(s)) return '';
	const [whole, frac = ''] = s.split('.');
	const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
	return (BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0')).toString();
}

/**
 * Two responsibilities, one fetch:
 *  - a metadata `map` (id → symbol/name/decimals) built from
 *    `magi_token_overview` + statically-known extras, used for the
 *    lookups (`symbol`/`name`/`decimals`/`format`) across the widget —
 *    this covers EVERY token so an existing listing priced in a
 *    non-whitelisted token still renders a readable label.
 *  - the dropdown `tokens` list, which is the marketplace's payment-token
 *    WHITELIST (the `magi_market_payment_tokens` view, active rows) ∪ the
 *    statically-known extras. So the picker only offers tokens the
 *    contract will actually accept. Native HIVE/HBD aren't in the view;
 *    TokenPicker prepends them itself.
 */
export function useTokenMeta(config: MagiConfig): TokenMeta {
	const urls = useMemo(() => resolveIndexerUrls(config), [config]);
	const network = config.network;
	const [map, setMap] = useState<Map<string, { symbol: string; name: string; decimals: number }>>(new Map());
	const [whitelist, setWhitelist] = useState<string[]>([]);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setReady(false);
		// Statically-known non-magi_token payment tokens for this network
		// (e.g. the BTC UTXO-mapping contract). They aren't in
		// magi_token_overview, so they supply their own metadata, and we
		// treat them as whitelisted (we added them on-chain) so they show
		// even if the view query lags.
		const extras = EXTRA_TOKENS[network] ?? {};
		const extraIds = Object.keys(extras);
		gqlFetchFailover<{
			magi_token_overview: OverviewRow[];
			magi_market_payment_tokens: { token: string }[];
		}>(
			urls,
			'{ magi_token_overview { contract_id name symbol decimals } magi_market_payment_tokens(where:{active:{_eq:true}}) { token } }'
		)
			.then((d) => {
				if (cancelled) return;
				const m = new Map<string, { symbol: string; name: string; decimals: number }>();
				for (const r of d.magi_token_overview ?? []) {
					m.set(r.contract_id, {
						symbol: r.symbol || short(r.contract_id),
						name: r.name || r.contract_id,
						// Indexer may carry null for never-init'd contracts; 3 is
						// the closest sane fallback (matches HBD/HIVE precision)
						// without claiming "0 decimals" for tokens we just don't
						// know yet.
						decimals: r.decimals ?? 3
					});
				}
				for (const [id, meta] of Object.entries(extras)) m.set(id, meta);
				setMap(m);
				const wl = new Set<string>(extraIds);
				for (const p of d.magi_market_payment_tokens ?? []) wl.add(p.token);
				setWhitelist(Array.from(wl));
			})
			.catch(() => {
				// Indexer unreachable — still surface the statically-known extras.
				if (!cancelled) {
					setMap(new Map(Object.entries(extras)));
					setWhitelist(extraIds);
				}
			})
			.finally(() => !cancelled && setReady(true));
		return () => {
			cancelled = true;
		};
	}, [urls, network]);

	return useMemo(() => {
		const lookup = (id: string) => {
			const k = (id || '').toLowerCase();
			return NATIVE[k] ?? map.get(id);
		};
		/** Decimals if known, null otherwise. Replaces the prior `?? 3`
		 *  fallback at the boundaries where guessing wrong is destructive
		 *  (toMicro scales a user-entered "1.50000000" by the precision —
		 *  guessing 3 for an 8-dp BTC turns 1.5 BTC into 1500 sats, a
		 *  100_000× under-charge). Display helpers still fall back to 3
		 *  because rendering a vaguely-wrong number is far less harmful
		 *  than refusing to render at all. */
		const knownDecimalsOf = (id: string): number | null => {
			const v = lookup(id);
			return v ? v.decimals : null;
		};
		const decimalsOf = (id: string) => knownDecimalsOf(id) ?? 3;
		// Dropdown list = the whitelisted set, resolved through the metadata
		// map (unknown whitelisted ids degrade to a shortened id + 3 dp).
		const tokens: TokenMetaRow[] = whitelist
			.map((id) => {
				const v = map.get(id);
				return {
					id,
					symbol: v?.symbol ?? short(id),
					name: v?.name ?? id,
					decimals: v?.decimals ?? 3
				};
			})
			.sort((a, b) => a.symbol.localeCompare(b.symbol));
		return {
			symbol: (id: string) => lookup(id)?.symbol ?? short(id),
			name: (id: string) => lookup(id)?.name ?? id ?? '',
			decimals: decimalsOf,
			smallestUnit: (id: string) => {
				const d = knownDecimalsOf(id);
				if (d === null) return ''; // unknown → no minimum-unit hint
				return d <= 0 ? '1' : `0.${'0'.repeat(d - 1)}1`;
			},
			format: (id: string, raw) => microToHuman(raw, decimalsOf(id)),
			// Destructive: returns "" (the existing "disable submit" sentinel)
			// when decimals are unknown rather than silently mis-scaling.
			toMicro: (id: string, human: string) => {
				const d = knownDecimalsOf(id);
				if (d === null) return '';
				return humanToMicro(human, d);
			},
			tokens,
			ready
		};
	}, [map, whitelist, ready]);
}
