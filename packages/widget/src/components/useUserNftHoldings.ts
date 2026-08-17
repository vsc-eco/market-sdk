import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveIndexerUrls, type MagiConfig } from '@vsc.eco/market-sdk';
import { gqlFetchAllPages } from './gqlPaged.js';

interface NftBalanceRow {
	contract_id: string;
	token_id: string;
	balance: string | number;
}

export interface UserNftHoldings {
	/**
	 * Units of `contractId:tokenId` the user holds. `null` while the lookup
	 * is still in flight so callers can distinguish "unknown" from "zero"
	 * and avoid flashing a wrong verdict.
	 */
	balanceOf: (contractId: string, tokenId: string) => bigint | null;
	/**
	 * Whether the user holds a positive balance of ANY token in `contractId`
	 * — the eligibility test for a collection-wide offer. `null` while loading.
	 */
	holdsAnyIn: (contractId: string) => boolean | null;
	/** TokenIds of `contractId` the user holds, ascending. Empty while loading. */
	tokenIdsIn: (contractId: string) => string[];
	ready: boolean;
	/** Re-query (after an accept/transfer changed the wallet). */
	refresh: () => void;
}

const key = (contractId: string, tokenId: string) => `${contractId}:${tokenId}`;

/**
 * The connected user's NFT inventory, as the indexer sees it: one
 * `magi_nft_balances` query per username, keyed `contract_id:token_id`.
 *
 * Used to gate the seller-side offer actions — magi-market's
 * `doAcceptOffer` pulls the NFT out of the accepter's wallet and aborts
 * with "Insufficient NFT balance to fulfill offer" when they hold none, so
 * showing an Accept button to a non-holder can only ever produce a failed
 * (RC-burning) broadcast.
 *
 * Same shape and source as `useUserBalances` (which covers *payment*
 * tokens); this is its NFT counterpart. Reads the indexer rather than
 * token-sdk's `getUserNfts` because only the raw balance rows are needed —
 * no metadata, no image resolution.
 */
export function useUserNftHoldings(
	config: MagiConfig,
	username: string | undefined
): UserNftHoldings {
	const indexerUrls = useMemo(() => resolveIndexerUrls(config), [config]);

	// The indexer stores accounts prefixed (`magi_nft_balances.account =
	// "hive:tibfox"`) while the connected username is bare, so an
	// un-normalized lookup silently returns zero rows — i.e. "holds
	// nothing", which would hide every Accept button.
	const account = username ? `hive:${username.replace(/^@/, '').replace(/^hive:/, '')}` : '';

	const [held, setHeld] = useState<Map<string, bigint>>(new Map());
	const [ready, setReady] = useState(false);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		if (!account) {
			setHeld(new Map());
			setReady(true);
			return;
		}
		let cancelled = false;
		setReady(false);
		// Paged: the indexer caps every response at 100 rows, so a wallet
		// holding more than that would silently look like it holds nothing
		// past the cap — and this map is what hides the Accept button.
		gqlFetchAllPages<NftBalanceRow>(
			indexerUrls,
			`query H($a:String!,$limit:Int!,$offset:Int!){
				magi_nft_balances(
					where:{account:{_eq:$a}, balance:{_gt:"0"}}
					order_by:{contract_id:asc, token_id:asc}
					limit:$limit offset:$offset
				){ contract_id token_id balance }
			}`,
			(d) => (d as { magi_nft_balances?: NftBalanceRow[] }).magi_nft_balances,
			{ a: account }
		)
			.then(({ rows }) => {
				if (cancelled) return;
				const m = new Map<string, bigint>();
				for (const row of rows) {
					try {
						const b = BigInt(row.balance);
						if (b > 0n) m.set(key(row.contract_id, row.token_id), b);
					} catch {
						/* skip unparseable balance */
					}
				}
				setHeld(m);
			})
			.catch(() => {
				// A failed lookup must not masquerade as "holds nothing" — see
				// `balanceOf` below: `ready` flips but an empty map plus a
				// recorded error would be indistinguishable from a real zero.
				// Erring toward an empty map matches useUserBalances and keeps
				// the panel from acting on data it doesn't have.
				if (!cancelled) setHeld(new Map());
			})
			.finally(() => {
				if (!cancelled) setReady(true);
			});
		return () => {
			cancelled = true;
		};
	}, [account, indexerUrls, nonce]);

	const refresh = useCallback(() => setNonce((n) => n + 1), []);

	return useMemo(
		() => ({
			balanceOf: (contractId: string, tokenId: string) =>
				ready ? (held.get(key(contractId, tokenId)) ?? 0n) : null,
			holdsAnyIn: (contractId: string) => {
				if (!ready) return null;
				const prefix = `${contractId}:`;
				for (const k of held.keys()) if (k.startsWith(prefix)) return true;
				return false;
			},
			tokenIdsIn: (contractId: string) => {
				const prefix = `${contractId}:`;
				const out: string[] = [];
				for (const k of held.keys()) if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
				return out.sort((a, b) => a.localeCompare(b));
			},
			ready,
			refresh
		}),
		[held, ready, refresh]
	);
}
