import { useEffect, useMemo, useState } from 'react';
import { resolveIndexerUrls, type MagiConfig } from '@vsc.eco/market-sdk';
import { gqlFetchAllPages } from './gqlPaged.js';

interface TokenInfoRow {
	token_id: string;
	soulbound: boolean;
}
interface BalanceRow {
	account: string;
	token_id: string;
	balance: string | number;
}

export interface CollectionToken {
	tokenId: string;
	soulbound: boolean;
	/** Units currently held across ALL accounts. 0 = defined but never minted. */
	supply: bigint;
	/** Every account holding a positive balance, `hive:…` / `contract:…`. */
	holders: string[];
	/** Whether the collection owner is one of the holders. */
	heldByOwner: boolean;
	/** False when an offer on this token could never be fulfilled. */
	offerable: boolean;
	/** Why `offerable` is false — shown on the disabled tile. */
	blockedReason?: string;
}

export interface CollectionTokens {
	/** Every minted token, offerable or not, ascending by id. */
	tokens: CollectionToken[];
	loading: boolean;
	error: string | null;
}

/** Alias kept for callers that only care about the offerable subset. */
export type TransferableToken = CollectionToken;

const acctNorm = (s?: string) => (s ?? '').replace(/^@/, '').replace(/^hive:/, '').toLowerCase();

const TOKEN_INFO_Q = `query T($c:String!,$limit:Int!,$offset:Int!){
	magi_nft_token_info(
		where:{contract_id:{_eq:$c}}
		order_by:{token_id:asc}
		limit:$limit offset:$offset
	){ token_id soulbound }
}`;

const BALANCES_Q = `query B($c:String!,$limit:Int!,$offset:Int!){
	magi_nft_balances(
		where:{contract_id:{_eq:$c}, balance:{_gt:"0"}}
		order_by:{token_id:asc, account:asc}
		limit:$limit offset:$offset
	){ account token_id balance }
}`;

/**
 * Enumerate one NFT collection: every token, who holds it, and whether an
 * offer on it could ever be fulfilled.
 *
 * Both reads are **paged** (see `gqlFetchAllPages`). They used to be single
 * un-paged queries, which the indexer capped at 100 rows each — on a
 * 1023-token collection that showed 10% of the tokens and a holder map
 * consisting entirely of the collection owner, so the offer picker looked
 * like it only knew about the owner's NFTs. Tokens sold on to other accounts
 * were simply past the cap.
 *
 * Offerability rules, which mirror what magi_nft and magi-market actually
 * enforce at accept time:
 *
 * - Unminted (nobody holds a positive balance): nobody can accept, so it's
 *   listed as blocked rather than hidden — a defined-but-unminted edition is
 *   a real thing a buyer may be looking for.
 * - Soulbound held by someone other than the collection owner: magi_nft's
 *   `safeTransferFrom` aborts unless `from == ownerAddr` (token.go:146), so
 *   the holder physically cannot deliver it. Blocked, with the reason shown —
 *   previously these were dropped silently, which read as a missing NFT.
 * - Everything else minted: offerable.
 *
 * `collectionOwner` is the `hive:…` owner of `contractId` (from
 * useCollectionMeta). Pass an empty `contractId` to no-op.
 */
export function useCollectionTokens(
	config: MagiConfig,
	contractId: string,
	collectionOwner: string
): CollectionTokens {
	const urls = useMemo(() => resolveIndexerUrls(config), [config]);
	const [rows, setRows] = useState<{ info: TokenInfoRow[]; bal: BalanceRow[] }>({ info: [], bal: [] });
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!contractId) {
			setRows({ info: [], bal: [] });
			setError(null);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError(null);
		Promise.all([
			gqlFetchAllPages<TokenInfoRow>(
				urls,
				TOKEN_INFO_Q,
				(d) => (d as { magi_nft_token_info?: TokenInfoRow[] }).magi_nft_token_info,
				{ c: contractId }
			),
			gqlFetchAllPages<BalanceRow>(
				urls,
				BALANCES_Q,
				(d) => (d as { magi_nft_balances?: BalanceRow[] }).magi_nft_balances,
				{ c: contractId }
			)
		])
			.then(([info, bal]) => {
				if (cancelled) return;
				setRows({ info: info.rows, bal: bal.rows });
			})
			.catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [urls, contractId]);

	const tokens = useMemo<CollectionToken[]>(() => {
		const ownerNorm = acctNorm(collectionOwner);
		const holders = new Map<string, string[]>();
		const supply = new Map<string, bigint>();
		for (const b of rows.bal) {
			let units: bigint;
			try {
				units = BigInt(b.balance);
			} catch {
				continue;
			}
			if (units <= 0n) continue;
			const list = holders.get(b.token_id) ?? [];
			list.push(b.account);
			holders.set(b.token_id, list);
			supply.set(b.token_id, (supply.get(b.token_id) ?? 0n) + units);
		}
		const out = rows.info.map((t) => {
			const hs = holders.get(t.token_id) ?? [];
			const heldByOwner = !!ownerNorm && hs.some((a) => acctNorm(a) === ownerNorm);
			let offerable = true;
			let blockedReason: string | undefined;
			if (hs.length === 0) {
				offerable = false;
				blockedReason = 'Not minted yet — nobody holds it';
			} else if (t.soulbound && !heldByOwner) {
				offerable = false;
				blockedReason = 'Soulbound — only the collection owner can transfer it';
			}
			return {
				tokenId: t.token_id,
				soulbound: t.soulbound,
				supply: supply.get(t.token_id) ?? 0n,
				holders: hs,
				heldByOwner,
				offerable,
				blockedReason
			};
		});
		out.sort((a, b) => {
			// Offerable first, then by id — the grid is long and the actionable
			// tokens should not be buried among unminted definitions.
			if (a.offerable !== b.offerable) return a.offerable ? -1 : 1;
			return a.tokenId.localeCompare(b.tokenId);
		});
		return out;
	}, [rows, collectionOwner]);

	return { tokens, loading, error };
}
