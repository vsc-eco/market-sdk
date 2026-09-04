import { useMemo, useState } from 'react';
import type { MarketClient, MintSpotListing } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useAffordability } from '../components/useAffordability.js';
import { FundsNote } from '../components/FundsNote.js';

export interface BuyMintSpotFormProps {
	client: MarketClient;
	username: string;
	listing: MintSpotListing;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

const NATIVE_TOKENS = new Set(['hive', 'hbd']);

/**
 * Buy N spots from a mint-spot listing. Native payment (HIVE/HBD) attaches
 * a `transfer.allow` intent so the contract can pull funds at execution;
 * magi_token payment is sent as a 2-step batch (token approve(market,total)
 * + buyMintSpot). The contract enforces remaining-spots and per-call caps.
 */
export function BuyMintSpotForm({ client, username, listing, onSuccess, onClose }: BuyMintSpotFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const paySym = tokenMeta.symbol(listing.paymentToken);
	const priceHuman = tokenMeta.format(listing.paymentToken, listing.pricePerSpot);
	const isNative = NATIVE_TOKENS.has((listing.paymentToken || '').toLowerCase());

	const remaining = listing.maxSpots ? Math.max(0, listing.maxSpots - listing.sold) : Infinity;
	const max = Number.isFinite(remaining) ? remaining : 999_999_999;

	const [amount, setAmount] = useState('1');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const totalMicro = useMemo(() => {
		const a = Number(amount);
		if (!Number.isInteger(a) || a <= 0) return null;
		try {
			return (BigInt(listing.pricePerSpot) * BigInt(a)).toString();
		} catch {
			return null;
		}
	}, [amount, listing.pricePerSpot]);

	const funds = useAffordability(client.config, username, listing.paymentToken, totalMicro);
	const valid =
		Number.isInteger(Number(amount)) &&
		Number(amount) > 0 &&
		Number(amount) <= max &&
		!!totalMicro &&
		funds.ok;

	async function handleSubmit() {
		if (!valid || submitting || !totalMicro) return;
		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative
				? [{ type: 'transfer.allow' as const, args: { limit: totalMicro, token: listing.paymentToken } }]
				: undefined;
			const op = client.ops.buyMintSpotOp(
				username,
				{ listingId: listing.listingId, amount: Number(amount) },
				intents
			);
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	const remainingLabel = Number.isFinite(remaining) ? `${remaining} left` : 'unlimited';

	return (
		<Modal
			title={`Mint ${listing.tokenId}`}
			subtitle={`${priceHuman} ${paySym} per spot · ${remainingLabel}`}
			onClose={onClose}
		>
			<Field label="Spots" hint={Number.isFinite(remaining) ? `Up to ${remaining}.` : 'Unlimited.'}>
				<TextInput
					type="number"
					inputMode="numeric"
					min={1}
					max={Number.isFinite(remaining) ? remaining : undefined}
					value={amount}
					onChange={setAmount}
					disabled={submitting}
				/>
			</Field>
			{totalMicro && (
				<p className="magi-market-field-hint">
					Total: {tokenMeta.format(listing.paymentToken, totalMicro)} {paySym}
				</p>
			)}

			<FundsNote funds={funds} paymentToken={listing.paymentToken} tokenMeta={tokenMeta} />

			{error && <p className="magi-market-status error">{error}</p>}

			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
					{submitting ? 'Minting…' : 'Mint'}
				</button>
			)}
		</Modal>
	);
}
