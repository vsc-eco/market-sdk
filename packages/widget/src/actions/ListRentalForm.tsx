import { useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { NftPicker } from '../components/NftPicker.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { BlockDurationInput } from '../components/BlockDurationInput.js';
import { useTokenMeta } from '../components/useTokenMeta.js';

export interface ListRentalFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	defaultTokenId?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * List an NFT (amount=1) for rental. The marketplace must already be
 * approved as an operator on the NFT collection; this form only emits the
 * `listRental` market op, not the approval leg — wrap with `client.rental`
 * if you need the approval batched in.
 */
export function ListRentalForm({
	client,
	username,
	defaultNftContract,
	defaultTokenId,
	onSuccess,
	onClose
}: ListRentalFormProps) {
	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	const [tokenId, setTokenId] = useState(defaultTokenId ?? '');
	const [paymentToken, setPaymentToken] = useState('');
	const [pricePerBlock, setPricePerBlock] = useState('');
	// Min/max rental duration as relative block counts, entered as
	// days/hours/minutes (resolved by BlockDurationInput, relative mode).
	const [minBlocks, setMinBlocks] = useState<number | null>(null);
	const [maxBlocks, setMaxBlocks] = useState<number | null>(null);
	const tokenMeta = useTokenMeta(client.config);
	const microPpb = tokenMeta.toMicro(paymentToken, pricePerBlock);
	const [step, setStep] = useState<1 | 2>(1);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const valid = useMemo(
		() =>
			nftContract.trim() !== '' &&
			tokenId.trim() !== '' &&
			paymentToken.trim() !== '' &&
			microPpb !== '' &&
			BigInt(microPpb) > 0n &&
			minBlocks !== null &&
			minBlocks > 0 &&
			maxBlocks !== null &&
			maxBlocks > 0 &&
			minBlocks <= maxBlocks,
		[nftContract, tokenId, paymentToken, microPpb, minBlocks, maxBlocks]
	);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const op = client.ops.listRentalOp(username, {
				nftContract: nftContract.trim(),
				tokenId: tokenId.trim(),
				amount: 1,
				paymentToken: paymentToken.trim(),
				pricePerBlock: microPpb,
				minBlocks: minBlocks ?? 0,
				maxBlocks: maxBlocks ?? 0
			});
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	const nftPicked = nftContract.trim() !== '' && tokenId.trim() !== '';

	return (
		<Modal
			title="List for rental"
			subtitle={
				txId
					? undefined
					: step === 1
						? 'Step 1 of 2 — choose the NFT to rent out'
						: 'Step 2 of 2 — rental terms'
			}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} />
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
						label="NFT to rent out"
						filterItem={(i) => !i.soulbound}
						emptyHint="No NFTs eligible for rental — soulbound tokens can't be rented (the rental escrows the NFT, which would strand a soulbound token in the market)."
					/>
					<button type="button" className="magi-market-submit" disabled={!nftPicked} onClick={() => setStep(2)}>
						Next →
					</button>
				</>
			) : (
				<>
					<TokenPicker config={client.config} value={paymentToken} onChange={setPaymentToken} disabled={submitting} />
					<Field label="Price per block">
						<TextInput inputMode="decimal" value={pricePerBlock} onChange={setPricePerBlock} placeholder={tokenMeta.smallestUnit(paymentToken)} disabled={submitting} />
					</Field>
					<BlockDurationInput
						client={client}
						relative
						label="Minimum rental"
						value={minBlocks}
						onChange={setMinBlocks}
						disabled={submitting}
					/>
					<BlockDurationInput
						client={client}
						relative
						label="Maximum rental"
						hint={
							minBlocks !== null && maxBlocks !== null && minBlocks > maxBlocks
								? 'Maximum must be ≥ minimum.'
								: undefined
						}
						value={maxBlocks}
						onChange={setMaxBlocks}
						disabled={submitting}
					/>

					{error && <p className="magi-market-status error">{error}</p>}

					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="magi-market-submit ghost" style={{ width: 'auto' }} disabled={submitting} onClick={() => setStep(1)}>
							← Back
						</button>
						<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
							{submitting ? 'Listing…' : 'List rental'}
						</button>
					</div>
				</>
			)}
		</Modal>
	);
}
