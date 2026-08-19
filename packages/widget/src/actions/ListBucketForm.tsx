import { useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { NftMultiPicker, type NftMultiPick } from '../components/NftMultiPicker.js';
import { canTransferNft } from '../components/nftFilters.js';
import { BlockDurationInput } from '../components/BlockDurationInput.js';
import { WizardSteps } from '../components/WizardSteps.js';

export interface ListBucketFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/** The contract caps one call at 24 entries; more go in via addToBucket. */
const MAX_ENTRIES = 24;
/** The contract's pool ceiling. */
const MAX_TIERS = 8;

interface Tier {
	/** Display only — the contract identifies a tier by its index. */
	name: string;
	picks: NftMultiPick[];
	/** Slots this tier fills in one pack. 0 = in the bucket, never guaranteed. */
	perPack: string;
}

const DEFAULT_TIER_NAMES = ['Commons', 'Uncommons', 'Rares', 'Holos', 'Secrets', 'Tier 6', 'Tier 7', 'Tier 8'];

function newTier(index: number, perPack: string): Tier {
	return { name: DEFAULT_TIER_NAMES[index] ?? `Tier ${index + 1}`, picks: [], perPack };
}

/**
 * Open a bucket: a fixed-price sale where the CONTRACT picks which NFT the
 * buyer receives.
 *
 * Exposes what the contract actually does, rather than a safe subset: up to
 * eight tiers, any number of guaranteed slots per tier, single draws and packs
 * priced independently (or both at once), and an optional expiry.
 *
 * The one thing the form insists on is coherence, because the contract does not
 * check it at listing time and the buyer is the one who pays for that: a pack
 * promising slots from a tier that cannot fill them lists perfectly happily and
 * then refuses every purchase. Every such mismatch is caught here with the
 * numbers spelled out.
 */
export function ListBucketForm({
	client,
	username,
	defaultNftContract,
	onSuccess,
	onClose
}: ListBucketFormProps) {
	const tokenMeta = useTokenMeta(client.config);

	const [step, setStep] = useState(0);
	const [sellSingles, setSellSingles] = useState(true);
	const [sellPacks, setSellPacks] = useState(false);
	const [tiers, setTiers] = useState<Tier[]>([newTier(0, '0')]);
	const [paymentToken, setPaymentToken] = useState('');
	const [pricePerDraw, setPricePerDraw] = useState('');
	const [pricePerPack, setPricePerPack] = useState('');
	const [expirationBlock, setExpirationBlock] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const STEPS = ['Sale type', 'Tiers', 'Price', 'Review'];

	// One collection per bucket — the contract stores a single nftContract, so
	// the pickers all lock to whichever collection is picked first.
	const lockCollection =
		defaultNftContract ?? tiers.map((t) => t.picks[0]?.nftContract).find((c): c is string => !!c);

	const microDraw =
		paymentToken && pricePerDraw.trim() !== '' ? tokenMeta.toMicro(paymentToken, pricePerDraw.trim()) : '';
	const microPack =
		paymentToken && pricePerPack.trim() !== '' ? tokenMeta.toMicro(paymentToken, pricePerPack.trim()) : '';

	const positive = (micro: string) => {
		if (micro === '') return false;
		try {
			return BigInt(micro) > 0n;
		} catch {
			return false;
		}
	};

	const units = (t: Tier) => t.picks.reduce((a, p) => a + p.amount, 0);
	const slots = (t: Tier) => {
		const n = Number(t.perPack);
		return Number.isInteger(n) && n > 0 ? n : 0;
	};
	const totalEntries = tiers.reduce((a, t) => a + t.picks.length, 0);
	const totalUnits = tiers.reduce((a, t) => a + units(t), 0);
	const packSize = tiers.reduce((a, t) => a + slots(t), 0);

	/** How many packs the stock supports — the scarcest tier decides. */
	const packsPossible = useMemo(() => {
		if (!sellPacks || packSize === 0) return 0;
		const limits = tiers.filter((t) => slots(t) > 0).map((t) => Math.floor(units(t) / slots(t)));
		return limits.length ? Math.min(...limits) : 0;
	}, [tiers, sellPacks, packSize]);

	const updateTier = (i: number, patch: Partial<Tier>) =>
		setTiers((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));

	const stepProblem = useMemo<(string | null)[]>(() => {
		const typeProblem = !sellSingles && !sellPacks ? 'Pick at least one way to sell.' : null;

		const tierProblem = (() => {
			if (totalEntries === 0) return 'Pick at least one NFT.';
			if (totalEntries > MAX_ENTRIES)
				return `${totalEntries} NFTs picked — up to ${MAX_ENTRIES} per bucket here; add the rest afterwards.`;
			const empty = tiers.findIndex((t) => t.picks.length === 0);
			if (empty !== -1) return `"${tiers[empty].name}" has no NFTs — fill it or remove the tier.`;
			if (sellPacks) {
				if (packSize === 0) return 'A pack needs at least one slot. Set how many cards come from a tier.';
				if (packSize > 24) return `A pack of ${packSize} exceeds the contract's 24-draw limit.`;
				// Slots a tier cannot fill = a bucket that lists and then refuses
				// every purchase, which the buyer discovers rather than the seller.
				const short = tiers.find((t) => slots(t) > 0 && units(t) < slots(t));
				if (short)
					return `"${short.name}" promises ${slots(short)} per pack but only has ${units(short)} unit${units(short) === 1 ? '' : 's'}.`;
			}
			// Single draws always come from the first tier, so it must have stock.
			if (sellSingles && units(tiers[0]) === 0)
				return `Single draws come from "${tiers[0].name}", which is empty.`;
			return null;
		})();

		const priceProblem = (() => {
			if (paymentToken.trim() === '') return 'Choose a payment token.';
			if (sellSingles && !positive(microDraw)) return 'Set a price per draw.';
			if (sellPacks && !positive(microPack)) return 'Set a price per pack.';
			return null;
		})();

		return [typeProblem, tierProblem, priceProblem, typeProblem ?? tierProblem ?? priceProblem];
	}, [tiers, sellSingles, sellPacks, paymentToken, microDraw, microPack, totalEntries, packSize]);

	const problem = stepProblem[step];
	const valid = stepProblem[STEPS.length - 1] === null;

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const nftContract = tiers.flatMap((t) => t.picks)[0].nftContract;
			const entries = tiers.flatMap((t, pool) =>
				t.picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, pool }))
			);
			// packDraws is positional: index = tier. A tier with no guaranteed
			// slots still needs its 0 so later tiers keep their index.
			const packDraws = sellPacks ? tiers.map((t) => slots(t)) : [];
			const { txIds } = await client.listBucket(username, {
				nftContract,
				entries,
				paymentToken: paymentToken.trim(),
				pricePerDraw: sellSingles ? microDraw : '0',
				pricePerPack: sellPacks ? microPack : '0',
				packDraws,
				expirationBlock: expirationBlock ?? 0
			});
			const tx = txIds[txIds.length - 1];
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
			title="Open a bucket"
			subtitle={
				txId
					? undefined
					: [
							'A fixed-price sale where the contract picks which NFT the buyer gets.',
							'Group your NFTs into tiers. Each pack slot draws from one tier — that is what makes a guarantee.',
							'What a draw costs, and how long it runs.',
							'Check it over, then open.'
						][step]
			}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>
						Done
					</button>
				</>
			) : (
				<>
					<WizardSteps steps={STEPS} current={step} onGoTo={setStep} disabled={submitting} />

					{step === 0 && (
						<Field
							label="How can people buy?"
							hint="Both can run at once — the same stock, sold two ways."
						>
							<label className="magi-market-check">
								<input
									type="checkbox"
									checked={sellSingles}
									disabled={submitting}
									onChange={(e) => setSellSingles(e.currentTarget.checked)}
								/>
								<span>
									<strong>Single draws</strong> — one NFT at a time, drawn from the first tier.
									Weighted by units, so more copies of a card make it commoner.
								</span>
							</label>
							<label className="magi-market-check">
								<input
									type="checkbox"
									checked={sellPacks}
									disabled={submitting}
									onChange={(e) => setSellPacks(e.currentTarget.checked)}
								/>
								<span>
									<strong>Packs</strong> — several NFTs at once with a fixed shape. Each slot draws
									from a chosen tier, which is how "every pack has a rare" becomes a promise rather
									than a hope.
								</span>
							</label>
						</Field>
					)}

					{step === 1 && (
						<>
							{tiers.map((tier, i) => (
								<div key={i} className="magi-market-tier">
									<div className="magi-market-tier-head">
										<TextInput
											value={tier.name}
											onChange={(v) => updateTier(i, { name: v })}
											disabled={submitting}
										/>
										{sellPacks && (
											<label className="magi-market-tier-slots">
												<span>per pack</span>
												<TextInput
													type="number"
													inputMode="numeric"
													min={0}
													value={tier.perPack}
													onChange={(v) => updateTier(i, { perPack: v })}
													disabled={submitting}
												/>
											</label>
										)}
										{tiers.length > 1 && (
											<button
												type="button"
												className="magi-market-submit ghost"
												style={{ width: 'auto', padding: '0.25rem 0.6rem' }}
												disabled={submitting}
												onClick={() => setTiers((prev) => prev.filter((_, j) => j !== i))}
											>
												Remove
											</button>
										)}
									</div>
									<NftMultiPicker
										config={client.config}
										username={username}
										value={tier.picks}
										onChange={(picks) => updateTier(i, { picks })}
										label={`NFTs in "${tier.name}"`}
										lockCollection={lockCollection}
										filterItem={(it) => canTransferNft(it, username)}
										max={MAX_ENTRIES}
										disabled={submitting}
									/>
								</div>
							))}
							{tiers.length < MAX_TIERS && (
								<button
									type="button"
									className="magi-market-submit ghost"
									disabled={submitting}
									onClick={() => setTiers((prev) => [...prev, newTier(prev.length, sellPacks ? '1' : '0')])}
								>
									Add a tier ({tiers.length}/{MAX_TIERS})
								</button>
							)}
							<p className="magi-market-field-hint">
								{sellPacks
									? 'A tier with 0 per pack is still in the bucket — it just is not guaranteed a slot.'
									: 'Single draws come from the first tier. Add tiers if you also sell packs.'}
							</p>
						</>
					)}

					{step === 2 && (
						<>
							<TokenPicker
								config={client.config}
								value={paymentToken}
								onChange={setPaymentToken}
								disabled={submitting}
							/>
							{sellSingles && (
								<Field label="Price per draw">
									<TextInput
										inputMode="decimal"
										value={pricePerDraw}
										onChange={setPricePerDraw}
										placeholder={tokenMeta.smallestUnit(paymentToken)}
										disabled={submitting}
									/>
								</Field>
							)}
							{sellPacks && (
								<Field
									label="Price per pack"
									hint={`Each pack: ${tiers
										.filter((t) => slots(t) > 0)
										.map((t) => `${slots(t)} ${t.name.toLowerCase()}`)
										.join(' + ')} (${packSize} card${packSize === 1 ? '' : 's'}).`}
								>
									<TextInput
										inputMode="decimal"
										value={pricePerPack}
										onChange={setPricePerPack}
										placeholder={tokenMeta.smallestUnit(paymentToken)}
										disabled={submitting}
									/>
								</Field>
							)}
							<BlockDurationInput
								client={client}
								label="Closes in (optional)"
								hint="Unsold NFTs simply stay with you when it closes."
								value={expirationBlock}
								onChange={setExpirationBlock}
								allowEmpty
								disabled={submitting}
							/>
						</>
					)}

					{step === 3 && (
						<>
							<dl style={{ margin: '0 0 0.75rem' }}>
								<div className="magi-market-review-row">
									<dt>Sold as</dt>
									<dd>
										{[sellSingles && 'single draws', sellPacks && `packs of ${packSize}`]
											.filter(Boolean)
											.join(' + ')}
									</dd>
								</div>
								{tiers.map((t, i) => {
									const u = units(t);
									const rarest = t.picks.length
										? t.picks.reduce((a, b) => (a.amount <= b.amount ? a : b))
										: null;
									const pct = rarest && u ? (rarest.amount / u) * 100 : 0;
									return (
										<div key={i} className="magi-market-review-row">
											<dt>
												{t.name}
												{sellPacks && slots(t) > 0 && ` · ${slots(t)}/pack`}
											</dt>
											<dd>
												{t.picks.length} NFT{t.picks.length === 1 ? '' : 's'}, {u} unit
												{u === 1 ? '' : 's'}
												{rarest && (
													<>
														{' · rarest '}#{rarest.tokenId} {pct < 0.1 ? '<0.1' : pct.toFixed(1)}%
													</>
												)}
											</dd>
										</div>
									);
								})}
								<div className="magi-market-review-row">
									<dt>Price</dt>
									<dd>
										{[
											sellSingles && `${pricePerDraw || '—'} ${tokenMeta.symbol(paymentToken)}/draw`,
											sellPacks && `${pricePerPack || '—'} ${tokenMeta.symbol(paymentToken)}/pack`
										]
											.filter(Boolean)
											.join(' · ')}
									</dd>
								</div>
								<div className="magi-market-review-row">
									<dt>Stock supports</dt>
									<dd>
										{[
											sellSingles && `${totalUnits} draw${totalUnits === 1 ? '' : 's'}`,
											sellPacks && `${packsPossible} pack${packsPossible === 1 ? '' : 's'}`
										]
											.filter(Boolean)
											.join(' · ')}
									</dd>
								</div>
								{expirationBlock !== null && (
									<div className="magi-market-review-row">
										<dt>Closes at block</dt>
										<dd>{expirationBlock}</dd>
									</div>
								)}
							</dl>
							<p className="magi-market-field-hint">
								You keep the NFTs until they are drawn. Opening a bucket also approves the
								marketplace to move units of this collection, so expect TWO signature prompts.
							</p>
						</>
					)}

					{problem && !error && <p className="magi-market-field-hint">{problem}</p>}
					{error && <p className="magi-market-status error">{error}</p>}

					<div className="magi-market-wizard-nav">
						{step > 0 && (
							<button
								type="button"
								className="magi-market-submit ghost"
								disabled={submitting}
								onClick={() => setStep(step - 1)}
							>
								Back
							</button>
						)}
						{step < STEPS.length - 1 ? (
							<button
								type="button"
								className="magi-market-submit"
								disabled={submitting || problem !== null}
								onClick={() => setStep(step + 1)}
							>
								Next
							</button>
						) : (
							<button
								type="button"
								className="magi-market-submit"
								disabled={!valid || submitting}
								onClick={handleSubmit}
							>
								{submitting ? 'Opening…' : `Open bucket (${totalEntries} NFT${totalEntries === 1 ? '' : 's'})`}
							</button>
						)}
					</div>
				</>
			)}
		</Modal>
	);
}
