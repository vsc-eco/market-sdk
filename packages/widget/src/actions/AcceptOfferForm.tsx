import { useMemo, useState } from 'react';
import type { MarketClient, Offer } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { assertValidTokenIdChars } from '../components/tokenIdValid.js';

export interface AcceptOfferFormProps {
	client: MarketClient;
	username: string;
	offer: Offer;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Seller-side accept of a buyer's offer. Two cases:
 *
 * - Token-specific offer (offer.tokenId !== ''): the buyer already chose
 *   the NFT they want; seller just confirms the amount (up to offer
 *   remaining). Calls `acceptOfferOp`.
 * - Collection offer (offer.tokenId === ''): the buyer offered for any
 *   NFT in the collection; seller picks which tokenId they want to
 *   fulfill with. Calls `acceptCollectionOfferOp`.
 *
 * Total payout the seller receives is `offer.pricePerUnit * amount`
 * minus fee + royalty — feeBps/royaltyBps snapshots locked at offer
 * time, so the displayed number is what the seller actually gets.
 */
export function AcceptOfferForm({ client, username, offer, onSuccess, onClose }: AcceptOfferFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const isCollection = offer.tokenId === '';
	const paySym = tokenMeta.symbol(offer.paymentToken);
	const pricePerHuman = tokenMeta.format(offer.paymentToken, offer.pricePerUnit);

	const [amount, setAmount] = useState('1');
	const [tokenId, setTokenId] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const amtNum = Number(amount);
	const validAmount = Number.isInteger(amtNum) && amtNum > 0 && amtNum <= offer.amount;
	const validTokenId = isCollection ? tokenId.trim() !== '' && assertValidTokenIdChars(tokenId.trim()) : true;
	const valid = validAmount && validTokenId;

	const totalMicro = useMemo(() => {
		if (!validAmount) return null;
		try {
			return (BigInt(offer.pricePerUnit) * BigInt(amtNum)).toString();
		} catch {
			return null;
		}
	}, [offer.pricePerUnit, amtNum, validAmount]);

	async function handleSubmit() {
		if (!valid || submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const op = isCollection
				? client.ops.acceptCollectionOfferOp(username, {
						offerId: offer.offerId,
						tokenId: tokenId.trim(),
						amount: amtNum
					})
				: client.ops.acceptOfferOp(username, { offerId: offer.offerId, amount: amtNum });
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	}

	const target = isCollection
		? `any NFT from ${offer.nftContract}`
		: `#${offer.tokenId}`;

	return (
		<Modal
			title={isCollection ? 'Accept collection offer' : `Accept offer on #${offer.tokenId}`}
			subtitle={`${pricePerHuman} ${paySym} per unit · buyer offered for ${target} · up to ${offer.amount}`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					{isCollection && (
						<Field
							label="Token ID to deliver"
							hint="Pick which NFT from this collection you want to sell against the offer."
						>
							<TextInput value={tokenId} onChange={setTokenId} placeholder="e.g. nft19" disabled={submitting} />
						</Field>
					)}
					<Field label="Amount" hint={`Up to ${offer.amount}.`}>
						<TextInput
							type="number"
							inputMode="numeric"
							min={1}
							max={offer.amount}
							value={amount}
							onChange={setAmount}
							disabled={submitting}
						/>
					</Field>
					{totalMicro && (
						<p className="magi-market-field-hint">
							You receive (before fee + royalty): {tokenMeta.format(offer.paymentToken, totalMicro)} {paySym}
						</p>
					)}
					{error && <p className="magi-market-status error">{error}</p>}
					<button
						type="button"
						className="magi-market-submit"
						disabled={!valid || submitting}
						onClick={handleSubmit}
					>
						{submitting ? 'Accepting…' : 'Accept offer'}
					</button>
				</>
			)}
		</Modal>
	);
}
