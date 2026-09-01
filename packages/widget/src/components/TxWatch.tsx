import { useEffect, useRef } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import { useTxStatus, type TxState } from './useTxStatus.js';

const LABEL: Record<TxState, string> = {
	pending: 'Waiting for the network…',
	included: 'In a block — finalising…',
	confirmed: 'Confirmed — updating…',
	indexed: 'Done',
	failed: 'Failed on chain',
	unknown: 'Still not visible — check the explorer'
};

export interface TxWatchProps {
	config: MagiConfig;
	txId: string;
	/** What the transaction was, in the user's terms: "Sale listed". */
	label: string;
	/** Fired once, when the chain confirms it — the cue to re-read the market. */
	onSettled: (txId: string) => void;
	onDismiss: (txId: string) => void;
}

/**
 * One transaction, watched from the panel rather than from inside the form
 * that started it.
 *
 * The forms close the moment they broadcast — which is right, you want to be
 * back looking at the market — but it meant the receipt they were about to
 * render was unmounted before anyone saw it. So the panel keeps watching
 * after the form is gone.
 *
 * Confirmation is also the cue to RELOAD: the panel used to refresh the
 * instant a transaction was broadcast, which is before the network has
 * processed it, so the thing you just made reliably wasn't in the list yet.
 */
export function TxWatch({ config, txId, label, onSettled, onDismiss }: TxWatchProps) {
	const { state, watching } = useTxStatus(config, txId);
	const settled = useRef(false);

	useEffect(() => {
		if (settled.current) return;
		if (state !== 'indexed' && state !== 'failed') return;
		settled.current = true;
		if (state === 'indexed') onSettled(txId);
		// A finished line is worth reading, not worth keeping. Failures stay
		// until dismissed: that one you need to act on.
		if (state === 'indexed') {
			const t = setTimeout(() => onDismiss(txId), 6000);
			return () => clearTimeout(t);
		}
	}, [state, txId, onSettled, onDismiss]);

	return (
		<div className={`magi-market-txwatch tx-${state}`}>
			{watching && <span className="magi-market-tx-spin" aria-hidden="true" />}
			{state === 'indexed' && <span className="magi-market-tx-tick" aria-hidden="true">✓</span>}
			<span className="magi-market-txwatch-label">{label}</span>
			<span className="magi-market-txwatch-state">{LABEL[state]}</span>
			<button
				type="button"
				className="magi-market-txwatch-x"
				aria-label="Dismiss"
				onClick={() => onDismiss(txId)}
			>
				✕
			</button>
		</div>
	);
}
