import { useState } from 'react';
import type { MarketClient, SwapProposal } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';

export interface AcceptSwapFormProps {
	client: MarketClient;
	username: string;
	swap: SwapProposal;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Accept an NFT-for-NFT swap proposal. The acceptor must own the swap's
 * `wanted` NFT and have already approved the marketplace on that
 * collection. Any optional `topUp` token was attached by the proposer at
 * propose time (its intent is bound to the original proposeSwap op), so
 * the acceptor passes no intents here.
 */
export function AcceptSwapForm({ client, username, swap, onSuccess, onClose }: AcceptSwapFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const hasTopUp = !!swap.topUp && swap.topUp !== '' && swap.topUp !== '0';
	const topUpSym = swap.topUpToken ? tokenMeta.symbol(swap.topUpToken) : '';
	const topUpHuman = hasTopUp && swap.topUpToken ? tokenMeta.format(swap.topUpToken, swap.topUp) : '';

	async function handleSubmit() {
		if (submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const op = client.ops.acceptSwapOp(username, { swapId: swap.swapId });
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal
			title={`Accept swap #${swap.swapId}`}
			subtitle={`Proposed by ${swap.proposer}`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<div className="magi-market-field">
						<span className="magi-market-field-label">You give</span>
						<p className="magi-market-field-hint">
							#{swap.wantedTokenId} × {swap.wantedAmount} from {swap.wantedNft}
						</p>
					</div>
					<div className="magi-market-field">
						<span className="magi-market-field-label">You get</span>
						<p className="magi-market-field-hint">
							#{swap.offeredTokenId} × {swap.offeredAmount} from {swap.offeredNft}
						</p>
					</div>
					{hasTopUp && (
						<div className="magi-market-field">
							<span className="magi-market-field-label">Plus top-up</span>
							<p className="magi-market-field-hint">
								{topUpHuman} {topUpSym} (paid by the proposer)
							</p>
						</div>
					)}

					{error && <p className="magi-market-status error">{error}</p>}

					<button
						type="button"
						className="magi-market-submit"
						disabled={submitting}
						onClick={handleSubmit}
					>
						{submitting ? 'Accepting…' : 'Accept swap'}
					</button>
				</>
			)}
		</Modal>
	);
}
