import { useCallback, useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import type { NftItem } from '@vsc.eco/token-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { NftPicker } from '../components/NftPicker.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { SelectPicker } from '../components/SelectPicker.js';

export interface ListMintSpotsFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	defaultTokenId?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Sell primary-sale "mint spots" for a pre-defined edition — buyers get
 * the NFT minted straight to them. Cross-contract `client.mintSpotListing`:
 * authorize the marketplace on the NFT collection (blanket
 * `setApprovalForAll`, OR a capped per-token `approve(market,id,maxSpots)`)
 * then `listMintSpots`. With the per-token allowance, `maxSpots` is
 * mandatory and must be ≤ the granted allowance — enforced here and by the
 * contract.
 */
export function ListMintSpotsForm({
	client,
	username,
	defaultNftContract,
	defaultTokenId,
	onSuccess,
	onClose
}: ListMintSpotsFormProps) {
	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	const [tokenId, setTokenId] = useState(defaultTokenId ?? '');
	const [paymentToken, setPaymentToken] = useState('');
	const [price, setPrice] = useState('');
	const tokenMeta = useTokenMeta(client.config);
	const microPrice = tokenMeta.toMicro(paymentToken, price);
	const [maxSpots, setMaxSpots] = useState('');
	const [auth, setAuth] = useState<'operator' | 'allowance'>('operator');
	const [skipApproval, setSkipApproval] = useState(false);
	const [step, setStep] = useState<1 | 2>(1);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const valid = useMemo(
		() =>
			nftContract.trim() !== '' &&
			tokenId.trim() !== '' &&
			paymentToken.trim() !== '' &&
			microPrice !== '' && BigInt(microPrice) > 0n &&
			// per-token allowance requires an explicit positive cap
			(auth === 'operator' ? maxSpots === '' || Number(maxSpots) >= 0 : Number(maxSpots) > 0),
		[nftContract, tokenId, paymentToken, microPrice, maxSpots, auth]
	);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const { txIds } = await client.mintSpotListing(username, {
				nftContract: nftContract.trim(),
				tokenId: tokenId.trim(),
				paymentToken: paymentToken.trim(),
				pricePerSpot: microPrice,
				maxSpots: maxSpots ? Number(maxSpots) : 0,
				auth,
				skipApproval
			});
			const last = txIds[txIds.length - 1];
			setTxId(last);
			onSuccess?.(last);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	const nftPicked = nftContract.trim() !== '' && tokenId.trim() !== '';

	// Mint spots are a *primary* sale: only the collection owner can sell
	// them, and only for an edition that still has unminted supply. Strip
	// `@`/`hive:` on both sides so the owner comparison is prefix-agnostic.
	const norm = (s?: string) => (s ?? '').replace(/^@/, '').replace(/^hive:/, '').toLowerCase();
	const me = norm(username);
	const eligibleEdition = useCallback(
		(i: NftItem) => {
			const ownsCollection = norm(i.collection?.owner) === me;
			const max = i.maxSupply ?? 0;
			// maxSupply <= 0 means an unbounded edition (always has room);
			// otherwise there must be supply left to mint.
			const hasRoom = max <= 0 ? true : (i.currentSupply ?? 0) < max;
			return ownsCollection && hasRoom;
		},
		[me]
	);

	return (
		<Modal
			title="Sell mint spots"
			subtitle={
				txId
					? undefined
					: step === 1
						? 'Step 1 of 2 — choose the edition'
						: 'Step 2 of 2 — primary-sale terms (the NFT is minted directly to each buyer)'
			}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : step === 1 ? (
				<>
					<NftPicker
						config={client.config}
						username={username}
						value={{ nftContract, tokenId }}
						onChange={(v) => {
							setNftContract(v.nftContract);
							setTokenId(v.tokenId);
						}}
						disabled={submitting}
						label="Edition (must already be defined)"
						filterItem={eligibleEdition}
						emptyHint="No eligible editions — you can only sell mint spots for collections you own that still have unminted supply."
					/>
					<button type="button" className="magi-market-submit" disabled={!nftPicked} onClick={() => setStep(2)}>
						Next →
					</button>
				</>
			) : (
				<>
					<TokenPicker config={client.config} value={paymentToken} onChange={setPaymentToken} disabled={submitting} />
					<Field label="Price per spot">
						<TextInput inputMode="decimal" value={price} onChange={setPrice} placeholder={tokenMeta.smallestUnit(paymentToken)} disabled={submitting} />
					</Field>
					<SelectPicker
						label="Authorization"
						value={auth}
						disabled={submitting}
						onChange={(v) => setAuth(v as 'operator' | 'allowance')}
						options={[
							{ value: 'operator', label: 'Operator approval (uncapped)' },
							{ value: 'allowance', label: 'Per-token allowance (capped at maxSpots)' }
						]}
					/>
					<p className="magi-market-field-hint" style={{ marginTop: '-0.4rem' }}>
						{auth === 'allowance'
							? 'Grants the marketplace a capped per-token allowance — it can mint exactly maxSpots, decremented per sale.'
							: 'Grants the marketplace blanket operator approval on the collection — uncapped, bounded only by the edition maxSupply.'}
					</p>
					<Field
						label={auth === 'allowance' ? 'Max spots (required, = allowance)' : 'Max spots (optional, 0 = unbounded)'}
						hint={auth === 'allowance' ? 'The per-token approve grants exactly this many mints.' : 'Bounded by the edition maxSupply on the NFT contract.'}
					>
						<TextInput type="number" inputMode="numeric" min={0} value={maxSpots} onChange={setMaxSpots} placeholder="0" disabled={submitting} />
					</Field>
					<label className="magi-market-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
						<input type="checkbox" checked={skipApproval} onChange={(e) => setSkipApproval((e.target as HTMLInputElement).checked)} disabled={submitting} />
						<span className="magi-market-field-hint">Marketplace already authorized on this collection</span>
					</label>

					{error && <p className="magi-market-status error">{error}</p>}

					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="magi-market-submit ghost" style={{ width: 'auto' }} disabled={submitting} onClick={() => setStep(1)}>
							← Back
						</button>
						<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
							{submitting ? 'Listing…' : 'Authorize & list mint spots'}
						</button>
					</div>
				</>
			)}
		</Modal>
	);
}
