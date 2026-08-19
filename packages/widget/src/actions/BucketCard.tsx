import { useEffect, useMemo, useState } from 'react';
import type { BucketEntry, BucketListing, BucketPool, MarketClient } from '@vsc.eco/market-sdk';
import {
	createNftClient,
	MAINNET_CONFIG as TOKEN_MAINNET,
	TESTNET_CONFIG as TOKEN_TESTNET,
	type NftItem
} from '@vsc.eco/token-sdk';
import { CollectionGroup } from '../components/CollectionGroup.js';
import { Spinner } from '../components/Spinner.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useCollectionMeta } from '../components/useCollectionMeta.js';
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
 * publishing the pool costs the seller nothing and is the only thing that makes
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
					<span className="magi-market-tile-tag" title="Chance per draw from this pool">
						{chance < 0.1 ? '<0.1' : chance.toFixed(1)}%
					</span>
				)}
			</div>
		</div>
	);
}

/**
 * A bucket rendered as a collapsible group: the header carries the price(s) and
 * the draw actions, the body shows what is still inside with per-pool odds.
 *
 * Pools are surfaced explicitly rather than folded into one number because a
 * bucket with guaranteed slots drains UNEVENLY — the guaranteed pool empties
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
	const collMeta = useCollectionMeta(client.config);
	const tokenConfig = useMemo(
		() => (client.config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET),
		[client.config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [entries, setEntries] = useState<BucketEntry[] | null>(null);
	const [pools, setPools] = useState<BucketPool[]>([]);
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
				const p = await client.provider.getBucketPools(bucket.bucketId);
				if (!cancelled) setPools(p);
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

	const poolUnits = useMemo(() => {
		const m = new Map<number, number>();
		for (const p of pools) m.set(p.pool, p.unitsLeft);
		return m;
	}, [pools]);

	/** Chance of drawing this entry, given a draw from its own pool. */
	const chanceOf = (e: BucketEntry): number | null => {
		const total = poolUnits.get(e.pool);
		if (!total) return null;
		return (e.amountLeft / total) * 100;
	};

	const singlesOn = bucket.pricePerDraw !== '0' && bucket.pricePerDraw !== '';
	const packsOn = bucket.pricePerPack !== '0' && bucket.pricePerPack !== '';

	/** A pack needs every promised slot filled, so check pools not the total. */
	const packFillable = useMemo(() => {
		if (!packsOn || bucket.packDraws.length === 0) return false;
		return bucket.packDraws.every((need: number, pool: number) => need === 0 || (poolUnits.get(pool) ?? 0) >= need);
	}, [packsOn, bucket.packDraws, poolUnits]);

	const sym = tokenMeta.symbol(bucket.paymentToken);
	const action = (
		<>
			{singlesOn && (
				<span className="magi-market-row-price" style={{ fontSize: '0.82rem', marginRight: '0.2rem' }}>
					{tokenMeta.format(bucket.paymentToken, bucket.pricePerDraw)} {sym}/draw
				</span>
			)}
			{packsOn && (
				<span className="magi-market-row-price" style={{ fontSize: '0.82rem', marginRight: '0.2rem' }}>
					{tokenMeta.format(bucket.paymentToken, bucket.pricePerPack)} {sym}/pack
				</span>
			)}
			{mine ? (
				<button
					type="button"
					className="magi-market-submit ghost"
					style={{ width: 'auto', padding: '0.35rem 0.8rem' }}
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
							style={{ width: 'auto', padding: '0.35rem 0.8rem' }}
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
							style={{ width: 'auto', padding: '0.35rem 0.8rem' }}
							disabled={!username || busy || !packFillable}
							title={packFillable ? undefined : 'A guaranteed slot has run out'}
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
		<CollectionGroup
			collectionName={`Bucket #${bucket.bucketId} · ${collMeta.name(bucket.nftContract)}`}
			count={bucket.unitsLeft}
			action={action}
		>
			<div className="magi-market-row-sub" style={{ padding: '0 0.2rem 0.5rem' }}>
				{bucket.unitsLeft} of {bucket.unitsStocked} left
				{bucket.packDraws.length > 1 && (
					<> · pack: {bucket.packDraws.map((n: number, i: number) => `${n} from pool ${i}`).join(' + ')}</>
				)}
				{pools.length > 1 && (
					<>
						{' '}
						·{' '}
						{pools
							.slice()
							.sort((a, b) => a.pool - b.pool)
							.map((p) => `pool ${p.pool}: ${p.unitsLeft}`)
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
				entries
					.slice()
					.sort((a, b) => a.pool - b.pool || b.amountLeft - a.amountLeft)
					.map((e) => (
						<EntryTile
							key={`${e.pool}:${e.tokenId}`}
							imageUrl={images.get(`${bucket.nftContract}:${e.tokenId}`) ?? null}
							entry={e}
							chance={chanceOf(e)}
							onOpen={() => onOpenNft(bucket.nftContract, e.tokenId)}
						/>
					))
			)}
		</CollectionGroup>
	);
}
