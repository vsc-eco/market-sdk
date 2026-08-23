import { useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { TokenPicker } from '../components/TokenPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { NftMultiPicker, type NftMultiPick } from '../components/NftMultiPicker.js';
import { canTransferNft } from '../components/nftFilters.js';

export interface ListBundleFormProps {
	client: MarketClient;
	username: string;
	defaultNftContract?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

const MAX_ITEMS = 20;

/**
 * Create a single-collection atomic bundle listing. The user picks NFTs
 * from their wallet via `NftMultiPicker`; the picker locks subsequent
 * selections to the first picked collection (the contract requires a
 * single nftContract per bundle). The marketplace must already be
 * approved as an operator on that nftContract; this form does NOT
 * emit the approval leg.
 */
export function ListBundleForm({
	client,
	username,
	defaultNftContract,
	onSuccess,
	onClose
}: ListBundleFormProps) {
	const tokenMeta = useTokenMeta(client.config);

	const [picks, setPicks] = useState<NftMultiPick[]>([]);
	const [paymentToken, setPaymentToken] = useState('');
	const [price, setPrice] = useState('');
	const [skipApproval, setSkipApproval] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// The picker locks the collection; first pick wins. (defaultNftContract
	// pins it before any pick, useful when launched from a collection
	// group header.)
	const lockCollection = defaultNftContract ?? picks[0]?.nftContract;
	const microPrice = paymentToken && price.trim() !== '' ? tokenMeta.toMicro(paymentToken, price.trim()) : '';

	const valid =
		picks.length > 0 &&
		picks.length <= MAX_ITEMS &&
		paymentToken.trim() !== '' &&
		microPrice !== '' &&
		(() => {
			try {
				return BigInt(microPrice) > 0n;
			} catch {
				return false;
			}
		})();

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const nftContract = picks[0].nftContract;
			// One `approve` per item rather than setApprovalForAll: the contract
			// takes a per-token allowance, so listing a bundle need not hand over
			// the whole collection.
			const { txIds } = await client.listBundle(username, {
				nftContract,
				items: picks.map((p) => ({ tokenId: p.tokenId, amount: p.amount })),
				paymentToken: paymentToken.trim(),
				price: microPrice,
				expirationBlock: 0,
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

	return (
		<Modal
			title="List a bundle"
			subtitle="All-or-nothing atomic sale of multiple NFTs from one collection."
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<NftMultiPicker
						config={client.config}
						username={username}
						value={picks}
						onChange={setPicks}
						label={`Pick NFTs to bundle (max ${MAX_ITEMS})`}
						lockCollection={lockCollection}
						filterItem={(i) => canTransferNft(i, username)}
						max={MAX_ITEMS}
						disabled={submitting}
					/>

					<TokenPicker
						config={client.config}
						value={paymentToken}
						onChange={setPaymentToken}
						disabled={submitting}
					/>
					<Field label="Bundle price (whole bundle, not per item)">
						<TextInput
							inputMode="decimal"
							value={price}
							onChange={setPrice}
							placeholder={tokenMeta.smallestUnit(paymentToken)}
							disabled={submitting}
						/>
					</Field>

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
						{skipApproval
							? 'One signature: the listing itself.'
							: `${picks.length + 1} signatures: one approval per NFT, then the listing.`}
					</p>

					{error && <p className="magi-market-status error">{error}</p>}

					<button
						type="button"
						className="magi-market-submit"
						disabled={!valid || submitting}
						onClick={handleSubmit}
					>
						{submitting ? 'Listing…' : `List bundle (${picks.length} item${picks.length === 1 ? '' : 's'})`}
					</button>
				</>
			)}
		</Modal>
	);
}
