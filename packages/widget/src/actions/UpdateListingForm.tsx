import { useState } from 'react';
import type { Listing, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';

export interface UpdateListingFormProps {
	client: MarketClient;
	username: string;
	listing: Listing;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Seller-side price update for an existing fixed-price listing. Only the
 * `pricePerUnit` is editable (the contract's `updateListing` payload
 * accepts a single new price). Amount/payment-token/expiration are not
 * changeable without delisting + re-listing.
 */
export function UpdateListingForm({ client, username, listing, onSuccess, onClose }: UpdateListingFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const paySym = tokenMeta.symbol(listing.paymentToken);
	const currentHuman = tokenMeta.format(listing.paymentToken, listing.pricePerUnit);

	const [price, setPrice] = useState(currentHuman);
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const microPrice = price.trim() === '' ? null : tokenMeta.toMicro(listing.paymentToken, price.trim());
	const valid = !!microPrice && (() => {
		try {
			return BigInt(microPrice) > 0n;
		} catch {
			return false;
		}
	})();

	async function handleSubmit() {
		if (!valid || submitting || !microPrice) return;
		setSubmitting(true);
		setError(null);
		try {
			const op = client.ops.updateListingOp(username, {
				listingId: listing.listingId,
				newPrice: microPrice
			});
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal
			title={`Update listing #${listing.listingId}`}
			subtitle={`Currently ${currentHuman} ${paySym} per unit · ${listing.amount} available`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<Field label={`New price per unit (${paySym})`} hint="Human decimal — converted to the token's micro-units on submit.">
						<TextInput inputMode="decimal" value={price} onChange={setPrice} placeholder={currentHuman} disabled={submitting} />
					</Field>
					{error && <p className="magi-market-status error">{error}</p>}
					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Updating…' : 'Update listing'}
					</button>
				</>
			)}
		</Modal>
	);
}
