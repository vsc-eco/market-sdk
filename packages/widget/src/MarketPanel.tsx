import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
	createMarketClient,
	MAINNET_CONFIG,
	type AiohaLike,
	type Auction,
	type BroadcastHook,
	type BundleListing,
	type BucketListing,
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
import { BundleCard } from './actions/BundleCard.js';
import { BucketCard } from './actions/BucketCard.js';
import { ListBucketForm } from './actions/ListBucketForm.js';
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
import { humanizeContractError } from './contractErrors.js';
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
import { useUserNftHoldings } from './components/useUserNftHoldings.js';
import { useAllNfts } from './components/useAllNfts.js';
import { useTemplateLinks } from './components/useTemplateLinks.js';
import { useElementWidth } from './components/useElementWidth.js';
import { CollectionGroup, TemplateGroup, bareAccount } from './components/CollectionGroup.js';
import { useNftImages } from './components/useNftImages.js';

/**
 * Explore page size. Holdings are paged rather than capped: every match is
 * reachable via "Load more", nothing is silently dropped.
 *
 * 40 also keeps each image-resolution round inside the node's ~100-key
 * `getStateByKeys` limit — `useNftImages` only fetches the newly revealed
 * items, so one page of tokens plus their templates stays well under it.
 */
const EXPLORE_PAGE = 40;

/**
 * Panel width at which Explore switches from the stacked accordion to the
 * two-pane collection-list/detail layout. Below this the sidebar plus a
 * useful tile grid don't both fit, so the stacked design wins.
 *
 * Measured on the PANEL, not the viewport — see `useElementWidth`. Note the
 * panel is `max-width: 720px`, so this must sit below that or the split
 * layout can never engage; at 720 the detail pane still gets ~440px, three
 * tile columns.
 */
const EXPLORE_SPLIT_AT = 640;

/**
 * Panel width below which the sub-tabs row stacks: the tab action ("Sell an
 * NFT" + "Sweep") moves to its own row above the Others/Yours pills. One line
 * for action + pills + filter/help icons needs roughly 460px of content, so
 * this leaves headroom over the panel's 1.25rem side padding.
 *
 * Measured on the panel (see `useElementWidth`) rather than the viewport,
 * because the previous viewport-gated version missed the case this is for:
 * a phone-width column inside a wider page, and any narrow embed.
 */
const SUBTABS_STACK_AT = 560;

/**
 * One NFT on the Explore view: a token plus everyone who holds it. Explore
 * is token-shaped rather than holding-shaped because a magi-market offer is
 * an OPEN bid on `(nftContract, tokenId)` that any holder may accept — there
 * is no way to direct one at a specific account.
 */
interface ExploreToken {
	nftContract: string;
	tokenId: string;
	soulbound: boolean;
	/** Every holder, `hive:…`; marketplace escrow excluded. */
	holders: string[];
	/** Units in circulation across those holders. */
	totalUnits: bigint;
	/** How many of those units the connected user holds. */
	myUnits: bigint;
	/** Whether the collection owner is among the holders (soulbound gate). */
	ownerHolds: boolean;
}

/**
 * Group items sharing an `nftContract` so listings/auctions/mint-spots render
 * as per-collection sections with named headers.
 *
 * Pass `nameOf` (i.e. `collMeta.name`) to order the groups alphabetically by
 * display name. Without it groups come out in whatever order the rows
 * arrived, which for indexer reads is contract-id order — stable, but
 * meaningless to a reader. Compared case- and accent-insensitively with
 * `numeric` so "Series 2" sorts before "Series 10".
 */
function groupByContract<T extends { nftContract: string }>(
	items: T[],
	nameOf?: (contractId: string) => string
): Array<{ contractId: string; items: T[] }> {
	const map = new Map<string, T[]>();
	for (const it of items) {
		const arr = map.get(it.nftContract) ?? [];
		arr.push(it);
		map.set(it.nftContract, arr);
	}
	const groups = Array.from(map, ([contractId, list]) => ({ contractId, items: list }));
	if (nameOf) {
		groups.sort((a, b) =>
			nameOf(a.contractId).localeCompare(nameOf(b.contractId), undefined, {
				sensitivity: 'base',
				numeric: true
			})
		);
	}
	return groups;
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

/** Native assets ride a `transfer.allow` intent instead of an approve leg. */
const NATIVE_TOKENS = new Set(['hive', 'hbd']);

type Tab = 'listings' | 'offers' | 'auctions' | 'mintspots' | 'tokens' | 'bundles' | 'buckets' | 'swaps' | 'rentals';

/**
 * Top-level section, one level ABOVE the market tabs. "Market" is every
 * order-book view (the `Tab` strip); "Explore" browses the whole NFT
 * population, listed or not. Explore isn't a market view, so it sits beside
 * the panel header rather than inside the tab strip.
 */
type Section = 'market' | 'explore';

const EXPLORE_HELP =
	'Every NFT on the network and who currently holds it, grouped by collection and then by mint template — including tokens nobody has listed for sale. Make an offer on anything you see to ask its holder to sell, or list one of your own.';

/** Two-sentence explainer per tab: what it is + what you can do here.
 *  Shown by the (?) popover next to the filter toggle. */
const TAB_HELP: Record<Tab, string> = {
	listings: 'Fixed-price NFT sales — browse what others have listed and buy instantly. You can list your own NFTs for sale (and sweep several at once).',
	bundles: 'Several NFTs sold together as one fixed-price lot. Buy a whole bundle in a single purchase, or create one from NFTs you own.',
	buckets: 'Random-draw sales — packs, raffles and gacha. You pay a fixed price and the CONTRACT picks which NFT you get, so the stacks and the odds are shown up front.',
	auctions: 'Timed NFT auctions — English (ascending bids) or Dutch (price declines until someone buys). Place bids on others’ auctions, or start your own.',
	rentals: 'Rent an NFT for a chosen duration at a price per block; the NFT is escrowed until the rental ends. Rent one that’s offered, or list your own for rental.',
	mintspots: 'Sell the right to mint new editions of a collection you own. Buyers pay to mint a fresh edition directly to themselves.',
	tokens: 'Fixed-price sales of fungible (ERC-20-style) tokens. Buy listed tokens, or sell your own at a set price per unit.',
	offers: 'Standing buy offers on NFTs, with the buyer’s funds escrowed until accepted. Make an offer on any NFT, or accept offers on NFTs you hold.',
	swaps: 'Trade one NFT directly for another, optionally with a token top-up. Propose a swap, or accept one proposed to you.'
};
type Sheet =
	// `nftContract`/`tokenId` prefill the form when the sheet is opened from
	// a specific NFT (the Explore tab) rather than from the toolbar.
	| { kind: 'sell'; nftContract?: string; tokenId?: string }
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
	| { kind: 'listBucket' }
	| { kind: 'buyBundle'; bundle: BundleListing }
	| { kind: 'proposeSwap' }
	| { kind: 'acceptSwap'; swap: SwapProposal }
	| { kind: 'listRental' }
	| { kind: 'rent'; rental: RentalListing }
	| { kind: 'admin'; nftContract?: string }
	| { kind: 'offer'; listing?: Listing; nftContract?: string; tokenId?: string }
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
	// The tab strip is a horizontal scroller once the tabs stop fitting (see
	// `.magi-market-tabs`), so a tab selected from elsewhere — or simply one
	// past the fold — can sit off-screen. Centre the active one.
	const tabsRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const strip = tabsRef.current;
		const active = strip?.querySelector<HTMLElement>('.magi-market-tab.active');
		if (!strip || !active) return;
		// Deliberately NOT scrollIntoView: that would also scroll the host
		// page vertically to the widget on mount. Only ever touch the strip's
		// own scrollLeft — a no-op when the tabs already fit.
		const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
		strip.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
	}, [tab]);
	// Top-level section, above the tab strip — see `Section`.
	const [section, setSection] = useState<Section>('market');
	// Explore's layout follows the PANEL's width, not the viewport's, so an
	// embed in a narrow column gets the stacked design even on a wide screen.
	const rootRef = useRef<HTMLDivElement>(null);
	const panelWidth = useElementWidth(rootRef);
	const exploreSplit = panelWidth >= EXPLORE_SPLIT_AT;
	// `panelWidth === 0` means "not measured yet", and the stacked row is the
	// one that can't overflow — so treat unknown as narrow. Worst case a wide
	// panel shows the stacked row for a single frame; the alternative is a
	// frame of horizontal overflow on every phone.
	const isNarrow = panelWidth < SUBTABS_STACK_AT;
	/** Selected collection in the split layout; null = fall back to the first. */
	const [exploreColl, setExploreColl] = useState<string | null>(null);
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
	const [buckets, setBuckets] = useState<BucketListing[]>([]);
	const [drawing, setDrawing] = useState<number | null>(null);
	const [swaps, setSwaps] = useState<SwapProposal[]>([]);
	const [rentals, setRentals] = useState<RentalListing[]>([]);
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [sheet, setSheet] = useState<Sheet>(null);
	// `${kind}:${id}` of the listing currently being cancelled (delisted).
	const [canceling, setCanceling] = useState<string | null>(null);

	// The connected `username` is bare (`tibfox`) while the indexer stores
	// accounts prefixed (`hive:tibfox`), so a raw `===` never matched and
	// users could buy/offer on their own listings. Normalize both sides.
	// Declared up here because the Explore memos below need it, and those in
	// turn feed `visibleNftItems`.
	const acctNorm = (s?: string) =>
		(s ?? '').trim().replace(/^@/, '').replace(/^hive:/, '').toLowerCase();
	const me = acctNorm(username);
	const isSelf = (account?: string) => !!me && acctNorm(account) === me;

	// ---- Explore: the whole NFT population, listed or not ----
	// Both reads are gated on the section being open so their paged indexer
	// requests don't run for everyone browsing the market tabs.
	const allNfts = useAllNfts(config, section === 'explore');
	const templates = useTemplateLinks(config, section === 'explore');
	const [exploreQuery, setExploreQuery] = useState('');

	// Aggregate the holdings into ONE ROW PER TOKEN, not per (token, holder).
	//
	// This matters beyond de-duplication: a magi-market offer targets
	// `(nftContract, tokenId)` and *any* holder may accept it — `MakeOfferPayload`
	// has no seller field and `doAcceptOffer` only bars the buyer themselves.
	// Rendering a tile per holder therefore showed, for a token held by 35
	// accounts, 35 "Make offer" buttons that all created the identical open
	// offer, and implied you were bidding on one specific person's copy.
	//
	// Marketplace-escrowed balances (`contract:<market>`) are excluded from the
	// holder list: they're auction/rental collateral mid-flight, not somebody's
	// holding.
	const exploreTokens = useMemo(() => {
		const byToken = new Map<
			string,
			{
				nftContract: string;
				tokenId: string;
				soulbound: boolean;
				holders: string[];
				totalUnits: bigint;
				myUnits: bigint;
			}
		>();
		for (const h of allNfts.holdings) {
			if (h.account.startsWith('contract:')) continue;
			const k = `${h.nftContract}:${h.tokenId}`;
			const row = byToken.get(k) ?? {
				nftContract: h.nftContract,
				tokenId: h.tokenId,
				soulbound: h.soulbound,
				holders: [] as string[],
				totalUnits: 0n,
				myUnits: 0n
			};
			row.holders.push(h.account);
			row.totalUnits += h.balance;
			if (isSelf(h.account)) row.myUnits += h.balance;
			byToken.set(k, row);
		}
		// Own holdings first within a collection, then by id — your inventory is
		// what you're most likely to act on.
		return Array.from(byToken.values()).map((t) => ({
			...t,
			// Soulbound tokens can only move while the COLLECTION OWNER holds
			// them, whoever else is holding.
			ownerHolds: t.holders.some((a) => acctNorm(a) === acctNorm(collMeta.owner(t.nftContract)))
		}));
	}, [allNfts.holdings, me, collMeta]); // eslint-disable-line react-hooks/exhaustive-deps

	// Scope means holder: "others" = a token someone else holds (what you'd
	// offer on), "yours" = tokens you hold. A token held by both you and
	// others appears in both, because both actions are real. With nobody
	// connected `isSelf` is always false, so "others" shows everything — the
	// right default for browsing without signing in.
	const exploreScoped = useMemo(
		() =>
			exploreTokens.filter((t) =>
				scope === 'yours' ? t.myUnits > 0n : t.holders.some((a) => !isSelf(a))
			),
		[exploreTokens, scope, me] // eslint-disable-line react-hooks/exhaustive-deps
	);

	// Search spans token id, any holder, collection name/id and template id,
	// so "alicante", "tibfox" and a collection name all find something.
	const exploreFiltered = useMemo(() => {
		const q = exploreQuery.trim().toLowerCase();
		if (!q) return exploreScoped;
		return exploreScoped.filter((t) => {
			const tpl = templates.templateOf(t.nftContract, t.tokenId);
			return (
				t.tokenId.toLowerCase().includes(q) ||
				t.holders.some((a) => a.toLowerCase().includes(q)) ||
				t.nftContract.toLowerCase().includes(q) ||
				collMeta.name(t.nftContract).toLowerCase().includes(q) ||
				(tpl ? tpl.toLowerCase().includes(q) : false)
			);
		});
	}, [exploreScoped, exploreQuery, templates, collMeta]);

	// Paged, not capped — everything is reachable via "Load more".
	//
	// Paged PER COLLECTION rather than over the flat list: on testnet one
	// collection holds 1022 of 1052 holdings, so a flat first page was 40
	// tiles from that single collection and every other collection looked
	// missing. Per-collection paging shows all collections immediately and
	// grows the one you're actually reading.
	const [exploreShownByColl, setExploreShownByColl] = useState<Record<string, number>>({});
	const shownCountFor = (contractId: string) => exploreShownByColl[contractId] ?? EXPLORE_PAGE;

	// A new search or scope must not keep deep pages — switching to a
	// 3-result search should not still render as though 400 rows were asked
	// for.
	useEffect(() => {
		setExploreShownByColl({});
	}, [exploreQuery, scope]);

	// Collection group → template sub-group. Tokens minted from the same
	// template are near-identical, so folding them under one collapsed
	// sub-header keeps a long grid readable; tokens with no template render
	// directly in the collection group.
	const exploreGroups = useMemo(() => {
		return groupByContract(exploreFiltered, collMeta.name).map((g) => {
			const shown = g.items.slice(0, shownCountFor(g.contractId));
			const loose: ExploreToken[] = [];
			const byTemplate = new Map<string, ExploreToken[]>();
			for (const h of shown) {
				const tpl = templates.templateOf(h.nftContract, h.tokenId);
				if (!tpl) {
					loose.push(h);
					continue;
				}
				const list = byTemplate.get(tpl) ?? [];
				list.push(h);
				byTemplate.set(tpl, list);
			}
			return {
				contractId: g.contractId,
				total: g.items.length,
				shownCount: shown.length,
				shown,
				loose,
				templateGroups: Array.from(byTemplate, ([templateId, items]) => ({ templateId, items })).sort(
					(a, b) => a.templateId.localeCompare(b.templateId)
				)
			};
		});
	}, [exploreFiltered, templates, exploreShownByColl]); // eslint-disable-line react-hooks/exhaustive-deps

	/** Every holding currently rendered, across all collection groups. */
	/**
	 * The collection whose contents the split layout is showing. Falls back to
	 * the first group so the detail pane is never blank, and self-heals when
	 * the selected collection drops out of the current search/scope.
	 */
	const exploreActiveGroup = useMemo(() => {
		if (exploreGroups.length === 0) return null;
		return exploreGroups.find((g) => g.contractId === exploreColl) ?? exploreGroups[0];
	}, [exploreGroups, exploreColl]);

	/** Holdings actually on screen — only the open collection in split mode. */
	const exploreShown = useMemo(
		() =>
			exploreSplit
				? exploreActiveGroup?.shown ?? []
				: exploreGroups.flatMap((g) => g.shown),
		[exploreGroups, exploreSplit, exploreActiveGroup]
	);

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
		if (tab === 'rentals') return rentals.map((r) => ({ nftContract: r.nftContract, tokenId: r.tokenId }));
		return [];
	}, [tab, listings, offers, auctions, mintSpots, rentals]);

	// Explore resolves images for exactly the page that's rendered, deduped
	// by token (the same token held by two accounts is two tiles, one image).
	// `useNftImages` caches and chunks, so paging in adds one small request.
	const exploreNftItems = useMemo<Array<{ nftContract: string; tokenId: string }>>(() => {
		const seen = new Set<string>();
		const out: Array<{ nftContract: string; tokenId: string }> = [];
		for (const h of exploreShown) {
			const k = `${h.nftContract}:${h.tokenId}`;
			if (seen.has(k)) continue;
			seen.add(k);
			out.push({ nftContract: h.nftContract, tokenId: h.tokenId });
		}
		return out;
	}, [exploreShown]);
	const nftImages = useNftImages(
		config,
		section === 'explore' ? exploreNftItems : visibleNftItems
	);

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
			else if (tab === 'buckets')
				setBuckets(
					await client.provider.getBuckets(
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
			setErr(humanizeContractError(e));
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
		// An accept/sale moved an NFT out of the wallet — re-read holdings so
		// the offers tab stops offering to accept with a token now gone, and
		// Explore stops attributing it to the previous holder.
		nftHoldings.refresh();
		allNfts.refresh();
	};

	// `acctNorm` / `me` / `isSelf` are declared above the Explore memos, which
	// need them before `visibleNftItems` runs.

	/**
	 * One Explore tile — a token and everyone holding it. Shared by the loose
	 * grid and the per-template sub-groups so both render identically.
	 *
	 * The holder line is informational, NOT a target: an offer is open to
	 * every holder of the token (see `ExploreToken`), so the copy says "offer
	 * to any holder" rather than naming one.
	 *
	 * Soulbound tokens can only move while the collection owner holds them
	 * (magi_nft's `safeTransferFrom` aborts unless `from == ownerAddr`), so an
	 * offer on one held only by others is unfulfillable — say so rather than
	 * offer a button that leads to a failing accept.
	 */
	const renderExploreTile = (t: ExploreToken) => {
		const others = t.holders.filter((a) => !isSelf(a));
		const stuck = t.soulbound && !t.ownerHolds;
		// "you", "alice", "you +3", "alice +34". The space before "+N" is
		// non-breaking so the count never gets orphaned onto its own line —
		// the tile is ~160px wide, so "held by" wraps away from the name and a
		// lone "+34" underneath read as a separate fact. `overflow-wrap:
		// anywhere` on the class still breaks a name too long to fit at all.
		const holderLine = (() => {
			const lead = t.myUnits > 0n ? 'you' : others[0]?.replace(/^hive:/, '') ?? 'nobody';
			const rest = t.holders.length - 1;
			return rest > 0 ? `${lead}\u00A0+${rest}` : lead;
		})();
		return (
			<MarketTile
				key={`${t.nftContract}:${t.tokenId}`}
				imageUrl={nftImages.get(t.nftContract, t.tokenId)}
				tokenId={t.tokenId}
				subtitle={
					<>
						×{t.totalUnits.toString()}
						{t.myUnits > 0n && t.myUnits !== t.totalUnits ? ` (${t.myUnits} yours)` : ''}
						{t.soulbound ? ' · soulbound' : ''}
					</>
				}
				price={
					<span
						className="magi-market-tile-holder"
						title={t.holders.map((a) => a.replace(/^hive:/, '')).join(', ')}
					>
						held by {holderLine}
					</span>
				}
				onOpen={() => setSheet({ kind: 'nftDetails', nftContract: t.nftContract, tokenId: t.tokenId })}
				actions={
					stuck ? (
						<span className="magi-market-field-hint">
							Soulbound — only the collection owner can transfer it
						</span>
					) : t.myUnits > 0n ? (
						<button type="button" className="magi-market-submit ghost"
							disabled={!username}
							onClick={() => setSheet({ kind: 'sell', nftContract: t.nftContract, tokenId: t.tokenId })}>
							List for sale
						</button>
					) : (
						<button type="button" className="magi-market-submit"
							disabled={!username}
							title={
								!username
									? 'Connect a wallet to make an offer'
									: t.holders.length > 1
										? `Open offer — any of the ${t.holders.length} holders can accept it`
										: 'Open offer — the holder can accept it'
							}
							onClick={() => setSheet({ kind: 'offer', nftContract: t.nftContract, tokenId: t.tokenId })}>
							{/* "any holder" only says something when there IS more than
							    one; on a single-holder token it's just noise. */}
							{t.holders.length > 1 ? 'Offer to any holder' : 'Make offer'}
						</button>
					)
				}
			/>
		);
	};

	/**
	 * The contents of one Explore collection: any template-less tokens, then a
	 * sub-group per mint template, then its own "Load more". Shared verbatim by
	 * the stacked accordion and the split layout's detail pane.
	 */
	const renderExploreGroupBody = (g: (typeof exploreGroups)[number]) => (
		<>
			{g.loose.length > 0 && (
				<div className="magi-market-grid">{g.loose.map((t) => renderExploreTile(t))}</div>
			)}
			{g.templateGroups.map((tg) => (
				<TemplateGroup
					key={tg.templateId}
					templateId={tg.templateId}
					count={tg.items.length}
					// Open on its own when it's the only thing in the collection —
					// collapsing a single result reads as "no results".
					defaultOpen={g.templateGroups.length === 1 && g.loose.length === 0}
				>
					{tg.items.map((t) => renderExploreTile(t))}
				</TemplateGroup>
			))}
			{g.shownCount < g.total && (
				<div className="magi-market-loadmore">
					<span className="magi-market-row-sub">
						Showing {g.shownCount} of {g.total}
					</span>
					<button
						type="button"
						className="magi-market-submit ghost"
						style={{ width: 'auto' }}
						onClick={() =>
							setExploreShownByColl((m) => ({
								...m,
								[g.contractId]: shownCountFor(g.contractId) + EXPLORE_PAGE
							}))
						}
					>
						Load more
					</button>
				</div>
			)}
		</>
	);

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
	const scopedBuckets = useMemo(() => buckets.filter((b) => inScope(b.seller)), [buckets, scope, me]); // eslint-disable-line react-hooks/exhaustive-deps
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
	// Seller-side gate for the offers tab: you can only fulfil an offer for
	// an NFT you actually hold.
	const nftHoldings = useUserNftHoldings(config, username);

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
	/**
	 * Draw from a bucket — one unit, or a whole pack.
	 *
	 * Payment mirrors every other purchase here: a native asset rides a
	 * `transfer.allow` intent on the call itself, while a magi_token-style
	 * asset needs an `approve` leg first, so the two are batched.
	 *
	 * There is no confirmation sheet on purpose. The buyer already sees the
	 * price and the odds on the card, and a bucket draw has no parameters to
	 * choose — quantity is fixed by the pack, and what you receive is the
	 * contract's to decide.
	 */
	async function drawFromBucket(b: BucketListing, mode: 'single' | 'pack') {
		if (!username || drawing !== null) return;
		const total = mode === 'pack' ? b.pricePerPack : b.pricePerDraw;
		setDrawing(b.bucketId);
		setErr(null);
		try {
			const isNative = NATIVE_TOKENS.has((b.paymentToken || '').toLowerCase());
			let txId: string;
			if (isNative) {
				const op = client.ops.buyFromBucketOp(
					username,
					{ bucketId: b.bucketId, mode, quantity: 1, maxTotalPrice: total },
					[{ type: 'transfer.allow', args: { limit: total, token: b.paymentToken } }]
				);
				txId = (await client.broadcast(op)).txId;
			} else {
				const { txIds } = await client.buyFromBucketWithPayment(username, {
					bucketId: b.bucketId,
					mode,
					quantity: 1,
					maxTotalPrice: total,
					paymentToken: b.paymentToken,
					total
				});
				txId = txIds[txIds.length - 1];
			}
			void txId;
			void load();
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		} finally {
			setDrawing(null);
		}
	}

	async function cancelListing(
		kind:
			| 'listing'
			| 'token'
			| 'auction'
			| 'mintspots'
			| 'offer'
			| 'settleAuction'
			| 'bundle'
			| 'bucket'
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
				case 'bucket':
					op = client.ops.delistBucketOp(username, { bucketId: id });
					break;
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
			setErr(humanizeContractError(e));
		} finally {
			setCanceling(null);
		}
	}

	const TABS: Array<{ id: Tab; label: string }> = [
		{ id: 'listings', label: 'Listings' },
		{ id: 'bundles', label: 'Bundles' },
		{ id: 'buckets', label: 'Buckets' },
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
		<div
			ref={rootRef}
			className={`magi-market${bare ? ' bare' : ''}${isNarrow ? ' is-narrow' : ''} ${className ?? ''}`}
		>
			{enableRefresh && (
				<RefreshButton
					refreshing={loading}
					onClick={() => {
						void load();
						nftHoldings.refresh();
						if (section === 'explore') allNfts.refresh();
					}}
				/>
			)}

			{!hideHeader && (
				<div className="magi-market-header">
					<div className="magi-market-badge">
						<span className="magi-market-dot" />
						<span className="magi-market-badge-text">
							{section === 'explore' ? 'MAGI EXPLORE' : 'MAGI MARKET'}
						</span>
					</div>
					<p className="magi-market-subtitle">
						{section === 'explore'
							? 'Every NFT on Magi and who holds it'
							: 'Buy, sell & auction NFTs on Magi'}
					</p>
				</div>
			)}

			{/* Top-level section switch, one level ABOVE the market tabs and at
			    the same level as the header — Explore isn't an order-book view,
			    so it doesn't belong among Listings/Auctions/…. */}
			<div className="magi-market-sections" role="tablist" aria-label="Panel section">
				{([
					{ id: 'market' as Section, label: 'Market' },
					{ id: 'explore' as Section, label: 'Explore' }
				]).map((s) => (
					<button
						key={s.id}
						type="button"
						role="tab"
						aria-selected={section === s.id}
						className={`magi-market-section${section === s.id ? ' active' : ''}`}
						onClick={() => setSection(s.id)}
					>
						{s.label}
					</button>
				))}
			</div>

			{section === 'market' && (
				<div className="magi-market-tabs" ref={tabsRef} role="tablist" aria-label="Market views">
					{TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={tab === t.id}
							className={`magi-market-tab ${tab === t.id ? 'active' : ''}`}
							onClick={() => setTab(t.id)}
						>
							{t.label}
						</button>
					))}
				</div>
			)}

			{section === 'explore' && (
				<div className="magi-market-search">
					<svg className="magi-market-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<circle cx="11" cy="11" r="8" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
					<input
						value={exploreQuery}
						onChange={(e) => setExploreQuery((e.target as HTMLInputElement).value)}
						placeholder="Search NFTs by id, holder, collection or template…"
						aria-label="Search NFTs"
						autoComplete="off"
						spellCheck={false}
					/>
					{exploreQuery && (
						<button type="button" onClick={() => setExploreQuery('')}>Clear</button>
					)}
				</div>
			)}

			<div className="magi-market-subtabs-row">
				<div className="magi-market-subtabs-action magi-market-subtabs-action--left">
					{section === 'market' && username && tab === 'listings' && (
						<>
							<ToolbarAction label="Sell an NFT" onClick={() => setSheet({ kind: 'sell' })} />
							<ToolbarAction label="Sweep" onClick={() => setSheet({ kind: 'sweep' })} style={{ marginLeft: '0.5rem' }} />
						</>
					)}
					{section === 'market' && username && tab === 'offers' && (
						<ToolbarAction label="Make an offer" onClick={() => setSheet({ kind: 'offer' })} />
					)}
					{section === 'market' && username && tab === 'auctions' && (
						<ToolbarAction label="New auction" onClick={() => setSheet({ kind: 'auction' })} />
					)}
					{section === 'market' && username && tab === 'mintspots' && (
						<ToolbarAction label="Sell mint spots" onClick={() => setSheet({ kind: 'mintspots' })} />
					)}
					{section === 'market' && username && tab === 'bundles' && (
						<ToolbarAction label="Create bundle" onClick={() => setSheet({ kind: 'listBundle' })} />
					)}
					{section === 'market' && username && tab === 'buckets' && (
						<ToolbarAction label="Open a bucket" onClick={() => setSheet({ kind: 'listBucket' })} />
					)}
					{section === 'market' && username && tab === 'swaps' && (
						<ToolbarAction label="Propose swap" onClick={() => setSheet({ kind: 'proposeSwap' })} />
					)}
					{section === 'market' && username && tab === 'rentals' && (
						<ToolbarAction label="List for rental" onClick={() => setSheet({ kind: 'listRental' })} />
					)}
					{section === 'market' && username && tab === 'tokens' && (
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
					{/* Explore has no price / payment-token / date field to filter
					    on, so opening the bar there would change nothing — worse
					    than having no toggle at all. */}
					{section !== 'explore' && (
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
					)}
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
								{section === 'explore' ? EXPLORE_HELP : TAB_HELP[tab]}
							</div>
						)}
					</div>
				</div>
			</div>

			{section === 'market' && filtersOpen && (
				<FilterBar
					value={filters}
					onChange={setFilters}
					tokenMeta={tokenMeta}
					hasUser={!!username}
				/>
			)}

			{section === 'market' && err && <div className="magi-market-state">{err}</div>}

			{section === 'market' && !err && loading && <Spinner label="Loading…" />}

			{section === 'market' && !err && !loading && tab === 'listings' && (
				filteredListings.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You haven't listed anything." : 'No active listings from others.'}
					</div>
				) : (
					groupByContract(filteredListings, collMeta.name).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							owner={collMeta.owner(g.contractId)}
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

			{section === 'market' && !err && !loading && tab === 'offers' && (
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
						})),
						collMeta.name
					).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							owner={collMeta.owner(g.contractId)}
							count={g.items.length}
							action={ownerGear(g.contractId)}
						>
							{g.items.map((o) => {
								const isCol = o.tokenId === '(collection)';
								// Only a holder can fulfil an offer — the contract pulls the
								// NFT from the accepter's wallet, so a non-holder's accept
								// aborts ("Insufficient NFT balance to fulfill offer") after
								// burning RC. A collection offer can be met with any token
								// of the collection; a token-specific one needs that id.
								// `null` = not yet known (still loading, or nobody
								// connected), so the button stays visible but disabled
								// rather than flickering in and out.
								const canAccept: boolean | null = !username
									? null
									: isCol
										? nftHoldings.holdsAnyIn(o.nftContract)
										: (() => {
											const b = nftHoldings.balanceOf(o.nftContract, o.tokenId);
											return b === null ? null : b > 0n;
										})();
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
													{canAccept !== false ? (
														<button type="button" className="magi-market-submit"
															disabled={!username || canAccept === null}
															title={
																!username
																	? 'Connect a wallet to accept offers'
																	: canAccept === null
																		? 'Checking your holdings…'
																		: undefined
															}
															onClick={() => setSheet({ kind: 'acceptOffer', offer: { ...o, tokenId: isCol ? '' : o.tokenId } })}>
															Accept
														</button>
													) : (
														<span className="magi-market-field-hint">
															{isCol ? 'You hold nothing from this collection' : "You don't hold this NFT"}
														</span>
													)}
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

			{section === 'market' && !err && !loading && tab === 'auctions' && (
				filteredAuctions.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active auctions." : 'No active auctions from others.'}
					</div>
				) : (
					groupByContract(filteredAuctions, collMeta.name).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							owner={collMeta.owner(g.contractId)}
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

			{section === 'market' && !err && !loading && tab === 'mintspots' && (
				filteredMintSpots.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active mint-spot listings." : 'No active mint-spot listings from others.'}
					</div>
				) : (
					groupByContract(filteredMintSpots, collMeta.name).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							owner={collMeta.owner(g.contractId)}
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

			{section === 'market' && !err && !loading && tab === 'tokens' && (
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

			{/* Explore — every NFT on the network and who holds it, grouped by
			    collection and then by mint template. Not a market view: these
			    tokens need not be listed, so the action is "ask the holder to
			    sell" (an offer), or for your own inventory, "list it". Its
			    loading/error state is its own (`allNfts`), not the market-view
			    `loading`/`err`. Paged, never capped — every match is reachable. */}
			{section === 'explore' && (
				allNfts.error ? (
					<div className="magi-market-state">{allNfts.error}</div>
				) : allNfts.loading && exploreShown.length === 0 ? (
					<Spinner label="Loading every NFT…" />
				) : exploreFiltered.length === 0 ? (
					<div className="magi-market-state">
						{exploreQuery.trim()
							? `Nothing matches “${exploreQuery.trim()}”.`
							: scope === 'yours'
								? "You don't hold any NFTs yet."
								: 'No NFTs found on this network.'}
					</div>
				) : (
					<>
						{allNfts.truncated && (
							<div className="magi-market-state">
								Showing a partial set — there are more NFTs than this view enumerates.
							</div>
						)}

						{/* Wide panel: collections down the left, the open one's
						    contents on the right. Narrow (or embedded in a narrow
						    column): the stacked accordion, which works at any width.
						    Driven by the PANEL's measured width, not the viewport. */}
						{exploreSplit ? (
							<div className="magi-market-explore-split">
								<nav className="magi-market-explore-list" aria-label="Collections">
									{exploreGroups.map((g) => {
										const active = g.contractId === exploreActiveGroup?.contractId;
										return (
											<button
												key={g.contractId}
												type="button"
												className={`magi-market-explore-collbtn${active ? ' active' : ''}`}
												aria-current={active}
												onClick={() => setExploreColl(g.contractId)}
											>
												<span className="magi-market-explore-collname">
													{collMeta.name(g.contractId)}
													{bareAccount(collMeta.owner(g.contractId)) && (
														<span className="magi-market-coll-owner">
															{' '}({bareAccount(collMeta.owner(g.contractId))})
														</span>
													)}
												</span>
												<span className="magi-market-coll-count">{g.total}</span>
											</button>
										);
									})}
								</nav>
								<div className="magi-market-explore-detail">
									{exploreActiveGroup && (
										<>
											<div className="magi-market-explore-detail-head">
												<span className="magi-market-coll-name">
													{collMeta.name(exploreActiveGroup.contractId)}
													{bareAccount(collMeta.owner(exploreActiveGroup.contractId)) && (
														<span className="magi-market-coll-owner">
															{' '}({bareAccount(collMeta.owner(exploreActiveGroup.contractId))})
														</span>
													)}
												</span>
												<span className="magi-market-coll-count">{exploreActiveGroup.total}</span>
												{ownerGear(exploreActiveGroup.contractId)}
											</div>
											<div className="magi-market-coll-stack">
												{renderExploreGroupBody(exploreActiveGroup)}
											</div>
										</>
									)}
								</div>
							</div>
						) : (
							exploreGroups.map((g) => (
								<CollectionGroup
									key={g.contractId}
									collectionName={collMeta.name(g.contractId)}
									owner={collMeta.owner(g.contractId)}
									count={g.total}
									action={ownerGear(g.contractId)}
									layout="stack"
								>
									{renderExploreGroupBody(g)}
								</CollectionGroup>
							))
						)}

						<div className="magi-market-loadmore">
							<span className="magi-market-row-sub">
								{exploreShown.length} of{' '}
								{exploreSplit
									? (exploreActiveGroup?.total ?? 0)
									: exploreFiltered.length}{' '}
								NFTs shown
								{!exploreSplit && exploreGroups.length > 1
									? ` across ${exploreGroups.length} collections`
									: ''}
							</span>
						</div>
					</>
				)
			)}

			{section === 'market' && !err && !loading && tab === 'bundles' && (
				scopedBundles.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active bundles." : 'No active bundles from others.'}
					</div>
				) : (
					scopedBundles.map((b) => (
						<BundleCard
							key={b.bundleId}
							client={client}
							bundle={b}
							mine={isSelf(b.seller)}
							username={username}
							canceling={canceling === `bundle:${b.bundleId}`}
							onBuy={() => setSheet({ kind: 'buyBundle', bundle: b })}
							onCancel={() => cancelListing('bundle', b.bundleId)}
							onOpenNft={(nftContract, tokenId) => setSheet({ kind: 'nftDetails', nftContract, tokenId })}
						/>
					))
				)
			)}

			{section === 'market' && !err && !loading && tab === 'buckets' && (
				scopedBuckets.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active buckets." : 'No active buckets from others.'}
					</div>
				) : (
					scopedBuckets.map((b) => (
						<BucketCard
							key={b.bucketId}
							client={client}
							bucket={b}
							mine={isSelf(b.seller)}
							username={username}
							busy={canceling === `bucket:${b.bucketId}` || drawing === b.bucketId}
							onDraw={() => drawFromBucket(b, 'single')}
							onBuyPack={() => drawFromBucket(b, 'pack')}
							onCancel={() => cancelListing('bucket', b.bucketId)}
							onOpenNft={(nftContract, tokenId) => setSheet({ kind: 'nftDetails', nftContract, tokenId })}
						/>
					))
				)
			)}

			{section === 'market' && !err && !loading && tab === 'swaps' && (
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

			{section === 'market' && !err && !loading && tab === 'rentals' && (
				scopedRentals.length === 0 ? (
					<div className="magi-market-state">
						{scope === 'yours' ? "You don't have active rental listings." : 'No rental listings from others.'}
					</div>
				) : (
					groupByContract(scopedRentals, collMeta.name).map((g) => (
						<CollectionGroup
							key={g.contractId}
							collectionName={collMeta.name(g.contractId)}
							owner={collMeta.owner(g.contractId)}
							count={g.items.length}
							action={ownerGear(g.contractId)}
						>
							{g.items.map((r) => {
								const rentedByMe = !!r.renter && isSelf(r.renter);
								const ended = r.endBlock != null && chainClock.currentBlock != null && chainClock.currentBlock >= r.endBlock;
								return (
									<MarketTile
										key={r.rentalId}
										imageUrl={nftImages.get(r.nftContract, r.tokenId)}
										tokenId={r.tokenId}
										subtitle={
											<>
												<div>{r.minBlocks}–{r.maxBlocks} blocks</div>
												{r.renter && <div className={ended ? 'magi-market-tile-expiry expired' : undefined}>{ended ? 'rental ended' : `rented by ${r.renter}`}</div>}
											</>
										}
										price={<>{tokenMeta.format(r.paymentToken, r.pricePerBlock)} {tokenMeta.symbol(r.paymentToken)} /block</>}
										onOpen={() => setSheet({ kind: 'nftDetails', nftContract: r.nftContract, tokenId: r.tokenId })}
										actions={
											<>
												{isSelf(r.owner) && !r.renter && (
													<button type="button" className="magi-market-submit ghost"
														disabled={canceling === `rental:${r.rentalId}`}
														onClick={() => cancelListing('rental', r.rentalId)}>
														{canceling === `rental:${r.rentalId}` ? 'Cancelling…' : 'Cancel'}
													</button>
												)}
												{isSelf(r.owner) && r.renter && ended && (
													<button type="button" className="magi-market-submit"
														disabled={canceling === `endRental:${r.rentalId}`}
														onClick={() => cancelListing('endRental', r.rentalId)}>
														{canceling === `endRental:${r.rentalId}` ? 'Ending…' : 'End rental'}
													</button>
												)}
												{rentedByMe && !ended && (
													<button type="button" className="magi-market-submit ghost"
														disabled={canceling === `endRentalEarly:${r.rentalId}`}
														onClick={() => cancelListing('endRentalEarly', r.rentalId)}>
														{canceling === `endRentalEarly:${r.rentalId}` ? 'Ending…' : 'End early'}
													</button>
												)}
												{!isSelf(r.owner) && !r.renter && (
													<button type="button" className="magi-market-submit"
														disabled={!username}
														onClick={() => setSheet({ kind: 'rent', rental: r })}>
														Rent
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

			{sheet?.kind === 'sell' && username && (
				<ListForm
					client={client}
					username={username}
					defaultNftContract={sheet.nftContract}
					defaultTokenId={sheet.tokenId}
					onSuccess={success}
					onClose={() => setSheet(null)}
				/>
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
			{sheet?.kind === 'listBucket' && username && (
				<ListBucketForm client={client} username={username} onSuccess={success} onClose={() => setSheet(null)} />
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
					defaultNftContract={sheet.listing?.nftContract ?? sheet.nftContract}
					defaultTokenId={sheet.listing?.tokenId ?? sheet.tokenId}
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
