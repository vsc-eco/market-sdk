import {
	resolveGqlUrls,
	resolveIndexerUrls,
	resolveMarketContractId,
	type Auction,
	type BundleListing,
	type BucketListing,
	type BucketEntry,
	type BucketStack,
	type BucketDraw,
	type ActivityEvent,
	type ActivityKind,
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
	/**
	 * The per-item NFTs of one bundle, read from node state — the
	 * `magi_market_bundles` view only carries the item COUNT, so this reads
	 * the `bnd|<id>|<i>_ti` / `_amt` / `nc` keys directly to recover the
	 * actual token ids (e.g. to render the bundle's contents).
	 */
	getBundleItems(bundleId: number): Promise<{ nftContract: string; items: Array<{ tokenId: string; amount: number }> }>;
	/**
	 * Buckets — fixed-price sales where the CONTRACT picks the unit. Reads the
	 * `magi_market_buckets` fold view.
	 */
	getBuckets(filter?: { seller?: string; nftContract?: string; activeOnly?: boolean }): Promise<BucketListing[]>;
	/**
	 * What is actually still inside a bucket, per token. Unlike bundles this
	 * does NOT need a node state read — the contract emits its entries, so the
	 * indexer can expand them. That is deliberate: a contract-picked draw is
	 * only fair if the stack is public, so buyers can compute their own odds.
	 */
	getBucketEntries(bucketId: number): Promise<BucketEntry[]>;
	/**
	 * Units left per stack. Check this before offering a pack: a bucket with
	 * guaranteed slots drains unevenly, so the grand total can look healthy
	 * while the guaranteed stack is empty and no pack can be filled.
	 */
	getBucketStacks(bucketId: number): Promise<BucketStack[]>;
	/** What a purchase drew, in contract order — the pack reveal reads this. */
	getBucketDraws(f?: { txId?: string; buyer?: string; bucketId?: number; limit?: number }): Promise<BucketDraw[]>;
	/** Completed purchases across every format, newest first. */
	getActivity(f?: { account?: string; nftContract?: string; limit?: number }): Promise<ActivityEvent[]>;
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

interface BucketRow {
	bucket_id: unknown;
	name?: unknown;
	cover_token_id?: unknown;
	cover_token_ids?: unknown;
	seller: string;
	nft_contract: string;
	payment_token: string;
	price_per_draw: string;
	price_per_pack: string;
	pack_draws: string;
	expiration_block: unknown;
	fee_bps: unknown;
	royalty_bps: unknown;
	royalty_recipient: string;
	entry_count: unknown;
	units_stocked: unknown;
	units_left: unknown;
	units_left_reported: unknown;
	units_drawn: unknown;
	units_dropped: unknown;
	purchases: unknown;
	sold_out: boolean;
	delisted: boolean;
	active: boolean;
}

interface BucketEntryRow {
	bucket_id: unknown;
	token_id: string;
	stack: unknown;
	amount_stocked: unknown;
	amount_drawn: unknown;
	amount_dropped: unknown;
	amount_left: unknown;
}

interface BucketDrawRow {
	bucket_id: unknown;
	buyer: unknown;
	token_id: unknown;
	stack: unknown;
	draw_index: unknown;
	indexer_tx_hash?: unknown;
	indexer_ts?: unknown;
}

interface ActivityRow {
	kind: unknown;
	actor: unknown;
	nft_contract?: unknown;
	token_id?: unknown;
	price?: unknown;
	payment_token?: unknown;
	count?: unknown;
	indexer_tx_hash?: unknown;
	indexer_block_height?: unknown;
	indexer_ts?: unknown;
}

interface BucketStackRow {
	bucket_id: unknown;
	stack: unknown;
	units_stocked: unknown;
	units_left: unknown;
	distinct_tokens: unknown;
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
const BUCKET_COLS =
	'bucket_id name seller nft_contract payment_token price_per_draw price_per_pack pack_draws ' +
	'expiration_block fee_bps royalty_bps royalty_recipient entry_count units_stocked units_left ' +
	'units_left_reported units_drawn units_dropped purchases sold_out delisted active cover_token_id cover_token_ids ' +
	'indexer_block_height indexer_ts';
const BUCKET_ENTRY_COLS = 'bucket_id token_id stack amount_stocked amount_drawn amount_dropped amount_left';
const BUCKET_STACK_COLS = 'bucket_id stack units_stocked units_left distinct_tokens';
const BUCKET_DRAW_COLS = 'bucket_id buyer token_id stack draw_index indexer_tx_hash indexer_ts';
const ACTIVITY_COLS =
	'kind actor nft_contract token_id price payment_token count indexer_tx_hash indexer_block_height indexer_ts';
/**
 * A bucket may hold up to 512 entries, but the indexer's Hasura role caps EVERY
 * response at 100 rows and silently ignores a larger `limit`. Asking for 100 is
 * therefore the honest maximum; a fuller bucket needs paging, which the widget
 * does not need yet since it renders odds from what it can see.
 */
// A bucket holds up to 512 distinct tokens, and the odds shown to a buyer are
// computed from what we can see — reading only the first hundred published
// odds that were simply wrong.
const MAX_BUCKET_ENTRY_ROWS = 512;
/**
 * How many rows a browse list will read at most, now that reads are paged.
 * Not unlimited: a client that walks a hundred pages to render a grid is its
 * own kind of broken, and the panel says when a list stopped here.
 */
export const MARKET_LIST_MAX = 500;
/** MaxBucketStacks in the contract is 8; a little headroom costs one page. */
const MaxBucketStacksRows = 16;

/**
 * The row ceiling Hasura enforces on every view. A result of exactly this
 * length is indistinguishable from a truncated one, so anything that renders
 * a list has to be able to SAY it may be incomplete rather than quietly
 * presenting a page as the whole market.
 */
export const INDEXER_ROW_CAP = 100;

/**
 * Did this result stop at the ceiling rather than at the end of the data?
 *
 * Reads are paged now, so a full 100-row page no longer means "truncated" —
 * only reaching MARKET_LIST_MAX does.
 */
export function looksTruncated(rows: { length: number }, limit = MARKET_LIST_MAX): boolean {
	return rows.length >= limit;
}
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

/** `pack_draws` arrives as the JSON text the contract emitted, e.g. "[4,1]". */
function parsePackDraws(raw: unknown): number[] {
	if (Array.isArray(raw)) return raw.map((n) => num(n));
	if (typeof raw !== 'string' || raw.trim() === '') return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.map((n) => num(n)) : [];
	} catch {
		return [];
	}
}

function mapBucket(r: BucketRow): BucketListing {
	const packDraws = parsePackDraws(r.pack_draws);
	return {
		bucketId: num(r.bucket_id),
		name: r.name ? str(r.name) : undefined,
		coverTokenId: r.cover_token_id ? str(r.cover_token_id) : undefined,
		coverTokenIds: Array.isArray(r.cover_token_ids)
			? (r.cover_token_ids as unknown[]).map((t) => str(t)).filter(Boolean)
			: undefined,
		seller: r.seller,
		nftContract: r.nft_contract,
		paymentToken: r.payment_token,
		pricePerDraw: str(r.price_per_draw),
		pricePerPack: str(r.price_per_pack),
		packDraws,
		packSize: packDraws.reduce((a, b) => a + b, 0),
		expirationBlock: num(r.expiration_block),
		feeBps: num(r.fee_bps),
		royaltyBps: num(r.royalty_bps),
		royaltyRecipient: r.royalty_recipient ?? '',
		entryCount: num(r.entry_count),
		unitsStocked: num(r.units_stocked),
		unitsLeft: num(r.units_left),
		unitsLeftReported: r.units_left_reported == null ? null : num(r.units_left_reported),
		unitsDrawn: num(r.units_drawn),
		unitsDropped: num(r.units_dropped),
		purchases: num(r.purchases),
		soldOut: !!r.sold_out,
		delisted: !!r.delisted,
		active: !!r.active
	};
}

function mapBucketEntry(r: BucketEntryRow): BucketEntry {
	return {
		bucketId: num(r.bucket_id),
		tokenId: r.token_id,
		stack: num(r.stack),
		amountStocked: num(r.amount_stocked),
		amountDrawn: num(r.amount_drawn),
		amountDropped: num(r.amount_dropped),
		amountLeft: num(r.amount_left)
	};
}

function mapBucketDraw(r: BucketDrawRow): BucketDraw {
	return {
		bucketId: num(r.bucket_id),
		buyer: str(r.buyer),
		tokenId: str(r.token_id),
		stack: num(r.stack),
		drawIndex: num(r.draw_index),
		txId: r.indexer_tx_hash ? str(r.indexer_tx_hash) : undefined,
		at: r.indexer_ts ? str(r.indexer_ts) : undefined
	};
}

function mapActivity(r: ActivityRow): ActivityEvent {
	return {
		kind: str(r.kind) as ActivityKind,
		actor: str(r.actor),
		nftContract: r.nft_contract ? str(r.nft_contract) : undefined,
		tokenId: r.token_id ? str(r.token_id) : undefined,
		price: r.price != null ? str(r.price) : undefined,
		paymentToken: r.payment_token ? str(r.payment_token) : undefined,
		count: r.count != null ? num(r.count) : undefined,
		txId: r.indexer_tx_hash ? str(r.indexer_tx_hash) : undefined,
		blockHeight: r.indexer_block_height != null ? num(r.indexer_block_height) : undefined,
		at: r.indexer_ts ? str(r.indexer_ts) : undefined
	};
}

function mapBucketStack(r: BucketStackRow): BucketStack {
	return {
		bucketId: num(r.bucket_id),
		stack: num(r.stack),
		unitsStocked: num(r.units_stocked),
		unitsLeft: num(r.units_left),
		distinctTokens: num(r.distinct_tokens)
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
	/**
	 * Like `indexerList` but without an `order_by`.
	 *
	 * The bucket entry/stack views are GROUPED aggregates spanning a listing and
	 * every restock, so they carry no single indexer_block_height to sort on —
	 * asking Hasura to order by it would just error.
	 */
	/**
	 * Read up to `want` rows, a page at a time.
	 *
	 * Hasura caps EVERY response at 100 rows and ignores a larger `limit`, so
	 * a single-shot query does not fail when there is more — it just stops.
	 * That is invisible until a market has more than a hundred of anything,
	 * at which point it quietly shows a slice and calls it the market.
	 *
	 * `orderBy` must be a TOTAL order. `offset` over a partial one is not a
	 * stable window: rows tied on the sort key can move between pages, so the
	 * same row comes back twice while another is never seen.
	 */
	async function pageAll<TRow>(
		view: string,
		cols: string,
		where: Record<string, unknown>,
		orderBy: string,
		want: number
	): Promise<TRow[]> {
		const PAGE = Math.min(INDEXER_ROW_CAP, want);
		const out: TRow[] = [];
		for (let offset = 0; out.length < want; offset += PAGE) {
			const q = `query L($w: ${view}_bool_exp, $l: Int, $o: Int){ rows: ${view}(where:$w, limit:$l, offset:$o, order_by:${orderBy}){ ${cols} } }`;
			let rows: TRow[];
			try {
				const d = await gqlFetchFailover<{ rows: TRow[] }>(
					indexerUrls(),
					q,
					{ w: where, l: PAGE, o: offset },
					fo
				);
				rows = d.rows ?? [];
			} catch {
				// A failed page returns what we already have rather than
				// nothing: a partial market beats an empty one.
				break;
			}
			out.push(...rows);
			// Short page = last page. An exactly-full one is ambiguous and
			// costs one more request to resolve.
			if (rows.length < PAGE) break;
		}
		return out.slice(0, want);
	}

	/**
	 * Like `indexerList` but for the GROUPED aggregate views (bucket entries
	 * and stacks), which span a listing and every restock and so carry no
	 * single indexer_block_height to sort on — asking Hasura to order by it
	 * errors. The caller supplies the key that makes the order total.
	 */
	async function indexerListUnordered<TRow, TOut>(
		view: string,
		cols: string,
		where: Record<string, unknown>,
		limit: number,
		map: (r: TRow) => TOut,
		orderBy = '{}'
	): Promise<TOut[]> {
		const rows = await pageAll<TRow>(view, cols, where, orderBy, limit);
		return rows.map(map);
	}

	async function indexerList<TRow, TOut>(
		view: string,
		cols: string,
		where: Record<string, unknown>,
		limit: number,
		map: (r: TRow) => TOut
	): Promise<TOut[]> {
		// Newest first, then the view's id column so the order is total —
		// every COLS list starts with one (listing_id, bucket_id, swap_id…).
		const idCol = cols.trim().split(/\s+/)[0];
		const orderBy = `[{indexer_block_height:desc},{${idCol}:asc}]`;
		const rows = await pageAll<TRow>(view, cols, where, orderBy, limit);
		return rows.map(map);
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
				f.limit ?? MARKET_LIST_MAX,
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
				MARKET_LIST_MAX,
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
				MARKET_LIST_MAX,
				mapAuction
			);
			return hydrateState(rows, 'au', 'auctionId', ['pt'], (it, v) => ({
				...it,
				paymentToken: v.pt ?? it.paymentToken ?? ''
			}));
		},
		getBuckets: (f = {}) =>
			indexerList<BucketRow, BucketListing>(
				'magi_market_buckets',
				BUCKET_COLS,
				{
					...(f.seller ? { seller: { _eq: f.seller } } : {}),
					...(f.nftContract ? { nft_contract: { _eq: f.nftContract } } : {}),
					...activeWhere(f.activeOnly)
				},
				MARKET_LIST_MAX,
				mapBucket
			),
		getBucketEntries: (bucketId: number) =>
			indexerListUnordered<BucketEntryRow, BucketEntry>(
				'magi_market_bucket_entries',
				BUCKET_ENTRY_COLS,
				{ bucket_id: { _eq: bucketId } },
				MAX_BUCKET_ENTRY_ROWS,
				mapBucketEntry,
				'[{bucket_id:asc},{stack:asc},{token_id:asc}]'
			),
		getBucketStacks: (bucketId: number) =>
			indexerListUnordered<BucketStackRow, BucketStack>(
				'magi_market_bucket_stacks',
				BUCKET_STACK_COLS,
				{ bucket_id: { _eq: bucketId } },
				MaxBucketStacksRows,
				mapBucketStack,
				'[{bucket_id:asc},{stack:asc}]'
			),
		/**
		 * The NFTs a purchase actually produced, in the order the contract
		 * drew them. Filtered by tx so a pack reveal shows exactly what THIS
		 * purchase yielded — the buyer may own others from earlier draws.
		 */
		getBucketDraws: (f: { txId?: string; buyer?: string; bucketId?: number; limit?: number } = {}) => {
			const where: Record<string, unknown> = {};
			if (f.txId) where.indexer_tx_hash = { _eq: f.txId };
			if (f.buyer) where.buyer = { _eq: f.buyer };
			if (f.bucketId != null) where.bucket_id = { _eq: f.bucketId };
			return indexerListUnordered<BucketDrawRow, BucketDraw>(
				'magi_market_bucket_draw_events',
				BUCKET_DRAW_COLS,
				where,
				f.limit ?? 64,
				mapBucketDraw,
				'[{bucket_id:asc},{draw_index:asc},{token_id:asc}]'
			);
		},
		/** Completed purchases, newest first. */
		getActivity: (f: { account?: string; nftContract?: string; limit?: number } = {}) => {
			const where: Record<string, unknown> = {};
			if (f.account) where.actor = { _eq: f.account };
			if (f.nftContract) where.nft_contract = { _eq: f.nftContract };
			return indexerList<ActivityRow, ActivityEvent>(
				'magi_market_activity',
				ACTIVITY_COLS,
				where,
				f.limit ?? 40,
				mapActivity
			);
		},
		getBundles: async (f = {}) => {
			const rows = await indexerList<BundleRow, BundleListing>(
				'magi_market_bundles',
				BUNDLE_COLS,
				{
					...(f.seller ? { seller: { _eq: f.seller } } : {}),
					...activeWhere(f.activeOnly)
				},
				MARKET_LIST_MAX,
				mapBundle
			);
			// `bundle_listed` carries a COUNT, not the ids — so a bundle from
			// the view has placeholder items and no cover art. The ids are in
			// contract state, so read the first slot of every bundle in one
			// call rather than leaving each one blank.
			if (rows.length === 0) return rows;
			// Slots 0..4, not just 0: the first item may have no artwork, and
			// the client needs somewhere to fall back to.
			const COVER_SLOTS = 5;
			const keys = rows.flatMap((b) =>
				Array.from({ length: COVER_SLOTS }, (_, i) => `bnd|${b.bundleId}|${i}_ti`)
			);
			const q = `query S($c:String!,$k:[String!]!){ getStateByKeys(contractId:$c,keys:$k,encoding:"string") }`;
			try {
				const data = await gqlFetchFailover<{
					getStateByKeys: Record<string, string | null> | null;
				}>(nodeUrls(), q, { c: cid(), k: keys }, fo);
				const st = data.getStateByKeys ?? {};
				for (const b of rows) {
					for (let i = 0; i < COVER_SLOTS && i < b.items.length; i++) {
						const ti = st[`bnd|${b.bundleId}|${i}_ti`];
						if (ti) b.items[i] = { ...b.items[i], tokenId: ti };
					}
				}
			} catch {
				/* cover art is a bonus — the bundle still lists without it */
			}
			return rows;
		},
		getBundleItems: async (bundleId: number) => {
			// Bundles cap at 20 items; read all candidate slots in one
			// getStateByKeys and stop at the first empty token id. uint64
			// state values come back as decimal strings (encoding:"string").
			const MAX = 20;
			const keys = [`bnd|${bundleId}|nc`];
			for (let i = 0; i < MAX; i++) keys.push(`bnd|${bundleId}|${i}_ti`, `bnd|${bundleId}|${i}_amt`);
			const q = `query S($c:String!,$k:[String!]!){ getStateByKeys(contractId:$c,keys:$k,encoding:"string") }`;
			let s: Record<string, string | null> = {};
			try {
				const data = await gqlFetchFailover<{ getStateByKeys: Record<string, string | null> | null }>(
					nodeUrls(),
					q,
					{ c: cid(), k: keys },
					fo
				);
				s = data.getStateByKeys ?? {};
			} catch {
				return { nftContract: '', items: [] };
			}
			const items: Array<{ tokenId: string; amount: number }> = [];
			for (let i = 0; i < MAX; i++) {
				const ti = s[`bnd|${bundleId}|${i}_ti`];
				if (!ti) break;
				items.push({ tokenId: ti, amount: num(s[`bnd|${bundleId}|${i}_amt`]) || 1 });
			}
			return { nftContract: s[`bnd|${bundleId}|nc`] ?? '', items };
		},
		getSwaps: (f = {}) =>
			indexerList<SwapRow, SwapProposal>(
				'magi_market_swaps',
				SWAP_COLS,
				{
					...(f.proposer ? { proposer: { _eq: f.proposer } } : {}),
					...activeWhere(f.activeOnly)
				},
				MARKET_LIST_MAX,
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
				MARKET_LIST_MAX,
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
				MARKET_LIST_MAX,
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
				MARKET_LIST_MAX,
				mapTokenListing
			),
		getPaymentTokens: (f = {}) =>
			indexerList<PaymentTokenRow, PaymentToken>(
				'magi_market_payment_tokens',
				PAYMENT_TOKEN_COLS,
				{ ...activeWhere(f.activeOnly) },
				MARKET_LIST_MAX,
				mapPaymentToken
			)
	};
}
