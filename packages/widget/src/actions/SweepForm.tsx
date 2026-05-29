import { useMemo, useState } from 'react';
import type { Listing, MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { SelectPicker, type SelectOption } from '../components/SelectPicker.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useCollectionMeta } from '../components/useCollectionMeta.js';

export interface SweepFormProps {
	client: MarketClient;
	username: string;
	/** All listings the panel currently has loaded — caller passes the
	 *  already-filtered set (e.g. visible Listings tab). The form picks the
	 *  collection-matched + cheapest-priced subset that fits the buyer's
	 *  total budget. */
	listings: Listing[];
	/** Pre-fill the collection picker (when the caller is sweeping from a
	 *  collection group header). */
	defaultNftContract?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Floor-sweep one collection: aggregate cheapest listings up to a
 * `maxTotal` budget and buy them all in one tx via `sweep`. The
 * contract enforces `maxTotal` itself (sum of pricePerUnit × amount
 * across all listingIds ≤ maxTotal) so the buyer is protected against
 * any seller updating their listing mid-flight. All listings must
 * share a single nftContract AND a single paymentToken (contract
 * requirement).
 */
export function SweepForm({ client, username, listings, defaultNftContract, onSuccess, onClose }: SweepFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const collMeta = useCollectionMeta(client.config);

	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	const [maxTotal, setMaxTotal] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	// Group eligible listings (active + matching collection + matching
	// payment token) cheapest-first. Sweep only operates on a SINGLE
	// payment token at a time (contract enforces this) so we pick the
	// majority payment token among matching listings; the buyer can
	// override by passing a different nftContract.
	// Never sweep your own listings — buying your own NFT is a self-deal the
	// contract rejects (`Seller cannot buy own listing`) and would abort the
	// whole multi-buy. Normalize both sides of the account string.
	const acctNorm = (s?: string) => (s ?? '').replace(/^@/, '').replace(/^hive:/, '').toLowerCase();
	const meNorm = acctNorm(username);
	const sweepable = useMemo(
		() => listings.filter((l) => l.active && acctNorm(l.seller) !== meNorm),
		[listings, meNorm]
	);

	const { selected, paymentToken, paySymbol, totalMicro } = useMemo(() => {
		const matching = sweepable.filter((l) => l.nftContract === nftContract);
		if (matching.length === 0) {
			return { selected: [], paymentToken: '', paySymbol: '', totalMicro: 0n };
		}
		// Count occurrences per paymentToken, pick majority.
		const counts = new Map<string, number>();
		for (const l of matching) counts.set(l.paymentToken, (counts.get(l.paymentToken) ?? 0) + 1);
		let pt = matching[0].paymentToken;
		let max = 0;
		for (const [k, v] of counts) if (v > max) { max = v; pt = k; }

		const eligible = matching.filter((l) => l.paymentToken === pt);

		// Sort cheapest first (per-unit). If the buyer hasn't set a budget,
		// we still show the top 10 cheapest as a preview.
		eligible.sort((a, b) => {
			try {
				const ap = BigInt(a.pricePerUnit);
				const bp = BigInt(b.pricePerUnit);
				return ap < bp ? -1 : ap > bp ? 1 : 0;
			} catch {
				return 0;
			}
		});

		let cap: bigint | null = null;
		if (maxTotal.trim() !== '') {
			try {
				cap = BigInt(tokenMeta.toMicro(pt, maxTotal.trim()) || '0');
			} catch {
				cap = null;
			}
		}

		const chosen: Listing[] = [];
		let running = 0n;
		for (const l of eligible) {
			let cost = 0n;
			try {
				cost = BigInt(l.pricePerUnit) * BigInt(l.amount);
			} catch {
				continue;
			}
			if (cap !== null && running + cost > cap) continue;
			chosen.push(l);
			running += cost;
		}

		return {
			selected: chosen,
			paymentToken: pt,
			paySymbol: tokenMeta.symbol(pt),
			totalMicro: running
		};
	}, [sweepable, nftContract, maxTotal, tokenMeta]);

	const collectionOptions = useMemo<SelectOption[]>(() => {
		const set = new Set<string>();
		for (const l of sweepable) set.add(l.nftContract);
		return Array.from(set).map((c) => {
			const owner = collMeta.owner(c);
			return {
				value: c,
				label: collMeta.name(c),
				// Owner shown as the secondary hint line in the dropdown row.
				hint: owner ? `by ${owner}` : c
			};
		});
	}, [sweepable, collMeta]);

	const NATIVE = new Set(['hive', 'hbd']);
	const isNative = NATIVE.has((paymentToken || '').toLowerCase());

	const maxTotalMicro = maxTotal.trim() === '' || !paymentToken ? null : tokenMeta.toMicro(paymentToken, maxTotal.trim());
	const valid = nftContract !== '' && selected.length > 0 && !!maxTotalMicro;

	async function handleSubmit() {
		if (!valid || submitting || !maxTotalMicro) return;
		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative
				? [{ type: 'transfer.allow' as const, args: { limit: maxTotalMicro, token: paymentToken } }]
				: undefined;
			const op = client.ops.sweepOp(
				username,
				{
					nftContract,
					listingIds: selected.map((l) => l.listingId),
					maxTotal: maxTotalMicro
				},
				intents
			);
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
			title="Sweep collection"
			subtitle="Buy the cheapest listings up to a budget — single tx, slippage-capped on-chain."
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<SelectPicker
						label="Collection"
						value={nftContract}
						options={collectionOptions}
						onChange={setNftContract}
						disabled={submitting}
					/>
					{nftContract && paymentToken && (
						<p className="magi-market-field-hint">Payment token: {paySymbol}</p>
					)}
					<Field
						label={`Max total to spend${paymentToken ? ` (${paySymbol})` : ''}`}
						hint="Sweep aborts on-chain if the cheapest-first selection exceeds this — your buyer balance is never silently over-pulled."
					>
						<TextInput inputMode="decimal" value={maxTotal} onChange={setMaxTotal} placeholder="e.g. 10.000" disabled={submitting} />
					</Field>

					{selected.length > 0 && (
						<div className="magi-market-field">
							<span className="magi-market-field-label">
								Will sweep {selected.length} listing{selected.length === 1 ? '' : 's'} for {tokenMeta.format(paymentToken, totalMicro.toString())} {paySymbol}
							</span>
							<ul className="magi-market-list" style={{ fontSize: '0.75rem', listStyle: 'none', padding: 0, margin: '0.3rem 0 0' }}>
								{selected.slice(0, 8).map((l) => (
									<li key={l.listingId}>
										#{l.tokenId} × {l.amount} @ {tokenMeta.format(paymentToken, l.pricePerUnit)} {paySymbol}
									</li>
								))}
								{selected.length > 8 && <li>… +{selected.length - 8} more</li>}
							</ul>
						</div>
					)}

					{error && <p className="magi-market-status error">{error}</p>}
					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Sweeping…' : 'Sweep'}
					</button>
				</>
			)}
		</Modal>
	);
}
