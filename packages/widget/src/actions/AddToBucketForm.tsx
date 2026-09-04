import { useEffect, useMemo, useState } from 'react';
import type { BucketListing, BucketStack, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Modal } from '../components/Modal.js';
import { NftMultiPicker, type NftMultiPick } from '../components/NftMultiPicker.js';
import { canTransferNft } from '../components/nftFilters.js';
import { stackRole } from '../components/stackRole.js';

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
 *
 * Laid out as the creation wizard lays out stacks — one section per stack, each
 * with its own picker — rather than one chip row governing a single flat list.
 * `addToBucket` takes the stack PER ENTRY, so one call can restock several
 * stacks at once; the chip row could only ever describe one, which quietly made
 * a two-stack top-up two transactions.
 */
export function AddToBucketForm({
	client,
	username,
	bucket,
	stacks,
	onSuccess,
	onClose
}: AddToBucketFormProps) {
	const [picks, setPicks] = useState<Record<number, NftMultiPick[]>>({});
	const [openStack, setOpenStack] = useState(0);
	const [skipApproval, setSkipApproval] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	/**
	 * The sale's stacks. The panel opens this form without them, and a header
	 * that cannot say what a stack already holds is asking the seller to
	 * remember — so fetch them here when the caller has none to give.
	 */
	const [fetched, setFetched] = useState<BucketStack[] | null>(null);
	useEffect(() => {
		if (stacks) return;
		let cancelled = false;
		client.provider
			.getBucketStacks(bucket.bucketId)
			.then((p) => {
				if (!cancelled) setFetched(p);
			})
			.catch(() => {
				/* headers fall back to the pack layout alone */
			});
		return () => {
			cancelled = true;
		};
	}, [client, bucket.bucketId, stacks]);
	const known = stacks ?? fetched ?? undefined;

	// Which stacks exist. A sale with one stack has nothing to choose.
	const stackIds = useMemo(() => {
		const ids = new Set<number>([0]);
		for (const s of known ?? []) ids.add(s.stack);
		for (let i = 0; i < (bucket.packDraws?.length ?? 0); i++) ids.add(i);
		return Array.from(ids).sort((a, b) => a - b);
	}, [known, bucket.packDraws]);

	/** What the sale currently holds in each stack, for the section headers. */
	const held = useMemo(() => {
		const m = new Map<number, BucketStack>();
		for (const s of known ?? []) m.set(s.stack, s);
		return m;
	}, [known]);

	const singlesOn = bucket.pricePerDraw !== '0' && bucket.pricePerDraw !== '';
	const packsOn = bucket.pricePerPack !== '0' && bucket.pricePerPack !== '';

	const picksFor = (id: number) => picks[id] ?? [];
	const room = Math.max(0, 512 - bucket.entryCount);
	const budget = Math.min(MAX_PER_CALL, room);
	const totalPicks = stackIds.reduce((n, id) => n + picksFor(id).length, 0);
	const valid = totalPicks > 0 && totalPicks <= budget && !submitting;

	const setStackPicks = (id: number, v: NftMultiPick[]) =>
		setPicks((prev) => ({ ...prev, [id]: v }));

	async function handleSubmit() {
		if (!valid) return;
		setSubmitting(true);
		setError(null);
		try {
			// Stack travels per entry, so a single call can top up several.
			const entries = stackIds.flatMap((id) =>
				picksFor(id).map((p) => ({ tokenId: p.tokenId, amount: p.amount, stack: id }))
			);
			const { txIds } = await client.addToBucket(username, {
				bucketId: bucket.bucketId,
				nftContract: bucket.nftContract,
				entries,
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
			title={`Add to ${bucket.name?.trim() || `mystery sale #${bucket.bucketId}`}`}
			subtitle={`${bucket.entryCount} entries in so far · ${bucket.unitsStocked} units left to draw`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					{room === 0 ? (
						<p className="magi-market-status error">
							This sale already holds the maximum 512 entries.
						</p>
					) : (
						<div className="magi-market-bucketform magi-market-addstacks">
							{stackIds.map((id) => {
								// One stack has nothing to collapse to and nothing to be
								// distinguished from, so it drops the accordion — the same
								// call the creation wizard makes.
								const flat = stackIds.length === 1;
								const open = flat || openStack === id;
								const mine = picksFor(id);
								const has = held.get(id);
								const units = mine.reduce((n, p) => n + p.amount, 0);
								return (
									<div key={id} className={`magi-market-stack${open ? ' open' : ''}${flat ? ' flat' : ''}`}>
										{!flat && (
											<div className="magi-market-stack-head">
												<button
													type="button"
													className="magi-market-stack-toggle"
													aria-expanded={open}
													disabled={submitting}
													onClick={() => setOpenStack(open ? -1 : id)}
												>
													<span className="magi-market-stack-caret">{open ? '▾' : '▸'}</span>
													<span className="magi-market-stack-title">Stack {id + 1}</span>
													<span className="magi-market-stack-role">
														{stackRole(id, bucket.packDraws ?? [], singlesOn, packsOn).join(' · ')}
													</span>
													<span className="magi-market-stack-summary">
														{has
														? `${has.unitsLeft} unit${has.unitsLeft === 1 ? '' : 's'} in the sale`
														: known
															? 'nothing in it yet'
															: '…'}
														{mine.length > 0 && ` · adding ${mine.length} (${units} unit${units === 1 ? '' : 's'})`}
													</span>
												</button>
											</div>
										)}
										{open && (
											<NftMultiPicker
												config={client.config}
												username={username}
												value={mine}
												onChange={(v) => setStackPicks(id, v)}
												label={flat ? 'NFTs to add' : `NFTs to add to stack ${id + 1}`}
												groupEditions
												lockCollection={bucket.nftContract}
												filterItem={(it) => canTransferNft(it, username)}
												// The 24 is per TRANSACTION across every stack, not
												// per stack — see the same split in the wizard.
												max={Math.max(mine.length, budget - (totalPicks - mine.length))}
												overLimitNote={`One transaction carries ${MAX_PER_CALL} entries — send this batch, then open this form again for the rest. Room for ${room} more in this sale.`}
												disabled={submitting}
											/>
										)}
									</div>
								);
							})}

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
								ones. {totalPicks > 0 ? `${totalPicks} of ${budget} entries used in this batch.` : `Room for ${room} more entries.`}
							</p>

							{error && <p className="magi-market-status error">{error}</p>}

							<button
								type="button"
								className="magi-market-submit"
								disabled={!valid}
								onClick={handleSubmit}
							>
								{submitting ? 'Adding…' : `Add ${totalPicks || ''} to the sale`.trim()}
							</button>
						</div>
					)}
				</>
			)}
		</Modal>
	);
}
