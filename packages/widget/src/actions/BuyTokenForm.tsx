import { useMemo, useState } from 'react';
import type { MarketClient, TokenListing } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useAffordability } from '../components/useAffordability.js';
import { FundsNote } from '../components/FundsNote.js';

export interface BuyTokenFormProps {
	client: MarketClient;
	username: string;
	listing: TokenListing;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Buy an amount of a token-sale listing. Amounts/prices are integer unit
 * strings, so total = price × amount is exact BigInt. For a magi_token
 * payment token this batches `approve(market,total)` + `buyToken`; for a
 * native (HBD/HIVE) payment token it sends a single `buyToken` op with a
 * `transfer.allow` intent.
 */
const NATIVE_TOKENS = new Set(['hive', 'hbd']);

export function BuyTokenForm({ client, username, listing, onSuccess, onClose }: BuyTokenFormProps) {
	const [amount, setAmount] = useState('1');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tokenMeta = useTokenMeta(client.config);
	const paySym = tokenMeta.symbol(listing.paymentToken);
	const assetSym = tokenMeta.symbol(listing.tokenContract);
	const isNative = NATIVE_TOKENS.has((listing.paymentToken || '').toLowerCase());

	const isPosInt = (s: string) => /^\d+$/.test(s.trim()) && BigInt(s.trim()) > 0n;
	const remaining = (() => {
		try {
			return BigInt(listing.amount);
		} catch {
			return 0n;
		}
	})();

	const total = useMemo(() => {
		if (!isPosInt(amount)) return null;
		try {
			return (BigInt(listing.pricePerUnit) * BigInt(amount.trim())).toString();
		} catch {
			return null;
		}
	}, [amount, listing.pricePerUnit]);

	const funds = useAffordability(client.config, username, listing.paymentToken, total);
	const valid = isPosInt(amount) && BigInt(amount.trim()) <= remaining && total !== null && funds.ok;

	async function handleSubmit() {
		if (!valid || submitting || !total) return;
		setSubmitting(true);
		setError(null);
		try {
			let last: string;
			if (isNative) {
				const op = client.ops.buyTokenOp(
					username,
					{ listingId: listing.listingId, amount: amount.trim() },
					[{ type: 'transfer.allow', args: { limit: total, token: listing.paymentToken } }]
				);
				last = (await client.broadcast(op)).txId;
			} else {
				const { txIds } = await client.buyTokenWithPayment(username, {
					listingId: listing.listingId,
					amount: amount.trim(),
					paymentToken: listing.paymentToken,
					total
				});
				last = txIds[txIds.length - 1];
			}
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
			title={`Buy ${assetSym}`}
			subtitle={`${tokenMeta.format(listing.paymentToken, listing.pricePerUnit)} ${paySym} per unit · ${listing.amount} ${assetSym} available`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<Field label="Amount to buy" hint={`Up to ${listing.amount} ${assetSym} (integer units).`}>
						<TextInput type="number" inputMode="numeric" min={1} value={amount} onChange={setAmount} disabled={submitting} />
					</Field>
					{total && <p className="magi-market-field-hint">Total: {tokenMeta.format(listing.paymentToken, total)} {paySym}</p>}

					<FundsNote funds={funds} paymentToken={listing.paymentToken} tokenMeta={tokenMeta} />
					{error && <p className="magi-market-status error">{error}</p>}

					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Buying…' : 'Buy'}
					</button>
				</>
			)}
		</Modal>
	);
}
