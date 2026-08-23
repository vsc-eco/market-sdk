import { useMemo, useState } from 'react';
import type * as React from 'react';
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
import { PanelView } from '../components/PanelView.js';

export interface ListBucketFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
	/**
	 * Render as a full-panel view rather than a dialog.
	 *
	 * Preferred for this form: it holds an NFT picker, and a dialog caps its
	 * own height so the grid gets squeezed and the buttons drift out of reach.
	 * The modal path is kept so the form can still be opened from a context
	 * where taking over the panel would lose the user's place.
	 */
	inline?: boolean;
}

/** The contract caps one call at 24 entries; more go in via addToBucket. */
const MAX_ENTRIES = 24;
/** The contract's ceiling on stacks. */
const MAX_STACKS = 8;

/**
 * A stack of NFTs that a pack slot can draw from.
 *
 * On the wire the contract calls this a "stack" and identifies it by index —
 * `entries[].stack`, `packDraws[i]`. "Stack" is the name everywhere a person can
 * see, because "stack" reads as a liquidity stack in a product that also has
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
 * Naming: the contract's wire format says "stack"; everything a user reads says
 * "stack".
 */
export function ListBucketForm({
	client,
	username,
	defaultNftContract,
	onSuccess,
	onClose,
	inline
}: ListBucketFormProps) {
	const tokenMeta = useTokenMeta(client.config);

	const [step, setStep] = useState(0);
	const [sellSingles, setSellSingles] = useState(true);
	const [sellPacks, setSellPacks] = useState(false);
	/** Pending sale-type change that would throw work away, awaiting a yes. */
	const [confirmTypeChange, setConfirmTypeChange] = useState(false);
	const [stacks, setStacks] = useState<Stack[]>([newStack(0, '0')]);
	/**
	 * Which stack is expanded. Only one at a time: each stack carries a full NFT
	 * picker, so leaving them all open buries the Add/Next controls under
	 * several screens of grid and makes the wizard feel like a scroll.
	 */
	const [openStack, setOpenStack] = useState(0);
	const [paymentToken, setPaymentToken] = useState('');
	const [pricePerDraw, setPricePerDraw] = useState('');
	const [pricePerPack, setPricePerPack] = useState('');
	const [expirationBlock, setExpirationBlock] = useState<number | null>(null);
	const [skipApproval, setSkipApproval] = useState(false);
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

	/** More than one stack, or anything picked — i.e. a change would cost something. */
	const hasStackWork = stacks.length > 1 || stacks.some((t) => t.picks.length > 0);

	const updateStack = (i: number, patch: Partial<Stack>) =>
		setStacks((prev) => prev.map((t, j) => (j === i ? { ...t, ...patch } : t)));

	const stepProblem = useMemo<(string | null)[]>(() => {
		const typeProblem = !sellSingles && !sellPacks ? 'Pick at least one way to sell.' : null;

		const stackProblem = (() => {
			if (totalEntries === 0) return 'Pick at least one NFT.';
			if (totalEntries > MAX_ENTRIES)
				return `${totalEntries} NFTs picked — one transaction carries ${MAX_ENTRIES}. Open the sale with these and add the rest from its "Add" button.`;
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
			const entries = stacks.flatMap((t, stack) =>
				t.picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, stack }))
			);
			// packDraws is positional: index = stack (the contract's "stack"). A
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
				expirationBlock: expirationBlock ?? 0,
				skipApproval
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

	const subtitle =
				txId
					? undefined
					: [
							'A fixed-price sale where the contract picks which NFT the buyer gets.',
							'Group your NFTs into stacks. Each pack slot draws from one stack — that is what makes a guarantee.',
							'What a draw costs, and how long it runs.',
							'Check it over, then open.'
						][step]
			;

	/**
	 * The body is a VALUE, and the container is chosen around it.
	 *
	 * It was briefly a `Shell` component declared inside this one, which is a
	 * new component type on every render — React then unmounts and remounts the
	 * whole subtree each time, so the NFT picker refetched on a loop and never
	 * settled. Declaring components during render is the bug; building elements
	 * is not.
	 */
	const body = (
		<>
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
					<div className="magi-market-bucketform">

					{step === 0 && (
						<Field
							label="How can people buy?"
							hint="Both can run at once — the same stock, sold two ways."
						>
							<div className="magi-market-options">
								<button
									type="button"
									className={`magi-market-option${sellSingles ? ' selected' : ''}`}
									aria-pressed={sellSingles}
									disabled={submitting}
									onClick={() => setSellSingles(!sellSingles)}
								>
									<span className="magi-market-option-title">Single draws</span>
									<span className="magi-market-option-desc">
										One NFT at a time, drawn from the first stack. Odds follow how many
										copies you put in — 10 copies of a card are drawn ten times as often as
										a 1-of-1.
									</span>
								</button>
								<button
									type="button"
									className={`magi-market-option${sellPacks ? ' selected' : ''}`}
									aria-pressed={sellPacks}
									disabled={submitting}
									onClick={() => {
										// Turning packs off makes stacks meaningless — a single
										// draw only ever comes from stack 0 — so the stacks have
										// to go. Ask before throwing away the picks rather than
										// silently rearranging them.
										if (sellPacks && hasStackWork) {
											setConfirmTypeChange(true);
											return;
										}
										setSellPacks(!sellPacks);
									}}
								>
									<span className="magi-market-option-title">Packs</span>
									<span className="magi-market-option-desc">
										Several NFTs at once with a fixed shape. Each slot draws from a chosen
										stack, which is how "every pack has a rare" becomes a promise rather than a
										hope.
									</span>
								</button>
							</div>
						</Field>
					)}

					{step === 1 && (
						<>
							{stacks.map((stack, i) => {
								// One pile has nothing to collapse to and nothing to
								// distinguish from, so it drops the accordion, the name
								// field, and the name in the picker's label.
								const flat = !sellPacks;
								const open = flat || openStack === i;
								const u = units(stack);
								return (
									<div key={i} className={`magi-market-stack${open ? ' open' : ''}${flat ? ' flat' : ''}`}>
										{!flat && (
										<div className="magi-market-stack-head">
											<button
												type="button"
												className="magi-market-stack-toggle"
												aria-expanded={open}
												disabled={submitting}
												onClick={() => setOpenStack(open ? -1 : i)}
											>
												<span className="magi-market-stack-caret">{open ? '▾' : '▸'}</span>
												{open ? null : <span className="magi-market-stack-title">{stack.name}</span>}
												{!open && (
													<span className="magi-market-stack-summary">
														{stack.picks.length} NFT{stack.picks.length === 1 ? '' : 's'} · {u} unit
														{u === 1 ? '' : 's'}
														{sellPacks && slots(stack) > 0 && ` · ${slots(stack)}/pack`}
													</span>
												)}
											</button>
											{open && (
												<TextInput
													value={stack.name}
													onChange={(v) => updateStack(i, { name: v })}
													disabled={submitting}
												/>
											)}
											{open && sellPacks && (
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
											{open && stacks.length > 1 && (
												<button
													type="button"
													className="magi-market-submit ghost"
													style={{ width: 'auto', padding: '0.25rem 0.6rem' }}
													disabled={submitting}
													onClick={() => {
														setStacks((prev) => prev.filter((_, j) => j !== i));
														setOpenStack((o) => (o >= i ? Math.max(0, o - 1) : o));
													}}
												>
													Remove
												</button>
											)}
										</div>
										)}
										{open && (
											<>
												<NftMultiPicker
													config={client.config}
													username={username}
													value={stack.picks}
													onChange={(picks) => updateStack(i, { picks })}
													label={flat ? 'NFTs in this sale' : `NFTs in "${stack.name}"`}
													// Stock by the handful: editions fold into one tile
													// and ask how many, rather than making the seller
													// click twenty near-identical cards.
													groupEditions
													lockCollection={lockCollection}
													filterItem={(it) => canTransferNft(it, username)}
													max={MAX_ENTRIES}
													disabled={submitting}
												/>
											</>
										)}
									</div>
								);
							})}
							{/* Stacks only mean something for packs: a single draw always
							    comes from stack 0, so a singles-only sale with several
							    stacks escrows NFTs nobody can ever pull. Rather than
							    warn about it afterwards, the control is not offered. */}
							{sellPacks && stacks.length < MAX_STACKS && (
								<button
									type="button"
									className="magi-market-submit ghost"
									disabled={submitting}
									onClick={() => {
										// Collapse whatever is open: the new stack is what you
										// came here to fill in, and two open pickers push the
										// controls off-screen.
										setStacks((prev) => {
											setOpenStack(prev.length);
											return [...prev, newStack(prev.length, sellPacks ? '1' : '0')];
										});
									}}
								>
									Add a stack ({stacks.length}/{MAX_STACKS})
								</button>
							)}
							<p className="magi-market-field-hint">
								{sellPacks
									? 'A stack with 0 per pack is still in the bucket — it just is not guaranteed a slot.'
									: 'One pile: every draw picks from everything you put here. Stacks — commons, rares, a guaranteed slot — are what packs are for, so turn packs on if you want them.'}
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
								You keep the NFTs until they are drawn.{' '}
								{skipApproval
									? 'One signature: the listing itself.'
									: `${totalEntries + 1} signature${totalEntries === 0 ? '' : 's'}: one approval per NFT, then the listing. ` +
										'Approving per NFT rather than the whole collection means the market can only ever move what you put in this bucket.'}
							</p>
						</>
					)}

					</div>

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
		</>
	);

	// Written out rather than reusing Modal: inside the panel Modal renders as
	// a full PanelView, and this wants to sit over the step it is asking about.
	const typeChangeConfirm = confirmTypeChange ? (
		<div
			className="magi-market-modal"
			role="dialog"
			aria-modal="true"
			onClick={() => setConfirmTypeChange(false)}
		>
			<div
				className="magi-market-modal-card magi-market-confirm"
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="magi-market-modal-title">
					<span>Stop selling packs?</span>
				</h3>
				<p className="magi-market-field-hint">
					Single draws only ever come from the first stack, so the stacks you built no
					longer mean anything — the NFTs you picked will be cleared and you start the
					selection again.
				</p>
				<div className="magi-market-confirm-actions">
					<button
						type="button"
						className="magi-market-submit ghost"
						onClick={() => setConfirmTypeChange(false)}
					>
						Keep packs
					</button>
					<button
						type="button"
						className="magi-market-submit"
						onClick={() => {
							setSellPacks(false);
							setStacks([newStack(0, '0')]);
							setOpenStack(0);
							setConfirmTypeChange(false);
						}}
					>
						Clear and change
					</button>
				</div>
			</div>
		</div>
	) : null;

	return inline ? (

		<PanelView
			title="Mystery sale"
			subtitle={subtitle}
			onBack={onClose}
			confirmMessage="The stacks you set up here will be lost."
		>
			{body}
			{typeChangeConfirm}
		</PanelView>
	) : (
		<Modal wide title="Mystery sale" subtitle={subtitle} onClose={onClose}>
			{body}
			{typeChangeConfirm}
		</Modal>
	);
}
