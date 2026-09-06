import { useState } from 'react';
import type { BundleListing, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useAffordability } from '../components/useAffordability.js';
import { FundsNote } from '../components/FundsNote.js';

export interface BuyBundleFormProps {
	client: MarketClient;
	username: string;
	bundle: BundleListing;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

const NATIVE_TOKENS = new Set(['hive', 'hbd']);

/**
 * Buy a `BundleListing` atomically — bundles are all-or-nothing, no amount
 * input. Native payment (HIVE/HBD) attaches a `transfer.allow` intent with
 * `limit = bundle.price`; magi_token payment would require an external
 * `approve(market,price)` step which the host must run before opening this
 * form.
 */
export function BuyBundleForm({ client, username, bundle, onSuccess, onClose }: BuyBundleFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const paySym = tokenMeta.symbol(bundle.paymentToken);
	const priceHuman = tokenMeta.format(bundle.paymentToken, bundle.price);
	const isNative = NATIVE_TOKENS.has((bundle.paymentToken || '').toLowerCase());
	// A bundle is one fixed price, so there is nothing to multiply.
	const funds = useAffordability(client.config, username, bundle.paymentToken, bundle.price);

	const itemsCount = bundle.items.length;
	const totalUnits = bundle.items.reduce((s, it) => s + (it.amount || 0), 0);

	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function handleSubmit() {
		if (submitting) return;
		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative
				? [{ type: 'transfer.allow' as const, args: { limit: bundle.price, token: bundle.paymentToken } }]
				: undefined;
			const op = client.ops.buyBundleOp(username, { bundleId: bundle.bundleId }, intents);
			const { txId: tx } = await client.broadcast(op);
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
			title={`Buy bundle #${bundle.bundleId}`}
			subtitle={`${itemsCount} item${itemsCount === 1 ? '' : 's'} (${totalUnits} unit${totalUnits === 1 ? '' : 's'}) · ${priceHuman} ${paySym} total`}
			onClose={onClose}
		>
			<p className="magi-market-field-hint">
				Total: {priceHuman} {paySym}
			</p>

			<FundsNote funds={funds} paymentToken={bundle.paymentToken} tokenMeta={tokenMeta} />

			{error && <p className="magi-market-status error">{error}</p>}

			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<button type="button" className="magi-market-submit" disabled={submitting || !funds.ok} onClick={handleSubmit}>
					{submitting ? 'Buying…' : 'Buy bundle'}
				</button>
			)}
		</Modal>
	);
}
