/** Magi network identifier — matches the `net_id` baked into vsc.call ops. */
export type MagiNetwork = 'vsc-mainnet' | 'vsc-testnet';

/** Configuration for SDK clients. The marketplace contract id comes from the deployer. */
export interface MagiConfig {
	network: MagiNetwork;
	/**
	 * The deployed magi-market contract id (`vsc1...`). Every op builder
	 * targets this. Defaulted per-network below; override for a private
	 * marketplace instance.
	 */
	marketContractId?: string;
	/**
	 * Indexer Hasura HTTP endpoint — used for read queries (listings,
	 * offers, auctions, etc.). Single-URL form, kept for back-compat;
	 * prefer `indexerHasuraUrls` for failover. When both are set,
	 * `indexerHasuraUrls` wins and this is ignored.
	 */
	indexerHasuraUrl?: string;
	/**
	 * Ordered list of indexer Hasura endpoints. The first entry is tried
	 * first; on any network/parse/GraphQL error the next entry is tried.
	 * Mirrors `gqlUrls` in @vsc.eco/crosschain-core.
	 */
	indexerHasuraUrls?: string[];
	/**
	 * GraphQL HTTP endpoint for the VSC node — used for `getStateByKeys`,
	 * `findContract`, `findContractOutput`. Single-URL form. Prefer
	 * `gqlUrls` for failover.
	 */
	gqlUrl?: string;
	/**
	 * Ordered list of VSC node GraphQL endpoints. Same failover semantics
	 * as `indexerHasuraUrls`.
	 */
	gqlUrls?: string[];
	/** Optional deployer URL — used when (re)deploying the marketplace contract. */
	deployerUrl?: string;
}

/**
 * Resolve a `MagiConfig` field to an ordered URL list. Callers feed this
 * into `gqlFetchFailover` which tries each entry in turn until one
 * succeeds.
 */
export function resolveIndexerUrls(config: MagiConfig): string[] {
	if (config.indexerHasuraUrls && config.indexerHasuraUrls.length > 0) {
		return config.indexerHasuraUrls;
	}
	if (config.indexerHasuraUrl) return [config.indexerHasuraUrl];
	throw new Error(
		'MagiConfig: neither `indexerHasuraUrls` nor `indexerHasuraUrl` is set'
	);
}

export function resolveGqlUrls(config: MagiConfig): string[] {
	if (config.gqlUrls && config.gqlUrls.length > 0) return config.gqlUrls;
	if (config.gqlUrl) return [config.gqlUrl];
	throw new Error('MagiConfig: neither `gqlUrls` nor `gqlUrl` is set');
}

/** Resolve the marketplace contract id, throwing a clear error if unset. */
export function resolveMarketContractId(config: MagiConfig): string {
	if (config.marketContractId && config.marketContractId.length > 0) {
		return config.marketContractId;
	}
	throw new Error(
		'MagiConfig: `marketContractId` is not set (no default for this network)'
	);
}

export const MAINNET_CONFIG: MagiConfig = {
	network: 'vsc-mainnet',
	// NOTE: the magi-market contract is NOT deployed on mainnet yet. This
	// id is a placeholder so the client constructs and the read side / NFT
	// picker work against the mainnet indexer; market WRITE actions point
	// at a contract that doesn't exist on mainnet and will fail on
	// broadcast until a mainnet deployment exists. Override
	// `marketContractId` once it's deployed.
	marketContractId: 'vsc1BnMAaeUzhzVcfKMDG5vphthhymk6irjLNq',
	indexerHasuraUrls: [
		'https://indexer.magi.milohpr.com/v1/graphql',
		'https://api.okinoko.io/hasura/v1/graphql'
	],
	gqlUrls: [
		'https://api.vsc.eco/api/v1/graphql',
		'https://vsc.techcoderx.com/api/v1/graphql',
		'https://api.okinoko.io/api/v1/graphql',
		'https://magi.milohpr.com/api/v1/graphql'
	],
	deployerUrl: 'https://deploy.okinoko.io'
};

export const TESTNET_CONFIG: MagiConfig = {
	network: 'vsc-testnet',
	// Deployed + initialized 2026-05-19 (owner hive:magi.contracts, feeBps=0).
	marketContractId: 'vsc1BnMAaeUzhzVcfKMDG5vphthhymk6irjLNq',
	// Our okinoko indexer (carries the `magi_market_*` fold views) is the
	// primary; the milohpr indexer is a generic-VSC fallback that does not
	// project the market views, so it must come second.
	indexerHasuraUrls: [
		'https://api-testnet.okinoko.io/hasura/v1/graphql',
		'https://indexer.testnet.magi.milohpr.com/v1/graphql'
	],
	gqlUrls: ['https://magi-test.techcoderx.com/api/v1/graphql'],
	deployerUrl: 'https://deploy-testnet.okinoko.io'
};

/** A contract callable via vsc.call. */
export interface VscCall {
	/** vsc1... contract address. */
	contractId: string;
	/** Function name on the contract. */
	action: string;
	/** JSON-encoded payload as a string OR a structured object. SDK stringifies. */
	payload: string | Record<string, unknown>;
	/** RC limit (HBD millis budgeted). Defaults vary per call. */
	rcLimit?: number;
	/** transfer.allow intents for native asset pulls. */
	intents?: VscIntent[];
}

export interface VscIntent {
	type: 'transfer.allow' | string;
	args: Record<string, string>;
}

/** Custom JSON op shape, structurally compatible with @hiveio/dhive's CustomJsonOperation. */
export type CustomJsonOp = [
	'custom_json',
	{
		required_auths: string[];
		required_posting_auths: string[];
		id: string;
		json: string;
	}
];

/** ============== Marketplace domain types ============== */

/** A single multi-recipient royalty split entry (Σ bps ≤ 5000). */
export interface RoyaltySplit {
	recipient: string;
	bps: number;
}

/** Per-collection royalty configuration (legacy single OR multi-split). */
export interface RoyaltyInfo {
	nftContract: string;
	royaltyBps: number;
	royaltyRecipient: string;
	splits?: RoyaltySplit[];
}

/** A fixed-price listing (NFT stays with the seller via operator approval). */
/** Per-row provenance from the indexer — when the create event was first
 * picked up. `indexedAt` is an ISO timestamp; `indexedAtBlock` is the
 * Hive-anchored L2 block. Both nullable because the provider may serve
 * cached/stub rows that pre-date the indexer view. */
export interface Indexed {
	indexedAt?: string;
	indexedAtBlock?: number;
}

export interface Listing extends Indexed {
	listingId: number;
	seller: string;
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	pricePerUnit: string;
	active: boolean;
	expirationBlock?: number;
	startBlock?: number;
	/** F1 native-L1 payout opt-in. */
	payoutMode?: '' | 'default' | 'unmap';
	payoutL1Address?: string;
	/** F2 DEX-routed settlement opt-in. */
	dexPool?: string;
	settleToken?: string;
	minSettleOut?: string;
}

/** An offer on a specific token, or a collection-wide offer. */
export interface Offer {
	offerId: number;
	buyer: string;
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	pricePerUnit: string;
	active: boolean;
	expirationBlock?: number;
}

/** An English or Dutch auction (NFT escrowed for the duration). */
export interface Auction extends Indexed {
	auctionId: number;
	seller: string;
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	auctionType: 'english' | 'dutch';
	startPrice: string;
	endPrice?: string;
	startBlock?: number;
	endBlock: number;
	highBidder?: string;
	highBid?: string;
	settled: boolean;
	active: boolean;
}

/** A single-collection atomic bundle listing. */
/**
 * A bucket as the indexer sees it: a fixed-price sale where the CONTRACT picks
 * which unit the buyer gets.
 *
 * `unitsLeft` is derived from the event log (stocked − drawn − dropped) so it
 * accounts for restocks and for stock that went stale. `unitsLeftReported` is
 * the contract's own figure at the most recent purchase — a checkpoint, not a
 * live value; the two diverge legitimately after a restock.
 */
export interface BucketListing {
	bucketId: number;
	seller: string;
	nftContract: string;
	paymentToken: string;
	/** "0" when single draws are disabled. */
	pricePerDraw: string;
	/** "0" when pack sales are disabled. */
	pricePerPack: string;
	/** Draws per pool, e.g. [4,1] = 4 commons + 1 guaranteed rare. */
	packDraws: number[];
	/** Cards in one pack — the sum of packDraws. 0 when packs are off. */
	packSize: number;
	expirationBlock: number;
	feeBps: number;
	royaltyBps: number;
	royaltyRecipient: string;
	entryCount: number;
	unitsStocked: number;
	unitsLeft: number;
	unitsLeftReported: number | null;
	unitsDrawn: number;
	unitsDropped: number;
	purchases: number;
	soldOut: boolean;
	delisted: boolean;
	active: boolean;
}

/** One token in a bucket, with what is still drawable. */
export interface BucketEntry {
	bucketId: number;
	tokenId: string;
	pool: number;
	amountStocked: number;
	amountDrawn: number;
	amountDropped: number;
	amountLeft: number;
}

/**
 * Units remaining in one pool.
 *
 * Worth reading before offering a pack: a bucket with guaranteed slots drains
 * UNEVENLY — the guaranteed pool empties first and strands the rest — so the
 * grand total can look healthy while the next pack cannot actually be filled.
 */
export interface BucketPool {
	bucketId: number;
	pool: number;
	unitsStocked: number;
	unitsLeft: number;
	distinctTokens: number;
}

export interface BundleListing {
	bundleId: number;
	seller: string;
	nftContract: string;
	items: Array<{ tokenId: string; amount: number }>;
	paymentToken: string;
	price: string;
	active: boolean;
	expirationBlock?: number;
}

/** An NFT-for-NFT swap proposal (optional token top-up). */
export interface SwapProposal {
	swapId: number;
	proposer: string;
	offeredNft: string;
	offeredTokenId: string;
	offeredAmount: number;
	wantedNft: string;
	wantedTokenId: string;
	wantedAmount: number;
	topUp?: string;
	topUpToken?: string;
	active: boolean;
	expirationBlock?: number;
}

/** An escrow-backed rental-rights listing / active rental. */
export interface RentalListing {
	rentalId: number;
	owner: string;
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	pricePerBlock: string;
	minBlocks: number;
	maxBlocks: number;
	renter?: string;
	endBlock?: number;
	active: boolean;
}

/** A primary-sale mint-spot listing (delegated mint to the buyer). */
export interface MintSpotListing extends Indexed {
	listingId: number;
	lister: string;
	nftContract: string;
	tokenId: string;
	paymentToken: string;
	pricePerSpot: string;
	maxSpots: number;
	sold: number;
	active: boolean;
	expirationBlock?: number;
	startBlock?: number;
	feeBps?: number;
}

/** A fixed-price ERC-20 token-contract sale (asset = an amount of a token,
 * not an NFT). Amounts are big.Int decimal strings. */
export interface TokenListing extends Indexed {
	listingId: number;
	seller: string;
	tokenContract: string;
	/** Remaining asset amount (decimal string). */
	amount: string;
	pricePerUnit: string;
	paymentToken: string;
	active: boolean;
	expirationBlock?: number;
	startBlock?: number;
	feeBps?: number;
}

/**
 * A row of the `magi_market_payment_tokens` fold view: a token whose most
 * recent add/remove whitelist event was an add (`active: true`) or remove
 * (`active: false`). Native HIVE/HBD are seeded in the contract's init
 * without an event, so they are NOT in this view — clients add them
 * statically. Empty when the on-chain whitelist (`ptw_on`) was enabled
 * before any add/remove event was emitted.
 */
export interface PaymentToken extends Indexed {
	/** The token id the contract accepts as `paymentToken` (a `vsc1…` id). */
	token: string;
	active: boolean;
}

/** `getInfo` view — marketplace config + governance state. */
export interface MarketInfo {
	owner: string;
	pendingOwner?: string;
	feeBps: number;
	feeRecipient: string;
	paused: boolean;
}
