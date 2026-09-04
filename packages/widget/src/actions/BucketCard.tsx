import { useEffect, useMemo, useState } from 'react';
import type { BucketEntry, BucketListing, BucketStack, MarketClient } from '@vsc.eco/market-sdk';
import { createNftClient, 	type NftItem
} from '@vsc.eco/token-sdk';
import { tokenConfigFrom } from '../components/tokenConfig.js';
import { Spinner } from '../components/Spinner.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { stackRole } from '../components/stackRole.js';
import magiSvg from '../assets/magi.svg';

/**
 * NFTs shown per stack before paging.
 *
 * A stack can hold hundreds of entries and they all carry an image, so
 * rendering the lot made opening a sale a scroll through someone else's
 * inventory — and buried the second stack, which is usually the one worth
 * looking at, below the first.
 */
const ENTRIES_PER_PAGE = 10;

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
 * Prev/next over one stack's entries.
 *
 * Paging rather than a "show more" that only grows: a stack of 200 cards is
 * something you scan a page at a time, and a list that can only get longer
 * strands the actions at the bottom of the panel again.
 */
function Pager({
	page,
	pages,
	total,
	onPage
}: {
	page: number;
	pages: number;
	total: number;
	onPage: (p: number) => void;
}) {
	const from = page * ENTRIES_PER_PAGE + 1;
	const to = Math.min(total, (page + 1) * ENTRIES_PER_PAGE);
	return (
		<div className="magi-market-stackpager">
			<button
				type="button"
				className="magi-market-submit ghost"
				disabled={page === 0}
				onClick={() => onPage(page - 1)}
			>
				Back
			</button>
			<span className="magi-market-stackpager-count">
				{from}–{to} of {total}
			</span>
			<button
				type="button"
				className="magi-market-submit ghost"
				disabled={page >= pages - 1}
				onClick={() => onPage(page + 1)}
			>
				More
			</button>
		</div>
	);
}

/** One stack: what it is, then its contents a page at a time. */
function StackGroup({
	stack,
	entries,
	unitsLeft,
	role,
	sole,
	images,
	nftContract,
	onOpenNft
}: {
	stack: number;
	entries: BucketEntry[];
	unitsLeft: number;
	role: string[];
	sole: boolean;
	images: Map<string, string | null>;
	nftContract: string;
	onOpenNft: (nftContract: string, tokenId: string) => void;
}) {
	const [page, setPage] = useState(0);
	const pages = Math.max(1, Math.ceil(entries.length / ENTRIES_PER_PAGE));
	// A stack that shrinks under you (a draw lands, stock is added) must not
	// leave the pager pointing past the end.
	const safePage = Math.min(page, pages - 1);
	const shown = entries.slice(safePage * ENTRIES_PER_PAGE, (safePage + 1) * ENTRIES_PER_PAGE);

	/** Chance of drawing this entry, GIVEN a draw from this stack. */
	const chanceOf = (e: BucketEntry): number | null =>
		unitsLeft > 0 ? (e.amountLeft / unitsLeft) * 100 : null;

	return (
		<section className="magi-market-stackgroup">
			<header className="magi-market-stackgroup-head">
				<h4 className="magi-market-stackgroup-title">
					{sole ? 'Contents' : `Stack ${stack + 1}`}
				</h4>
				<span className="magi-market-stackgroup-role">{role.join(' · ')}</span>
				<span className="magi-market-stackgroup-count">
					{unitsLeft} unit{unitsLeft === 1 ? '' : 's'} left · {entries.length} NFT
					{entries.length === 1 ? '' : 's'}
				</span>
			</header>
			<div className="magi-market-grid magi-market-bucketcard-grid">
				{shown.map((e) => (
					<EntryTile
						key={`${e.stack}:${e.tokenId}`}
						imageUrl={images.get(`${nftContract}:${e.tokenId}`) ?? null}
						entry={e}
						chance={chanceOf(e)}
						onOpen={() => onOpenNft(nftContract, e.tokenId)}
					/>
				))}
			</div>
			{entries.length > ENTRIES_PER_PAGE && (
				<Pager page={safePage} pages={pages} total={entries.length} onPage={setPage} />
			)}
		</section>
	);
}

/**
 * A bucket rendered as its stacks: each one says what it is and what it holds,
 * a page at a time.
 *
 * Stacks are surfaced explicitly rather than folded into one flat grid because
 * a bucket with guaranteed slots drains UNEVENLY — the guaranteed stack empties
 * first and strands the rest — so "units left" alone can suggest a pack is
 * available when it cannot actually be filled. It also stops the odds being
 * misread: every percentage here is conditional on a draw from ITS OWN stack,
 * which is only honest if you can see which stack that is.
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
				/* the per-stack totals get summed from the entries instead */
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

	const singlesOn = bucket.pricePerDraw !== '0' && bucket.pricePerDraw !== '';
	const packsOn = bucket.pricePerPack !== '0' && bucket.pricePerPack !== '';

	/**
	 * The sale's stacks, in contract order, each with its own entries.
	 *
	 * Units come from the stacks view when it answered, and are summed from the
	 * entries when it did not — the old code left the odds blank in that case,
	 * which is a worse answer than one derived from stock we already hold.
	 */
	const stackViews = useMemo(() => {
		const byStack = new Map<number, BucketEntry[]>();
		for (const e of entries ?? []) {
			const list = byStack.get(e.stack);
			if (list) list.push(e);
			else byStack.set(e.stack, [e]);
		}
		return Array.from(byStack.entries())
			.map(([stack, list]) => ({
				stack,
				entries: list
					.slice()
					.sort((a, b) => b.amountLeft - a.amountLeft || a.tokenId.localeCompare(b.tokenId)),
				unitsLeft: stackUnits.get(stack) ?? list.reduce((n, e) => n + e.amountLeft, 0)
			}))
			.sort((a, b) => a.stack - b.stack);
	}, [entries, stackUnits]);

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
				{packsOn && bucket.packDraws.length > 0 && (
					<> · pack: {bucket.packDraws
						.map((n: number, i: number) => (n > 0 ? `${n} from stack ${i + 1}` : null))
						.filter(Boolean)
						.join(' + ')}</>
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
				<div className="magi-market-stackgroups">
					{stackViews.map((v) => (
						<StackGroup
							key={v.stack}
							stack={v.stack}
							entries={v.entries}
							unitsLeft={v.unitsLeft}
							role={stackRole(v.stack, bucket.packDraws, singlesOn, packsOn)}
							sole={stackViews.length === 1}
							images={images}
							nftContract={bucket.nftContract}
							onOpenNft={onOpenNft}
						/>
					))}
				</div>
			)}
		</div>
	);
}
