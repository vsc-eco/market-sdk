import type {
	CustomJsonOp,
	MagiNetwork,
	RoyaltySplit,
	VscCall,
	VscIntent
} from '../types/index.js';
import { buildVscCallOp, normalizeHiveAccount } from './vsc.js';

/**
 * Operation builders for the Magi NFT-marketplace (magi-market) contract.
 *
 * Each function returns a tuple: `{ op, call }`.
 *  - `op`: the ready-to-broadcast Hive `custom_json` operation.
 *  - `call`: the inner `vsc.call` payload — useful when broadcasting via
 *    `aioha.vscCallContract(contractId, action, payload, rcLimit, intents, keyType)`
 *    instead of `signAndBroadcastTx(ops, keyType)`.
 *
 * The split lets headless integrators pick whichever signing path they
 * prefer. Mirrors @vsc.eco/token-core's nft/token op builders exactly.
 *
 * ## Cross-contract flows
 *
 * magi-market never escrows listed/offered NFTs — it mints/moves them via
 * operator approval on the *NFT contract*. So "putting an NFT up for sale"
 * is two ops on two contracts:
 *
 *   1. `setApprovalForAll(market, true)` on the **NFT contract**, and
 *   2. `list` / `createAuction` / `listRental` / `listMintSpots` on the
 *      **market contract**.
 *
 * Likewise a fixed-price purchase paid in a magi_token-style asset needs an
 * `approve(market, amount)` on the **token contract** before `buy`, while a
 * native-asset (HBD/HIVE) purchase rides a `transfer.allow` intent on the
 * `buy` op itself. The `*WithApproval` / `*WithPayment` composites below
 * assemble the correct multi-op bundle so the host can hand it straight to
 * `broadcastBatch`.
 */

export interface MarketOpBundle {
	op: CustomJsonOp;
	call: VscCall;
}

export interface MarketOpContext {
	/** The deployed magi-market contract id (`vsc1...`). */
	contractId: string;
	username: string;
	network: MagiNetwork;
}

function bundle(
	ctx: MarketOpContext,
	action: string,
	payload: Record<string, unknown>,
	rcLimit?: number,
	intents?: VscIntent[]
): MarketOpBundle {
	const call: VscCall = {
		contractId: ctx.contractId,
		action,
		payload,
		rcLimit: rcLimit ?? 10000,
		intents: intents ?? []
	};
	return {
		call,
		op: buildVscCallOp({ username: ctx.username, network: ctx.network, call })
	};
}

/**
 * Build a bundle targeting an *arbitrary* contract as the same signer —
 * used for the cross-contract legs (NFT `setApprovalForAll`, token
 * `approve`) that accompany a market action. `ctx.contractId` is ignored;
 * `targetContractId` is called instead.
 */
function bundleOn(
	ctx: MarketOpContext,
	targetContractId: string,
	action: string,
	payload: Record<string, unknown>,
	rcLimit?: number
): MarketOpBundle {
	const call: VscCall = {
		contractId: targetContractId,
		action,
		payload,
		rcLimit: rcLimit ?? 10000,
		intents: []
	};
	return {
		call,
		op: buildVscCallOp({ username: ctx.username, network: ctx.network, call })
	};
}

/* ============================================================ *
 *  Cross-contract approval legs (NFT contract / token contract)
 * ============================================================ */

/**
 * The marketplace's on-chain identity as OTHER contracts see it
 * (`msg.caller` when magi-market cross-calls) and as magi-market itself
 * uses via `getContractAddress()`: `contract:<vsc1…>`. NFT/token approvals
 * MUST target this, not the bare `vsc1…` id — the contract stores/reads the
 * operator/allowance under the `contract:`-prefixed key, so a bare-id
 * approval leaves the market unauthorized and `list`/`buy`/etc. abort.
 */
function marketIdentity(ctx: MarketOpContext): string {
	return ctx.contractId.startsWith('contract:') ? ctx.contractId : `contract:${ctx.contractId}`;
}

/**
 * `setApprovalForAll(market, approved)` on an **NFT contract** — the seller
 * authorizes the marketplace as an operator. Required once per NFT
 * collection before `list` / `createAuction` / `listRental` / mint-spot
 * listing via operator approval.
 */
export function buildNftSetApprovalForAll(
	ctx: MarketOpContext,
	p: { nftContract: string; approved: boolean }
): MarketOpBundle {
	return bundleOn(ctx, p.nftContract, 'setApprovalForAll', {
		operator: marketIdentity(ctx),
		approved: p.approved
	});
}

/**
 * `approve(spender=market, id, amount)` on an **NFT contract** — the
 * narrower ERC-6909 per-token allowance. magi-market accepts this (capped,
 * decremented per mint) as authorization for a mint-spot listing instead of
 * blanket operator approval.
 */
export function buildNftApprove(
	ctx: MarketOpContext,
	p: { nftContract: string; tokenId: string; amount: number }
): MarketOpBundle {
	return bundleOn(ctx, p.nftContract, 'approve', {
		spender: marketIdentity(ctx),
		id: p.tokenId,
		amount: p.amount
	});
}

/**
 * `approve(spender=market, amount)` on a **magi_token-style payment
 * token** — lets the marketplace pull the buyer's funds via escrowIn for a
 * `buy` / `makeOffer` / `placeBid` / `rent` / `buyBundle` / `buyMintSpot`
 * paid in that token. Native (HBD/HIVE) payments use a `transfer.allow`
 * intent instead — see `nativeTransferAllow`.
 */
export function buildTokenApprove(
	ctx: MarketOpContext,
	p: { paymentToken: string; amount: string }
): MarketOpBundle {
	return bundleOn(ctx, p.paymentToken, 'approve', {
		spender: marketIdentity(ctx),
		amount: p.amount
	});
}

/**
 * Build a `transfer.allow` intent for a native-asset (HBD/HIVE) payment.
 * Attach to the paying op (`buy`, `makeOffer`, …) so the contract can pull
 * the funds. `token` is the lowercase native symbol (`'hbd'` | `'hive'`);
 * `limit` is the smallest-unit decimal string.
 */
export function nativeTransferAllow(token: string, limit: string): VscIntent {
	return { type: 'transfer.allow', args: { limit, token } };
}

/* ============================================================ *
 *  Fixed-price listings
 * ============================================================ */

export interface ListParams {
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	pricePerUnit: string;
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
/**
 * Guard a `amount: number` field against the JS-double precision cliff at
 * 2^53. The contract treats every amount as a `uint64`, so any caller-side
 * silent truncation to a representable double would mis-encode a >2^53
 * batch. Also rejects negative / non-integer / non-finite — all of which
 * would abort on the wire with a less helpful message.
 */
export function assertSafeAmount(amount: number, fieldName = 'amount'): void {
	if (!Number.isInteger(amount) || amount < 1 || amount > Number.MAX_SAFE_INTEGER) {
		throw new Error(
			`${fieldName}: must be a positive safe integer (1..${Number.MAX_SAFE_INTEGER}); got ${amount}`
		);
	}
}

/** Mirror the contract's batch cap on the client so an oversized batch
 *  fails clearly before signing instead of with a generic chain abort. */
export const MAX_BATCH_ITEMS = 20;

function listPayload(p: ListParams): Record<string, unknown> {
	assertSafeAmount(p.amount, 'list.amount');
	return {
		nftContract: p.nftContract,
		tokenId: p.tokenId,
		amount: p.amount,
		paymentToken: p.paymentToken,
		pricePerUnit: p.pricePerUnit,
		expirationBlock: p.expirationBlock ?? 0,
		startBlock: p.startBlock ?? 0,
		payoutMode: p.payoutMode ?? '',
		payoutL1Address: p.payoutL1Address ?? '',
		dexPool: p.dexPool ?? '',
		settleToken: p.settleToken ?? '',
		minSettleOut: p.minSettleOut ?? ''
	};
}
/** List an NFT for fixed-price sale (seller keeps custody via operator approval). */
export function buildList(ctx: MarketOpContext, p: ListParams): MarketOpBundle {
	return bundle(ctx, 'list', listPayload(p));
}

/** Cancel a fixed-price listing. Seller-only. */
export function buildDelist(ctx: MarketOpContext, p: { listingId: number }): MarketOpBundle {
	return bundle(ctx, 'delist', { listingId: p.listingId });
}

export interface BuyParams {
	listingId: number;
	amount: number;
}
/**
 * Buy `amount` units of a listing. Pass `intents` for native-asset
 * payments (see `nativeTransferAllow`); for magi_token-style payment
 * tokens approve the marketplace first (`buildBuyWithPayment`).
 */
export function buildBuy(
	ctx: MarketOpContext,
	p: BuyParams,
	intents?: VscIntent[]
): MarketOpBundle {
	assertSafeAmount(p.amount, 'buy.amount');
	return bundle(ctx, 'buy', { listingId: p.listingId, amount: p.amount }, undefined, intents);
}

/** Owner of a listing: change its price. */
export function buildUpdateListing(
	ctx: MarketOpContext,
	p: { listingId: number; newPrice: string }
): MarketOpBundle {
	return bundle(ctx, 'updateListing', { listingId: p.listingId, newPrice: p.newPrice });
}

/** Atomically create multiple listings in one tx. */
export function buildBatchList(ctx: MarketOpContext, p: { items: ListParams[] }): MarketOpBundle {
	if (p.items.length === 0) throw new Error('batchList: items[] cannot be empty');
	if (p.items.length > MAX_BATCH_ITEMS) {
		throw new Error(`batchList: items[] capped at ${MAX_BATCH_ITEMS}, got ${p.items.length}`);
	}
	return bundle(ctx, 'batchList', { items: p.items.map(listPayload) });
}

/** Atomically buy multiple listings in one tx. */
export function buildBatchBuy(ctx: MarketOpContext, p: { items: BuyParams[] }, intents?: VscIntent[]): MarketOpBundle {
	if (p.items.length === 0) throw new Error('batchBuy: items[] cannot be empty');
	if (p.items.length > MAX_BATCH_ITEMS) {
		throw new Error(`batchBuy: items[] capped at ${MAX_BATCH_ITEMS}, got ${p.items.length}`);
	}
	p.items.forEach((i) => assertSafeAmount(i.amount, 'batchBuy.amount'));
	return bundle(
		ctx,
		'batchBuy',
		{ items: p.items.map((i) => ({ listingId: i.listingId, amount: i.amount })) },
		undefined,
		intents
	);
}

/* ============================================================ *
 *  Offers
 * ============================================================ */

export interface MakeOfferParams {
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	pricePerUnit: string;
	expirationBlock?: number;
}
/** Make an offer on a specific token (or a collection-wide offer when the contract treats `tokenId` as a wildcard). */
export function buildMakeOffer(
	ctx: MarketOpContext,
	p: MakeOfferParams,
	intents?: VscIntent[]
): MarketOpBundle {
	assertSafeAmount(p.amount, 'makeOffer.amount');
	return bundle(
		ctx,
		'makeOffer',
		{
			nftContract: p.nftContract,
			tokenId: p.tokenId,
			amount: p.amount,
			paymentToken: p.paymentToken,
			pricePerUnit: p.pricePerUnit,
			expirationBlock: p.expirationBlock ?? 0
		},
		undefined,
		intents
	);
}

/** Cancel your own offer. */
export function buildCancelOffer(ctx: MarketOpContext, p: { offerId: number }): MarketOpBundle {
	return bundle(ctx, 'cancelOffer', { offerId: p.offerId });
}

/** NFT holder: accept an offer for `amount` units. */
export function buildAcceptOffer(
	ctx: MarketOpContext,
	p: { offerId: number; amount: number }
): MarketOpBundle {
	assertSafeAmount(p.amount, 'acceptOffer.amount');
	return bundle(ctx, 'acceptOffer', { offerId: p.offerId, amount: p.amount });
}

/** NFT holder: fulfil a collection-wide offer with a specific `tokenId`. */
export function buildAcceptCollectionOffer(
	ctx: MarketOpContext,
	p: { offerId: number; tokenId: string; amount: number }
): MarketOpBundle {
	assertSafeAmount(p.amount, 'acceptCollectionOffer.amount');
	return bundle(ctx, 'acceptCollectionOffer', {
		offerId: p.offerId,
		tokenId: p.tokenId,
		amount: p.amount
	});
}

/* ============================================================ *
 *  Auctions (English + Dutch)
 * ============================================================ */

export interface CreateAuctionParams {
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	auctionType: 'english' | 'dutch';
	startPrice: string;
	/** Dutch only — declining floor price. */
	endPrice?: string;
	startBlock?: number;
	endBlock: number;
}
/** Create an auction (NFT is escrowed to the marketplace for its duration). */
export function buildCreateAuction(ctx: MarketOpContext, p: CreateAuctionParams): MarketOpBundle {
	assertSafeAmount(p.amount, 'createAuction.amount');
	return bundle(ctx, 'createAuction', {
		nftContract: p.nftContract,
		tokenId: p.tokenId,
		amount: p.amount,
		paymentToken: p.paymentToken,
		auctionType: p.auctionType,
		startPrice: p.startPrice,
		endPrice: p.endPrice ?? '',
		startBlock: p.startBlock ?? 0,
		endBlock: p.endBlock
	});
}

/** Place a bid. English: escrows the bid; Dutch: the first accepting bid settles. */
export function buildPlaceBid(
	ctx: MarketOpContext,
	p: { auctionId: number; bidAmount: string },
	intents?: VscIntent[]
): MarketOpBundle {
	return bundle(ctx, 'placeBid', { auctionId: p.auctionId, bidAmount: p.bidAmount }, undefined, intents);
}

/** Settle an ended English auction. Permissionless — anyone may call it. */
export function buildSettleAuction(ctx: MarketOpContext, p: { auctionId: number }): MarketOpBundle {
	return bundle(ctx, 'settleAuction', { auctionId: p.auctionId });
}

/** Seller: cancel an auction (only while it has no live bids). */
export function buildCancelAuction(ctx: MarketOpContext, p: { auctionId: number }): MarketOpBundle {
	return bundle(ctx, 'cancelAuction', { auctionId: p.auctionId });
}

/** Owner-only: minimum bid increment, in basis points of the current high bid. */
export function buildSetMinBidIncrement(
	ctx: MarketOpContext,
	p: { minBidIncrementBps: number }
): MarketOpBundle {
	return bundle(ctx, 'setMinBidIncrement', { minBidIncrementBps: p.minBidIncrementBps });
}

/** Owner-only: anti-snipe window — bids within N blocks of the end extend it. */
export function buildSetAntiSnipeBlocks(
	ctx: MarketOpContext,
	p: { antiSnipeBlocks: number }
): MarketOpBundle {
	return bundle(ctx, 'setAntiSnipeBlocks', { antiSnipeBlocks: p.antiSnipeBlocks });
}

/* ============================================================ *
 *  Royalties & fees
 * ============================================================ */

/** Owner-only: legacy single-recipient royalty for a collection. */
export function buildSetRoyalty(
	ctx: MarketOpContext,
	p: { nftContract: string; royaltyBps: number; royaltyRecipient: string }
): MarketOpBundle {
	return bundle(ctx, 'setRoyalty', {
		nftContract: p.nftContract,
		royaltyBps: p.royaltyBps,
		royaltyRecipient: normalizeHiveAccount(p.royaltyRecipient)
	});
}

/** Owner-only: multi-recipient royalty splits (≤10 entries, Σ bps ≤ 5000). */
export function buildSetRoyaltySplits(
	ctx: MarketOpContext,
	p: { nftContract: string; splits: RoyaltySplit[] }
): MarketOpBundle {
	return bundle(ctx, 'setRoyaltySplits', {
		nftContract: p.nftContract,
		splits: p.splits.map((s) => ({
			recipient: normalizeHiveAccount(s.recipient),
			bps: s.bps
		}))
	});
}

/** Owner-only: global marketplace fee (basis points). */
export function buildSetFee(ctx: MarketOpContext, p: { feeBps: number }): MarketOpBundle {
	return bundle(ctx, 'setFee', { feeBps: p.feeBps });
}

/** Owner-only: change the fee-recipient account. */
export function buildSetFeeRecipient(
	ctx: MarketOpContext,
	p: { feeRecipient: string }
): MarketOpBundle {
	return bundle(ctx, 'setFeeRecipient', { feeRecipient: normalizeHiveAccount(p.feeRecipient) });
}

/** Owner-only: per-collection fee override. */
export function buildSetCollectionFee(
	ctx: MarketOpContext,
	p: { nftContract: string; feeBps: number }
): MarketOpBundle {
	return bundle(ctx, 'setCollectionFee', { nftContract: p.nftContract, feeBps: p.feeBps });
}

/** Owner-only: clear a per-collection fee override (revert to the global fee). */
export function buildClearCollectionFee(
	ctx: MarketOpContext,
	p: { nftContract: string }
): MarketOpBundle {
	return bundle(ctx, 'clearCollectionFee', { nftContract: p.nftContract });
}

/** Owner-only: minimum offer price floor (decimal string). */
export function buildSetMinOffer(ctx: MarketOpContext, p: { minOffer: string }): MarketOpBundle {
	return bundle(ctx, 'setMinOffer', { minOffer: p.minOffer });
}

/* ============================================================ *
 *  Floor sweep + bundles
 * ============================================================ */

/** Buy the cheapest listings of a collection atomically, slippage-guarded by `maxTotal`. */
export function buildSweep(
	ctx: MarketOpContext,
	p: { nftContract: string; listingIds: number[]; maxTotal: string },
	intents?: VscIntent[]
): MarketOpBundle {
	return bundle(
		ctx,
		'sweep',
		{ nftContract: p.nftContract, listingIds: p.listingIds, maxTotal: p.maxTotal },
		undefined,
		intents
	);
}

export interface ListBundleParams {
	nftContract: string;
	items: Array<{ tokenId: string; amount: number }>;
	paymentToken: string;
	price: string;
	expirationBlock?: number;
}
/** List a single-collection bundle for an all-or-nothing price. */
export function buildListBundle(ctx: MarketOpContext, p: ListBundleParams): MarketOpBundle {
	if (p.items.length === 0) throw new Error('listBundle: items[] cannot be empty');
	if (p.items.length > MAX_BATCH_ITEMS) {
		throw new Error(`listBundle: items[] capped at ${MAX_BATCH_ITEMS}, got ${p.items.length}`);
	}
	p.items.forEach((i) => assertSafeAmount(i.amount, 'listBundle.items.amount'));
	return bundle(ctx, 'listBundle', {
		nftContract: p.nftContract,
		items: p.items,
		paymentToken: p.paymentToken,
		price: p.price,
		expirationBlock: p.expirationBlock ?? 0
	});
}

/** Buy a bundle atomically. */
export function buildBuyBundle(
	ctx: MarketOpContext,
	p: { bundleId: number },
	intents?: VscIntent[]
): MarketOpBundle {
	return bundle(ctx, 'buyBundle', { bundleId: p.bundleId }, undefined, intents);
}

/** Seller: cancel a bundle listing. */
export function buildDelistBundle(ctx: MarketOpContext, p: { bundleId: number }): MarketOpBundle {
	return bundle(ctx, 'delistBundle', { bundleId: p.bundleId });
}

/* ============================================================ *
 *  NFT-for-NFT swaps
 * ============================================================ */

export interface ProposeSwapParams {
	offeredNft: string;
	offeredTokenId: string;
	offeredAmount: number;
	wantedNft: string;
	wantedTokenId: string;
	wantedAmount: number;
	/** Optional token top-up the proposer adds (fee-only, no royalty on barter). */
	topUp?: string;
	topUpToken?: string;
	expirationBlock?: number;
}
/** Propose an NFT-for-NFT swap (optional token top-up). */
export function buildProposeSwap(ctx: MarketOpContext, p: ProposeSwapParams): MarketOpBundle {
	assertSafeAmount(p.offeredAmount, 'proposeSwap.offeredAmount');
	assertSafeAmount(p.wantedAmount, 'proposeSwap.wantedAmount');
	return bundle(ctx, 'proposeSwap', {
		offeredNft: p.offeredNft,
		offeredTokenId: p.offeredTokenId,
		offeredAmount: p.offeredAmount,
		wantedNft: p.wantedNft,
		wantedTokenId: p.wantedTokenId,
		wantedAmount: p.wantedAmount,
		topUp: p.topUp ?? '',
		topUpToken: p.topUpToken ?? '',
		expirationBlock: p.expirationBlock ?? 0
	});
}

/** Accept a swap proposal (you must hold the wanted NFT + have approved the market). */
export function buildAcceptSwap(
	ctx: MarketOpContext,
	p: { swapId: number },
	intents?: VscIntent[]
): MarketOpBundle {
	return bundle(ctx, 'acceptSwap', { swapId: p.swapId }, undefined, intents);
}

/** Proposer: cancel a swap proposal. */
export function buildCancelSwap(ctx: MarketOpContext, p: { swapId: number }): MarketOpBundle {
	return bundle(ctx, 'cancelSwap', { swapId: p.swapId });
}

/* ============================================================ *
 *  Rentals (escrow-backed rights attestation)
 * ============================================================ */

export interface ListRentalParams {
	nftContract: string;
	tokenId: string;
	amount: number;
	paymentToken: string;
	pricePerBlock: string;
	minBlocks: number;
	maxBlocks: number;
}
/** List rental rights (NFT escrowed owner↔market, never to the renter). */
export function buildListRental(ctx: MarketOpContext, p: ListRentalParams): MarketOpBundle {
	assertSafeAmount(p.amount, 'listRental.amount');
	return bundle(ctx, 'listRental', {
		nftContract: p.nftContract,
		tokenId: p.tokenId,
		amount: p.amount,
		paymentToken: p.paymentToken,
		pricePerBlock: p.pricePerBlock,
		minBlocks: p.minBlocks,
		maxBlocks: p.maxBlocks
	});
}

/** Rent a listing for `blocks` blocks. */
export function buildRent(
	ctx: MarketOpContext,
	p: { rentalId: number; blocks: number },
	intents?: VscIntent[]
): MarketOpBundle {
	return bundle(ctx, 'rent', { rentalId: p.rentalId, blocks: p.blocks }, undefined, intents);
}

/** End a rental after its term — callable by anyone (no strand). */
export function buildEndRental(ctx: MarketOpContext, p: { rentalId: number }): MarketOpBundle {
	return bundle(ctx, 'endRental', { rentalId: p.rentalId });
}

/** Renter/owner: end a rental early (per contract rules). */
export function buildEndRentalEarly(ctx: MarketOpContext, p: { rentalId: number }): MarketOpBundle {
	return bundle(ctx, 'endRentalEarly', { rentalId: p.rentalId });
}

/** Owner: delist a rental that has no active renter. */
export function buildDelistRental(ctx: MarketOpContext, p: { rentalId: number }): MarketOpBundle {
	return bundle(ctx, 'delistRental', { rentalId: p.rentalId });
}

/* ============================================================ *
 *  Mint spots (primary sale — delegated mint)
 * ============================================================ */

export interface ListMintSpotsParams {
	nftContract: string;
	tokenId: string;
	paymentToken: string;
	pricePerSpot: string;
	/** Required (and ≤ allowance) when authorized via per-token approve. */
	maxSpots: number;
	expirationBlock?: number;
	startBlock?: number;
}
/** List mint spots for a pre-defined edition (delegated mint straight to buyers). */
export function buildListMintSpots(ctx: MarketOpContext, p: ListMintSpotsParams): MarketOpBundle {
	return bundle(ctx, 'listMintSpots', {
		nftContract: p.nftContract,
		tokenId: p.tokenId,
		paymentToken: p.paymentToken,
		pricePerSpot: p.pricePerSpot,
		maxSpots: p.maxSpots,
		expirationBlock: p.expirationBlock ?? 0,
		startBlock: p.startBlock ?? 0
	});
}

/** Buy `amount` mint spots — the NFT is minted directly to the buyer. */
export function buildBuyMintSpot(
	ctx: MarketOpContext,
	p: { listingId: number; amount: number },
	intents?: VscIntent[]
): MarketOpBundle {
	assertSafeAmount(p.amount, 'buyMintSpot.amount');
	return bundle(ctx, 'buyMintSpot', { listingId: p.listingId, amount: p.amount }, undefined, intents);
}

/** Lister: delist a mint-spot listing. */
export function buildDelistMintSpots(ctx: MarketOpContext, p: { listingId: number }): MarketOpBundle {
	return bundle(ctx, 'delistMintSpots', { listingId: p.listingId });
}

/* ============================================================ *
 *  Governance & payment tokens
 * ============================================================ */

/** Owner-only: propose a 2-step ownership transfer. */
export function buildChangeOwner(ctx: MarketOpContext, p: { newOwner: string }): MarketOpBundle {
	return bundle(ctx, 'changeOwner', { newOwner: normalizeHiveAccount(p.newOwner) });
}

/** Pending owner: accept a proposed ownership transfer (works while paused). */
export function buildAcceptOwnership(ctx: MarketOpContext): MarketOpBundle {
	return bundle(ctx, 'acceptOwnership', {});
}

/** Owner: cancel a pending ownership transfer. */
export function buildCancelOwnershipTransfer(ctx: MarketOpContext): MarketOpBundle {
	return bundle(ctx, 'cancelOwnershipTransfer', {});
}

/** Owner-only: pause / unpause the marketplace. */
export function buildPause(ctx: MarketOpContext): MarketOpBundle {
	return bundle(ctx, 'pause', {});
}
export function buildUnpause(ctx: MarketOpContext): MarketOpBundle {
	return bundle(ctx, 'unpause', {});
}

/** Owner-only: retroactively denylist a collection (recovery paths stay open). */
export function buildDenyCollection(
	ctx: MarketOpContext,
	p: { nftContract: string }
): MarketOpBundle {
	return bundle(ctx, 'denyCollection', { nftContract: p.nftContract });
}

/** Owner-only: re-allow a previously denied collection. */
export function buildAllowCollection(
	ctx: MarketOpContext,
	p: { nftContract: string }
): MarketOpBundle {
	return bundle(ctx, 'allowCollection', { nftContract: p.nftContract });
}

/** Owner-only: add an allowed payment token. */
export function buildAddPaymentToken(ctx: MarketOpContext, p: { token: string }): MarketOpBundle {
	return bundle(ctx, 'addPaymentToken', { token: p.token });
}

/** Owner-only: remove an allowed payment token. */
export function buildRemovePaymentToken(ctx: MarketOpContext, p: { token: string }): MarketOpBundle {
	return bundle(ctx, 'removePaymentToken', { token: p.token });
}

/** Owner-only emergency recovery: withdraw a stuck NFT/token to `to`. */
export interface EmergencyWithdrawParams {
	tokenType: string;
	contract: string;
	tokenId: string;
	amount: string;
	to: string;
}
export function buildEmergencyWithdraw(
	ctx: MarketOpContext,
	p: EmergencyWithdrawParams
): MarketOpBundle {
	return bundle(ctx, 'emergencyWithdraw', {
		tokenType: p.tokenType,
		contract: p.contract,
		tokenId: p.tokenId,
		amount: p.amount,
		to: normalizeHiveAccount(p.to)
	});
}

/** Initialize a freshly-deployed marketplace (owner-only, once). RC-heavy → 10000. */
export function buildInit(
	ctx: MarketOpContext,
	p: { feeBps: number; feeRecipient: string }
): MarketOpBundle {
	return bundle(ctx, 'init', {
		feeBps: p.feeBps,
		feeRecipient: normalizeHiveAccount(p.feeRecipient)
	});
}

/* ============================================================ *
 *  Cross-contract composites ("put an NFT up for sale")
 * ============================================================ */

/**
 * Full "sell" flow: grant the marketplace a **per-token** ERC-6909
 * allowance (`approve(market, tokenId, amount)`) on the NFT collection —
 * least-privilege, scoped to exactly the token being listed rather than a
 * blanket `setApprovalForAll` over the whole collection — then create the
 * listing. magi-market's `doList` accepts either an operator approval or a
 * per-token allowance ≥ the listed amount; `doBuy` drives magi_nft's
 * `safeTransferFrom`, which honours and decrements that same allowance per
 * sale. Returns BOTH bundles in broadcast order — hand straight to
 * `broadcastBatch`. `skipApproval` drops the approve leg when the seller
 * has already approved this token (or the whole collection).
 */
export function buildSellNftFlow(
	ctx: MarketOpContext,
	p: ListParams & { skipApproval?: boolean }
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		out.push(buildNftApprove(ctx, { nftContract: p.nftContract, tokenId: p.tokenId, amount: p.amount }));
	}
	out.push(buildList(ctx, p));
	return out;
}

/** Same as `buildSellNftFlow` but the second leg is an auction. */
export function buildAuctionNftFlow(
	ctx: MarketOpContext,
	p: CreateAuctionParams & { skipApproval?: boolean }
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		out.push(buildNftApprove(ctx, { nftContract: p.nftContract, tokenId: p.tokenId, amount: p.amount }));
	}
	out.push(buildCreateAuction(ctx, p));
	return out;
}

/** Same as `buildSellNftFlow` but the second leg is a rental listing. */
export function buildRentalNftFlow(
	ctx: MarketOpContext,
	p: ListRentalParams & { skipApproval?: boolean }
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		out.push(buildNftApprove(ctx, { nftContract: p.nftContract, tokenId: p.tokenId, amount: p.amount }));
	}
	out.push(buildListRental(ctx, p));
	return out;
}

/**
 * Mint-spot listing flow. `auth: 'operator'` grants blanket
 * `setApprovalForAll`; `auth: 'allowance'` grants a per-token
 * `approve(market, tokenId, maxSpots)` (capped) instead. Returns the
 * approval leg + the `listMintSpots` leg.
 */
export function buildMintSpotFlow(
	ctx: MarketOpContext,
	p: ListMintSpotsParams & { auth?: 'operator' | 'allowance'; skipApproval?: boolean }
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		if (p.auth === 'allowance') {
			out.push(
				buildNftApprove(ctx, {
					nftContract: p.nftContract,
					tokenId: p.tokenId,
					amount: p.maxSpots
				})
			);
		} else {
			out.push(buildNftSetApprovalForAll(ctx, { nftContract: p.nftContract, approved: true }));
		}
	}
	out.push(buildListMintSpots(ctx, p));
	return out;
}

export interface AcceptOfferFlowParams {
	offerId: number;
	amount: number;
	/** The offer's NFT collection — the approval leg targets this contract. */
	nftContract: string;
	/**
	 * The token being delivered. For a token-specific offer this is
	 * `offer.tokenId`; for a collection offer it's the id the accepting
	 * holder picked.
	 */
	tokenId: string;
	skipApproval?: boolean;
}

/**
 * Full "accept an offer" flow. Accepting is a *sale* — the contract pulls
 * the NFT out of the accepter's wallet via magi_nft's `safeTransferFrom` —
 * so `doAcceptOffer` preflights authorization exactly like `doList` does
 * and aborts with "Marketplace not approved as operator or sufficient
 * per-token allowance to fulfill offer" when neither is in place. Sellers
 * who never listed this token have no such approval, so the accept leg
 * alone fails.
 *
 * This emits the per-token ERC-6909 allowance
 * (`approve(market, tokenId, amount)` — least-privilege, scoped to exactly
 * the token and count being delivered rather than a blanket
 * `setApprovalForAll` over the collection) followed by the accept leg, in
 * broadcast order. `skipApproval` drops the approve leg when the market is
 * already an operator on the collection (or already holds a sufficient
 * allowance on this token).
 */
export function buildAcceptOfferFlow(
	ctx: MarketOpContext,
	p: AcceptOfferFlowParams
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		out.push(buildNftApprove(ctx, { nftContract: p.nftContract, tokenId: p.tokenId, amount: p.amount }));
	}
	out.push(buildAcceptOffer(ctx, { offerId: p.offerId, amount: p.amount }));
	return out;
}

/** Same as `buildAcceptOfferFlow` but the second leg fulfils a
 *  collection-wide offer with `tokenId`. */
export function buildAcceptCollectionOfferFlow(
	ctx: MarketOpContext,
	p: AcceptOfferFlowParams
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		out.push(buildNftApprove(ctx, { nftContract: p.nftContract, tokenId: p.tokenId, amount: p.amount }));
	}
	out.push(
		buildAcceptCollectionOffer(ctx, { offerId: p.offerId, tokenId: p.tokenId, amount: p.amount })
	);
	return out;
}

/**
 * Buy paid in a magi_token-style payment token: `approve(market, total)`
 * on the token contract, then `buy`. `total` is the smallest-unit decimal
 * string (pricePerUnit × amount). For native (HBD/HIVE) payments skip this
 * and pass `nativeTransferAllow(...)` as the `buy` intent instead.
 */
export function buildBuyWithPayment(
	ctx: MarketOpContext,
	p: BuyParams & { paymentToken: string; total: string }
): MarketOpBundle[] {
	return [
		buildTokenApprove(ctx, { paymentToken: p.paymentToken, amount: p.total }),
		buildBuy(ctx, { listingId: p.listingId, amount: p.amount })
	];
}

/* ============================================================ *
 *  Token-contract (ERC-20) fixed-price sale
 *  Asset = an amount of a token contract (not an NFT). Custody is the
 *  same approve+transferFrom model the contract uses for payment.
 * ============================================================ */

export interface ListTokenParams {
	/** The ERC-20 token contract whose units are being sold. */
	tokenContract: string;
	/** Amount of the asset token to sell (decimal string). */
	amount: string;
	paymentToken: string;
	/** Payment-token amount per ONE asset unit (decimal string). */
	pricePerUnit: string;
	expirationBlock?: number;
	startBlock?: number;
}

/** List an amount of an ERC-20 token for fixed-price sale. */
export function buildListToken(ctx: MarketOpContext, p: ListTokenParams): MarketOpBundle {
	return bundle(ctx, 'listToken', {
		tokenContract: p.tokenContract,
		amount: p.amount,
		paymentToken: p.paymentToken,
		pricePerUnit: p.pricePerUnit,
		expirationBlock: p.expirationBlock ?? 0,
		startBlock: p.startBlock ?? 0
	});
}

/** Seller: cancel a token-sale listing. */
export function buildDelistToken(ctx: MarketOpContext, p: { listingId: number }): MarketOpBundle {
	return bundle(ctx, 'delistToken', { listingId: p.listingId });
}

export interface BuyTokenParams {
	listingId: number;
	/** Amount of the asset token to buy (decimal string). */
	amount: string;
}
/**
 * Buy `amount` units of a token-sale listing. Pass `intents` for a native
 * payment token; for a magi_token-style payment token approve the market
 * first (`buildBuyTokenWithPayment`).
 */
export function buildBuyToken(
	ctx: MarketOpContext,
	p: BuyTokenParams,
	intents?: VscIntent[]
): MarketOpBundle {
	return bundle(ctx, 'buyToken', { listingId: p.listingId, amount: p.amount }, undefined, intents);
}

/**
 * Cross-contract "sell a token": ERC-20 `approve(spender=contract:<market>,
 * amount)` on the **asset** token, then `listToken`. Returns both bundles
 * in broadcast order — hand to `broadcastBatch`. magi-market's `buyToken`
 * pulls the asset via `transferFrom` against this allowance (atomic).
 * `skipApproval` drops the approve leg when already approved.
 */
export function buildSellTokenFlow(
	ctx: MarketOpContext,
	p: ListTokenParams & { skipApproval?: boolean }
): MarketOpBundle[] {
	const out: MarketOpBundle[] = [];
	if (!p.skipApproval) {
		out.push(buildTokenApprove(ctx, { paymentToken: p.tokenContract, amount: p.amount }));
	}
	out.push(buildListToken(ctx, p));
	return out;
}

/**
 * Buy a token-sale listing paid in a magi_token-style payment token:
 * `approve(market, total)` on the payment token, then `buyToken`. `total`
 * = pricePerUnit × amount (decimal string). Native payments instead pass
 * `nativeTransferAllow(...)` as the `buyToken` intent.
 */
export function buildBuyTokenWithPayment(
	ctx: MarketOpContext,
	p: BuyTokenParams & { paymentToken: string; total: string }
): MarketOpBundle[] {
	return [
		buildTokenApprove(ctx, { paymentToken: p.paymentToken, amount: p.total }),
		buildBuyToken(ctx, { listingId: p.listingId, amount: p.amount })
	];
}
