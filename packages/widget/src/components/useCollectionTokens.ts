import { useEffect, useMemo, useState } from 'react';
import { gqlFetchFailover, resolveIndexerUrls, type MagiConfig } from '@vsc.eco/market-sdk';

interface TokenInfoRow {
	token_id: string;
	soulbound: boolean;
}
interface BalanceRow {
	account: string;
	token_id: string;
	balance: string | number;
}

export interface TransferableToken {
	tokenId: string;
	soulbound: boolean;
}

export interface CollectionTokens {
	tokens: TransferableToken[];
	loading: boolean;
	error: string | null;
}

const acctNorm = (s?: string) => (s ?? '').replace(/^@/, '').replace(/^hive:/, '').toLowerCase();

/**
 * Enumerate the tokens of one NFT collection that are actually
 * *transferable* — i.e. an offer made on them could ever be fulfilled.
 *
 * A non-soulbound token is always transferable. A soulbound token is
 * transferable ONLY by the collection owner (magi_nft's
 * `safeTransferFrom` aborts unless `from == ownerAddr`), so it's
 * offer-able only while the collection owner still holds a positive
 * balance of it. Soulbound tokens held by anyone else can never move,
 * so we hide them from the offer picker.
 *
 * `collectionOwner` is the `hive:…` owner of `contractId` (from
 * useCollectionMeta). Pass empty `contractId` to no-op.
 */
export function useCollectionTokens(
	config: MagiConfig,
	contractId: string,
	collectionOwner: string
): CollectionTokens {
	const urls = useMemo(() => resolveIndexerUrls(config), [config]);
	const [tokens, setTokens] = useState<TransferableToken[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!contractId) {
			setTokens([]);
			setError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		const q = `query C($c:String!){
			magi_nft_token_info(where:{contract_id:{_eq:$c}}){ token_id soulbound }
			magi_nft_balances(where:{contract_id:{_eq:$c}, balance:{_gt:"0"}}){ account token_id balance }
		}`;
		gqlFetchFailover<{ magi_nft_token_info: TokenInfoRow[]; magi_nft_balances: BalanceRow[] }>(urls, q, { c: contractId })
			.then((d) => {
				if (cancelled) return;
				const ownerNorm = acctNorm(collectionOwner);
				// tokenIds the collection owner currently holds (for the
				// soulbound transferability test).
				const ownerHolds = new Set<string>();
				for (const b of d.magi_nft_balances ?? []) {
					if (acctNorm(b.account) === ownerNorm) ownerHolds.add(b.token_id);
				}
				const out: TransferableToken[] = [];
				for (const t of d.magi_nft_token_info ?? []) {
					if (!t.soulbound) {
						out.push({ tokenId: t.token_id, soulbound: false });
					} else if (ownerNorm && ownerHolds.has(t.token_id)) {
						// Soulbound but the collection owner still holds it → they
						// can transfer it, so an offer can be fulfilled.
						out.push({ tokenId: t.token_id, soulbound: true });
					}
				}
				out.sort((a, b) => a.tokenId.localeCompare(b.tokenId));
				setTokens(out);
			})
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [urls, contractId, collectionOwner]);

	return { tokens, loading, error };
}
