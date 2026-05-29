import { useEffect, useMemo, useState } from 'react';
import {
	gqlFetchFailover,
	resolveGqlUrls,
	resolveIndexerUrls,
	type MagiConfig
} from '@vsc.eco/market-sdk';

interface NodeBalance {
	hbd: number | null;
	hive: number | null;
}

interface TokenBalanceRow {
	contract_id: string;
	balance: string | number;
}

export interface UserBalances {
	/** Raw smallest-unit balance for a payment-token id, or null while
	 *  loading / 0 if the user holds nothing. `hive`/`hbd` are precision-3
	 *  on the L2 ledger; magi_tokens use their own decimals. */
	balanceOf: (paymentToken: string) => bigint | null;
	ready: boolean;
}

/**
 * Look up the connected user's L2 balance for any payment-token id used by
 * the market. Native (HBD/HIVE) comes from the node's `getAccountBalance`;
 * magi_tokens come from the indexer's `magi_token_balances` view (filtered
 * by `account`). One fetch per `username`; the result feeds the
 * affordability and "include tokens I don't have" filters in the panel.
 */
export function useUserBalances(config: MagiConfig, username: string | undefined): UserBalances {
	const indexerUrls = useMemo(() => resolveIndexerUrls(config), [config]);
	const nodeUrls = useMemo(() => resolveGqlUrls(config), [config]);

	const account = username ? `hive:${username.replace(/^@/, '').replace(/^hive:/, '')}` : '';

	const [tokens, setTokens] = useState<Map<string, bigint>>(new Map());
	const [native, setNative] = useState<{ hive: bigint; hbd: bigint } | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (!account) {
			setTokens(new Map());
			setNative(null);
			setReady(true);
			return;
		}
		let cancelled = false;
		setReady(false);
		const nativeQ = gqlFetchFailover<{ getAccountBalance: NodeBalance | null }>(
			nodeUrls,
			`query($a:String!){ getAccountBalance(account:$a){ hbd hive } }`,
			{ a: account }
		);
		const tokenQ = gqlFetchFailover<{ magi_token_balances: TokenBalanceRow[] }>(
			indexerUrls,
			`query($a:String!){ magi_token_balances(where:{account:{_eq:$a}}){ contract_id balance } }`,
			{ a: account }
		);
		Promise.allSettled([nativeQ, tokenQ]).then((results) => {
			if (cancelled) return;
			const [n, t] = results;
			if (n.status === 'fulfilled') {
				const b = n.value.getAccountBalance;
				setNative({
					hive: BigInt(b?.hive ?? 0),
					hbd: BigInt(b?.hbd ?? 0)
				});
			} else {
				setNative({ hive: 0n, hbd: 0n });
			}
			if (t.status === 'fulfilled') {
				const m = new Map<string, bigint>();
				for (const row of t.value.magi_token_balances ?? []) {
					try {
						m.set(row.contract_id, BigInt(row.balance));
					} catch {
						/* skip unparseable balance */
					}
				}
				setTokens(m);
			} else {
				setTokens(new Map());
			}
			setReady(true);
		});
		return () => {
			cancelled = true;
		};
	}, [account, nodeUrls, indexerUrls]);

	return useMemo(
		() => ({
			balanceOf: (paymentToken: string): bigint | null => {
				if (!ready) return null;
				const k = (paymentToken || '').toLowerCase();
				if (k === 'hive') return native?.hive ?? 0n;
				if (k === 'hbd') return native?.hbd ?? 0n;
				return tokens.get(paymentToken) ?? 0n;
			},
			ready
		}),
		[native, tokens, ready]
	);
}
