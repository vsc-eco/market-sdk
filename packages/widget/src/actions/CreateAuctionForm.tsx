import { useCallback, useMemo, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import type { NftItem } from '@vsc.eco/token-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { NftPicker } from '../components/NftPicker.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { SelectPicker } from '../components/SelectPicker.js';
import { BlockDurationInput } from '../components/BlockDurationInput.js';
import { useTokenMeta } from '../components/useTokenMeta.js';

export interface CreateAuctionFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	defaultTokenId?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Create an English or Dutch auction. Auctions DO escrow the NFT for their
 * duration, so this is the cross-contract `client.auction(...)` flow:
 * `setApprovalForAll(market,true)` on the NFT collection, then
 * `createAuction(...)`, batched. English settlement is permissionless
 * (anyone calls `settleAuction` after `endBlock`); Dutch auctions settle
 * on the first accepting bid.
 */
export function CreateAuctionForm({
	client,
	username,
	defaultNftContract,
	defaultTokenId,
	onSuccess,
	onClose
}: CreateAuctionFormProps) {
	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	const [tokenId, setTokenId] = useState(defaultTokenId ?? '');
	const [amount, setAmount] = useState('1');
	const [paymentToken, setPaymentToken] = useState('');
	const [auctionType, setAuctionType] = useState<'english' | 'dutch'>('english');
	const [startPrice, setStartPrice] = useState('');
	const [endPrice, setEndPrice] = useState('');
	const tokenMeta = useTokenMeta(client.config);
	const microStart = tokenMeta.toMicro(paymentToken, startPrice);
	const microEnd = tokenMeta.toMicro(paymentToken, endPrice);
	// Absolute end block resolved by the shared duration picker (the
	// picker fetches the current chain head and adds the d/h/m duration).
	const [endBlock, setEndBlock] = useState<number | null>(null);
	const [skipApproval, setSkipApproval] = useState(false);
	const [step, setStep] = useState<1 | 2>(1);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const nftPicked = nftContract.trim() !== '' && tokenId.trim() !== '';

	// Auctions escrow the NFT into the market contract. A soulbound token
	// can only be transferred when `from == collectionOwner` (magi_nft), so
	// once escrowed into the market it could never be settled out or
	// returned — it would be stranded forever. Block ALL soulbound here,
	// even for the collection owner. (Plain listings/bundles don't escrow,
	// so those allow the owner's soulbound.)
	const eligibleForAuction = useCallback((i: NftItem) => !i.soulbound, []);
	const AUCTION_HELP: Record<'english' | 'dutch', string> = {
		english:
			'Ascending: bidders raise the price; the highest bid at the end block wins. Settlement is permissionless — anyone can settle it once it ends.',
		dutch: 'Declining: the price falls from the start price toward the floor over time; the first bid buys instantly at the current price.'
	};

	const valid = useMemo(
		() =>
			nftContract.trim() !== '' &&
			tokenId.trim() !== '' &&
			Number(amount) > 0 &&
			paymentToken.trim() !== '' &&
			microStart !== '' && BigInt(microStart) > 0n &&
			endBlock !== null &&
			(auctionType === 'english' || (microEnd !== '' && BigInt(microEnd) > 0n)),
		[nftContract, tokenId, amount, paymentToken, microStart, microEnd, endBlock, auctionType]
	);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const { txIds } = await client.auction(username, {
				nftContract: nftContract.trim(),
				tokenId: tokenId.trim(),
				amount: Number(amount),
				paymentToken: paymentToken.trim(),
				auctionType,
				startPrice: microStart,
				endPrice: auctionType === 'dutch' ? microEnd : undefined,
				endBlock: endBlock ?? 0,
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

	return (
		<Modal
			title="Create auction"
			subtitle={
				txId
					? undefined
					: step === 1
						? 'Step 1 of 2 — choose the NFT to auction'
						: 'Step 2 of 2 — auction terms (approve + escrow signed as one batch)'
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
						label="NFT to auction"
						filterItem={eligibleForAuction}
						emptyHint="No NFTs eligible for auction — soulbound tokens can't be auctioned (the auction escrows the NFT, which would strand a soulbound token in the market)."
					/>
					<button
						type="button"
						className="magi-market-submit"
						disabled={!nftPicked}
						onClick={() => setStep(2)}
					>
						Next →
					</button>
				</>
			) : (
				<>
					<Field label="Amount">
						<TextInput type="number" inputMode="numeric" min={1} value={amount} onChange={setAmount} disabled={submitting} />
					</Field>
					<TokenPicker config={client.config} value={paymentToken} onChange={setPaymentToken} disabled={submitting} />
					<SelectPicker
						label="Auction type"
						value={auctionType}
						disabled={submitting}
						onChange={(v) => setAuctionType(v as 'english' | 'dutch')}
						options={[
							{ value: 'english', label: 'English (ascending)' },
							{ value: 'dutch', label: 'Dutch (declining)' }
						]}
					/>
					<p className="magi-market-field-hint" style={{ marginTop: '-0.4rem' }}>
						{AUCTION_HELP[auctionType]}
					</p>
					<Field label={auctionType === 'dutch' ? 'Start price (high)' : 'Reserve / start price'}>
						<TextInput inputMode="decimal" value={startPrice} onChange={setStartPrice} placeholder={tokenMeta.smallestUnit(paymentToken)} disabled={submitting} />
					</Field>
					{auctionType === 'dutch' && (
						<Field label="End price (floor)" hint="Must be lower than the start price.">
							<TextInput inputMode="decimal" value={endPrice} onChange={setEndPrice} placeholder={tokenMeta.smallestUnit(paymentToken)} disabled={submitting} />
						</Field>
					)}
					<BlockDurationInput
						client={client}
						label="Auction duration"
						value={endBlock}
						onChange={setEndBlock}
						defaultHours="1"
						disabled={submitting}
					/>
					<label className="magi-market-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
						<input type="checkbox" checked={skipApproval} onChange={(e) => setSkipApproval((e.target as HTMLInputElement).checked)} disabled={submitting} />
						<span className="magi-market-field-hint">Marketplace already approved on this collection</span>
					</label>

					{error && <p className="magi-market-status error">{error}</p>}

					<div style={{ display: 'flex', gap: 8 }}>
						<button type="button" className="magi-market-submit ghost" style={{ width: 'auto' }} disabled={submitting} onClick={() => setStep(1)}>
							← Back
						</button>
						<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
							{submitting ? 'Creating…' : 'Approve & create auction'}
						</button>
					</div>
				</>
			)}
		</Modal>
	);
}
