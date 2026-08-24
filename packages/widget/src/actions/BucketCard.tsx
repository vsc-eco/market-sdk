import { useEffect, useMemo, useState } from 'react';
import type { BucketEntry, BucketListing, BucketStack, MarketClient } from '@vsc.eco/market-sdk';
import { createNftClient, 	type NftItem
} from '@vsc.eco/token-sdk';
import { tokenConfigFrom } from '../components/tokenConfig.js';
import { Spinner } from '../components/Spinner.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import magiSvg from '../assets/magi.svg';

export interface BucketCardProps {
	client: MarketClient;
	bucket: BucketListing;
	mine: boolean;
	username?: string;
	busy: boolean;
	onDraw: () => void;
	onBuyPack: () => void;
	onCancel: () => void;
	onOpenNft: (nftContract: string, tokenId: string) => void;
}

/**
 * One entry, with what is still drawable and how likely it is.
 *
 * The odds are shown because they can be: the CONTRACT picks the unit, so
 * publishing the stack costs the seller nothing and is the only thing that makes
 * a blind draw checkable. A bucket that hid its contents would be asking for
 * trust it has not earned.
 */
function EntryTile({
	imageUrl,
	entry,
	chance,
	onOpen
}: {
	imageUrl: string | null;
	entry: BucketEntry;
	chance: number | null;
	onOpen: () => void;
}) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	const gone = entry.amountLeft === 0;
	return (
		<div className="magi-market-tile" style={gone ? { opacity: 0.45 } : undefined}>
			<div
				className={`magi-market-tile-image ${useFallback ? 'fallback' : ''}`}
				role="button"
				tabIndex={0}
				title="View NFT details"
				onClick={onOpen}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						onOpen();
					}
				}}
			>
				{useFallback ? (
					<img src={magiSvg} alt={`#${entry.tokenId}`} className="magi-market-tile-fallback-img" />
				) : (
					<img
						src={imageUrl as string}
						alt={`#${entry.tokenId}`}
						loading="lazy"
						decoding="async"
						onError={() => setImgFailed(true)}
					/>
				)}
			</div>
			<div className="magi-market-tile-id" title={entry.tokenId}>
				#{entry.tokenId}
			</div>
			<div className="magi-market-tile-row">
				<span className="magi-market-tile-tag">
					{gone ? 'gone' : `${entry.amountLeft} left`}
				</span>
				{chance !== null && !gone && (
					<span className="magi-market-tile-tag" title="Chance per draw from this stack">
						{chance < 0.1 ? '<0.1' : chance.toFixed(1)}%
					</span>
				)}
			</div>
		</div>
	);
}

/**
 * A bucket rendered as a collapsible group: the header carries the price(s) and
 * the draw actions, the body shows what is still inside with per-stack odds.
 *
 * Stacks are surfaced explicitly rather than folded into one number because a
 * ("stack" is the user-facing name for what the contract's wire format calls a
 * stack — `entries[].stack`, `packDraws[i]` — kept distinct from liquidity stacks.)
 * bucket with guaranteed slots drains UNEVENLY — the guaranteed stack empties
 * first and strands the rest — so "units left" alone can suggest a pack is
 * available when it cannot actually be filled.
 */
export function BucketCard({
	client,
	bucket,
	mine,
	username,
	busy,
	onDraw,
	onBuyPack,
	onCancel,
	onOpenNft
}: BucketCardProps) {
	const tokenMeta = useTokenMeta(client.config);
	const tokenConfig = useMemo(
		() => tokenConfigFrom(client.config),
		[client.config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [entries, setEntries] = useState<BucketEntry[] | null>(null);
	const [stacks, setStacks] = useState<BucketStack[]>([]);
	const [images, setImages] = useState<Map<string, string | null>>(new Map());

	useEffect(() => {
		let cancelled = false;
		(async () => {
			let rows: BucketEntry[];
			try {
				rows = await client.provider.getBucketEntries(bucket.bucketId);
			} catch {
				if (!cancelled) setEntries([]);
				return;
			}
			if (cancelled) return;
			setEntries(rows); // commit before image resolution, which must not undo it
			try {
				const p = await client.provider.getBucketStacks(bucket.bucketId);
				if (!cancelled) setStacks(p);
			} catch {
				/* odds fall back to per-bucket */
			}
			if (!rows.length) return;
			try {
				const map = await nft.nft.provider.resolveNftImages(
					rows.map((e) => ({ contractId: bucket.nftContract, tokenId: e.tokenId }) as NftItem)
				);
				if (!cancelled) setImages(map);
			} catch {
				/* tiles fall back to the logo */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client, nft, bucket]);

	const stackUnits = useMemo(() => {
		const m = new Map<number, number>();
		for (const p of stacks) m.set(p.stack, p.unitsLeft);
		return m;
	}, [stacks]);

	/** Chance of drawing this entry, given a draw from its own stack. */
	const chanceOf = (e: BucketEntry): number | null => {
		const total = stackUnits.get(e.stack);
		if (!total) return null;
		return (e.amountLeft / total) * 100;
	};

	const singlesOn = bucket.pricePerDraw !== '0' && bucket.pricePerDraw !== '';
	const packsOn = bucket.pricePerPack !== '0' && bucket.pricePerPack !== '';

	/** A pack needs every promised slot filled, so check stacks not the total. */
	const packFillable = useMemo(() => {
		if (!packsOn || bucket.packDraws.length === 0) return false;
		return bucket.packDraws.every((need: number, stack: number) => need === 0 || (stackUnits.get(stack) ?? 0) >= need);
	}, [packsOn, bucket.packDraws, stackUnits]);

	const sym = tokenMeta.symbol(bucket.paymentToken);
	const action = (
		<>
			{singlesOn && (
				<span className="magi-market-bucketcard-price">
					{tokenMeta.format(bucket.paymentToken, bucket.pricePerDraw)} {sym}<span className="magi-market-tile-per">/draw</span>
				</span>
			)}
			{packsOn && (
				<span className="magi-market-bucketcard-price">
					{tokenMeta.format(bucket.paymentToken, bucket.pricePerPack)} {sym}<span className="magi-market-tile-per">/pack</span>
				</span>
			)}
			{mine ? (
				<button
					type="button"
					className="magi-market-submit ghost"
					disabled={busy}
					onClick={onCancel}
				>
					{busy ? 'Closing…' : 'Close'}
				</button>
			) : (
				<>
					{singlesOn && (
						<button
							type="button"
							className="magi-market-submit"
							disabled={!username || busy || bucket.unitsLeft === 0}
							onClick={onDraw}
						>
							Draw one
						</button>
					)}
					{packsOn && (
						<button
							type="button"
							className="magi-market-submit"
							disabled={!username || busy || !packFillable}
							title={packFillable ? undefined : 'A guaranteed stack has run out'}
							onClick={onBuyPack}
						>
							Buy pack ({bucket.packSize})
						</button>
					)}
				</>
			)}
		</>
	);

	return (
		// No collapsible header here: this card only ever renders inside the
		// sale's own panel, which already carries its name — and cramming a
		// title, two prices and two buttons into one header row is what broke
		// the layout on a phone. Prices and actions get a row that wraps.
		<div className="magi-market-bucketcard">
			<div className="magi-market-bucketcard-bar">{action}</div>
			<div className="magi-market-row-sub" style={{ padding: '0 0.2rem 0.5rem' }}>
				{bucket.unitsLeft} of {bucket.unitsStocked} left
				{bucket.packDraws.length > 1 && (
					<> · pack: {bucket.packDraws.map((n: number, i: number) => `${n} from stack ${i + 1}`).join(' + ')}</>
				)}
				{stacks.length > 1 && (
					<>
						{' '}
						·{' '}
						{stacks
							.slice()
							.sort((a, b) => a.stack - b.stack)
							.map((p) => `stack ${p.stack + 1}: ${p.unitsLeft}`)
							.join(', ')}
					</>
				)}
				{bucket.unitsDropped > 0 && (
					<> · {bucket.unitsDropped} withdrawn by the seller</>
				)}
			</div>
			{entries === null ? (
				<Spinner label="Loading bucket contents…" />
			) : entries.length === 0 ? (
				<div className="magi-market-state">Contents not indexed yet.</div>
			) : (
				// The tiles lost their grid when this card stopped being wrapped
				// in a CollectionGroup — which supplied one — so they stacked one
				// per row. Two per row: these carry a picture, a count and the
				// odds, and that does not survive being squeezed narrower.
				<div className="magi-market-grid magi-market-bucketcard-grid">
				{entries
					.slice()
					.sort((a, b) => a.stack - b.stack || b.amountLeft - a.amountLeft)
					.map((e) => (
						<EntryTile
							key={`${e.stack}:${e.tokenId}`}
							imageUrl={images.get(`${bucket.nftContract}:${e.tokenId}`) ?? null}
							entry={e}
							chance={chanceOf(e)}
							onOpen={() => onOpenNft(bucket.nftContract, e.tokenId)}
						/>
					))}
				</div>
			)}
		</div>
	);
}
