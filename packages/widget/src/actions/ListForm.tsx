import { useCallback, useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import type { NftItem } from '@vsc.eco/token-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { NftPicker } from '../components/NftPicker.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { BlockDurationInput } from '../components/BlockDurationInput.js';
import { useTokenMeta } from '../components/useTokenMeta.js';

export interface ListFormProps {
	client: MarketClient;
	username: string;
	/** Pre-fill the collection (e.g. opened from an NFT tile). */
	defaultNftContract?: string;
	defaultTokenId?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * "Put an NFT up for sale" — the cross-contract flow. magi-market never
 * escrows listed NFTs; it moves them via operator approval on the NFT
 * contract. `client.sell(...)` therefore emits TWO ops on TWO contracts —
 * `setApprovalForAll(market,true)` on the NFT collection, then `list(...)`
 * on the market — and signs them as one chunked batch. Tick "already
 * approved" to skip the first leg when the collection is already approved.
 */
export function ListForm({
	client,
	username,
	defaultNftContract,
	defaultTokenId,
	onSuccess,
	onClose
}: ListFormProps) {
	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	const [tokenId, setTokenId] = useState(defaultTokenId ?? '');
	const [amount, setAmount] = useState('1');
	const [paymentToken, setPaymentToken] = useState('');
	const [price, setPrice] = useState('');
	const tokenMeta = useTokenMeta(client.config);
	const microPrice = tokenMeta.toMicro(paymentToken, price);
	const [expirationBlock, setExpirationBlock] = useState<number | null>(null);
	const [skipApproval, setSkipApproval] = useState(false);
	const [step, setStep] = useState<1 | 2>(1);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const valid = useMemo(() => {
		const amt = Number(amount);
		return (
			nftContract.trim() !== '' &&
			tokenId.trim() !== '' &&
			Number.isInteger(amt) &&
			amt > 0 &&
			paymentToken.trim() !== '' &&
			microPrice !== '' &&
			BigInt(microPrice) > 0n
		);
	}, [nftContract, tokenId, amount, paymentToken, microPrice]);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const { txIds } = await client.sell(username, {
				nftContract: nftContract.trim(),
				tokenId: tokenId.trim(),
				amount: Number(amount),
				paymentToken: paymentToken.trim(),
				pricePerUnit: microPrice,
				expirationBlock: expirationBlock ?? 0,
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

	// Selling = transfer-to-buyer; soulbound tokens can't be transferred,
	// so they're invalid for a sale unless the user is the collection's
	// minter/owner (privileged path). Hide everything else.
	const norm = (s?: string) => (s ?? '').replace(/^@/, '').replace(/^hive:/, '').toLowerCase();
	const me = norm(username);
	const eligibleForSale = useCallback(
		(i: NftItem) => !i.soulbound || norm(i.collection?.owner) === me,
		[me]
	);

	return (
		<Modal
			title="Sell an NFT"
			subtitle={
				txId
					? undefined
					: step === 1
						? 'Step 1 of 2 — choose the NFT to sell'
						: 'Step 2 of 2 — listing terms (approve + list signed as one batch)'
			}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>
						Done
					</button>
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
						label="NFT to sell"
						filterItem={eligibleForSale}
						emptyHint="No NFTs eligible for sale — soulbound tokens can't be transferred to a buyer unless you're the collection's minter."
					/>
					<button type="button" className="magi-market-submit" disabled={!nftPicked} onClick={() => setStep(2)}>
						Next →
					</button>
				</>
			) : (
				<>
					<Field label="Amount" hint="Copies to list (1 for a unique NFT).">
						<TextInput type="number" inputMode="numeric" min={1} value={amount} onChange={setAmount} disabled={submitting} />
					</Field>
					<TokenPicker config={client.config} value={paymentToken} onChange={setPaymentToken} disabled={submitting} />
					<Field label="Price per unit" hint="Decimal string in the payment token's units.">
						<TextInput inputMode="decimal" value={price} onChange={setPrice} placeholder={tokenMeta.smallestUnit(paymentToken)} disabled={submitting} />
					</Field>
					<BlockDurationInput
						client={client}
						label="Expires in (optional)"
						value={expirationBlock}
						onChange={setExpirationBlock}
						allowEmpty
						disabled={submitting}
					/>
					<label className="magi-market-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
						<input
							type="checkbox"
							checked={skipApproval}
							onChange={(e) => setSkipApproval((e.target as HTMLInputElement).checked)}
							disabled={submitting}
						/>
						<span className="magi-market-field-hint">Marketplace already approved on this collection (skip the approve op)</span>
					</label>

					{error && <p className="magi-market-status error">{error}</p>}

					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="magi-market-submit ghost" style={{ width: 'auto' }} disabled={submitting} onClick={() => setStep(1)}>
							← Back
						</button>
						<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
							{submitting ? 'Listing…' : 'Approve & list'}
						</button>
					</div>
				</>
			)}
		</Modal>
	);
}
