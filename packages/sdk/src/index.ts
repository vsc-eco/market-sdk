import {
	MAINNET_CONFIG,
	TESTNET_CONFIG,
	buildAcceptCollectionOffer,
	buildAcceptCollectionOfferFlow,
	buildAcceptOffer,
	buildAcceptOfferFlow,
	buildAcceptOwnership,
	buildAcceptSwap,
	buildAddPaymentToken,
	buildAllowCollection,
	buildAuctionNftFlow,
	buildBatchBuy,
	buildBatchList,
	buildBuy,
	buildBuyBundle,
	buildBuyMintSpot,
	buildBuyWithPayment,
	buildCancelAuction,
	buildCancelOffer,
	buildCancelOwnershipTransfer,
	buildCancelSwap,
	buildChangeOwner,
	buildClearCollectionFee,
	buildCreateAuction,
	buildDelist,
	buildDelistBundle,
	buildListBucket,
	buildListBucketFlow,
	buildAddToBucket,
	buildBuyFromBucket,
	buildBuyFromBucketWithPayment,
	buildDelistBucket,
	buildDelistMintSpots,
	buildDelistRental,
	buildDenyCollection,
	buildEmergencyWithdraw,
	buildEndRental,
	buildEndRentalEarly,
	buildInit,
	buildList,
	buildListBundle,
	buildListMintSpots,
	buildListRental,
	buildMakeOffer,
	buildMintSpotFlow,
	buildPause,
	buildPlaceBid,
	buildProposeSwap,
	buildRent,
	buildRentalNftFlow,
	buildRemovePaymentToken,
	buildSellNftFlow,
	buildListToken,
	buildDelistToken,
	buildBuyToken,
	buildSellTokenFlow,
	buildBuyTokenWithPayment,
	buildSetAntiSnipeBlocks,
	buildSetCollectionFee,
	buildSetFee,
	buildSetFeeRecipient,
	buildSetMinBidIncrement,
	buildSetMinOffer,
	buildSetRoyalty,
	buildSetRoyaltySplits,
	buildSettleAuction,
	buildSweep,
	buildUnpause,
	buildUpdateListing,
	resolveMarketContractId,
	type BuyParams,
	type CreateAuctionParams,
	type ListBundleParams,
	type ListBucketParams,
	type BuyFromBucketParams,
	type BucketEntryParam,
	type ListMintSpotsParams,
	type ListParams,
	type ListRentalParams,
	type ListTokenParams,
	type BuyTokenParams,
	type AcceptOfferFlowParams,
	type MagiConfig,
	type MakeOfferParams,
	type MarketOpBundle,
	type ProposeSwapParams,
	type VscCall,
	type VscIntent
} from '@vsc.eco/market-core';
import { createMarketProvider, type MarketProvider } from './marketProvider.js';
import {
	gqlFetchFailover,
	gqlFetchOne,
	type GqlFetchOptions
} from './graphql.js';

export {
	MAINNET_CONFIG,
	TESTNET_CONFIG,
	resolveIndexerUrls,
	resolveGqlUrls,
	resolveMarketContractId
} from '@vsc.eco/market-core';
export { MarketAmount } from '@vsc.eco/market-core';
export { gqlFetchFailover, gqlFetchOne };
export type { GqlFetchOptions };
export type {
	MagiConfig,
	MagiNetwork,
	MarketInfo,
	Listing,
	Offer,
	Auction,
	BundleListing,
	BucketListing,
	BucketEntry,
	BucketPool,
	SwapProposal,
	RentalListing,
	MintSpotListing,
	TokenListing,
	PaymentToken,
	RoyaltyInfo,
	RoyaltySplit,
	CustomJsonOp,
	MarketOpBundle,
	AcceptOfferFlowParams
} from '@vsc.eco/market-core';
export {
	createDeployerClient,
	substituteDeployerOps
} from './deployer.js';
export type {
	DeployerClient,
	DeployedCode,
	DeployerOp,
	DeployLogEntry,
	DeployResult,
	DeployTag,
	PrepareDeployParams,
	PrepareDeployResponse,
	CreateDeployerClientOptions
} from './deployer.js';
export { createMarketProvider } from './marketProvider.js';
export type { MarketProvider } from './marketProvider.js';

/**
 * Tiny Promise-based sleep used by `broadcastBatch` to space chunks
 * across Hive blocks. Kept dependency-free.
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/**
 * Aioha-shaped signer. The SDK uses `vscCallContract` when present (lowest-
 * friction path — same as okinoko-terminal) and falls back to
 * `signAndBroadcastTx` otherwise. Callers can also bypass the client and
 * sign manually with the `op` returned by any `build*` function.
 */
export interface AiohaLike {
	/**
	 * Pin Aioha's VSC `net_id`. Aioha hard-defaults this to `vsc-mainnet`
	 * (the testnet Hive api/chain-id passed to its constructor only affects
	 * Hive L1, NOT the L2 net id), so the SDK must set it from
	 * `config.network` before `vscCallContract`, else single-op calls
	 * broadcast with the wrong net id ("wrong net ID" on a testnet contract).
	 */
	vscSetNetId?(netId: string): void;
	vscCallContract?(
		contractId: string,
		action: string,
		payload: string | Record<string, unknown>,
		rcLimit: number,
		intents: VscIntent[],
		keyType: unknown
	): Promise<{ success: boolean; result?: string; error?: string }>;
	signAndBroadcastTx?(
		operations: unknown[],
		keyType: unknown
	): Promise<{ success: boolean; result?: string; error?: string }>;
}

/**
 * Generic broadcast hook for hosts that don't use Aioha. Receives the
 * already-built `custom_json` operation and returns a tx id. Errors should
 * be thrown.
 */
export type BroadcastHook = (
	op: unknown[],
	keyType: unknown
) => Promise<{ txId: string }>;

export interface CreateMarketClientOptions {
	config?: MagiConfig;
	aioha?: AiohaLike;
	onBroadcast?: BroadcastHook;
	/** Override the default key type. Most marketplace actions need active. */
	keyType?: unknown;
	provider?: MarketProvider;
	/**
	 * Forwarded to the default provider's GraphQL calls. Lets hosts hook
	 * `onAttempt`/`onError` for telemetry, set a `timeoutMs`, or share an
	 * AbortSignal across all reads. Ignored when `provider` is also passed.
	 */
	fetchOptions?: GqlFetchOptions;
}

export interface BroadcastResult {
	txId: string;
	/** The bundle that was broadcast — useful for tracking via `addTransaction`. */
	bundle: MarketOpBundle;
}

/**
 * High-level marketplace client. Combines:
 *   - a read provider (market info + indexed listing/offer/auction views)
 *   - write builders for every magi-market entrypoint
 *   - cross-contract composites (`sell`, `auction`, `rental`,
 *     `mintSpotListing`, `buyWithPayment`) that emit the NFT/token approval
 *     leg + the market leg and broadcast them as a chunked batch
 *   - a signer adapter so the host needn't know whether Aioha or a custom
 *     hook is in play
 *
 * For headless integrators who want NO signing logic: skip `aioha`/
 * `onBroadcast`, use the `*Op` methods to get `{ op, call }` bundles, and
 * broadcast them however you like.
 */
export interface MarketClient {
	config: MagiConfig;
	contractId: string;
	provider: MarketProvider;
	/** Every write entrypoint as an op builder — never broadcast on their own. */
	ops: {
		listOp(username: string, p: ListParams): MarketOpBundle;
		delistOp(username: string, p: { listingId: number }): MarketOpBundle;
		buyOp(username: string, p: BuyParams, intents?: VscIntent[]): MarketOpBundle;
		updateListingOp(username: string, p: { listingId: number; newPrice: string }): MarketOpBundle;
		batchListOp(username: string, p: { items: ListParams[] }): MarketOpBundle;
		batchBuyOp(username: string, p: { items: BuyParams[] }, intents?: VscIntent[]): MarketOpBundle;
		makeOfferOp(username: string, p: MakeOfferParams, intents?: VscIntent[]): MarketOpBundle;
		cancelOfferOp(username: string, p: { offerId: number }): MarketOpBundle;
		acceptOfferOp(username: string, p: { offerId: number; amount: number }): MarketOpBundle;
		acceptCollectionOfferOp(username: string, p: { offerId: number; tokenId: string; amount: number }): MarketOpBundle;
		createAuctionOp(username: string, p: CreateAuctionParams): MarketOpBundle;
		placeBidOp(username: string, p: { auctionId: number; bidAmount: string }, intents?: VscIntent[]): MarketOpBundle;
		settleAuctionOp(username: string, p: { auctionId: number }): MarketOpBundle;
		cancelAuctionOp(username: string, p: { auctionId: number }): MarketOpBundle;
		setMinBidIncrementOp(username: string, p: { minBidIncrementBps: number }): MarketOpBundle;
		setAntiSnipeBlocksOp(username: string, p: { antiSnipeBlocks: number }): MarketOpBundle;
		setRoyaltyOp(username: string, p: { nftContract: string; royaltyBps: number; royaltyRecipient: string }): MarketOpBundle;
		setRoyaltySplitsOp(username: string, p: { nftContract: string; splits: Array<{ recipient: string; bps: number }> }): MarketOpBundle;
		setFeeOp(username: string, p: { feeBps: number }): MarketOpBundle;
		setFeeRecipientOp(username: string, p: { feeRecipient: string }): MarketOpBundle;
		setCollectionFeeOp(username: string, p: { nftContract: string; feeBps: number }): MarketOpBundle;
		clearCollectionFeeOp(username: string, p: { nftContract: string }): MarketOpBundle;
		setMinOfferOp(username: string, p: { minOffer: string }): MarketOpBundle;
		sweepOp(username: string, p: { nftContract: string; listingIds: number[]; maxTotal: string }, intents?: VscIntent[]): MarketOpBundle;
		listBundleOp(username: string, p: ListBundleParams): MarketOpBundle;
		buyBundleOp(username: string, p: { bundleId: number }, intents?: VscIntent[]): MarketOpBundle;
		delistBundleOp(username: string, p: { bundleId: number }): MarketOpBundle;
		/** Open a bucket (random-draw sale). See `listBucketFlow` for the approval leg. */
		listBucketOp(username: string, p: ListBucketParams): MarketOpBundle;
		/** Approve the market, then open the bucket — returns both ops in order. */
		listBucketFlow(username: string, p: ListBucketParams & { skipApproval?: boolean }): MarketOpBundle[];
		/** Add stock to an existing bucket. Append-only: new token ids only. */
		addToBucketOp(username: string, p: { bucketId: number; entries: BucketEntryParam[] }): MarketOpBundle;
		/** Draw from a bucket — one unit, or a whole pack. */
		buyFromBucketOp(username: string, p: BuyFromBucketParams, intents?: VscIntent[]): MarketOpBundle;
		delistBucketOp(username: string, p: { bucketId: number }): MarketOpBundle;
		proposeSwapOp(username: string, p: ProposeSwapParams): MarketOpBundle;
		acceptSwapOp(username: string, p: { swapId: number }, intents?: VscIntent[]): MarketOpBundle;
		cancelSwapOp(username: string, p: { swapId: number }): MarketOpBundle;
		listRentalOp(username: string, p: ListRentalParams): MarketOpBundle;
		rentOp(username: string, p: { rentalId: number; blocks: number }, intents?: VscIntent[]): MarketOpBundle;
		endRentalOp(username: string, p: { rentalId: number }): MarketOpBundle;
		endRentalEarlyOp(username: string, p: { rentalId: number }): MarketOpBundle;
		delistRentalOp(username: string, p: { rentalId: number }): MarketOpBundle;
		listMintSpotsOp(username: string, p: ListMintSpotsParams): MarketOpBundle;
		buyMintSpotOp(username: string, p: { listingId: number; amount: number }, intents?: VscIntent[]): MarketOpBundle;
		delistMintSpotsOp(username: string, p: { listingId: number }): MarketOpBundle;
		changeOwnerOp(username: string, p: { newOwner: string }): MarketOpBundle;
		acceptOwnershipOp(username: string): MarketOpBundle;
		cancelOwnershipTransferOp(username: string): MarketOpBundle;
		pauseOp(username: string): MarketOpBundle;
		unpauseOp(username: string): MarketOpBundle;
		denyCollectionOp(username: string, p: { nftContract: string }): MarketOpBundle;
		allowCollectionOp(username: string, p: { nftContract: string }): MarketOpBundle;
		addPaymentTokenOp(username: string, p: { token: string }): MarketOpBundle;
		removePaymentTokenOp(username: string, p: { token: string }): MarketOpBundle;
		emergencyWithdrawOp(username: string, p: { tokenType: string; contract: string; tokenId: string; amount: string; to: string }): MarketOpBundle;
		initOp(username: string, p: { feeBps: number; feeRecipient: string }): MarketOpBundle;
		listTokenOp(username: string, p: ListTokenParams): MarketOpBundle;
		delistTokenOp(username: string, p: { listingId: number }): MarketOpBundle;
		buyTokenOp(username: string, p: BuyTokenParams, intents?: VscIntent[]): MarketOpBundle;
	};
	/** Direct broadcast of any single bundle. Requires aioha or onBroadcast. */
	broadcast(bundle: MarketOpBundle): Promise<BroadcastResult>;
	/**
	 * Broadcast multiple bundles, working around two Hive L1 limits
	 * (per-tx op count + per-block custom_json cap). This is what the
	 * cross-contract composites use — the NFT/token approval leg and the
	 * market leg are signed in one chunked batch. Same chunking semantics
	 * as @vsc.eco/token-sdk.
	 */
	broadcastBatch(
		bundles: MarketOpBundle[],
		opts?: {
			sequential?: boolean;
			chunkSize?: number;
			delayBetweenChunksMs?: number;
			onProgress?: (i: number, total: number, txId: string) => void;
			onWaiting?: (nextChunkIndex: number, totalChunks: number, remainingMs: number) => void;
		}
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract "put an NFT up for sale": NFT approve + `list`. */
	sell(username: string, p: ListParams & { skipApproval?: boolean }): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract: NFT approve + `createAuction`. */
	auction(username: string, p: CreateAuctionParams & { skipApproval?: boolean }): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract: NFT approve + `listRental`. */
	rental(username: string, p: ListRentalParams & { skipApproval?: boolean }): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract: NFT operator/per-token approve + `listMintSpots`. */
	mintSpotListing(
		username: string,
		p: ListMintSpotsParams & { auth?: 'operator' | 'allowance'; skipApproval?: boolean }
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/**
	 * Cross-contract "accept a buy offer": NFT `approve(market,tokenId,amount)`
	 * + `acceptOffer`. Accepting hands the NFT to the buyer, so the market
	 * needs transfer authorization first — without it the accept leg aborts
	 * with "Marketplace not approved as operator or sufficient per-token
	 * allowance to fulfill offer".
	 */
	acceptOffer(
		username: string,
		p: AcceptOfferFlowParams
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract: NFT approve + `acceptCollectionOffer` (holder picks `tokenId`). */
	acceptCollectionOffer(
		username: string,
		p: AcceptOfferFlowParams
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract: token `approve(market,total)` + `buy`. */
	buyWithPayment(
		username: string,
		p: BuyParams & { paymentToken: string; total: string }
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract bucket draw: token `approve(market,total)` + `buyFromBucket`. */
	buyFromBucketWithPayment(
		username: string,
		p: BuyFromBucketParams & { paymentToken: string; total: string }
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract "sell a token": asset-token `approve(market,amount)` + `listToken`. */
	sellToken(
		username: string,
		p: ListTokenParams & { skipApproval?: boolean }
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
	/** Cross-contract: payment-token `approve(market,total)` + `buyToken`. */
	buyTokenWithPayment(
		username: string,
		p: BuyTokenParams & { paymentToken: string; total: string }
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }>;
}

export function createMarketClient(opts: CreateMarketClientOptions = {}): MarketClient {
	const config = opts.config ?? MAINNET_CONFIG;
	const aioha = opts.aioha;
	const onBroadcast = opts.onBroadcast;
	const keyType = opts.keyType;
	const contractId = resolveMarketContractId(config);
	const provider = opts.provider ?? createMarketProvider(config, { fetchOptions: opts.fetchOptions });

	async function broadcast(bundle: MarketOpBundle): Promise<BroadcastResult> {
		if (onBroadcast) {
			const { txId } = await onBroadcast(bundle.op, keyType);
			return { txId, bundle };
		}
		if (!aioha) {
			throw new Error(
				'No signer configured: pass `aioha` or `onBroadcast` to createMarketClient(), ' +
					'or use the `ops.*Op` methods to build operations and broadcast them yourself.'
			);
		}
		// Aioha hard-defaults its VSC net_id to `vsc-mainnet`; pin it to the
		// SDK's configured network so `vscCallContract` (single-op path)
		// doesn't broadcast to the wrong L2.
		aioha.vscSetNetId?.(config.network);
		const call: VscCall = bundle.call;
		if (typeof aioha.vscCallContract === 'function') {
			const res = await aioha.vscCallContract(
				call.contractId,
				call.action,
				call.payload,
				call.rcLimit ?? 10000,
				call.intents ?? [],
				keyType
			);
			if (!res.success || typeof res.result !== 'string') {
				throw new Error(`vscCallContract failed: ${res.error ?? 'unknown'}`);
			}
			return { txId: res.result, bundle };
		}
		if (typeof aioha.signAndBroadcastTx === 'function') {
			const res = await aioha.signAndBroadcastTx([bundle.op], keyType);
			if (!res.success || typeof res.result !== 'string') {
				throw new Error(`signAndBroadcastTx failed: ${res.error ?? 'unknown'}`);
			}
			return { txId: res.result, bundle };
		}
		throw new Error('Aioha instance has neither vscCallContract nor signAndBroadcastTx');
	}

	async function broadcastBatch(
		bundles: MarketOpBundle[],
		bopts: {
			sequential?: boolean;
			chunkSize?: number;
			delayBetweenChunksMs?: number;
			onProgress?: (i: number, total: number, txId: string) => void;
			onWaiting?: (nextChunkIndex: number, totalChunks: number, remainingMs: number) => void;
		} = {}
	): Promise<{ txIds: string[]; bundles: MarketOpBundle[] }> {
		if (bundles.length === 0) return { txIds: [], bundles };
		const chunkSize = Math.max(1, Math.floor(bopts.chunkSize ?? 4));
		const delayMs = Math.max(0, Math.floor(bopts.delayBetweenChunksMs ?? 4000));
		const canBundle =
			!bopts.sequential &&
			!onBroadcast &&
			!!aioha &&
			typeof aioha.signAndBroadcastTx === 'function';
		if (canBundle) {
			const txIds: string[] = [];
			const totalChunks = Math.ceil(bundles.length / chunkSize);
			for (let i = 0; i < bundles.length; i += chunkSize) {
				const chunkIndex = Math.floor(i / chunkSize);
				if (chunkIndex > 0 && delayMs > 0) {
					const waitStart = Date.now();
					while (Date.now() - waitStart < delayMs) {
						const remaining = delayMs - (Date.now() - waitStart);
						bopts.onWaiting?.(chunkIndex, totalChunks, Math.max(0, remaining));
						await sleep(Math.min(200, remaining));
					}
					bopts.onWaiting?.(chunkIndex, totalChunks, 0);
				}
				const chunk = bundles.slice(i, i + chunkSize);
				const ops = chunk.map((b) => b.op as unknown);
				const res = await aioha!.signAndBroadcastTx!(ops, keyType);
				if (!res.success || typeof res.result !== 'string') {
					throw new Error(
						`signAndBroadcastTx failed on chunk ${chunkIndex + 1}/${totalChunks}: ${res.error ?? 'unknown'}`
					);
				}
				txIds.push(res.result);
				bopts.onProgress?.(txIds.length - 1, totalChunks, res.result);
			}
			return { txIds, bundles };
		}
		const txIds: string[] = [];
		for (let i = 0; i < bundles.length; i++) {
			if (i > 0 && delayMs > 0) {
				const waitStart = Date.now();
				while (Date.now() - waitStart < delayMs) {
					const remaining = delayMs - (Date.now() - waitStart);
					bopts.onWaiting?.(i, bundles.length, Math.max(0, remaining));
					await sleep(Math.min(200, remaining));
				}
				bopts.onWaiting?.(i, bundles.length, 0);
			}
			const r = await broadcast(bundles[i]);
			txIds.push(r.txId);
			bopts.onProgress?.(i, bundles.length, r.txId);
		}
		return { txIds, bundles };
	}

	const ctx = (username: string) => ({ contractId, username, network: config.network });

	return {
		config,
		contractId,
		provider,
		ops: {
			listOp: (u, p) => buildList(ctx(u), p),
			delistOp: (u, p) => buildDelist(ctx(u), p),
			buyOp: (u, p, i) => buildBuy(ctx(u), p, i),
			updateListingOp: (u, p) => buildUpdateListing(ctx(u), p),
			batchListOp: (u, p) => buildBatchList(ctx(u), p),
			batchBuyOp: (u, p, i) => buildBatchBuy(ctx(u), p, i),
			makeOfferOp: (u, p, i) => buildMakeOffer(ctx(u), p, i),
			cancelOfferOp: (u, p) => buildCancelOffer(ctx(u), p),
			acceptOfferOp: (u, p) => buildAcceptOffer(ctx(u), p),
			acceptCollectionOfferOp: (u, p) => buildAcceptCollectionOffer(ctx(u), p),
			createAuctionOp: (u, p) => buildCreateAuction(ctx(u), p),
			placeBidOp: (u, p, i) => buildPlaceBid(ctx(u), p, i),
			settleAuctionOp: (u, p) => buildSettleAuction(ctx(u), p),
			cancelAuctionOp: (u, p) => buildCancelAuction(ctx(u), p),
			setMinBidIncrementOp: (u, p) => buildSetMinBidIncrement(ctx(u), p),
			setAntiSnipeBlocksOp: (u, p) => buildSetAntiSnipeBlocks(ctx(u), p),
			setRoyaltyOp: (u, p) => buildSetRoyalty(ctx(u), p),
			setRoyaltySplitsOp: (u, p) => buildSetRoyaltySplits(ctx(u), p),
			setFeeOp: (u, p) => buildSetFee(ctx(u), p),
			setFeeRecipientOp: (u, p) => buildSetFeeRecipient(ctx(u), p),
			setCollectionFeeOp: (u, p) => buildSetCollectionFee(ctx(u), p),
			clearCollectionFeeOp: (u, p) => buildClearCollectionFee(ctx(u), p),
			setMinOfferOp: (u, p) => buildSetMinOffer(ctx(u), p),
			sweepOp: (u, p, i) => buildSweep(ctx(u), p, i),
			listBundleOp: (u, p) => buildListBundle(ctx(u), p),
			buyBundleOp: (u, p, i) => buildBuyBundle(ctx(u), p, i),
			delistBundleOp: (u, p) => buildDelistBundle(ctx(u), p),
			listBucketOp: (u, p) => buildListBucket(ctx(u), p),
			listBucketFlow: (u, p) => buildListBucketFlow(ctx(u), p),
			addToBucketOp: (u, p) => buildAddToBucket(ctx(u), p),
			buyFromBucketOp: (u, p, i) => buildBuyFromBucket(ctx(u), p, i),
			delistBucketOp: (u, p) => buildDelistBucket(ctx(u), p),
			proposeSwapOp: (u, p) => buildProposeSwap(ctx(u), p),
			acceptSwapOp: (u, p, i) => buildAcceptSwap(ctx(u), p, i),
			cancelSwapOp: (u, p) => buildCancelSwap(ctx(u), p),
			listRentalOp: (u, p) => buildListRental(ctx(u), p),
			rentOp: (u, p, i) => buildRent(ctx(u), p, i),
			endRentalOp: (u, p) => buildEndRental(ctx(u), p),
			endRentalEarlyOp: (u, p) => buildEndRentalEarly(ctx(u), p),
			delistRentalOp: (u, p) => buildDelistRental(ctx(u), p),
			listMintSpotsOp: (u, p) => buildListMintSpots(ctx(u), p),
			buyMintSpotOp: (u, p, i) => buildBuyMintSpot(ctx(u), p, i),
			delistMintSpotsOp: (u, p) => buildDelistMintSpots(ctx(u), p),
			changeOwnerOp: (u, p) => buildChangeOwner(ctx(u), p),
			acceptOwnershipOp: (u) => buildAcceptOwnership(ctx(u)),
			cancelOwnershipTransferOp: (u) => buildCancelOwnershipTransfer(ctx(u)),
			pauseOp: (u) => buildPause(ctx(u)),
			unpauseOp: (u) => buildUnpause(ctx(u)),
			denyCollectionOp: (u, p) => buildDenyCollection(ctx(u), p),
			allowCollectionOp: (u, p) => buildAllowCollection(ctx(u), p),
			addPaymentTokenOp: (u, p) => buildAddPaymentToken(ctx(u), p),
			removePaymentTokenOp: (u, p) => buildRemovePaymentToken(ctx(u), p),
			emergencyWithdrawOp: (u, p) => buildEmergencyWithdraw(ctx(u), p),
			initOp: (u, p) => buildInit(ctx(u), p),
			listTokenOp: (u, p) => buildListToken(ctx(u), p),
			delistTokenOp: (u, p) => buildDelistToken(ctx(u), p),
			buyTokenOp: (u, p, i) => buildBuyToken(ctx(u), p, i)
		},
		broadcast,
		broadcastBatch,
		sell: (u, p) => broadcastBatch(buildSellNftFlow(ctx(u), p)),
		auction: (u, p) => broadcastBatch(buildAuctionNftFlow(ctx(u), p)),
		rental: (u, p) => broadcastBatch(buildRentalNftFlow(ctx(u), p)),
		mintSpotListing: (u, p) => broadcastBatch(buildMintSpotFlow(ctx(u), p)),
		acceptOffer: (u, p) => broadcastBatch(buildAcceptOfferFlow(ctx(u), p)),
		acceptCollectionOffer: (u, p) => broadcastBatch(buildAcceptCollectionOfferFlow(ctx(u), p)),
		buyWithPayment: (u, p) => broadcastBatch(buildBuyWithPayment(ctx(u), p)),
		buyFromBucketWithPayment: (u, p) => broadcastBatch(buildBuyFromBucketWithPayment(ctx(u), p)),
		sellToken: (u, p) => broadcastBatch(buildSellTokenFlow(ctx(u), p)),
		buyTokenWithPayment: (u, p) => broadcastBatch(buildBuyTokenWithPayment(ctx(u), p))
	};
}
