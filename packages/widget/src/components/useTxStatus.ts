import { useEffect, useRef, useState } from 'react';
import { resolveGqlUrls, gqlFetchFailover, type MagiConfig } from '@vsc.eco/market-sdk';

/**
 * What the chain says about a transaction we just broadcast.
 *
 * `pending` covers everything still in flight; `included` means it is in a
 * block but not yet final. They are separate because the wait is long enough
 * that "nothing has happened yet" and "it landed, finalising" feel very
 * different to someone watching.
 */
export type TxState = 'pending' | 'included' | 'confirmed' | 'failed' | 'unknown';

export interface TxStatus {
	state: TxState;
	/** True while we are still polling. */
	watching: boolean;
}

const Q = `query T($id: String!){
	findTransaction(filterOptions: {byId: $id}) { id status }
}`;

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
				const d = await gqlFetchFailover<{ findTransaction: Array<{ status: string }> | null }>(
					resolveGqlUrls(config),
					Q,
					{ id }
				);
				const row = d.findTransaction?.[0];
				if (row) {
					const next = mapStatus(row.status);
					if (!cancelled.current) setState(next);
					// Only a terminal state stops the watch; `included` still has
					// finalisation to go.
					if (next === 'confirmed' || next === 'failed') {
						if (!cancelled.current) setWatching(false);
						return;
					}
				}
			} catch {
				/* a failed poll is not a failed transaction — keep trying */
			}
			if (tries >= 40) {
				if (!cancelled.current) {
					setState((s) => (s === 'pending' ? 'unknown' : s));
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
