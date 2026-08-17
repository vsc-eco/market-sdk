import { useEffect, useMemo, useState } from 'react';
import type { MarketClient, Offer } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { SelectPicker } from '../components/SelectPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useUserNftHoldings } from '../components/useUserNftHoldings.js';
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
 *   remaining, and up to what they hold).
 * - Collection offer (offer.tokenId === ''): the buyer offered for any
 *   NFT in the collection; seller picks which of their held tokenIds to
 *   fulfill with.
 *
 * Both go out as the cross-contract composite, NOT a bare accept: the
 * marketplace never escrows offered-against NFTs, so `doAcceptOffer` pulls
 * the token from the accepter via magi_nft's `safeTransferFrom` and
 * preflight-aborts unless it holds an operator approval or a per-token
 * allowance ≥ the accepted amount. `client.acceptOffer` /
 * `client.acceptCollectionOffer` therefore sign
 * `approve(market, tokenId, amount)` on the NFT contract and the accept leg
 * as one batch. Tick "already approved" to drop the approve op when the
 * market is already authorized on this token/collection.
 *
 * Total payout the seller receives is `offer.pricePerUnit * amount`
 * minus fee + royalty — feeBps/royaltyBps snapshots locked at offer
 * time, so the displayed number is what the seller actually gets.
 */
export function AcceptOfferForm({ client, username, offer, onSuccess, onClose }: AcceptOfferFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const holdings = useUserNftHoldings(client.config, username);
	const isCollection = offer.tokenId === '';
	const paySym = tokenMeta.symbol(offer.paymentToken);
	const pricePerHuman = tokenMeta.format(offer.paymentToken, offer.pricePerUnit);

	const [amount, setAmount] = useState('1');
	const [tokenId, setTokenId] = useState('');
	const [skipApproval, setSkipApproval] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// TokenIds of this collection the seller actually holds. For a collection
	// offer these are the only valid fulfilment choices; the panel already
	// hides Accept when this is empty, so an empty list here means the
	// holdings lookup is still in flight or the wallet changed underneath.
	const heldIds = useMemo(
		() => (isCollection ? holdings.tokenIdsIn(offer.nftContract) : []),
		[isCollection, holdings, offer.nftContract]
	);

	// Auto-select when there's exactly one candidate — the common case for a
	// collection offer against a small holding.
	useEffect(() => {
		if (isCollection && tokenId === '' && heldIds.length === 1) setTokenId(heldIds[0]);
	}, [isCollection, tokenId, heldIds]);

	// Units of the token being delivered that the seller holds — the accept
	// amount is capped by this as well as by the offer's remaining amount
	// ("Insufficient NFT balance to fulfill offer" otherwise).
	const effectiveTokenId = isCollection ? tokenId.trim() : offer.tokenId;
	const heldUnits = effectiveTokenId
		? holdings.balanceOf(offer.nftContract, effectiveTokenId)
		: null;
	const maxAcceptable =
		heldUnits === null ? offer.amount : Math.min(offer.amount, Number(heldUnits));

	const amtNum = Number(amount);
	const validAmount = Number.isInteger(amtNum) && amtNum > 0 && amtNum <= maxAcceptable;
	const validTokenId = isCollection
		? effectiveTokenId !== '' && assertValidTokenIdChars(effectiveTokenId)
		: true;
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
			const p = {
				offerId: offer.offerId,
				amount: amtNum,
				nftContract: offer.nftContract,
				tokenId: effectiveTokenId,
				skipApproval
			};
			const { txIds } = isCollection
				? await client.acceptCollectionOffer(username, p)
				: await client.acceptOffer(username, p);
			// The accept leg is last in the batch — report its tx as the result.
			const last = txIds[txIds.length - 1];
			setTxId(last);
			onSuccess?.(last);
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
						heldIds.length > 0 ? (
							<SelectPicker
								label="Token ID to deliver"
								value={tokenId}
								options={heldIds.map((id) => {
									const b = holdings.balanceOf(offer.nftContract, id);
									return { value: id, label: `#${id}`, hint: b ? `you hold ×${b}` : undefined };
								})}
								onChange={setTokenId}
								disabled={submitting}
							/>
						) : (
							<Field
								label="Token ID to deliver"
								hint="Which NFT from this collection to sell against the offer. Only tokens you hold can fulfill it."
							>
								<TextInput value={tokenId} onChange={setTokenId} placeholder="e.g. nft19" disabled={submitting} />
							</Field>
						)
					)}
					<Field
						label="Amount"
						hint={
							heldUnits !== null && Number(heldUnits) < offer.amount
								? `Up to ${maxAcceptable} — the offer wants ${offer.amount} but you hold ×${heldUnits}.`
								: `Up to ${maxAcceptable}.`
						}
					>
						<TextInput
							type="number"
							inputMode="numeric"
							min={1}
							max={maxAcceptable}
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
					<label className="magi-market-field" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
						<input
							type="checkbox"
							checked={skipApproval}
							onChange={(e) => setSkipApproval((e.target as HTMLInputElement).checked)}
							disabled={submitting}
						/>
						<span className="magi-market-field-hint">Marketplace already approved for this NFT (skip the approve op)</span>
					</label>
					{error && <p className="magi-market-status error">{error}</p>}
					<button
						type="button"
						className="magi-market-submit"
						disabled={!valid || submitting}
						onClick={handleSubmit}
					>
						{submitting ? 'Accepting…' : skipApproval ? 'Accept offer' : 'Approve & accept offer'}
					</button>
				</>
			)}
		</Modal>
	);
}
