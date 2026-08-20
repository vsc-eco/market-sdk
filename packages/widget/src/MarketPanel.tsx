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
	type ActivityEvent,
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
import { BuyTile, type BuyItem, type BuyKind } from './actions/BuyTile.js';
import { DrawReveal } from './actions/DrawReveal.js';
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
import { looksTruncated } from '@vsc.eco/market-sdk';
import { humanizeContractError } from './contractErrors.js';
import { NftDetails } from './components/NftDetails.js';
import { ActivityFeed } from './components/ActivityFeed.js';
import {
	ExploreFilterBar,
	DEFAULT_EXPLORE_FILTERS,
	type ExploreFilterState
} from './components/ExploreFilterBar.js';
import { Spinner } from './components/Spinner.js';
import { PanelSurface } from './components/PanelSurface.js';
import { PanelView } from './components/PanelView.js';
import { Modal } from './components/Modal.js';
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

type Tab = 'buy' | 'offers' | 'auctions' | 'tokens' | 'swaps' | 'rentals';

/**
 * Singles, bundles, random packs and mint spots were four tabs; they are one
 * tab now because they are the same interaction — a fixed price and a Buy
 * button — and differ only in what arrives. The item shape and the tile that
 * renders it live in actions/BuyTile.tsx.
 */

/**
 * Top-level section, one level ABOVE the market tabs. "Market" is every
 * order-book view (the `Tab` strip); "Explore" browses the whole NFT
 * population, listed or not. Explore isn't a market view, so it sits beside
 * the panel header rather than inside the tab strip.
 */
type Section = 'market' | 'explore' | 'activity';

const EXPLORE_HELP =
	'Every NFT on the network and who currently holds it, grouped by collection and then by mint template — including tokens nobody has listed for sale. Make an offer on anything you see to ask its holder to sell, or list one of your own.';

/** Two-sentence explainer per tab: what it is + what you can do here.
 *  Shown by the (?) popover next to the filter toggle. */
const TAB_HELP: Record<Tab, string> = {
	buy: 'Everything on sale at a fixed price, grouped by collection: single NFTs, bundles sold as one lot, random-draw packs, and the right to mint a fresh edition. Each tile says which it is; buy instantly, or list something of your own.',
	auctions: 'Timed NFT auctions — English (ascending bids) or Dutch (price declines until someone buys). Place bids on others’ auctions, or start your own.',
	rentals: 'Rent an NFT for a chosen duration at a price per block; the NFT is escrowed until the rental ends. Rent one that’s offered, or list your own for rental.',
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
	| { kind: 'buyBundle'; bundle: BundleListing }
	// The rich card for a bundle/bucket is now a detail VIEW rather than a
	// row in the list: the merged tab renders every format as a uniform tile,
	// and the contents-and-odds detail opens on top of it.
	// Narrow panels get one "Create" entry point instead of five toolbar
	// buttons; this is the chooser behind it.
	| { kind: 'create' }
	// What a draw produced. The tx is the key: it is what ties the reveal to
	// THIS purchase rather than to everything the buyer has ever pulled.
	| { kind: 'reveal'; bucket: BucketListing; txId: string }
	| { kind: 'bundleDetail'; bundle: BundleListing }
	| { kind: 'bucketDetail'; bucket: BucketListing }
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

	const [tab, setTab] = useState<Tab>('buy');
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
	/**
	 * A full-panel view, shown INSTEAD of the browse UI.
	 *
	 * Creating a listing is a task, not an interruption — it needs the room a
	 * dialog cannot give it (an NFT grid, several steps), and nothing behind it
	 * is worth keeping visible while it is open.
	 */
	const [view, setView] = useState<null | { kind: 'listBucket' }>(null);
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
	const [activity, setActivity] = useState<ActivityEvent[]>([]);
	/** Which buy-now sources came back at the row ceiling. */
	const [truncated, setTruncated] = useState<string[]>([]);
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
	const [exploreFilters, setExploreFilters] = useState<ExploreFilterState>(DEFAULT_EXPLORE_FILTERS);

	/**
	 * Activity's filters. `who` and `collection` are sent to the indexer
	 * because they change WHICH rows exist; `kind` and `range` narrow what
	 * came back. Filtering "yours" client-side would have been a lie — it
	 * would show your events only if they happened to fall inside the last
	 * page of everyone's.
	 */
	const [activityFilters, setActivityFilters] = useState<{
		kind: 'any' | ActivityEvent['kind'];
		who: 'any' | 'me';
		collection: string;
		range: 'any' | '1d' | '7d' | '30d';
	}>({ kind: 'any', who: 'any', collection: '', range: 'any' });

	/** `contract:tokenId` of everything currently listed, for the availability filter. */
	const listedKeys = useMemo(
		() => new Set(listings.filter((l) => l.active).map((l) => `${l.nftContract}:${l.tokenId}`)),
		[listings]
	);

	const exploreFiltered = useMemo(() => {
		const q = exploreQuery.trim().toLowerCase();
		const f = exploreFilters;
		const narrowed = exploreScoped.filter((t) => {
			if (f.listed !== 'any') {
				const isListed = listedKeys.has(`${t.nftContract}:${t.tokenId}`);
				if (f.listed === 'listed' && !isListed) return false;
				if (f.listed === 'unlisted' && isListed) return false;
			}
			if (f.holding === 'mine' && t.myUnits <= 0n) return false;
			if (f.holding === 'others' && !t.holders.some((a) => !isSelf(a))) return false;
			if (f.soulbound === 'only' && !t.soulbound) return false;
			if (f.soulbound === 'hide' && t.soulbound) return false;
			return true;
		});
		const sorted =
			f.sort === 'id'
				? narrowed
				: [...narrowed].sort((a, b) =>
						f.sort === 'holders'
							? b.holders.length - a.holders.length
							: Number(b.totalUnits - a.totalUnits)
					);
		if (!q) return sorted;
		return sorted.filter((t) => {
			const tpl = templates.templateOf(t.nftContract, t.tokenId);
			return (
				t.tokenId.toLowerCase().includes(q) ||
				t.holders.some((a) => a.toLowerCase().includes(q)) ||
				t.nftContract.toLowerCase().includes(q) ||
				collMeta.name(t.nftContract).toLowerCase().includes(q) ||
				(tpl ? tpl.toLowerCase().includes(q) : false)
			);
		});
	}, [exploreScoped, exploreQuery, templates, collMeta, exploreFilters, listedKeys]); // eslint-disable-line react-hooks/exhaustive-deps

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
		if (tab === 'buy')
			return [
				...listings.map((l) => ({ nftContract: l.nftContract, tokenId: l.tokenId })),
				...mintSpots.map((m) => ({ nftContract: m.nftContract, tokenId: m.tokenId })),
				// A bundle's tile shows its first item. Buckets deliberately
				// have none: showing one card from a random draw would suggest
				// it is the card you get.
				...bundles
					.filter((b) => b.items.length > 0)
					.map((b) => ({ nftContract: b.nftContract, tokenId: b.items[0].tokenId }))
			];
		if (tab === 'offers')
			return offers
				.filter((o) => o.tokenId !== '')
				.map((o) => ({ nftContract: o.nftContract, tokenId: o.tokenId }));
		if (tab === 'auctions') return auctions.map((a) => ({ nftContract: a.nftContract, tokenId: a.tokenId }));
		if (tab === 'rentals') return rentals.map((r) => ({ nftContract: r.nftContract, tokenId: r.tokenId }));
		return [];
	}, [tab, listings, offers, auctions, mintSpots, bundles, rentals]);

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
			if (section === 'explore') {
				// Explore's own data comes from the holdings hooks; the only
				// thing load() owes it is which tokens are for sale, for the
				// availability filter.
				setListings(await client.provider.getListings({ activeOnly: true }));
				return;
			}
			if (section === 'activity') {
				const who =
					activityFilters.who === 'me'
						? username && username.startsWith('hive:')
							? username
							: username
								? `hive:${username}`
								: undefined
						: viewAccount;
				setActivity(
					await client.provider.getActivity({
						...(who ? { account: who } : {}),
						...(activityFilters.collection ? { nftContract: activityFilters.collection } : {}),
						limit: 60
					})
				);
				return;
			}
			if (tab === 'buy') {
				// Four sources, one tab. Fetched together rather than in
				// sequence: they are independent, and four round-trips one
				// after another would make the merged tab feel slower than the
				// four separate ones it replaces.
				const scoped = viewAccount ? { seller: viewAccount, activeOnly: true } : { activeOnly: true };
				const [ls, bn, bk, ms] = await Promise.all([
					client.provider.getListings(scoped),
					client.provider.getBundles(scoped),
					client.provider.getBuckets(scoped),
					client.provider.getMintSpotListings(
						viewAccount ? { lister: viewAccount, activeOnly: true } : { activeOnly: true }
					)
				]);
				setListings(ls);
				setBundles(bn);
				setBuckets(bk);
				setMintSpots(ms);
				// Hasura caps every response at 100 rows and ignores a larger
				// limit, so a full page is indistinguishable from "there is
				// more". Say so rather than presenting a page as the market.
				setTruncated(
					[ls, bn, bk, ms]
						.map((rows, i) => (looksTruncated(rows) ? ['listings', 'bundles', 'buckets', 'mint spots'][i] : null))
						.filter((x): x is string => x !== null)
				);
				// Recent sales drive the "sold today" badge on each collection
				// header. Fire-and-forget: a marketplace that cannot show its
				// heat is still a working marketplace.
				void client.provider
					.getActivity({ limit: 100 })
					.then(setActivity)
					.catch(() => undefined);
			} else if (tab === 'offers')
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
	}, [client, tab, section, viewAccount, activityFilters.who, activityFilters.collection, username]);

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
		const img = nftImages.get(t.nftContract, t.tokenId);
		const tpl = templates.templateOf(t.nftContract, t.tokenId);
		return (
			// Hover (or keyboard-focus) enlarges the art in place. Explore is a
			// wall of ~110px thumbnails you are browsing rather than shopping,
			// and opening the details panel to answer "what IS that" costs the
			// scroll position you were reading from.
			<div className="magi-market-preview-host" key={`${t.nftContract}:${t.tokenId}`}>
			<MarketTile
				imageUrl={img}
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
			{img && (
				<div className="magi-market-preview" aria-hidden="true">
					<img src={img} alt="" loading="lazy" />
					<span className="magi-market-preview-cap">
						#{t.tokenId}
						{tpl ? ` · ${tpl}` : ''}
					</span>
				</div>
			)}
			</div>
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
	const filteredTokenListings = useMemo(
		() => scopedTokenListings.filter((tl) => matchesFilters('tokenlisting', tl)),
		[scopedTokenListings, matchesFilters]
	);

	// ---- Buy now: four formats, one list ----

	/** Narrow the merged tab to one format. 'all' is the default. */
	const [buyKind, setBuyKind] = useState<'all' | BuyKind>('all');

	/**
	 * Everything buyable at a fixed price, normalised so one grid can render
	 * it. Each format keeps its own object on the item so the actions can
	 * still reach the fields they need — flattening to a lowest common
	 * denominator would have cost the per-format buttons.
	 */
	const buyItems = useMemo<BuyItem[]>(() => {
		const out: BuyItem[] = [];
		for (const l of scopedListings)
			out.push({
				key: `single:${l.listingId}`,
				kind: 'single',
				nftContract: l.nftContract,
				seller: l.seller,
				tokenId: l.tokenId,
				paymentToken: l.paymentToken,
				price: l.pricePerUnit,
				indexedAt: (l as { indexedAt?: string }).indexedAt,
				listing: l
			});
		for (const b of scopedBundles)
			out.push({
				key: `bundle:${b.bundleId}`,
				kind: 'bundle',
				nftContract: b.nftContract,
				seller: b.seller,
				tokenId: b.items[0]?.tokenId,
				paymentToken: b.paymentToken,
				price: b.price,
				indexedAt: (b as { indexedAt?: string }).indexedAt,
				bundle: b
			});
		for (const b of scopedBuckets)
			out.push({
				key: `bucket:${b.bucketId}`,
				kind: 'random',
				nftContract: b.nftContract,
				seller: b.seller,
				paymentToken: b.paymentToken,
				// Whichever way in is enabled — a bucket can sell single draws,
				// packs, or both, and the tile shows the cheaper entry price.
				price:
					b.pricePerDraw !== '0' && b.pricePerDraw !== ''
						? b.pricePerDraw
						: b.pricePerPack,
				indexedAt: (b as { indexedAt?: string }).indexedAt,
				bucket: b
			});
		for (const m of scopedMintSpots)
			out.push({
				key: `mint:${m.listingId}`,
				kind: 'mint',
				nftContract: m.nftContract,
				seller: m.lister,
				tokenId: m.tokenId,
				paymentToken: m.paymentToken,
				price: m.pricePerSpot,
				indexedAt: (m as { indexedAt?: string }).indexedAt,
				mintSpot: m
			});
		return out;
	}, [scopedListings, scopedBundles, scopedBuckets, scopedMintSpots]);

	/**
	 * The browse filters (date / price / payment token / affordability) run
	 * once over the merged list rather than per source. Before the merge each
	 * tab filtered its own array and bundles/buckets were filtered by nothing
	 * at all — in one shared grid that would show as a price filter that
	 * quietly skipped two of the four formats.
	 */
	const filteredBuyItems = useMemo(() => {
		const q = exploreQuery.trim().toLowerCase();
		return buyItems.filter((it) => {
			if (
				!matchesFilters('listing', {
					paymentToken: it.paymentToken,
					indexedAt: it.indexedAt,
					pricePerUnit: it.price
				})
			)
				return false;
			if (!q) return true;
			// Collection name first: it is what the groups are keyed on, so it
			// is what someone types when they want to get somewhere.
			return (
				collMeta.name(it.nftContract).toLowerCase().includes(q) ||
				it.nftContract.toLowerCase().includes(q) ||
				(it.tokenId ?? '').toLowerCase().includes(q) ||
				it.seller.toLowerCase().includes(q)
			);
		});
	}, [buyItems, matchesFilters, exploreQuery, collMeta]);

	/** Collections present in the feed, so the picker only offers real ones. */
	const activityCollections = useMemo(() => {
		const seen = new Set<string>();
		for (const e of activity) if (e.nftContract) seen.add(e.nftContract);
		if (activityFilters.collection) seen.add(activityFilters.collection);
		return Array.from(seen).sort((a, b) => collMeta.name(a).localeCompare(collMeta.name(b)));
	}, [activity, activityFilters.collection, collMeta]);

	/** Kind and age narrow what came back; who and collection were the query. */
	const shownActivity = useMemo(() => {
		const ms = { '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 } as const;
		const cutoff =
			activityFilters.range === 'any' ? null : Date.now() - ms[activityFilters.range];
		return activity.filter((e) => {
			if (activityFilters.kind !== 'any' && e.kind !== activityFilters.kind) return false;
			if (cutoff != null) {
				if (!e.at) return false;
				const t = new Date(e.at.endsWith('Z') ? e.at : `${e.at}Z`).getTime();
				if (!Number.isFinite(t) || t < cutoff) return false;
			}
			return true;
		});
	}, [activity, activityFilters.kind, activityFilters.range]);

	/**
	 * Sales per collection in the last day. A collection selling steadily and
	 * one that has never sold anything look identical without it, and that is
	 * the single most useful thing a browser can tell a buyer.
	 */
	const soldToday = useMemo(() => {
		const cutoff = Date.now() - 86_400_000;
		const m = new Map<string, number>();
		for (const e of activity) {
			if (!e.nftContract || !e.at) continue;
			const t = new Date(e.at.endsWith('Z') ? e.at : `${e.at}Z`).getTime();
			if (!Number.isFinite(t) || t < cutoff) continue;
			m.set(e.nftContract, (m.get(e.nftContract) ?? 0) + 1);
		}
		return m;
	}, [activity]);

	/** Per-format counts for the chip row — shown so an empty format is
	 *  visible as empty rather than as a chip that silently yields nothing. */
	const buyCounts = useMemo(() => {
		const c: Record<BuyKind, number> = { single: 0, bundle: 0, random: 0, mint: 0 };
		for (const it of filteredBuyItems) c[it.kind]++;
		return c;
	}, [filteredBuyItems]);

	/**
	 * Grouped by collection, cheapest first inside each group. Sorting by
	 * price rather than by format keeps the mixed grid from looking sorted by
	 * accident of which array was concatenated first.
	 */
	const buyGroups = useMemo(() => {
		const shown =
			buyKind === 'all' ? filteredBuyItems : filteredBuyItems.filter((it) => it.kind === buyKind);
		return groupByContract(shown, collMeta.name).map((g) => ({
			...g,
			items: [...g.items].sort((a, b) => {
				try {
					const ap = BigInt(a.price || '0');
					const bp = BigInt(b.price || '0');
					return ap < bp ? -1 : ap > bp ? 1 : 0;
				} catch {
					return 0;
				}
			})
		}));
	}, [filteredBuyItems, buyKind, collMeta]);

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
			// The tx id used to be dropped here, which is why a draw had no
			// payoff: you paid and the grid just refreshed. Hand it to the
			// reveal instead.
			if (txId) setSheet({ kind: 'reveal', bucket: b, txId });
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
		{ id: 'buy', label: 'Buy now' },
		{ id: 'auctions', label: 'Auctions' },
		{ id: 'rentals', label: 'Rentals' },
		{ id: 'tokens', label: 'Tokens' },
		// Offers kept after the primary six (not in the requested order list).
		{ id: 'offers', label: 'Offers' }
		// Swaps tab intentionally hidden for now — the swap flow still has
		// the native-top-up dud surface (acceptSwap's `from==caller` assert
		// makes any hive/hbd top-up fail). Re-enable here once that lands.
		// { id: 'swaps', label: 'Swaps' },
	];

	return (
		// Everything below is "inside the panel", so `Modal` renders its
		// children as a full-panel view rather than a floating dialog.
		<PanelSurface>
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

			{/* A full-panel view replaces the browse UI entirely while it is open.
			    Creating a listing needs the room — an NFT grid and several steps
			    — and a dialog caps its own height by design, which is what kept
			    squeezing the grid and pushing the buttons out of reach. */}
			{view?.kind === 'listBucket' && username && (
				<ListBucketForm
					inline
					client={client}
					username={username}
					onSuccess={(txId) => {
						success(txId);
						setView(null);
					}}
					onClose={() => setView(null)}
				/>
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
			{sheet?.kind === 'create' && username && (
				<Modal
					title="Sell or sweep"
					subtitle="Every way to put something on the market, or take several off it."
					onClose={() => setSheet(null)}
					confirmOnBackdrop={false}
				>
					<div className="magi-market-createlist">
						{[
							{ label: 'Sell an NFT', hint: 'One NFT at a fixed price.', go: () => setSheet({ kind: 'sell' as const }) },
							{ label: 'Create bundle', hint: 'Several NFTs as one all-or-nothing lot.', go: () => setSheet({ kind: 'listBundle' as const }) },
							{ label: 'Mystery sale', hint: 'A random draw — packs, raffles, gacha.', go: () => { setSheet(null); setView({ kind: 'listBucket' }); } },
							{ label: 'Sell mint spots', hint: 'The right to mint a fresh edition.', go: () => setSheet({ kind: 'mintspots' as const }) },
							{
								label: 'Sweep',
								hint: 'Buy the cheapest single listings of one collection at once.',
								go: () => {
									setBuyKind('single');
									setSheet({ kind: 'sweep' as const });
								}
							}
						].map((o) => (
							<button key={o.label} type="button" className="magi-market-createrow" onClick={o.go}>
								<span className="magi-market-createrow-label">{o.label}</span>
								<span className="magi-market-createrow-hint">{o.hint}</span>
							</button>
						))}
					</div>
				</Modal>
			)}
			{sheet?.kind === 'reveal' && (
				<PanelView
					title="You pulled"
					subtitle={`Mystery sale #${sheet.bucket.bucketId} · ${collMeta.name(sheet.bucket.nftContract)}`}
					onBack={() => setSheet(null)}
					confirmOnLeave={false}
				>
					<DrawReveal
						client={client}
						bucket={sheet.bucket}
						txId={sheet.txId}
						// A stack a pack always draws from is the one people buy
						// the pack for, so those pulls get called out.
						rareStacks={(sheet.bucket.packDraws ?? [])
							.map((n, i) => (n > 0 && i > 0 ? i : -1))
							.filter((i) => i >= 0)}
						onClose={() => setSheet(null)}
						onOpenNft={(nftContract, tokenId) => setSheet({ kind: 'nftDetails', nftContract, tokenId })}
					/>
				</PanelView>
			)}
			{sheet?.kind === 'bundleDetail' && (
				<PanelView
					title={`Bundle #${sheet.bundle.bundleId}`}
					subtitle={`${sheet.bundle.items.length} NFTs from ${collMeta.name(sheet.bundle.nftContract)} — sold as one lot`}
					onBack={() => setSheet(null)}
					confirmOnLeave={false}
				>
					<BundleCard
						client={client}
						bundle={sheet.bundle}
						mine={isSelf(sheet.bundle.seller)}
						username={username}
						canceling={canceling === `bundle:${sheet.bundle.bundleId}`}
						onBuy={() => setSheet({ kind: 'buyBundle', bundle: sheet.bundle })}
						onCancel={() => cancelListing('bundle', sheet.bundle.bundleId)}
						onOpenNft={(nftContract, tokenId) => setSheet({ kind: 'nftDetails', nftContract, tokenId })}
					/>
				</PanelView>
			)}
			{sheet?.kind === 'bucketDetail' && (
				<PanelView
					title={`Mystery sale #${sheet.bucket.bucketId}`}
					subtitle={`Random draw from ${collMeta.name(sheet.bucket.nftContract)} — every stack and its odds`}
					onBack={() => setSheet(null)}
					confirmOnLeave={false}
				>
					<BucketCard
						client={client}
						bucket={sheet.bucket}
						mine={isSelf(sheet.bucket.seller)}
						username={username}
						busy={canceling === `bucket:${sheet.bucket.bucketId}` || drawing === sheet.bucket.bucketId}
						onDraw={() => drawFromBucket(sheet.bucket, 'single')}
						onBuyPack={() => drawFromBucket(sheet.bucket, 'pack')}
						onCancel={() => cancelListing('bucket', sheet.bucket.bucketId)}
						onOpenNft={(nftContract, tokenId) => setSheet({ kind: 'nftDetails', nftContract, tokenId })}
					/>
				</PanelView>
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

			{/* Top-level section switch. Rendered OUTSIDE every section gate:
			    it used to live inside the market/explore branch, so opening
			    Activity removed the only control that could leave it. */}
			{!view && !sheet && (
					<div className="magi-market-sections" role="tablist" aria-label="Panel section">
						{([
							{ id: 'market' as Section, label: 'Market' },
							{ id: 'explore' as Section, label: 'Explore' },
							{ id: 'activity' as Section, label: 'Activity' }
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
			)}

			{!view && !sheet && section === 'activity' && (
				<>
					<p className="magi-market-subtitle" style={{ marginBottom: '0.7rem' }}>
						{viewAccount ? `What ${viewAccount.replace(/^hive:/, '')} has been buying` : 'What has been selling'}
					</p>
					<div className="magi-market-xfilters">
						<div className="magi-market-xfilter-group">
							<span className="magi-market-field-label">Kind</span>
							<div className="magi-market-xfilter-chips">
								{([
									['any', 'Everything'],
									['bought', 'Bought'],
									['mintSpotBought', 'Minted'],
									['bundleBought', 'Bundles'],
									['bucketPurchase', 'Packs'],
									['swept', 'Sweeps']
								] as Array<['any' | ActivityEvent['kind'], string]>).map(([id, label]) => (
									<button
										key={id}
										type="button"
										className={`magi-market-kindchip${activityFilters.kind === id ? ' active' : ''}`}
										onClick={() => setActivityFilters((f) => ({ ...f, kind: id }))}
									>
										{label}
									</button>
								))}
							</div>
						</div>
						<div className="magi-market-xfilter-group">
							<span className="magi-market-field-label">Who</span>
							<div className="magi-market-xfilter-chips">
								{([
									['any', 'Everyone'],
									['me', 'You']
								] as Array<['any' | 'me', string]>).map(([id, label]) => (
									<button
										key={id}
										type="button"
										disabled={id === 'me' && !username}
										className={`magi-market-kindchip${activityFilters.who === id ? ' active' : ''}`}
										onClick={() => setActivityFilters((f) => ({ ...f, who: id }))}
									>
										{label}
									</button>
								))}
							</div>
						</div>
						<div className="magi-market-xfilter-group">
							<span className="magi-market-field-label">When</span>
							<div className="magi-market-xfilter-chips">
								{([
									['any', 'Any time'],
									['1d', '24h'],
									['7d', '7 days'],
									['30d', '30 days']
								] as Array<['any' | '1d' | '7d' | '30d', string]>).map(([id, label]) => (
									<button
										key={id}
										type="button"
										className={`magi-market-kindchip${activityFilters.range === id ? ' active' : ''}`}
										onClick={() => setActivityFilters((f) => ({ ...f, range: id }))}
									>
										{label}
									</button>
								))}
							</div>
						</div>
						{activityCollections.length > 1 && (
							<div className="magi-market-xfilter-group">
								<span className="magi-market-field-label">Collection</span>
								<div className="magi-market-xfilter-chips">
									<button
										type="button"
										className={`magi-market-kindchip${activityFilters.collection === '' ? ' active' : ''}`}
										onClick={() => setActivityFilters((f) => ({ ...f, collection: '' }))}
									>
										All
									</button>
									{activityCollections.map((c) => (
										<button
											key={c}
											type="button"
											className={`magi-market-kindchip${activityFilters.collection === c ? ' active' : ''}`}
											onClick={() => setActivityFilters((f) => ({ ...f, collection: c }))}
										>
											{collMeta.name(c)}
										</button>
									))}
								</div>
							</div>
						)}
						<button
							type="button"
							className="magi-market-submit ghost magi-market-xfilter-reset"
							onClick={() =>
								setActivityFilters({ kind: 'any', who: 'any', collection: '', range: 'any' })
							}
						>
							Reset
						</button>
					</div>

					{loading ? (
						<div className="magi-market-state"><Spinner /></div>
					) : (
						<ActivityFeed
							events={shownActivity}
							me={me}
							collectionName={collMeta.name}
							formatPrice={(token, micro) =>
								token && micro ? `${tokenMeta.format(token, micro)} ${tokenMeta.symbol(token)}` : null
							}
							onOpenNft={(nftContract, tokenId) => setSheet({ kind: 'nftDetails', nftContract, tokenId })}
							emptyLabel={
								activity.length > 0
									? 'Nothing matches these filters.'
									: 'Nothing has sold yet.'
							}
						/>
					)}
				</>
			)}

			{!view && !sheet && section !== 'activity' && (
				<>
				{/* Top-level section switch, one level ABOVE the market tabs and at
				    the same level as the header — Explore isn't an order-book view,

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

				{/* One search box for both sections. It used to be Explore-only,
				    which was survivable when Market was eight narrow tabs — now
				    that Buy now groups by collection, "which collection" IS the
				    navigation and there was no way to ask for one. */}
				{(section === 'explore' || (section === 'market' && tab === 'buy')) && (
					<div className="magi-market-search">
						<svg className="magi-market-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<circle cx="11" cy="11" r="8" />
							<line x1="21" y1="21" x2="16.65" y2="16.65" />
						</svg>
						<input
							value={exploreQuery}
							onChange={(e) => setExploreQuery((e.target as HTMLInputElement).value)}
							placeholder={
								section === 'explore'
									? 'Search NFTs by id, holder, collection or template…'
									: 'Search by collection or NFT id…'
							}
							aria-label="Search"
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
						{section === 'market' && username && tab === 'buy' && (
							// Five ways to sell is three wrapped rows on a phone,
							// pushing the goods below the fold. Narrow panels get
							// one button and a chooser that has room to say what
							// each option actually does.
							isNarrow ? (
								<ToolbarAction label="Sell or sweep" onClick={() => setSheet({ kind: 'create' })} />
							) : (
								<>
									<ToolbarAction label="Sell an NFT" onClick={() => setSheet({ kind: 'sell' })} />
									<ToolbarAction label="Create bundle" onClick={() => setSheet({ kind: 'listBundle' })} style={{ marginLeft: '0.5rem' }} />
									<ToolbarAction label="Mystery sale" onClick={() => setView({ kind: 'listBucket' })} style={{ marginLeft: '0.5rem' }} />
									<ToolbarAction label="Sell mint spots" onClick={() => setSheet({ kind: 'mintspots' })} style={{ marginLeft: '0.5rem' }} />
									<ToolbarAction
										label="Sweep"
										// Sweep only handles single listings. Selecting that chip
										// first makes the tab show exactly what the form can act
										// on, instead of a mixed grid three-quarters of which it
										// silently ignores.
										onClick={() => {
											setBuyKind('single');
											setSheet({ kind: 'sweep' });
										}}
										style={{ marginLeft: '0.5rem' }}
									/>
								</>
							)
						)}
						{section === 'market' && username && tab === 'offers' && (
							<ToolbarAction label="Make an offer" onClick={() => setSheet({ kind: 'offer' })} />
						)}
						{section === 'market' && username && tab === 'auctions' && (
							<ToolbarAction label="New auction" onClick={() => setSheet({ kind: 'auction' })} />
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

				{section === 'explore' && filtersOpen && (
					<ExploreFilterBar
						value={exploreFilters}
						onChange={setExploreFilters}
						onReset={() => setExploreFilters(DEFAULT_EXPLORE_FILTERS)}
					/>
				)}

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

				{section === 'market' && !err && !loading && tab === 'buy' && (
					<>
					{/* Format filter. Counts are shown so an empty format reads as
					    empty rather than as a chip that silently yields nothing. */}
					<div className="magi-market-kindchips">
						{([
							['all', 'Everything', filteredBuyItems.length],
							['single', 'Single NFTs', buyCounts.single],
							['bundle', 'Bundles', buyCounts.bundle],
							['random', 'Random packs', buyCounts.random],
							['mint', 'Mint spots', buyCounts.mint]
						] as Array<[('all' | BuyKind), string, number]>).map(([id, label, n]) => (
							<button
								key={id}
								type="button"
								className={`magi-market-kindchip${buyKind === id ? ' active' : ''}`}
								onClick={() => setBuyKind(id)}
							>
								{label}<span className="magi-market-kindchip-count">{n}</span>
							</button>
						))}
					</div>

					{truncated.length > 0 && (
						<p className="magi-market-field-hint magi-market-truncated">
							Showing the first 100 {truncated.join(', ')} — there may be more than fits one page.
						</p>
					)}

					{buyGroups.length === 0 ? (
						<div className="magi-market-state">
							{scope === 'yours'
								? "You don't have anything on sale."
								: 'Nothing on sale from others right now.'}
						</div>
					) : (
						buyGroups.map((g) => (
							<CollectionGroup
								key={g.contractId}
								collectionName={collMeta.name(g.contractId)}
								owner={collMeta.owner(g.contractId)}
								count={g.items.length}
								action={
									<>
										{(soldToday.get(g.contractId) ?? 0) > 0 && (
											<span className="magi-market-heat">
												{soldToday.get(g.contractId)} sold today
											</span>
										)}
										{ownerGear(g.contractId)}
									</>
								}
							>
								{g.items.map((it) => (
									<BuyTile
										key={it.key}
										item={it}
										username={username}
										isSelf={isSelf}
										tokenMeta={tokenMeta}
										nftImages={nftImages}
										chainClock={chainClock}
										formatCountdown={formatCountdown}
										formatDateTime={formatGermanDateTime}
										canceling={canceling}
										drawing={drawing}
										onSheet={setSheet}
										onCancel={cancelListing}
										onDraw={drawFromBucket}
									/>
								))}
							</CollectionGroup>
						))
					)}
					</>
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
				</>
			)}

		</div>
		</PanelSurface>
	);
}
