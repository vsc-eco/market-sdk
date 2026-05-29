import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
	createMarketClient,
	MAINNET_CONFIG,
	type AiohaLike,
	type Auction,
	type BroadcastHook,
	type BundleListing,
	type Listing,
	type MagiConfig,
	type MarketClient,
	type MintSpotListing,
	type Offer,
	type RentalListing,
	type SwapProposal,
	type TokenListing
} from '@vsc.eco/market-sdk';
import { ListForm } from './actions/ListForm.js';
import { BuyForm } from './actions/BuyForm.js';
import { BuyMintSpotForm } from './actions/BuyMintSpotForm.js';
import { MakeOfferForm } from './actions/MakeOfferForm.js';
import { AcceptOfferForm } from './actions/AcceptOfferForm.js';
import { UpdateListingForm } from './actions/UpdateListingForm.js';
import { SweepForm } from './actions/SweepForm.js';
import { BuyBundleForm } from './actions/BuyBundleForm.js';
import { ListBundleForm } from './actions/ListBundleForm.js';
import { AcceptSwapForm } from './actions/AcceptSwapForm.js';
import { ProposeSwapForm } from './actions/ProposeSwapForm.js';
import { RentForm } from './actions/RentForm.js';
import { ListRentalForm } from './actions/ListRentalForm.js';
import { AdminPanel } from './actions/AdminPanel.js';
import { CreateAuctionForm } from './actions/CreateAuctionForm.js';
import { ListMintSpotsForm } from './actions/ListMintSpotsForm.js';
import { ListTokenForm } from './actions/ListTokenForm.js';
import { BuyTokenForm } from './actions/BuyTokenForm.js';
import { MakeBidForm } from './actions/MakeBidForm.js';
import { useTokenMeta } from './components/useTokenMeta.js';
import { useCollectionMeta } from './components/useCollectionMeta.js';
import { NftDetails } from './components/NftDetails.js';
import { Spinner } from './components/Spinner.js';
import { MarketTile } from './components/MarketTile.js';
import {
	useChainClock,
	dutchCurrentPrice,
	formatCountdown,
	formatGermanDateTime
} from './components/useChainClock.js';
import { FilterBar, DEFAULT_FILTERS, type FilterState } from './components/FilterBar.js';
import { useUserBalances } from './components/useUserBalances.js';
import { CollectionGroup } from './components/CollectionGroup.js';
import { useNftImages } from './components/useNftImages.js';

/** Group items sharing an `nftContract` so listings/auctions/mint-spots
 *  render as per-collection sections with named headers. */
function groupByContract<T extends { nftContract: string }>(
	items: T[]
): Array<{ contractId: string; items: T[] }> {
	const map = new Map<string, T[]>();
	for (const it of items) {
		const arr = map.get(it.nftContract) ?? [];
		arr.push(it);
		map.set(it.nftContract, arr);
	}
	return Array.from(map, ([contractId, list]) => ({ contractId, items: list }));
}

export interface MagiMarketPanelProps {
	/** Connected Hive account (enables write actions). */
	username?: string;
	/** Whose listings to browse. Defaults to "all active". */
	viewAccount?: string;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	keyType?: unknown;
	config?: MagiConfig;
	client?: MarketClient;
	className?: string;
	hideHeader?: boolean;
	bare?: boolean;
	enableRefresh?: boolean;
	onSuccess?: (txId: string) => void;
}

type Tab = 'listings' | 'offers' | 'auctions' | 'mintspots' | 'tokens' | 'bundles' | 'swaps' | 'rentals';

/** Two-sentence explainer per tab: what it is + what you can do here.
 *  Shown by the (?) popover next to the filter toggle. */
const TAB_HELP: Record<Tab, string> = {
	listings: 'Fixed-price NFT sales — browse what others have listed and buy instantly. You can list your own NFTs for sale (and sweep several at once).',
	bundles: 'Several NFTs sold together as one fixed-price lot. Buy a whole bundle in a single purchase, or create one from NFTs you own.',
	auctions: 'Timed NFT auctions — English (ascending bids) or Dutch (price declines until someone buys). Place bids on others’ auctions, or start your own.',
	rentals: 'Rent an NFT for a chosen duration at a price per block; the NFT is escrowed until the rental ends. Rent one that’s offered, or list your own for rental.',
	mintspots: 'Sell the right to mint new editions of a collection you own. Buyers pay to mint a fresh edition directly to themselves.',
	tokens: 'Fixed-price sales of fungible (ERC-20-style) tokens. Buy listed tokens, or sell your own at a set price per unit.',
	offers: 'Standing buy offers on NFTs, with the buyer’s funds escrowed until accepted. Make an offer on any NFT, or accept offers on NFTs you hold.',
	swaps: 'Trade one NFT directly for another, optionally with a token top-up. Propose a swap, or accept one proposed to you.'
};
type Sheet =
	| { kind: 'sell' }
	| { kind: 'auction' }
	| { kind: 'mintspots' }
	| { kind: 'sellToken' }
	| { kind: 'buyToken'; listing: TokenListing }
	| { kind: 'buy'; listing: Listing }
	| { kind: 'buyMintSpot'; listing: MintSpotListing }
	| { kind: 'bid'; auction: Auction }
	| { kind: 'acceptOffer'; offer: Offer }
	| { kind: 'updateListing'; listing: Listing }
	| { kind: 'sweep' }
	| { kind: 'listBundle' }
	| { kind: 'buyBundle'; bundle: BundleListing }
	| { kind: 'proposeSwap' }
	| { kind: 'acceptSwap'; swap: SwapProposal }
	| { kind: 'listRental' }
	| { kind: 'rent'; rental: RentalListing }
	| { kind: 'admin'; nftContract?: string }
	| { kind: 'offer'; listing?: Listing }
	| { kind: 'nftDetails'; nftContract: string; tokenId: string }
	| null;

/**
 * Circular top-right refresh button. Mirrors token-widget's `RefreshButton`
 * (same `magi-market-refresh-btn` class + spinning icon) so the chrome is
 * visually identical to `<MagiAssets>` / `<MagiNftPanel>`.
 */
function RefreshButton({ refreshing, onClick }: { refreshing: boolean; onClick: () => void }) {
	return (
		<button
			type="button"
			className="magi-market-refresh-btn"
			title={refreshing ? 'Refreshing…' : 'Refresh'}
			aria-label="Refresh"
			onClick={onClick}
			disabled={refreshing}
		>
			<svg
				className={refreshing ? 'spinning' : undefined}
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
				strokeLinejoin="round"
			>
				<polyline points="23 4 23 10 17 10" />
				<polyline points="1 20 1 14 7 14" />
				<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
				<path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
			</svg>
		</button>
	);
}

/** A "+"-prefixed toolbar action, matching token-widget's Deploy button. */
function ToolbarAction({
	label,
	disabled,
	onClick,
	style
}: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	style?: CSSProperties;
}) {
	return (
		<button
			type="button"
			className="magi-market-toolbar-action"
			title={label}
			disabled={disabled}
			onClick={onClick}
			style={style}
		>
			<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
				<line x1="12" y1="5" x2="12" y2="19" />
				<line x1="5" y1="12" x2="19" y2="12" />
			</svg>
			<span>{label}</span>
		</button>
	);
}

/**
 * Embeddable marketplace panel. Chrome mirrors `<MagiAssets>` in
 * @vsc.eco/token-widget verbatim — centered badge header, subtitle,
 * circular refresh, "+"-prefixed toolbar actions, underlined tab strip,
 * muted empty state — by reusing the same styled classes. Reads come from
 * `client.provider`; writes go through the SDK's cross-contract
 * orchestrator.
 */
export function MagiMarketPanel(props: MagiMarketPanelProps) {
	const {
		username,
		viewAccount,
		aioha,
		onBroadcast,
		keyType,
		config = MAINNET_CONFIG,
		client: providedClient,
		className,
		hideHeader,
		bare,
		enableRefresh = true,
		onSuccess
	} = props;

	const client = useMemo(
		() => providedClient ?? createMarketClient({ config, aioha, onBroadcast, keyType }),
		[providedClient, config, aioha, onBroadcast, keyType]
	);

	const tokenMeta = useTokenMeta(config);
	const collMeta = useCollectionMeta(config);
	const chainClock = useChainClock(client);

	const [tab, setTab] = useState<Tab>('listings');
	// Sub-scope inside each tab: "others" = items NOT owned by the user
	// (the marketplace browsing view), "yours" = items the user themselves
	// listed/seeded. "others" first matches the marketplace-first mindset.
	const [scope, setScope] = useState<'others' | 'yours'>('others');
	const [listings, setListings] = useState<Listing[]>([]);
	const [offers, setOffers] = useState<Offer[]>([]);
	const [auctions, setAuctions] = useState<Auction[]>([]);
	const [mintSpots, setMintSpots] = useState<MintSpotListing[]>([]);
	const [tokenListings, setTokenListings] = useState<TokenListing[]>([]);
	const [bundles, setBundles] = useState<BundleListing[]>([]);
	const [swaps, setSwaps] = useState<SwapProposal[]>([]);
	const [rentals, setRentals] = useState<RentalListing[]>([]);
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [sheet, setSheet] = useState<Sheet>(null);
	// `${kind}:${id}` of the listing currently being cancelled (delisted).
	const [canceling, setCanceling] = useState<string | null>(null);

	// Items for the currently visible tab — passed to the image resolver
	// so we only fetch images for NFTs actually shown on this tab. Token
	// listings are ERC-20s so they're excluded (no image to resolve).
	const visibleNftItems = useMemo<Array<{ nftContract: string; tokenId: string }>>(() => {
		if (tab === 'listings') return listings.map((l) => ({ nftContract: l.nftContract, tokenId: l.tokenId }));
		if (tab === 'offers')
			return offers
				.filter((o) => o.tokenId !== '')
				.map((o) => ({ nftContract: o.nftContract, tokenId: o.tokenId }));
		if (tab === 'auctions') return auctions.map((a) => ({ nftContract: a.nftContract, tokenId: a.tokenId }));
		if (tab === 'mintspots') return mintSpots.map((m) => ({ nftContract: m.nftContract, tokenId: m.tokenId }));
		return [];
	}, [tab, listings, offers, auctions, mintSpots]);
	const nftImages = useNftImages(config, visibleNftItems);

	const load = useCallback(async () => {
		setLoading(true);
		setErr(null);
		try {
			if (tab === 'listings')
				setListings(
					await client.provider.getListings(
						viewAccount ? { seller: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else if (tab === 'offers')
				setOffers(
					await client.provider.getOffers(
						viewAccount ? { buyer: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else if (tab === 'auctions')
				setAuctions(
					await client.provider.getAuctions(
						viewAccount ? { seller: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else if (tab === 'mintspots')
				setMintSpots(
					await client.provider.getMintSpotListings(
						viewAccount ? { lister: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else if (tab === 'bundles')
				setBundles(
					await client.provider.getBundles(
						viewAccount ? { seller: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else if (tab === 'swaps')
				setSwaps(
					await client.provider.getSwaps(
						viewAccount ? { proposer: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else if (tab === 'rentals')
				setRentals(
					await client.provider.getRentals(
						viewAccount ? { owner: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
			else
				setTokenListings(
					await client.provider.getTokenListings(
						viewAccount ? { seller: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [client, tab, viewAccount]);

	useEffect(() => {
		void load();
	}, [load]);

	const success = (tx: string) => {
		onSuccess?.(tx);
		setSheet(null);
		void load();
	};

	// The connected `username` is bare (`tibfox`) while the indexer stores
	// the seller prefixed (`hive:tibfox`), so a raw `===` never matched and
	// users could buy/offer on their own listings. Normalize both sides.
	const acctNorm = (s?: string) =>
		(s ?? '').trim().replace(/^@/, '').replace(/^hive:/, '').toLowerCase();
	const me = acctNorm(username);
	const isSelf = (account?: string) => !!me && acctNorm(account) === me;

	// Collection-owner settings gear, shown in a collection group's header
	// only when the connected user owns that collection. Opens the admin
	// panel scoped to this contract (royalty/splits/fee fields prefilled).
	const ownerGear = (contractId: string) =>
		isSelf(collMeta.owner(contractId)) ? (
			<button
				type="button"
				className="magi-market-filter-toggle-btn"
				title="Collection settings"
				aria-label="Collection settings"
				onClick={() => setSheet({ kind: 'admin', nftContract: contractId })}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
			</button>
		) : undefined;

	// Scope-filtered slices for the active sub-tab. Image resolution still
	// runs on the full lists (above), so flipping between Others/Yours is
	// instant and re-uses cached images.
	const inScope = (owner: string) =>
		scope === 'yours' ? isSelf(owner) : !isSelf(owner);
	const scopedListings = useMemo(() => listings.filter((l) => inScope(l.seller)), [listings, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	// Offers scope semantics differ from the seller-side tabs: "yours" means
	// offers I as the BUYER made; "others" means offers made BY someone else
	// (which the seller side may want to accept). isSelf() is matched against
	// the buyer field, not the seller field.
	const scopedOffers = useMemo(() => offers.filter((o) => inScope(o.buyer)), [offers, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	const scopedAuctions = useMemo(() => auctions.filter((a) => inScope(a.seller)), [auctions, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	const scopedMintSpots = useMemo(() => mintSpots.filter((m) => inScope(m.lister)), [mintSpots, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	const scopedTokenListings = useMemo(() => tokenListings.filter((tl) => inScope(tl.seller)), [tokenListings, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	const scopedBundles = useMemo(() => bundles.filter((b) => inScope(b.seller)), [bundles, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	const scopedSwaps = useMemo(() => swaps.filter((s) => inScope(s.proposer)), [swaps, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
	const scopedRentals = useMemo(() => rentals.filter((r) => inScope(r.owner)), [rentals, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps

	// ---- Browse filters (date / price / payment-token / affordability) ----
	const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const helpRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!helpOpen) return;
		const onDoc = (e: MouseEvent) => {
			if (helpRef.current && !helpRef.current.contains(e.target as Node)) setHelpOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [helpOpen]);
	const balances = useUserBalances(config, username);

	// Common predicate applied to listings/auctions/mintspots/token sales.
	// `kind` is the source so we can read the right price field; auctions
	// pass `livePrice` for an emulated current Dutch price.
	const matchesFilters = useCallback(
		(kind: 'listing' | 'offer' | 'auction' | 'mintspot' | 'tokenlisting', item: {
			paymentToken: string;
			indexedAt?: string;
			indexedAtBlock?: number;
			pricePerUnit?: string;
			pricePerSpot?: string;
			startPrice?: string;
			highBid?: string;
		}, livePrice?: string) => {
			// Date range
			if (filters.dateRange !== 'all' && item.indexedAt) {
				const ms = {
					'1d': 86400_000,
					'7d': 7 * 86400_000,
					'30d': 30 * 86400_000,
					'365d': 365 * 86400_000
				} as const;
				const cutoff = Date.now() - ms[filters.dateRange];
				const t = new Date(item.indexedAt).getTime();
				if (!Number.isFinite(t) || t < cutoff) return false;
			}
			// Payment token
			if (filters.paymentToken !== 'any' && item.paymentToken !== filters.paymentToken) return false;
			// Compute the per-listing reference price in micro-units.
			const refRaw =
				kind === 'mintspot' ? item.pricePerSpot
					: kind === 'auction' ? (livePrice ?? item.highBid ?? item.startPrice)
						: item.pricePerUnit;
			let refMicro: bigint = 0n;
			try { refMicro = BigInt(refRaw ?? '0'); } catch { refMicro = 0n; }
			// Max price (entered as human decimal in the FilterBar)
			if (filters.maxPrice.trim() !== '') {
				const capMicro = tokenMeta.toMicro(item.paymentToken, filters.maxPrice);
				if (capMicro && refMicro > BigInt(capMicro)) return false;
			}
			if (username && filters.affordableOnly) {
				const bal = balances.balanceOf(item.paymentToken);
				// Zero balance ⇒ any positive price fails this check, which
				// also subsumes the old "include tokens I don't have" toggle.
				if (bal != null && refMicro > bal) return false;
			}
			return true;
		},
		[filters, balances, username, tokenMeta]
	);

	const filteredListings = useMemo(
		() => scopedListings.filter((l) => matchesFilters('listing', l)),
		[scopedListings, matchesFilters]
	);
	const filteredOffers = useMemo(
		() => scopedOffers.filter((o) => matchesFilters('offer', o)),
		[scopedOffers, matchesFilters]
	);
	const filteredAuctions = useMemo(
		() => scopedAuctions.filter((a) => {
			const live = a.auctionType === 'dutch' && chainClock.currentBlock != null
				? dutchCurrentPrice(a.startPrice, a.endPrice ?? '0', a.startBlock ?? 0, a.endBlock, chainClock.currentBlock)
				: undefined;
			return matchesFilters('auction', a, live);
		}),
		[scopedAuctions, matchesFilters, chainClock.currentBlock]
	);
	const filteredMintSpots = useMemo(
		() => scopedMintSpots.filter((m) => matchesFilters('mintspot', m)),
		[scopedMintSpots, matchesFilters]
	);
	const filteredTokenListings = useMemo(
		() => scopedTokenListings.filter((tl) => matchesFilters('tokenlisting', tl)),
		[scopedTokenListings, matchesFilters]
	);

	// Cancel (delist) the caller's own item. `kind` selects the op so one
	// handler serves NFT listings, token-sale listings, auctions, and
	// mint-spot listings. The contract enforces owner-only + state rules
	// (e.g. an auction with bids); failures surface in the error area.
	async function cancelListing(
		kind:
			| 'listing'
			| 'token'
			| 'auction'
			| 'mintspots'
			| 'offer'
			| 'settleAuction'
			| 'bundle'
			| 'swap'
			| 'rental'
			| 'endRental'
			| 'endRentalEarly',
		id: number
	) {
		if (!username || canceling) return;
		setCanceling(`${kind}:${id}`);
		setErr(null);
		try {
			let op;
			switch (kind) {
				case 'token':
					op = client.ops.delistTokenOp(username, { listingId: id });
					break;
				case 'auction':
					op = client.ops.cancelAuctionOp(username, { auctionId: id });
					break;
				case 'mintspots':
					op = client.ops.delistMintSpotsOp(username, { listingId: id });
					break;
				case 'offer':
					op = client.ops.cancelOfferOp(username, { offerId: id });
					break;
				case 'settleAuction':
					op = client.ops.settleAuctionOp(username, { auctionId: id });
					break;
				case 'bundle':
					op = client.ops.delistBundleOp(username, { bundleId: id });
					break;
				case 'swap':
					op = client.ops.cancelSwapOp(username, { swapId: id });
					break;
				case 'rental':
					op = client.ops.delistRentalOp(username, { rentalId: id });
					break;
				case 'endRental':
					op = client.ops.endRentalOp(username, { rentalId: id });
					break;
				case 'endRentalEarly':
					op = client.ops.endRentalEarlyOp(username, { rentalId: id });
					break;
				default:
					op = client.ops.delistOp(username, { listingId: id });
			}
			const { txId } = await client.broadcast(op);
			success(txId);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setCanceling(null);
		}
	}

	const TABS: Array<{ id: Tab; label: string }> = [
		{ id: 'listings', label: 'Listings' },
		{ id: 'bundles', label: 'Bundles' },
		{ id: 'auctions', label: 'Auctions' },
		{ id: 'rentals', label: 'Rentals' },
		{ id: 'mintspots', label: 'Mint spots' },
		{ id: 'tokens', label: 'Tokens' },
		// Offers kept after the primary six (not in the requested order list).
		{ id: 'offers', label: 'Offers' }
		// Swaps tab intentionally hidden for now — the swap flow still has
		// the native-top-up dud surface (acceptSwap's `from==caller` assert
		// makes any hive/hbd top-up fail). Re-enable here once that lands.
		// { id: 'swaps', label: 'Swaps' },
	];

	return (
		<div className={`magi-market${bare ? ' bare' : ''} ${className ?? ''}`}>
			{enableRefresh && <RefreshButton refreshing={loading} onClick={() => void load()} />}

			{!hideHeader && (
				<div className="magi-market-header">
					<div className="magi-market-badge">
						<span className="magi-market-dot" />
						<span className="magi-market-badge-text">MAGI MARKET</span>
					</div>
					<p className="magi-market-subtitle">Buy, sell &amp; auction NFTs on Magi</p>
				</div>
			)}

			<div className="magi-market-tabs">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`magi-market-tab ${tab === t.id ? 'active' : ''}`}
						onClick={() => setTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>

			<div className="magi-market-subtabs-row">
				<div className="magi-market-subtabs-action magi-market-subtabs-action--left">
					{username && tab === 'listings' && (
						<>
							<ToolbarAction label="Sell an NFT" onClick={() => setSheet({ kind: 'sell' })} />
							<ToolbarAction label="Sweep" onClick={() => setSheet({ kind: 'sweep' })} style={{ marginLeft: '0.5rem' }} />
						</>
					)}
					{username && tab === 'offers' && (
						<ToolbarAction label="Make an offer" onClick={() => setSheet({ kind: 'offer' })} />
					)}
					{username && tab === 'auctions' && (
						<ToolbarAction label="New auction" onClick={() => setSheet({ kind: 'auction' })} />
					)}
					{username && tab === 'mintspots' && (
						<ToolbarAction label="Sell mint spots" onClick={() => setSheet({ kind: 'mintspots' })} />
					)}
					{username && tab === 'bundles' && (
						<ToolbarAction label="Create bundle" onClick={() => setSheet({ kind: 'listBundle' })} />
					)}
					{username && tab === 'swaps' && (
						<ToolbarAction label="Propose swap" onClick={() => setSheet({ kind: 'proposeSwap' })} />
					)}
					{username && tab === 'rentals' && (
						<ToolbarAction label="List for rental" onClick={() => setSheet({ kind: 'listRental' })} />
					)}
					{username && tab === 'tokens' && (
						<ToolbarAction label="Sell a token" onClick={() => setSheet({ kind: 'sellToken' })} />
					)}
				</div>
				<div className="magi-market-subtabs">
					{(['others', 'yours'] as const).map((s) => (
						<button
							key={s}
							type="button"
							className={`magi-market-subtab ${scope === s ? 'active' : ''}`}
							onClick={() => setScope(s)}
						>
							{s === 'others' ? 'Others' : 'Yours'}
						</button>
					))}
				</div>
				<div className="magi-market-subtabs-action magi-market-subtabs-action--right">
					<button
						type="button"
						className={`magi-market-filter-toggle-btn${filtersOpen ? ' active' : ''}`}
						title={filtersOpen ? 'Hide filters' : 'Show filters'}
						aria-label="Toggle filters"
						aria-expanded={filtersOpen}
						onClick={() => setFiltersOpen((v) => !v)}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
						</svg>
					</button>
					<div className="magi-market-help-wrap" ref={helpRef}>
						<button
							type="button"
							className={`magi-market-filter-toggle-btn${helpOpen ? ' active' : ''}`}
							title="What is this tab?"
							aria-label="What is this tab?"
							aria-expanded={helpOpen}
							onClick={() => setHelpOpen((v) => !v)}
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
								<circle cx="12" cy="12" r="10" />
								<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
								<line x1="12" y1="17" x2="12.01" y2="17" />
							</svg>
						</button>
						{helpOpen && (
							<div className="magi-market-help-popover" role="dialog" aria-label="Tab help">
								{TAB_HELP[tab]}
							</div>
						)}
					</div>
				</div>
			</div>

			{filtersOpen && (
				<FilterBar
					value={filters}
					onChange={setFilters}
					tokenMeta={tokenMeta}
					hasUser={!!username}
				/>
			)}

			{err && <div className="magi-market-state">{err}</div>}

			{!err && loading && <Spinner label="Loading…" />}

			{!err && !loading && tab === 'listings' && (
				filteredListings.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You haven't listed anything." : 'No active listings from others.'}
					</div>
				) : (
					groupByContract(filteredListings).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							count={g.items.length}
							action={ownerGear(g.contractId)}
						>
							{g.items.map((l) => {
								// Time-restricted listing: surface the expiry on the
								// tile. expirationBlock 0/undefined = no restriction.
								// (The indexer's `active` is event-derived and doesn't
								// recompute on-chain expiry, so a still-"active" listing
								// can already be past its block — show "expired".)
								const expSecs = l.expirationBlock ? chainClock.secondsUntilBlock(l.expirationBlock) : null;
								const expDate = l.expirationBlock ? chainClock.blockToDate(l.expirationBlock) : null;
								const expired = expSecs != null && expSecs <= 0;
								return (
								<MarketTile
									key={l.listingId}
									imageUrl={nftImages.get(l.nftContract, l.tokenId)}
									tokenId={l.tokenId}
									subtitle={
										l.expirationBlock ? (
											<span className={`magi-market-tile-expiry${expired ? ' expired' : ''}`}>
												{expired
													? 'expired'
													: expSecs != null
														? `expires in ${formatCountdown(expSecs)}`
														: expDate
															? `expires ${formatGermanDateTime(expDate)}`
															: `expires block ${l.expirationBlock}`}
											</span>
										) : undefined
									}
									price={<>{tokenMeta.format(l.paymentToken, l.pricePerUnit)} {tokenMeta.symbol(l.paymentToken)} · ×{l.amount}</>}
									onOpen={() => setSheet({ kind: 'nftDetails', nftContract: l.nftContract, tokenId: l.tokenId })}
									actions={
										isSelf(l.seller) ? (
											<>
												<button type="button" className="magi-market-submit ghost"
													disabled={!username}
													onClick={() => setSheet({ kind: 'updateListing', listing: l })}>
													Edit
												</button>
												<button type="button" className="magi-market-submit ghost"
													disabled={canceling === `listing:${l.listingId}`}
													onClick={() => cancelListing('listing', l.listingId)}>
													{canceling === `listing:${l.listingId}` ? 'Cancelling…' : 'Cancel'}
												</button>
											</>
										) : (
											<>
												<button type="button" className="magi-market-submit"
													disabled={!username}
													onClick={() => setSheet({ kind: 'buy', listing: l })}>Buy</button>
												<button type="button" className="magi-market-submit ghost"
													disabled={!username}
													onClick={() => setSheet({ kind: 'offer', listing: l })}>Offer</button>
											</>
										)
									}
								/>
								);
							})}
						</CollectionGroup>
					))
				)
			)}

			{!err && !loading && tab === 'offers' && (
				filteredOffers.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You haven't made any offers yet." : 'No open offers from others.'}
					</div>
				) : (
					groupByContract(
						filteredOffers.map((o) => ({
							...o,
							// Treat collection offers as having a synthetic tokenId so the
							// per-collection grouper still partitions them sensibly.
							tokenId: o.tokenId || '(collection)'
						}))
					).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							count={g.items.length}
							action={ownerGear(g.contractId)}
						>
							{g.items.map((o) => {
								const isCol = o.tokenId === '(collection)';
								return (
									<MarketTile
										key={o.offerId}
										imageUrl={isCol ? null : nftImages.get(o.nftContract, o.tokenId)}
										tokenId={isCol ? 'collection offer' : o.tokenId}
										subtitle={<>×{o.amount}{isCol ? ' · any token' : ''}</>}
										price={<>{tokenMeta.format(o.paymentToken, o.pricePerUnit)} {tokenMeta.symbol(o.paymentToken)} / unit</>}
										onOpen={() => isCol ? undefined : setSheet({ kind: 'nftDetails', nftContract: o.nftContract, tokenId: o.tokenId })}
										actions={
											isSelf(o.buyer) ? (
												<button type="button" className="magi-market-submit ghost"
													disabled={canceling === `offer:${o.offerId}`}
													onClick={() => cancelListing('offer', o.offerId)}>
													{canceling === `offer:${o.offerId}` ? 'Cancelling…' : 'Cancel offer'}
												</button>
											) : (
												<>
													<span className="magi-market-tile-bidder"
														title={o.buyer}
														data-fullname={`From: ${o.buyer}`}
														tabIndex={0}>
														From: {o.buyer}
													</span>
													<button type="button" className="magi-market-submit"
														disabled={!username}
														onClick={() => setSheet({ kind: 'acceptOffer', offer: { ...o, tokenId: isCol ? '' : o.tokenId } })}>
														Accept
													</button>
												</>
											)
										}
									/>
								);
							})}
						</CollectionGroup>
					))
				)
			)}

			{!err && !loading && tab === 'auctions' && (
				filteredAuctions.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active auctions." : 'No active auctions from others.'}
					</div>
				) : (
					groupByContract(filteredAuctions).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							count={g.items.length}
							action={ownerGear(g.contractId)}
						>
							{g.items.map((a) => {
								// Resolve block → wall-clock + countdown via the chain
								// clock. Dutch auctions emulate the contract's price
								// formula (linear startPrice → endPrice over the
								// block window) so the tile shows what a buyer would
								// actually pay at this instant.
								const endDate = chainClock.blockToDate(a.endBlock);
								const secsLeft = chainClock.secondsUntilBlock(a.endBlock);
								const ended = secsLeft != null && secsLeft <= 0;
								const isDutch = a.auctionType === 'dutch';
								const livePrice = isDutch && chainClock.currentBlock != null
									? dutchCurrentPrice(
										a.startPrice,
										a.endPrice ?? '0',
										a.startBlock ?? 0,
										a.endBlock,
										chainClock.currentBlock
									)
									: (a.highBid ?? a.startPrice);
								return (
									<MarketTile
										key={a.auctionId}
										imageUrl={nftImages.get(a.nftContract, a.tokenId)}
										tokenId={a.tokenId}
										subtitle={
											<>
												<div>{a.auctionType}</div>
												<div>
													{ended
														? 'ended'
														: isDutch
															? (secsLeft != null ? `ends in ${formatCountdown(secsLeft)}` : `ends block ${a.endBlock}`)
															: (endDate ? `ends ${formatGermanDateTime(endDate)}` : `ends block ${a.endBlock}`)}
												</div>
											</>
										}
										price={<>{tokenMeta.format(a.paymentToken, livePrice)} {tokenMeta.symbol(a.paymentToken)}</>}
									onOpen={() => setSheet({ kind: 'nftDetails', nftContract: a.nftContract, tokenId: a.tokenId })}
									actions={
										<>
											<span
												className="magi-market-tile-bidder"
												title={a.highBidder ? a.highBidder : undefined}
												data-fullname={a.highBidder ? `High: ${a.highBidder}` : undefined}
												tabIndex={a.highBidder ? 0 : -1}
											>
												{a.highBidder ? `High: ${a.highBidder}` : 'No bids'}
											</span>
											{!isSelf(a.seller) && !a.settled && !ended && (
												<button type="button" className="magi-market-submit"
													disabled={!username}
													onClick={() => setSheet({ kind: 'bid', auction: a })}>
													Bid
												</button>
											)}
											{!a.settled && ended && a.auctionType === 'english' && (
												<button type="button" className="magi-market-submit"
													disabled={!username || canceling === `settleAuction:${a.auctionId}`}
													onClick={() => cancelListing('settleAuction', a.auctionId)}>
													{canceling === `settleAuction:${a.auctionId}` ? 'Settling…' : 'Settle'}
												</button>
											)}
											{/* Ended Dutch auction (unsold): the contract's settleAuction
											    rejects non-english, and a sold Dutch settles instantly on
											    the first bid — so an unsold, ended Dutch is finalized by
											    the seller reclaiming via cancelAuction (seller-only). */}
											{isSelf(a.seller) && !a.settled && ended && a.auctionType === 'dutch' && (
												<button type="button" className="magi-market-submit"
													disabled={!username || canceling === `auction:${a.auctionId}`}
													onClick={() => cancelListing('auction', a.auctionId)}>
													{canceling === `auction:${a.auctionId}` ? 'Settling…' : 'Settle'}
												</button>
											)}
											{isSelf(a.seller) && !a.settled && !ended && !a.highBidder && (
												<button type="button" className="magi-market-submit ghost"
													disabled={canceling === `auction:${a.auctionId}`}
													onClick={() => cancelListing('auction', a.auctionId)}>
													{canceling === `auction:${a.auctionId}` ? 'Cancelling…' : 'Cancel'}
												</button>
											)}
										</>
									}
								/>
								);
							})}
						</CollectionGroup>
					))
				)
			)}

			{!err && !loading && tab === 'mintspots' && (
				filteredMintSpots.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active mint-spot listings." : 'No active mint-spot listings from others.'}
					</div>
				) : (
					groupByContract(filteredMintSpots).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							count={g.items.length}
							action={ownerGear(g.contractId)}
						>
							{g.items.map((m) => (
								<MarketTile
									key={m.listingId}
									imageUrl={nftImages.get(m.nftContract, m.tokenId)}
									tokenId={m.tokenId}
									subtitle={<>{m.sold}/{m.maxSpots || '∞'} sold</>}
									price={<>{tokenMeta.format(m.paymentToken, m.pricePerSpot)} {tokenMeta.symbol(m.paymentToken)}</>}
									onOpen={() => setSheet({ kind: 'nftDetails', nftContract: m.nftContract, tokenId: m.tokenId })}
									actions={
										isSelf(m.lister) ? (
											<button type="button" className="magi-market-submit ghost"
												disabled={canceling === `mintspots:${m.listingId}`}
												onClick={() => cancelListing('mintspots', m.listingId)}>
												{canceling === `mintspots:${m.listingId}` ? 'Cancelling…' : 'Cancel'}
											</button>
										) : (
											<button
												type="button"
												className="magi-market-submit"
												disabled={!username}
												onClick={() => setSheet({ kind: 'buyMintSpot', listing: m })}>
												Mint
											</button>
										)
									}
								/>
							))}
						</CollectionGroup>
					))
				)
			)}

			{!err && !loading && tab === 'tokens' && (
				filteredTokenListings.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active token sales." : 'No active token sales from others.'}
					</div>
				) : (
					<div className="magi-market-list">
						{filteredTokenListings.map((tl) => (
							<div key={tl.listingId} className="magi-market-row">
								<div className="magi-market-row-main">
									<span className="magi-market-row-id">
										{tl.amount} {tokenMeta.symbol(tl.tokenContract)}
									</span>
									<span className="magi-market-row-sub">{tokenMeta.name(tl.tokenContract)}</span>
								</div>
								<div className="magi-market-row-price">
									{tokenMeta.format(tl.paymentToken, tl.pricePerUnit)} {tokenMeta.symbol(tl.paymentToken)} /unit
								</div>
								<div className="magi-market-row-actions">
									{isSelf(tl.seller) ? (
										<button
											type="button"
											className="magi-market-submit ghost"
											style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
											disabled={canceling === `token:${tl.listingId}`}
											onClick={() => cancelListing('token', tl.listingId)}
										>
											{canceling === `token:${tl.listingId}` ? 'Cancelling…' : 'Cancel listing'}
										</button>
									) : (
										<button
											type="button"
											className="magi-market-submit"
											style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
											disabled={!username}
											onClick={() => setSheet({ kind: 'buyToken', listing: tl })}
										>
											Buy
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				)
			)}

			{!err && !loading && tab === 'bundles' && (
				scopedBundles.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active bundles." : 'No active bundles from others.'}
					</div>
				) : (
					<div className="magi-market-list">
						{scopedBundles.map((b) => (
							<div key={b.bundleId} className="magi-market-row">
								<div className="magi-market-row-main">
									<span className="magi-market-row-id">Bundle #{b.bundleId}</span>
									<span className="magi-market-row-sub">{b.items.length} item{b.items.length === 1 ? '' : 's'} · {collMeta.name(b.nftContract)}</span>
								</div>
								<div className="magi-market-row-price">
									{tokenMeta.format(b.paymentToken, b.price)} {tokenMeta.symbol(b.paymentToken)}
								</div>
								<div className="magi-market-row-actions">
									{isSelf(b.seller) ? (
										<button type="button" className="magi-market-submit ghost"
											style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
											disabled={canceling === `bundle:${b.bundleId}`}
											onClick={() => cancelListing('bundle', b.bundleId)}>
											{canceling === `bundle:${b.bundleId}` ? 'Cancelling…' : 'Cancel'}
										</button>
									) : (
										<button type="button" className="magi-market-submit"
											style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
											disabled={!username}
											onClick={() => setSheet({ kind: 'buyBundle', bundle: b })}>
											Buy
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				)
			)}

			{!err && !loading && tab === 'swaps' && (
				scopedSwaps.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You haven't proposed any swaps." : 'No open swap proposals from others.'}
					</div>
				) : (
					<div className="magi-market-list">
						{scopedSwaps.map((s) => (
							<div key={s.swapId} className="magi-market-row">
								<div className="magi-market-row-main">
									<span className="magi-market-row-id">Swap #{s.swapId}</span>
									<span className="magi-market-row-sub">
										Give #{s.wantedTokenId} × {s.wantedAmount} · Get #{s.offeredTokenId} × {s.offeredAmount}
										{s.topUp && s.topUp !== '0' && s.topUpToken
											? ` · + ${tokenMeta.format(s.topUpToken, s.topUp)} ${tokenMeta.symbol(s.topUpToken)} top-up`
											: ''}
									</span>
								</div>
								<div className="magi-market-row-actions">
									{isSelf(s.proposer) ? (
										<button type="button" className="magi-market-submit ghost"
											style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
											disabled={canceling === `swap:${s.swapId}`}
											onClick={() => cancelListing('swap', s.swapId)}>
											{canceling === `swap:${s.swapId}` ? 'Cancelling…' : 'Cancel'}
										</button>
									) : (
										<button type="button" className="magi-market-submit"
											style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
											disabled={!username}
											onClick={() => setSheet({ kind: 'acceptSwap', swap: s })}>
											Accept
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				)
			)}

			{!err && !loading && tab === 'rentals' && (
				scopedRentals.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active rental listings." : 'No rental listings from others.'}
					</div>
				) : (
					<div className="magi-market-list">
						{scopedRentals.map((r) => {
							const rentedByMe = !!r.renter && isSelf(r.renter);
							const ended = r.endBlock != null && chainClock.currentBlock != null && chainClock.currentBlock >= r.endBlock;
							return (
								<div key={r.rentalId} className="magi-market-row">
									<div className="magi-market-row-main">
										<span className="magi-market-row-id">Rental #{r.rentalId} · #{r.tokenId}</span>
										<span className="magi-market-row-sub">
											{tokenMeta.format(r.paymentToken, r.pricePerBlock)} {tokenMeta.symbol(r.paymentToken)} /block · {r.minBlocks}–{r.maxBlocks} blocks
											{r.renter ? ` · rented by ${r.renter}${ended ? ' (ended)' : ''}` : ''}
										</span>
									</div>
									<div className="magi-market-row-actions">
										{isSelf(r.owner) && !r.renter && (
											<button type="button" className="magi-market-submit ghost"
												style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
												disabled={canceling === `rental:${r.rentalId}`}
												onClick={() => cancelListing('rental', r.rentalId)}>
												{canceling === `rental:${r.rentalId}` ? 'Cancelling…' : 'Cancel'}
											</button>
										)}
										{isSelf(r.owner) && r.renter && ended && (
											<button type="button" className="magi-market-submit"
												style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
												disabled={canceling === `endRental:${r.rentalId}`}
												onClick={() => cancelListing('endRental', r.rentalId)}>
												{canceling === `endRental:${r.rentalId}` ? 'Ending…' : 'End rental'}
											</button>
										)}
										{rentedByMe && !ended && (
											<button type="button" className="magi-market-submit ghost"
												style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
												disabled={canceling === `endRentalEarly:${r.rentalId}`}
												onClick={() => cancelListing('endRentalEarly', r.rentalId)}>
												{canceling === `endRentalEarly:${r.rentalId}` ? 'Ending…' : 'End early'}
											</button>
										)}
										{!isSelf(r.owner) && !r.renter && (
											<button type="button" className="magi-market-submit"
												style={{ width: 'auto', padding: '0.4rem 0.9rem' }}
												disabled={!username}
												onClick={() => setSheet({ kind: 'rent', rental: r })}>
												Rent
											</button>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)
			)}

			{sheet?.kind === 'sell' && username && (
				<ListForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'auction' && username && (
				<CreateAuctionForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'mintspots' && username && (
				<ListMintSpotsForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'sellToken' && username && (
				<ListTokenForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'buyToken' && username && (
				<BuyTokenForm client={client} username={username} listing={sheet.listing} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'buyMintSpot' && username && (
				<BuyMintSpotForm client={client} username={username} listing={sheet.listing} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'buy' && username && (
				<BuyForm client={client} username={username} listing={sheet.listing} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'bid' && username && (
				<MakeBidForm client={client} username={username} auction={sheet.auction} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'acceptOffer' && username && (
				<AcceptOfferForm client={client} username={username} offer={sheet.offer} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'updateListing' && username && (
				<UpdateListingForm client={client} username={username} listing={sheet.listing} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'sweep' && username && (
				<SweepForm client={client} username={username} listings={listings} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'listBundle' && username && (
				<ListBundleForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'buyBundle' && username && (
				<BuyBundleForm client={client} username={username} bundle={sheet.bundle} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'proposeSwap' && username && (
				<ProposeSwapForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'acceptSwap' && username && (
				<AcceptSwapForm client={client} username={username} swap={sheet.swap} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'listRental' && username && (
				<ListRentalForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'rent' && username && (
				<RentForm client={client} username={username} rental={sheet.rental} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'admin' && username && (
				<AdminPanel client={client} username={username} nftContract={sheet.nftContract} onSuccess={success} onClose={() => setSheet(null)} />
			)}
			{sheet?.kind === 'offer' && username && (
				<MakeOfferForm
					client={client}
					username={username}
					defaultNftContract={sheet.listing?.nftContract}
					defaultTokenId={sheet.listing?.tokenId}
					onSuccess={success}
					onClose={() => setSheet(null)}
				/>
			)}
			{sheet?.kind === 'nftDetails' && (
				<NftDetails
					config={config}
					nftContract={sheet.nftContract}
					tokenId={sheet.tokenId}
					onClose={() => setSheet(null)}
				/>
			)}
		</div>
	);
}
