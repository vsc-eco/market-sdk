import { useEffect, useRef, useState } from 'react';
import {
	resolveGqlUrls,
	resolveIndexerUrls,
	gqlFetchFailover,
	type MagiConfig
} from '@vsc.eco/market-sdk';

/**
 * What the chain says about a transaction we just broadcast.
 *
 * `pending` covers everything still in flight; `included` means it is in a
 * block but not yet final. They are separate because the wait is long enough
 * that "nothing has happened yet" and "it landed, finalising" feel very
 * different to someone watching.
 */
export type TxState =
	| 'pending'
	| 'included'
	/** On chain, but the indexer has not reached that block yet. */
	| 'confirmed'
	/** Indexed too — only now will a refresh actually show the result. */
	| 'indexed'
	| 'failed'
	| 'unknown';

export interface TxStatus {
	state: TxState;
	/** True while we are still polling. */
	watching: boolean;
}

const Q = `query T($id: String!){
	findTransaction(filterOptions: {byId: $id}) { id status anchr_height }
}`;

/**
 * How far the indexer has read. The widget reads everything through the
 * indexer, so a confirmed transaction is still invisible to it until this
 * passes the block the transaction anchored in.
 */
const HEALTH = `query H { indexer_health { latest_block_height } }`;

/** The chain's vocabulary, mapped to the three outcomes a person cares about. */
function mapStatus(s: string): TxState {
	switch (s) {
		case 'CONFIRMED':
			return 'confirmed';
		case 'FAILED':
			return 'failed';
		case 'INCLUDED':
		case 'PROCESSED':
			return 'included';
		case 'UNCONFIRMED':
			return 'pending';
		default:
			return 'unknown';
	}
}

/**
 * Poll until a transaction settles.
 *
 * Broadcasting only means the node accepted it — the widget used to print the
 * id and stop there, so "did it work?" was a question you answered by
 * refreshing and looking, or by opening a block explorer.
 *
 * Bounded: a tx that never appears stops being watched rather than polling
 * forever, and says it is unknown rather than implying failure. An id with an
 * op-index suffix (`<hash>-2`) is trimmed — that is the indexer's addressing,
 * not the chain's.
 */
export function useTxStatus(config: MagiConfig, txId: string | null | undefined): TxStatus {
	const [state, setState] = useState<TxState>('pending');
	const [watching, setWatching] = useState(!!txId);
	const cancelled = useRef(false);

	useEffect(() => {
		cancelled.current = false;
		if (!txId) {
			setWatching(false);
			return;
		}
		setState('pending');
		setWatching(true);
		const id = txId.split('-')[0];
		let tries = 0;

		const tick = async () => {
			if (cancelled.current) return;
			tries++;
			try {
				const d = await gqlFetchFailover<{
					findTransaction: Array<{ status: string; anchr_height?: number }> | null;
				}>(resolveGqlUrls(config), Q, { id });
				const row = d.findTransaction?.[0];
				if (row) {
					const next = mapStatus(row.status);
					if (next === 'failed') {
						if (!cancelled.current) {
							setState('failed');
							setWatching(false);
						}
						return;
					}
					if (!cancelled.current) setState(next);
					// Confirmed is not the finish line. Everything the widget shows
					// comes from the indexer, so refreshing before it has read this
					// block just re-renders the old answer — which is what made a
					// new listing "not appear" even after it succeeded.
					if (next === 'confirmed') {
						const height = row.anchr_height;
						if (height == null) {
							if (!cancelled.current) {
								setState('indexed');
								setWatching(false);
							}
							return;
						}
						try {
							const h = await gqlFetchFailover<{
								indexer_health: Array<{ latest_block_height: number }>;
							}>(resolveIndexerUrls(config), HEALTH, {});
							const at = h.indexer_health?.[0]?.latest_block_height ?? 0;
							if (at >= height) {
								if (!cancelled.current) {
									setState('indexed');
									setWatching(false);
								}
								return;
							}
						} catch {
							/* health unreachable — keep waiting, then give up below */
						}
					}
				}
			} catch {
				/* a failed poll is not a failed transaction — keep trying */
			}
			// Chain confirmation plus indexer catch-up, so the budget covers
			// both: three minutes.
			if (tries >= 60) {
				if (!cancelled.current) {
					setState((s) =>
						// Confirmed but the indexer never visibly caught up: the chain
						// has it either way, so call it done and let the reload run.
						// Leaving it on "updating…" forever would be the one state
						// that never resolves.
						s === 'confirmed' ? 'indexed' : s === 'pending' ? 'unknown' : s
					);
					setWatching(false);
				}
				return;
			}
			setTimeout(tick, 3000);
		};
		void tick();

		return () => {
			cancelled.current = true;
		};
	}, [config, txId]);

	return { state, watching };
}
