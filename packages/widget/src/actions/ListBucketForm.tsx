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
/** The contract's ceiling on stacks. */
const MAX_STACKS = 8;

/**
 * A stack of NFTs that a pack slot can draw from.
 *
 * On the wire the contract calls this a "pool" and identifies it by index —
 * `entries[].pool`, `packDraws[i]`. "Stack" is the name everywhere a person can
 * see, because "pool" reads as a liquidity pool in a product that also has
 * those.
 */
interface Stack {
	/** Display only — the contract identifies a stack by its index. */
	name: string;
	picks: NftMultiPick[];
	/** Slots this stack fills in one pack. 0 = in the bucket, never guaranteed. */
	perPack: string;
}

const DEFAULT_STACK_NAMES = ['Commons', 'Uncommons', 'Rares', 'Holos', 'Secrets', 'Stack 6', 'Stack 7', 'Stack 8'];

function newStack(index: number, perPack: string): Stack {
	return { name: DEFAULT_STACK_NAMES[index] ?? `Stack ${index + 1}`, picks: [], perPack };
}

/**
 * Open a bucket: a fixed-price sale where the CONTRACT picks which NFT the
 * buyer receives.
 *
 * Exposes what the contract actually does, rather than a safe subset: up to
 * eight stacks, any number of guaranteed slots per stack, single draws and
 * packs priced independently (or both at once), and an optional expiry.
 *
 * The one thing the form insists on is coherence, because the contract does not
 * check it at listing time and the buyer is the one who pays for that: a pack
 * promising slots from a stack that cannot fill them lists perfectly happily and
 * then refuses every purchase. Every such mismatch is caught here with the
 * numbers spelled out.
 *
 * Naming: the contract's wire format says "pool"; everything a user reads says
 * "stack".
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
	const [stacks, setStacks] = useState<Stack[]>([newStack(0, '0')]);
	const [paymentToken, setPaymentToken] = useState('');
	const [pricePerDraw, setPricePerDraw] = useState('');
	const [pricePerPack, setPricePerPack] = useState('');
	const [expirationBlock, setExpirationBlock] = useState<number | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const STEPS = ['Sale type', 'Stacks', 'Price', 'Review'];

	// One collection per bucket — the contract stores a single nftContract, so
	// the pickers all lock to whichever collection is picked first.
	const lockCollection =
		defaultNftContract ?? stacks.map((t) => t.picks[0]?.nftContract).find((c): c is string => !!c);

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

	const units = (t: Stack) => t.picks.reduce((a, p) => a + p.amount, 0);
	const slots = (t: Stack) => {
		const n = Number(t.perPack);
		return Number.isInteger(n) && n > 0 ? n : 0;
	};
	const totalEntries = stacks.reduce((a, t) => a + t.picks.length, 0);
	const totalUnits = stacks.reduce((a, t) => a + units(t), 0);
	const packSize = stacks.reduce((a, t) => a + slots(t), 0);

	/** How many packs the stock supports — the scarcest stack decides. */
	const packsPossible = useMemo(() => {
		if (!sellPacks || packSize === 0) return 0;
		const limits = stacks.filter((t) => slots(t) > 0).map((t) => Math.floor(units(t) / slots(t)));
		return limits.length ? Math.min(...limits) : 0;
	}, [stacks, sellPacks, packSize]);

	const updateStack = (i: number, patch: Partial<Stack>) =>
		setStacks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));

	const stepProblem = useMemo<(string | null)[]>(() => {
		const typeProblem = !sellSingles && !sellPacks ? 'Pick at least one way to sell.' : null;

		const stackProblem = (() => {
			if (totalEntries === 0) return 'Pick at least one NFT.';
			if (totalEntries > MAX_ENTRIES)
				return `${totalEntries} NFTs picked — up to ${MAX_ENTRIES} per bucket here; add the rest afterwards.`;
			const empty = stacks.findIndex((t) => t.picks.length === 0);
			if (empty !== -1) return `"${stacks[empty].name}" has no NFTs — fill it or remove the stack.`;
			if (sellPacks) {
				if (packSize === 0) return 'A pack needs at least one slot. Set how many cards come from a stack.';
				if (packSize > 24) return `A pack of ${packSize} exceeds the contract's 24-draw limit.`;
				// Slots a stack cannot fill = a bucket that lists and then refuses
				// every purchase, which the buyer discovers rather than the seller.
				const short = stacks.find((t) => slots(t) > 0 && units(t) < slots(t));
				if (short)
					return `"${short.name}" promises ${slots(short)} per pack but only has ${units(short)} unit${units(short) === 1 ? '' : 's'}.`;
			}
			// Single draws always come from the first stack, so it must have stock.
			if (sellSingles && units(stacks[0]) === 0)
				return `Single draws come from "${stacks[0].name}", which is empty.`;
			return null;
		})();

		const priceProblem = (() => {
			if (paymentToken.trim() === '') return 'Choose a payment token.';
			if (sellSingles && !positive(microDraw)) return 'Set a price per draw.';
			if (sellPacks && !positive(microPack)) return 'Set a price per pack.';
			return null;
		})();

		return [typeProblem, stackProblem, priceProblem, typeProblem ?? stackProblem ?? priceProblem];
	}, [stacks, sellSingles, sellPacks, paymentToken, microDraw, microPack, totalEntries, packSize]);

	const problem = stepProblem[step];
	const valid = stepProblem[STEPS.length - 1] === null;

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const nftContract = stacks.flatMap((t) => t.picks)[0].nftContract;
			const entries = stacks.flatMap((t, pool) =>
				t.picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, pool }))
			);
			// packDraws is positional: index = stack (the contract's "pool"). A
			// stack with no guaranteed slots still needs its 0 so later stacks keep
			// their index.
			const packDraws = sellPacks ? stacks.map((t) => slots(t)) : [];
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
							'Group your NFTs into stacks. Each pack slot draws from one stack — that is what makes a guarantee.',
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
									<strong>Single draws</strong> — one NFT at a time, drawn from the first stack.
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
									from a chosen stack, which is how "every pack has a rare" becomes a promise rather
									than a hope.
								</span>
							</label>
						</Field>
					)}

					{step === 1 && (
						<>
							{stacks.map((stack, i) => (
								<div key={i} className="magi-market-stack">
									<div className="magi-market-stack-head">
										<TextInput
											value={stack.name}
											onChange={(v) => updateStack(i, { name: v })}
											disabled={submitting}
										/>
										{sellPacks && (
											<label className="magi-market-stack-slots">
												<span>per pack</span>
												<TextInput
													type="number"
													inputMode="numeric"
													min={0}
													value={stack.perPack}
													onChange={(v) => updateStack(i, { perPack: v })}
													disabled={submitting}
												/>
											</label>
										)}
										{stacks.length > 1 && (
											<button
												type="button"
												className="magi-market-submit ghost"
												style={{ width: 'auto', padding: '0.25rem 0.6rem' }}
												disabled={submitting}
												onClick={() => setStacks((prev) => prev.filter((_, j) => j !== i))}
											>
												Remove
											</button>
										)}
									</div>
									<NftMultiPicker
										config={client.config}
										username={username}
										value={stack.picks}
										onChange={(picks) => updateStack(i, { picks })}
										label={`NFTs in "${stack.name}"`}
										lockCollection={lockCollection}
										filterItem={(it) => canTransferNft(it, username)}
										max={MAX_ENTRIES}
										disabled={submitting}
									/>
								</div>
							))}
							{stacks.length < MAX_STACKS && (
								<button
									type="button"
									className="magi-market-submit ghost"
									disabled={submitting}
									onClick={() => setStacks((prev) => [...prev, newStack(prev.length, sellPacks ? '1' : '0')])}
								>
									Add a stack ({stacks.length}/{MAX_STACKS})
								</button>
							)}
							<p className="magi-market-field-hint">
								{sellPacks
									? 'A stack with 0 per pack is still in the bucket — it just is not guaranteed a slot.'
									: 'Single draws come from the first stack. Add stacks if you also sell packs.'}
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
									hint={`Each pack: ${stacks
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
								{stacks.map((t, i) => {
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
