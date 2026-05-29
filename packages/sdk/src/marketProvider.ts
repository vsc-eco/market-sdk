import {
	resolveGqlUrls,
	resolveIndexerUrls,
	resolveMarketContractId,
	type Auction,
	type BundleListing,
	type Listing,
	type MagiConfig,
	type MarketInfo,
	type MintSpotListing,
	type Offer,
	type PaymentToken,
	type RentalListing,
	type SwapProposal,
	type TokenListing
} from '@vsc.eco/market-core';
import { gqlFetchFailover, type GqlFetchOptions } from './graphql.js';

/**
 * Read-side provider for the marketplace.
 *
 * Two read planes, mirroring how okinoko-terminal reads VSC contracts:
 *
 *  - **VSC node** (`gqlUrls` → `getStateByKeys`): authoritative, schema-
 *    free, contract-id keyed. Used for `getMarketInfo()` (owner / fee /
 *    paused / pending owner) — the same keys the contract's `init`
 *    /governance entrypoints write.
 *  - **Indexer (Hasura)** (`indexerHasuraUrls`): event-projected fold
 *    views (`magi_market_listings`, `_offers`, `_auctions`, `_bundles`,
 *    `_swaps`, `_rentals`, `_mint_spots`, `_token_listings`). Each view
 *    exposes FLAT snake_case columns — exactly mirroring how
 *    @vsc.eco/token-sdk's `nftProvider` selects `magi_nft_*` columns and
 *    maps snake→camel. Column names follow `magi_market_views.yaml`.
 */
export interface MarketProvider {
	/** Marketplace governance/config — node state, schema-free. */
	getMarketInfo(): Promise<MarketInfo | null>;
	/**
	 * Current VSC L2 block height (`localNodeInfo.last_processed_block`).
	 * This is the height the contract's `getCurrentBlockHeight()` returns,
	 * so callers can turn a "duration in blocks" into the absolute
	 * `endBlock`/`expirationBlock`/`startBlock` the contract expects.
	 */
	getBlockHeight(): Promise<number | null>;
	getListings(filter?: {
		seller?: string;
		nftContract?: string;
		activeOnly?: boolean;
		limit?: number;
	}): Promise<Listing[]>;
	getListing(listingId: number): Promise<Listing | null>;
	getOffers(filter?: { buyer?: string; nftContract?: string; activeOnly?: boolean }): Promise<Offer[]>;
	getAuctions(filter?: { seller?: string; nftContract?: string; activeOnly?: boolean }): Promise<Auction[]>;
	getBundles(filter?: { seller?: string; activeOnly?: boolean }): Promise<BundleListing[]>;
	getSwaps(filter?: { proposer?: string; activeOnly?: boolean }): Promise<SwapProposal[]>;
	getRentals(filter?: { owner?: string; renter?: string; activeOnly?: boolean }): Promise<RentalListing[]>;
	getMintSpotListings(filter?: { lister?: string; nftContract?: string; activeOnly?: boolean }): Promise<MintSpotListing[]>;
	getTokenListings(filter?: { seller?: string; tokenContract?: string; activeOnly?: boolean }): Promise<TokenListing[]>;
	/**
	 * The marketplace's payment-token whitelist (the `magi_market_payment_tokens`
	 * fold view). Defaults to the currently-allowed set (`activeOnly` true);
	 * pass `activeOnly: false` to include de-whitelisted tokens. Native
	 * HIVE/HBD are not in this view — they're seeded in init without an event.
	 */
	getPaymentTokens(filter?: { activeOnly?: boolean }): Promise<PaymentToken[]>;
}

interface CreateMarketProviderOptions {
	fetchOptions?: GqlFetchOptions;
}

function num(v: unknown): number {
	if (typeof v === 'number') return v;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : 0;
	}
	return 0;
}

/** `numeric`/`text` columns come back as strings; normalise to a string. */
function str(v: unknown): string {
	if (v === null || v === undefined) return '';
	return String(v);
}

/** A nullable `numeric` → optional number (absent when null/unset). */
function optNum(v: unknown): number | undefined {
	if (v === null || v === undefined || v === '') return undefined;
	const n = num(v);
	return n;
}

// --- snake_case row shapes (exactly the columns each fold view emits) ---

interface ListingRow {
	listing_id: unknown;
	seller: string;
	nft_contract: string;
	token_id: string;
	amount: unknown;
	price_per_unit: string;
	payment_token: string;
	expiration_block: unknown;
	active: boolean;
	indexer_block_height: unknown;
	indexer_ts: string | null;
}

interface OfferRow {
	offer_id: unknown;
	buyer: string;
	nft_contract: string;
	token_id: string;
	amount: unknown;
	price_per_unit: string;
	payment_token: string;
	expiration_block: unknown;
	is_collection: boolean | null;
	active: boolean;
}

interface AuctionRow {
	auction_id: unknown;
	seller: string;
	nft_contract: string;
	token_id: string;
	amount: unknown;
	auction_type: string;
	start_price: string;
	end_price: string | null;
	start_block: unknown;
	end_block: unknown;
	high_bidder: string | null;
	high_bid: string | null;
	settled: boolean;
	active: boolean;
	indexer_block_height: unknown;
	indexer_ts: string | null;
}

interface BundleRow {
	bundle_id: unknown;
	seller: string;
	nft_contract: string;
	count: unknown;
	price: string;
	active: boolean;
}

interface SwapRow {
	swap_id: unknown;
	proposer: string;
	offered_nft: string;
	wanted_nft: string;
	active: boolean;
}

interface RentalRow {
	rental_id: unknown;
	owner: string;
	nft_contract: string;
	token_id: string;
	renter: string | null;
	end_block: unknown;
	active: boolean;
}

interface MintSpotRow {
	listing_id: unknown;
	lister: string;
	nft_contract: string;
	token_id: string;
	max_spots: unknown;
	sold: unknown;
	active: boolean;
	indexer_block_height: unknown;
	indexer_ts: string | null;
}

interface TokenListingRow {
	listing_id: unknown;
	seller: string;
	token_contract: string;
	amount: unknown;
	price_per_unit: string;
	payment_token: string;
	expiration_block: unknown;
	active: boolean;
	indexer_block_height: unknown;
	indexer_ts: string | null;
}

interface PaymentTokenRow {
	token: string;
	active: boolean;
	indexer_block_height: unknown;
	indexer_ts: string | null;
}

// --- column fragments (flat selection, like nftProvider's OVERVIEW_FRAGMENT) ---

const LISTING_COLS =
	'listing_id seller nft_contract token_id amount price_per_unit payment_token expiration_block active indexer_block_height indexer_ts';
const OFFER_COLS =
	'offer_id buyer nft_contract token_id amount price_per_unit payment_token expiration_block is_collection active';
const AUCTION_COLS =
	'auction_id seller nft_contract token_id amount auction_type start_price end_price start_block end_block high_bidder high_bid settled active indexer_block_height indexer_ts';
const BUNDLE_COLS = 'bundle_id seller nft_contract count price active';
const SWAP_COLS = 'swap_id proposer offered_nft wanted_nft active';
const RENTAL_COLS = 'rental_id owner nft_contract token_id renter end_block active';
const MINT_SPOT_COLS = 'listing_id lister nft_contract token_id max_spots sold active indexer_block_height indexer_ts';
const TOKEN_LISTING_COLS =
	'listing_id seller token_contract amount price_per_unit payment_token expiration_block active indexer_block_height indexer_ts';

const PAYMENT_TOKEN_COLS = 'token active indexer_block_height indexer_ts';

// --- snake → camel mappers ---

function mapListing(r: ListingRow): Listing {
	return {
		listingId: num(r.listing_id),
		seller: r.seller,
		nftContract: r.nft_contract,
		tokenId: str(r.token_id),
		amount: num(r.amount),
		paymentToken: r.payment_token,
		pricePerUnit: str(r.price_per_unit),
		active: !!r.active,
		expirationBlock: optNum(r.expiration_block),
		indexedAt: r.indexer_ts ?? undefined,
		indexedAtBlock: optNum(r.indexer_block_height)
	};
}

function mapOffer(r: OfferRow): Offer {
	return {
		offerId: num(r.offer_id),
		buyer: r.buyer,
		nftContract: r.nft_contract,
		tokenId: str(r.token_id),
		amount: num(r.amount),
		paymentToken: r.payment_token,
		pricePerUnit: str(r.price_per_unit),
		active: !!r.active,
		expirationBlock: optNum(r.expiration_block)
	};
}

function mapAuction(r: AuctionRow): Auction {
	return {
		auctionId: num(r.auction_id),
		seller: r.seller,
		nftContract: r.nft_contract,
		tokenId: str(r.token_id),
		amount: num(r.amount),
		// auction_created carries no paymentToken (settled in the listing
		// currency); leave empty so the widget falls back to its default.
		paymentToken: '',
		auctionType: r.auction_type === 'dutch' ? 'dutch' : 'english',
		startPrice: str(r.start_price),
		endPrice: r.end_price ? str(r.end_price) : undefined,
		startBlock: optNum(r.start_block),
		endBlock: num(r.end_block),
		highBidder: r.high_bidder ?? undefined,
		highBid: r.high_bid ? str(r.high_bid) : undefined,
		settled: !!r.settled,
		active: !!r.active,
		indexedAt: r.indexer_ts ?? undefined,
		indexedAtBlock: optNum(r.indexer_block_height)
	};
}

function mapBundle(r: BundleRow): BundleListing {
	return {
		bundleId: num(r.bundle_id),
		seller: r.seller,
		nftContract: r.nft_contract,
		// bundle_listed only carries a token count, not per-item ids; the
		// widget renders `items.length` so surface the count that way.
		items: Array.from({ length: num(r.count) }, () => ({ tokenId: '', amount: 1 })),
		paymentToken: '',
		price: str(r.price),
		active: !!r.active
	};
}

function mapSwap(r: SwapRow): SwapProposal {
	return {
		swapId: num(r.swap_id),
		proposer: r.proposer,
		offeredNft: r.offered_nft,
		offeredTokenId: '',
		offeredAmount: 0,
		wantedNft: r.wanted_nft,
		wantedTokenId: '',
		wantedAmount: 0,
		active: !!r.active
	};
}

function mapRental(r: RentalRow): RentalListing {
	return {
		rentalId: num(r.rental_id),
		owner: r.owner,
		nftContract: r.nft_contract,
		tokenId: str(r.token_id),
		amount: 0,
		paymentToken: '',
		pricePerBlock: '',
		minBlocks: 0,
		maxBlocks: 0,
		renter: r.renter ?? undefined,
		endBlock: optNum(r.end_block),
		active: !!r.active
	};
}

function mapMintSpot(r: MintSpotRow): MintSpotListing {
	return {
		listingId: num(r.listing_id),
		lister: r.lister,
		nftContract: r.nft_contract,
		tokenId: str(r.token_id),
		paymentToken: '',
		pricePerSpot: '',
		maxSpots: num(r.max_spots),
		sold: num(r.sold),
		active: !!r.active,
		indexedAt: r.indexer_ts ?? undefined,
		indexedAtBlock: optNum(r.indexer_block_height)
	};
}

function mapTokenListing(r: TokenListingRow): TokenListing {
	return {
		listingId: num(r.listing_id),
		seller: r.seller,
		tokenContract: r.token_contract,
		amount: str(r.amount),
		pricePerUnit: str(r.price_per_unit),
		paymentToken: r.payment_token,
		active: !!r.active,
		expirationBlock: optNum(r.expiration_block),
		indexedAt: r.indexer_ts ?? undefined,
		indexedAtBlock: optNum(r.indexer_block_height)
	};
}

function mapPaymentToken(r: PaymentTokenRow): PaymentToken {
	return {
		token: r.token,
		active: !!r.active,
		indexedAt: r.indexer_ts ?? undefined,
		indexedAtBlock: optNum(r.indexer_block_height)
	};
}

export function createMarketProvider(
	config: MagiConfig,
	opts: CreateMarketProviderOptions = {}
): MarketProvider {
	const fo = opts.fetchOptions ?? {};
	const indexerUrls = () => resolveIndexerUrls(config);
	const nodeUrls = () => resolveGqlUrls(config);
	const cid = () => resolveMarketContractId(config);

	async function getMarketInfo(): Promise<MarketInfo | null> {
		const q = `query S($c:String!,$k:[String!]!){ getStateByKeys(contractId:$c,keys:$k,encoding:"string") }`;
		const data = await gqlFetchFailover<{
			getStateByKeys: Record<string, string | null> | null;
		}>(nodeUrls(), q, {
			c: cid(),
			k: ['owner', 'pending_owner', 'fee_bps', 'fee_rcpt', 'paused', 'isInit']
		}, fo);
		const s = data.getStateByKeys;
		if (!s || s.isInit !== '1') return null;
		return {
			owner: s.owner ?? '',
			pendingOwner: s.pending_owner ?? undefined,
			feeBps: num(s.fee_bps),
			feeRecipient: s.fee_rcpt ?? '',
			paused: s.paused === '1'
		};
	}

	async function getBlockHeight(): Promise<number | null> {
		try {
			const d = await gqlFetchFailover<{
				localNodeInfo: { last_processed_block: number | null } | null;
			}>(nodeUrls(), '{ localNodeInfo { last_processed_block } }', {}, fo);
			const h = d.localNodeInfo?.last_processed_block;
			return typeof h === 'number' && h > 0 ? h : null;
		} catch {
			return null;
		}
	}

	/**
	 * Generic indexer list query. `view` is a `magi_market_*` fold view;
	 * `cols` is the flat snake_case column selection and `map` lifts each
	 * row to its camelCase domain type — exactly the shape token-sdk's
	 * `nftProvider` uses (`rows: <view>(where:$w){ <cols> }`). Failover +
	 * GqlFetchOptions are honoured exactly like token-sdk. An absent view
	 * yields `[]` rather than throwing, so writes/node-reads still work.
	 */
	async function indexerList<TRow, TOut>(
		view: string,
		cols: string,
		where: Record<string, unknown>,
		limit: number,
		map: (r: TRow) => TOut
	): Promise<TOut[]> {
		const q = `query L($w: ${view}_bool_exp, $l: Int){ rows: ${view}(where:$w, limit:$l, order_by:{indexer_block_height:desc}){ ${cols} } }`;
		try {
			const d = await gqlFetchFailover<{ rows: TRow[] }>(
				indexerUrls(),
				q,
				{ w: where, l: limit },
				fo
			);
			return (d.rows ?? []).map(map);
		} catch {
			return [];
		}
	}

	/**
	 * Auction-created + mint-spots-listed events don't carry the payment
	 * token field, so the indexer view leaves it empty. The contract DOES
	 * store it (`au|<id>|pt`, `msp|<id>|pt`). One batched `getStateByKeys`
	 * per result page hydrates `paymentToken` on the returned items — this
	 * is what the widget's payment-token filter compares against. Chunked
	 * to stay under the node's 100-key limit on `getStateByKeys`.
	 */
	/**
	 * Batch-fetch arbitrary suffix keys from contract state for a list of
	 * items keyed by `prefix|<id>|<suffix>`, then merge back into each item
	 * via the provided `set` callback. Used because the indexer view drops
	 * a few fields (auctions: paymentToken; mint spots: paymentToken + price)
	 * — see internal contract state in [[magi-market-progress]].
	 */
	async function hydrateState<T>(
		items: T[],
		prefix: 'au' | 'msp',
		idField: keyof T,
		suffixes: string[],
		merge: (item: T, vals: Record<string, string | null>) => T
	): Promise<T[]> {
		if (!items.length) return items;
		const keysFor = (it: T) => suffixes.map((s) => `${prefix}|${String(it[idField])}|${s}`);
		const CHUNK = 80;
		try {
			const state: Record<string, string | null> = {};
			const allKeys: string[] = [];
			for (const it of items) allKeys.push(...keysFor(it));
			for (let i = 0; i < allKeys.length; i += CHUNK) {
				const slice = allKeys.slice(i, i + CHUNK);
				const data = await gqlFetchFailover<{
					getStateByKeys: Record<string, string | null> | null;
				}>(
					nodeUrls(),
					`query S($c:String!,$k:[String!]!){ getStateByKeys(contractId:$c,keys:$k,encoding:"string") }`,
					{ c: cid(), k: slice },
					fo
				);
				const part = data.getStateByKeys ?? {};
				for (const k of Object.keys(part)) state[k] = part[k];
			}
			return items.map((it) => {
				const vals: Record<string, string | null> = {};
				for (const s of suffixes) vals[s] = state[`${prefix}|${String(it[idField])}|${s}`] ?? null;
				return merge(it, vals);
			});
		} catch {
			// Node unreachable or unauthorized — fall back to whatever the
			// indexer gave us. Filters that need the hydrated values will
			// simply not match strictly.
			return items;
		}
	}

	const activeWhere = (active?: boolean) =>
		active === false ? {} : { active: { _eq: true } };

	return {
		getMarketInfo,
		getBlockHeight,
		getListings: (f = {}) =>
			indexerList<ListingRow, Listing>(
				'magi_market_listings',
				LISTING_COLS,
				{
					...(f.seller ? { seller: { _eq: f.seller } } : {}),
					...(f.nftContract ? { nft_contract: { _eq: f.nftContract } } : {}),
					...activeWhere(f.activeOnly)
				},
				f.limit ?? 100,
				mapListing
			),
		getListing: async (listingId) => {
			const rows = await indexerList<ListingRow, Listing>(
				'magi_market_listings',
				LISTING_COLS,
				{ listing_id: { _eq: listingId } },
				1,
				mapListing
			);
			return rows[0] ?? null;
		},
		getOffers: (f = {}) =>
			indexerList<OfferRow, Offer>(
				'magi_market_offers',
				OFFER_COLS,
				{
					...(f.buyer ? { buyer: { _eq: f.buyer } } : {}),
					...(f.nftContract ? { nft_contract: { _eq: f.nftContract } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapOffer
			),
		getAuctions: async (f = {}) => {
			const rows = await indexerList<AuctionRow, Auction>(
				'magi_market_auctions',
				AUCTION_COLS,
				{
					...(f.seller ? { seller: { _eq: f.seller } } : {}),
					...(f.nftContract ? { nft_contract: { _eq: f.nftContract } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapAuction
			);
			return hydrateState(rows, 'au', 'auctionId', ['pt'], (it, v) => ({
				...it,
				paymentToken: v.pt ?? it.paymentToken ?? ''
			}));
		},
		getBundles: (f = {}) =>
			indexerList<BundleRow, BundleListing>(
				'magi_market_bundles',
				BUNDLE_COLS,
				{
					...(f.seller ? { seller: { _eq: f.seller } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapBundle
			),
		getSwaps: (f = {}) =>
			indexerList<SwapRow, SwapProposal>(
				'magi_market_swaps',
				SWAP_COLS,
				{
					...(f.proposer ? { proposer: { _eq: f.proposer } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapSwap
			),
		getRentals: (f = {}) =>
			indexerList<RentalRow, RentalListing>(
				'magi_market_rentals',
				RENTAL_COLS,
				{
					...(f.owner ? { owner: { _eq: f.owner } } : {}),
					...(f.renter ? { renter: { _eq: f.renter } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapRental
			),
		getMintSpotListings: async (f = {}) => {
			const rows = await indexerList<MintSpotRow, MintSpotListing>(
				'magi_market_mint_spots',
				MINT_SPOT_COLS,
				{
					...(f.lister ? { lister: { _eq: f.lister } } : {}),
					...(f.nftContract ? { nft_contract: { _eq: f.nftContract } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapMintSpot
			);
			return hydrateState(rows, 'msp', 'listingId', ['pt', 'p'], (it, v) => ({
				...it,
				paymentToken: v.pt ?? it.paymentToken ?? '',
				pricePerSpot: v.p ?? it.pricePerSpot ?? ''
			}));
		},
		getTokenListings: (f = {}) =>
			indexerList<TokenListingRow, TokenListing>(
				'magi_market_token_listings',
				TOKEN_LISTING_COLS,
				{
					...(f.seller ? { seller: { _eq: f.seller } } : {}),
					...(f.tokenContract ? { token_contract: { _eq: f.tokenContract } } : {}),
					...activeWhere(f.activeOnly)
				},
				100,
				mapTokenListing
			),
		getPaymentTokens: (f = {}) =>
			indexerList<PaymentTokenRow, PaymentToken>(
				'magi_market_payment_tokens',
				PAYMENT_TOKEN_COLS,
				{ ...activeWhere(f.activeOnly) },
				100,
				mapPaymentToken
			)
	};
}
