import { useMemo, useState } from 'react';
import type { Listing, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';

export interface BuyFormProps {
	client: MarketClient;
	username: string;
	listing: Listing;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Buy units of a fixed-price listing. For a magi_token-style payment token
 * the marketplace pulls funds via escrowIn, so this uses the cross-contract
 * `buyWithPayment` (token `approve(market,total)` + `buy`, batched). For a
 * native (HBD/HIVE) payment token the host should instead pass a
 * `transfer.allow` intent to `client.ops.buyOp` — surfaced here as the
 * "native payment" toggle which switches to a single intent-bearing op.
 */
const NATIVE_TOKENS = new Set(['hive', 'hbd']);

export function BuyForm({ client, username, listing, onSuccess, onClose }: BuyFormProps) {
	const [amount, setAmount] = useState('1');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const tokenMeta = useTokenMeta(client.config);
	const paySym = tokenMeta.symbol(listing.paymentToken);
	const priceHuman = tokenMeta.format(listing.paymentToken, listing.pricePerUnit);
	// Native (HBD/HIVE) is the contract's `hive.draw` path — we know from
	// the listing's payment token whether to send a `transfer.allow` intent
	// or to go through the magi_token approve + buy flow. The user has
	// nothing to decide; the checkbox the form used to render here was a
	// leak of the implementation.
	const isNative = NATIVE_TOKENS.has((listing.paymentToken || '').toLowerCase());

	const total = useMemo(() => {
		const a = Number(amount);
		if (!Number.isFinite(a) || a <= 0) return null;
		try {
			// pricePerUnit is a decimal string; total = price × amount, kept
			// as a string the contract re-parses (no float rounding).
			const [i = '0', f = ''] = listing.pricePerUnit.split('.');
			const scale = BigInt('1' + '0'.repeat(f.length));
			const unit = BigInt(i) * scale + BigInt(f || '0');
			const t = unit * BigInt(a);
			const s = t.toString().padStart(f.length + 1, '0');
			return f.length ? `${s.slice(0, -f.length)}.${s.slice(-f.length)}` : s;
		} catch {
			return null;
		}
	}, [amount, listing.pricePerUnit]);

	const valid = Number.isInteger(Number(amount)) && Number(amount) > 0 && Number(amount) <= listing.amount;

	async function handleSubmit() {
		if (!valid || submitting || !total) return;
		setSubmitting(true);
		setError(null);
		try {
			let last: string;
			if (isNative) {
				const op = client.ops.buyOp(
					username,
					{ listingId: listing.listingId, amount: Number(amount) },
					[{ type: 'transfer.allow', args: { limit: total, token: listing.paymentToken } }]
				);
				last = (await client.broadcast(op)).txId;
			} else {
				const { txIds } = await client.buyWithPayment(username, {
					listingId: listing.listingId,
					amount: Number(amount),
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
			title={`Buy #${listing.tokenId}`}
			subtitle={`${priceHuman} ${paySym} per unit · ${listing.amount} available`}
			onClose={onClose}
		>
			<Field label="Amount" hint={`Up to ${listing.amount}.`}>
				<TextInput type="number" inputMode="numeric" min={1} max={listing.amount} value={amount} onChange={setAmount} disabled={submitting} />
			</Field>
			{total && <p className="magi-market-field-hint">Total: {tokenMeta.format(listing.paymentToken, total)} {paySym}</p>}

			{error && <p className="magi-market-status error">{error}</p>}

			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
					{submitting ? 'Buying…' : 'Buy'}
				</button>
			)}
		</Modal>
	);
}
