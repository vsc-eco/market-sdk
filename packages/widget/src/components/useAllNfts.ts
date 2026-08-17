import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveIndexerUrls, type MagiConfig } from '@vsc.eco/market-sdk';
import { gqlFetchAllPages } from './gqlPaged.js';

interface BalanceRow {
	contract_id: string;
	token_id: string;
	account: string;
	balance: string | number;
}
interface TokenInfoRow {
	contract_id: string;
	token_id: string;
	soulbound: boolean;
}

/** One holding: a specific account's balance of a specific token. */
export interface NftHolding {
	nftContract: string;
	tokenId: string;
	/** Holder, as the indexer stores it (`hive:alice` / `contract:vsc1…`). */
	account: string;
	balance: bigint;
	soulbound: boolean;
}

export interface AllNfts {
	holdings: NftHolding[];
	loading: boolean;
	error: string | null;
	/** True when the row backstop was hit and the set may be incomplete. */
	truncated: boolean;
	refresh: () => void;
}

const BALANCES_Q = `query A($limit:Int!,$offset:Int!){
	magi_nft_balances(
		where:{balance:{_gt:"0"}}
		order_by:{contract_id:asc, token_id:asc, account:asc}
		limit:$limit offset:$offset
	){ contract_id token_id account balance }
}`;

const TOKEN_INFO_Q = `query I($limit:Int!,$offset:Int!){
	magi_nft_token_info(
		order_by:{contract_id:asc, token_id:asc}
		limit:$limit offset:$offset
	){ contract_id token_id soulbound }
}`;

/**
 * Every NFT holding on the network — what the Explore tab browses.
 *
 * This is deliberately holdings-shaped rather than token-shaped: the tab
 * answers "what NFTs exist out there and who has them", so a token held by
 * three accounts is three rows and each can be acted on separately. Tokens
 * that are defined but unminted have no balance row and so don't appear —
 * they aren't anyone's NFT yet.
 *
 * Both reads are paged; the indexer caps every response at 100 rows (see
 * `gqlFetchAllPages`), which for ~1.1k holdings is ~11 requests per table.
 * `soulbound` is joined in from `magi_nft_token_info` so a tile can say
 * up-front that a token can't be transferred by its current holder.
 */
export function useAllNfts(config: MagiConfig, enabled: boolean): AllNfts {
	const urls = useMemo(() => resolveIndexerUrls(config), [config]);
	const [holdings, setHoldings] = useState<NftHolding[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [truncated, setTruncated] = useState(false);
	const [nonce, setNonce] = useState(0);

	useEffect(() => {
		// Gated on `enabled` so ~22 indexer requests only fire when the
		// Explore tab is actually open.
		if (!enabled) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		Promise.all([
			gqlFetchAllPages<BalanceRow>(
				urls,
				BALANCES_Q,
				(d) => (d as { magi_nft_balances?: BalanceRow[] }).magi_nft_balances
			),
			gqlFetchAllPages<TokenInfoRow>(
				urls,
				TOKEN_INFO_Q,
				(d) => (d as { magi_nft_token_info?: TokenInfoRow[] }).magi_nft_token_info
			)
		])
			.then(([bal, info]) => {
				if (cancelled) return;
				const sb = new Set<string>();
				for (const t of info.rows) if (t.soulbound) sb.add(`${t.contract_id}:${t.token_id}`);
				const out: NftHolding[] = [];
				for (const b of bal.rows) {
					let units: bigint;
					try {
						units = BigInt(b.balance);
					} catch {
						continue;
					}
					if (units <= 0n) continue;
					out.push({
						nftContract: b.contract_id,
						tokenId: b.token_id,
						account: b.account,
						balance: units,
						soulbound: sb.has(`${b.contract_id}:${b.token_id}`)
					});
				}
				setHoldings(out);
				setTruncated(bal.truncated || info.truncated);
			})
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [urls, enabled, nonce]);

	const refresh = useCallback(() => setNonce((n) => n + 1), []);
	return { holdings, loading, error, truncated, refresh };
}
