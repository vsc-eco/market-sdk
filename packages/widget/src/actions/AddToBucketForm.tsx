import { useMemo, useState } from 'react';
import type { BucketListing, BucketStack, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Modal } from '../components/Modal.js';
import { NftMultiPicker, type NftMultiPick } from '../components/NftMultiPicker.js';
import { canTransferNft } from '../components/nftFilters.js';

/** One call takes 24 entries; a bucket holds 512 in total. */
const MAX_PER_CALL = 24;

export interface AddToBucketFormProps {
	client: MarketClient;
	username: string;
	bucket: BucketListing;
	/** Stacks the sale already has, so a restock can target one. */
	stacks?: BucketStack[];
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Put more NFTs into a mystery sale that is already running.
 *
 * The contract has always supported this — it is how a sale gets past the 24
 * entries one transaction can carry, and the reason large sales are possible
 * at all — but the widget never exposed it, so a sale was whatever it was
 * opened with. Buyers see the odds move as stock arrives, which is the point:
 * a sale that can be topped up does not have to be built in one sitting.
 */
export function AddToBucketForm({
	client,
	username,
	bucket,
	stacks,
	onSuccess,
	onClose
}: AddToBucketFormProps) {
	const [picks, setPicks] = useState<NftMultiPick[]>([]);
	const [stack, setStack] = useState(0);
	const [skipApproval, setSkipApproval] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Which stacks exist. A sale with one stack has nothing to choose.
	const stackIds = useMemo(() => {
		const ids = new Set<number>([0]);
		for (const s of stacks ?? []) ids.add(s.stack);
		for (let i = 0; i < (bucket.packDraws?.length ?? 0); i++) ids.add(i);
		return Array.from(ids).sort((a, b) => a - b);
	}, [stacks, bucket.packDraws]);

	const room = Math.max(0, 512 - bucket.entryCount);
	const valid = picks.length > 0 && picks.length <= Math.min(MAX_PER_CALL, room) && !submitting;

	async function handleSubmit() {
		if (!valid) return;
		setSubmitting(true);
		setError(null);
		try {
			const { txIds } = await client.addToBucket(username, {
				bucketId: bucket.bucketId,
				nftContract: bucket.nftContract,
				entries: picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, stack })),
				skipApproval
			});
			const tx = txIds[txIds.length - 1];
			setTxId(tx);
			onSuccess?.(tx);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal
			title={`Add to mystery sale #${bucket.bucketId}`}
			subtitle={`${bucket.entryCount} entries in so far · ${bucket.unitsStocked} units left to draw`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					{room === 0 ? (
						<p className="magi-market-status error">
							This sale already holds the maximum 512 entries.
						</p>
					) : (
						<>
							{stackIds.length > 1 && (
								<label className="magi-market-field">
									<span className="magi-market-field-label">Which stack?</span>
									<div className="magi-market-xfilter-chips">
										{stackIds.map((id) => (
											<button
												key={id}
												type="button"
												className={`magi-market-kindchip${stack === id ? ' active' : ''}`}
												disabled={submitting}
												onClick={() => setStack(id)}
											>
												Stack {id + 1}
											</button>
										))}
									</div>
									<span className="magi-market-field-hint">
										Packs draw each slot from a set stack, so this decides which slot the
										new stock can fill.
									</span>
								</label>
							)}

							<NftMultiPicker
								config={client.config}
								username={username}
								value={picks}
								onChange={setPicks}
								label="NFTs to add"
								groupEditions
								lockCollection={bucket.nftContract}
								filterItem={(it) => canTransferNft(it, username)}
								max={Math.min(MAX_PER_CALL, room)}
								overLimitNote={`Add another batch after this one — room for ${room} more entries in this sale.`}
								disabled={submitting}
							/>

							<label className="magi-market-approved">
								<input
									type="checkbox"
									checked={skipApproval}
									disabled={submitting}
									onChange={(e) => setSkipApproval((e.target as HTMLInputElement).checked)}
								/>
								<span className="magi-market-field-hint">
									Marketplace already approved on this collection (skip the approve ops)
								</span>
							</label>

							<p className="magi-market-field-hint">
								A token already in this sale cannot be added again — restocking appends new
								ones. {room < MAX_PER_CALL ? `Room for ${room} more entries.` : ''}
							</p>

							{error && <p className="magi-market-status error">{error}</p>}

							<button
								type="button"
								className="magi-market-submit"
								disabled={!valid}
								onClick={handleSubmit}
							>
								{submitting ? 'Adding…' : `Add ${picks.length || ''} to the sale`.trim()}
							</button>
						</>
					)}
				</>
			)}
		</Modal>
	);
}
