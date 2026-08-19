import { useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { NftMultiPicker, type NftMultiPick } from '../components/NftMultiPicker.js';
import { canTransferNft } from '../components/nftFilters.js';

export interface ListBucketFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/** The contract caps one call at 24 entries; the rest go through addToBucket. */
const MAX_ENTRIES = 24;

/**
 * Open a bucket: a fixed-price sale where the CONTRACT picks which NFT the
 * buyer receives.
 *
 * Two shapes are offered rather than the full pool matrix, because those cover
 * what people actually build and the third option is a footgun:
 *
 *   Simple  — every NFT in one pool. A draw is weighted by units, so a 1-of-1
 *             among 100 commons really is 1-in-101. This is a gacha machine.
 *   Pack    — the picked NFTs are commons, plus a "rare" set drawn from a
 *             second pool with one guaranteed slot per pack. This is a booster
 *             pack, and the guarantee is the whole point.
 *
 * The seller keeps custody either way; the market moves a unit per draw, so
 * this form emits the operator-approval leg alongside the listing.
 */
export function ListBucketForm({
	client,
	username,
	defaultNftContract,
	onSuccess,
	onClose
}: ListBucketFormProps) {
	const tokenMeta = useTokenMeta(client.config);

	const [mode, setMode] = useState<'simple' | 'pack'>('simple');
	const [picks, setPicks] = useState<NftMultiPick[]>([]);
	const [rarePicks, setRarePicks] = useState<NftMultiPick[]>([]);
	const [paymentToken, setPaymentToken] = useState('');
	const [pricePerDraw, setPricePerDraw] = useState('');
	const [pricePerPack, setPricePerPack] = useState('');
	const [packCommons, setPackCommons] = useState('4');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// One collection per bucket, same as bundles — the contract stores a single
	// nftContract, so the picker locks to the first pick.
	const lockCollection = defaultNftContract ?? picks[0]?.nftContract ?? rarePicks[0]?.nftContract;

	const microDraw =
		paymentToken && pricePerDraw.trim() !== '' ? tokenMeta.toMicro(paymentToken, pricePerDraw.trim()) : '';
	const microPack =
		paymentToken && pricePerPack.trim() !== '' ? tokenMeta.toMicro(paymentToken, pricePerPack.trim()) : '';

	const commonsPerPack = Number(packCommons);
	const totalEntries = picks.length + (mode === 'pack' ? rarePicks.length : 0);

	const positive = (micro: string) => {
		if (micro === '') return false;
		try {
			return BigInt(micro) > 0n;
		} catch {
			return false;
		}
	};

	const problem = useMemo(() => {
		if (picks.length === 0) return 'Pick at least one NFT.';
		if (totalEntries > MAX_ENTRIES) return `Up to ${MAX_ENTRIES} NFTs per bucket here.`;
		if (paymentToken.trim() === '') return 'Choose a payment token.';
		if (mode === 'simple' && !positive(microDraw)) return 'Set a price per draw.';
		if (mode === 'pack') {
			if (rarePicks.length === 0) return 'Pick at least one rare — that is what the pack guarantees.';
			if (!positive(microPack)) return 'Set a price per pack.';
			if (!Number.isInteger(commonsPerPack) || commonsPerPack < 1) return 'Commons per pack must be 1 or more.';
			// A pack promising more commons than exist can never be filled, and
			// the contract would refuse every purchase rather than the listing.
			const commonUnits = picks.reduce((a, p) => a + p.amount, 0);
			if (commonUnits < commonsPerPack) {
				return `Only ${commonUnits} common unit${commonUnits === 1 ? '' : 's'} picked — a pack needs ${commonsPerPack}.`;
			}
		}
		return null;
	}, [picks, rarePicks, mode, paymentToken, microDraw, microPack, commonsPerPack, totalEntries]);

	const valid = problem === null;

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const nftContract = picks[0].nftContract;
			const entries =
				mode === 'pack'
					? [
							...picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, pool: 0 })),
							...rarePicks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, pool: 1 }))
						]
					: picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount, pool: 0 }));

			// `listBucketFlow` emits the operator approval first: a bucket cannot
			// use per-token allowances, because the contract does not know in
			// advance which token a draw will move.
			const { txIds } = await client.listBucket(username, {
				nftContract,
				entries,
				paymentToken: paymentToken.trim(),
				pricePerDraw: mode === 'simple' ? microDraw : '0',
				pricePerPack: mode === 'pack' ? microPack : '0',
				packDraws: mode === 'pack' ? [commonsPerPack, 1] : [],
				expirationBlock: 0
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
			subtitle="A fixed-price sale where the contract picks which NFT the buyer gets."
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
					<Field
						label="Bucket type"
						hint={
							mode === 'simple'
								? 'One pool. Every unit is equally likely, so more copies of a card make it commoner.'
								: 'Two pools. Each pack is N commons plus ONE guaranteed rare.'
						}
					>
						<div style={{ display: 'flex', gap: '0.5rem' }}>
							<button
								type="button"
								className={`magi-market-submit ${mode === 'simple' ? '' : 'ghost'}`}
								style={{ width: 'auto', padding: '0.35rem 0.8rem' }}
								disabled={submitting}
								onClick={() => setMode('simple')}
							>
								Simple draw
							</button>
							<button
								type="button"
								className={`magi-market-submit ${mode === 'pack' ? '' : 'ghost'}`}
								style={{ width: 'auto', padding: '0.35rem 0.8rem' }}
								disabled={submitting}
								onClick={() => setMode('pack')}
							>
								Pack with a guaranteed rare
							</button>
						</div>
					</Field>

					<NftMultiPicker
						config={client.config}
						username={username}
						value={picks}
						onChange={setPicks}
						label={mode === 'pack' ? 'Commons — the bulk of the pack' : `NFTs in the bucket (max ${MAX_ENTRIES})`}
						lockCollection={lockCollection}
						filterItem={(i) => canTransferNft(i, username)}
						max={MAX_ENTRIES}
						disabled={submitting}
					/>

					{mode === 'pack' && (
						<>
							<NftMultiPicker
								config={client.config}
								username={username}
								value={rarePicks}
								onChange={setRarePicks}
								label="Rares — one of these is guaranteed in every pack"
								lockCollection={lockCollection}
								filterItem={(i) => canTransferNft(i, username)}
								max={MAX_ENTRIES}
								disabled={submitting}
							/>
							<Field label="Commons per pack" hint="Plus one guaranteed rare on top.">
								<TextInput
									type="number"
									inputMode="numeric"
									min={1}
									value={packCommons}
									onChange={setPackCommons}
									disabled={submitting}
								/>
							</Field>
						</>
					)}

					<TokenPicker
						config={client.config}
						value={paymentToken}
						onChange={setPaymentToken}
						disabled={submitting}
					/>

					{mode === 'simple' ? (
						<Field label="Price per draw">
							<TextInput
								inputMode="decimal"
								value={pricePerDraw}
								onChange={setPricePerDraw}
								placeholder={tokenMeta.smallestUnit(paymentToken)}
								disabled={submitting}
							/>
						</Field>
					) : (
						<Field label="Price per pack" hint={`Each pack: ${commonsPerPack || '?'} commons + 1 rare.`}>
							<TextInput
								inputMode="decimal"
								value={pricePerPack}
								onChange={setPricePerPack}
								placeholder={tokenMeta.smallestUnit(paymentToken)}
								disabled={submitting}
							/>
						</Field>
					)}

					<p className="magi-market-field-hint">
						You keep the NFTs until they are drawn. Opening a bucket also approves the
						marketplace to move units of this collection on your behalf.
					</p>

					{problem && !error && <p className="magi-market-field-hint">{problem}</p>}
					{error && <p className="magi-market-status error">{error}</p>}

					<button
						type="button"
						className="magi-market-submit"
						disabled={!valid || submitting}
						onClick={handleSubmit}
					>
						{submitting ? 'Opening…' : `Open bucket (${totalEntries} NFT${totalEntries === 1 ? '' : 's'})`}
					</button>
				</>
			)}
		</Modal>
	);
}
