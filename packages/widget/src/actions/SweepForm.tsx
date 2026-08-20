import { useEffect, useMemo, useState } from 'react';
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
 * any seller updating their listing mid-flight.
 *
 * All listings must share a single nftContract (the contract checks it) and
 * a single paymentToken (it does NOT — `maxTotal` is one bare number, so a
 * mixed-token sweep would total two currencies into it and pull both. The
 * one-token filter here is what keeps the cap meaningful).
 */
export function SweepForm({ client, username, listings, defaultNftContract, onSuccess, onClose }: SweepFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const collMeta = useCollectionMeta(client.config);

	const [nftContract, setNftContract] = useState(defaultNftContract ?? '');
	const [payToken, setPayToken] = useState('');
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

	// One sweep spends ONE asset: the budget is a single number, and each
	// listing is paid in whatever token it was priced in, so mixing them
	// would compare a sum of two currencies against one cap. The choice is
	// the buyer's, not a majority vote — a collection priced mostly in HBD
	// can still hold the HIVE listing you actually came for.
	const tokenOptions = useMemo<SelectOption[]>(() => {
		const counts = new Map<string, number>();
		for (const l of sweepable) {
			if (l.nftContract !== nftContract) continue;
			counts.set(l.paymentToken, (counts.get(l.paymentToken) ?? 0) + 1);
		}
		return Array.from(counts.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([t, n]) => ({
				value: t,
				label: tokenMeta.symbol(t),
				hint: `${n} listing${n === 1 ? '' : 's'}`
			}));
	}, [sweepable, nftContract, tokenMeta]);

	// Preselect the asset most of the collection is priced in, and repair a
	// selection that the current collection has no listings in. Written as a
	// correction rather than a reset so re-running it (token metadata arrives
	// async, which rebuilds the options) cannot clobber a deliberate choice.
	useEffect(() => {
		if (tokenOptions.length === 0) {
			if (payToken !== '') setPayToken('');
			return;
		}
		if (!tokenOptions.some((o) => o.value === payToken)) setPayToken(tokenOptions[0].value);
	}, [tokenOptions, payToken]);

	const { selected, paymentToken, paySymbol, totalMicro } = useMemo(() => {
		const matching = sweepable.filter((l) => l.nftContract === nftContract);
		if (matching.length === 0 || payToken === '') {
			return { selected: [], paymentToken: '', paySymbol: '', totalMicro: 0n };
		}
		const pt = payToken;
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
	}, [sweepable, nftContract, payToken, maxTotal, tokenMeta]);

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
	const isNative = NATIVE.has((payToken || '').toLowerCase());

	const maxTotalMicro = maxTotal.trim() === '' || !payToken ? null : tokenMeta.toMicro(payToken, maxTotal.trim());
	const valid = nftContract !== '' && selected.length > 0 && !!maxTotalMicro;

	async function handleSubmit() {
		if (!valid || submitting || !maxTotalMicro) return;
		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative
				? [{ type: 'transfer.allow' as const, args: { limit: maxTotalMicro, token: payToken } }]
				: undefined;
			const op = client.ops.sweepOp(
				username,
				{
					nftContract,
					listingIds: selected.map((l) => l.listingId),
					maxTotal: maxTotalMicro,
					// Sent explicitly: the contract otherwise takes the first
					// listing's token, and the buyer's budget is denominated in
					// what they picked, not in whatever sorted first.
					paymentToken: payToken
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
			subtitle="Buy the cheapest SINGLE listings up to a budget — one tx, slippage-capped on-chain. Bundles, packs and mint spots are bought individually."
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
					{nftContract !== '' && (
						<SelectPicker
							label="Pay with"
							value={payToken}
							options={tokenOptions}
							onChange={setPayToken}
							disabled={submitting}
						/>
					)}
					{nftContract !== '' && tokenOptions.length === 0 && (
						<p className="magi-market-field-hint">
							Nothing to sweep in this collection right now.
						</p>
					)}
					{tokenOptions.length > 1 && (
						<p className="magi-market-field-hint">
							This collection is priced in {tokenOptions.length} assets. A sweep spends one of
							them — listings in the others are left alone.
						</p>
					)}
					<Field
						label={`Max total to spend${payToken ? ` (${tokenMeta.symbol(payToken)})` : ''}`}
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
