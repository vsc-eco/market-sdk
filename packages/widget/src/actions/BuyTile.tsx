import type { ReactNode } from 'react';
import type { BucketListing, BundleListing, Listing, MintSpotListing } from '@vsc.eco/market-sdk';
import { MarketTile } from '../components/MarketTile.js';

/** What a buy-now item gets you — see MarketPanel's BuyKind. */
export type BuyKind = 'single' | 'bundle' | 'random' | 'mint';

export interface BuyItem {
	key: string;
	kind: BuyKind;
	nftContract: string;
	seller: string;
	tokenId?: string;
	coverCandidates?: string[];
	paymentToken: string;
	price: string;
	indexedAt?: string;
	listing?: Listing;
	bundle?: BundleListing;
	bucket?: BucketListing;
	mintSpot?: MintSpotListing;
}

export const BUY_KIND_LABEL: Record<BuyKind, string> = {
	single: 'Single',
	bundle: 'Bundle',
	random: 'Mystery',
	mint: 'Mint'
};

/**
 * Everything one tile needs that the panel owns.
 *
 * Passed explicitly rather than closed over, because this used to be a
 * function declared inside MarketPanel's render — the same shape that, as a
 * component, silently remounts its subtree on every pass. A real module-scope
 * component with a named props contract cannot drift back into that.
 */
export interface BuyTileProps {
	item: BuyItem;
	username?: string;
	isSelf: (account?: string) => boolean;
	tokenMeta: { symbol: (t: string) => string; format: (t: string, micro: string) => string };
	nftImages: { get: (contract: string, tokenId: string) => string | null | undefined };
	chainClock: {
		secondsUntilBlock: (block: number) => number | null;
		blockToDate: (block: number) => Date | null;
	};
	formatCountdown: (secs: number) => string;
	formatDateTime: (d: Date) => string;
	/** `${kind}:${id}` while that item's cancel is in flight. */
	canceling: string | null;
	/** Bucket id currently being drawn from. */
	drawing: number | null;
	onSheet: (sheet: BuySheetRequest) => void;
	onCancel: (kind: 'listing' | 'bundle' | 'bucket' | 'mintspots', id: number) => void;
	onDraw: (bucket: BucketListing, mode: 'single' | 'pack') => void;
	/** Whether the user can cover a price. Unknown counts as affordable. */
	canAfford: (paymentToken: string, micro: string | null | undefined) => boolean;
}

/** The sheets a tile can ask the panel to open. */
export type BuySheetRequest =
	| { kind: 'nftDetails'; nftContract: string; tokenId: string }
	| { kind: 'buy'; listing: Listing }
	| { kind: 'offer'; listing: Listing }
	| { kind: 'updateListing'; listing: Listing }
	| { kind: 'buyBundle'; bundle: BundleListing }
	| { kind: 'bundleDetail'; bundle: BundleListing }
	| { kind: 'bucketDetail'; bucket: BucketListing }
	| { kind: 'addToBucket'; bucket: BucketListing }
	| { kind: 'buyMintSpot'; listing: MintSpotListing };

export function BuyTile({
	item: it,
	username,
	isSelf,
	tokenMeta,
	nftImages,
	chainClock,
	formatCountdown,
	formatDateTime,
	canceling,
	drawing,
	onSheet,
	onCancel,
	onDraw,
	canAfford
}: BuyTileProps): ReactNode {

		const mine = isSelf(it.seller);
		const sym = tokenMeta.symbol(it.paymentToken);
		// Walk the candidates and take the first that actually has art. `get`
		// returns undefined while a lookup is still in flight and null once it
		// has resolved to nothing, so only a real URL ends the search — a tile
		// does not settle for the logo just because the first image is slow.
		const cover =
			(it.tokenId ? nftImages.get(it.nftContract, it.tokenId) : null) ??
			(it.coverCandidates ?? []).reduce<string | null | undefined>(
				(found, t) => found ?? nftImages.get(it.nftContract, t),
				undefined
			) ??
			null;

		const common = {
			badge: BUY_KIND_LABEL[it.kind],
			badgeTone: it.kind === 'single' ? undefined : (it.kind as 'bundle' | 'random' | 'mint'),
			imageUrl: cover,
			tokenId: it.tokenId ?? ''
		};

		if (it.kind === 'single' && it.listing) {
			const l = it.listing;
			const expSecs = l.expirationBlock ? chainClock.secondsUntilBlock(l.expirationBlock) : null;
			const expDate = l.expirationBlock ? chainClock.blockToDate(l.expirationBlock) : null;
			const expired = expSecs != null && expSecs <= 0;
			return (
				<MarketTile
					{...common}
					subtitle={
						l.expirationBlock ? (
							<span className={`magi-market-tile-expiry${expired ? ' expired' : ''}`}>
								{expired
									? 'expired'
									: expSecs != null
										? `expires in ${formatCountdown(expSecs)}`
										: expDate
											? `expires ${formatDateTime(expDate)}`
											: `expires block ${l.expirationBlock}`}
							</span>
						) : undefined
					}
					price={<>{tokenMeta.format(l.paymentToken, l.pricePerUnit)} {sym} · ×{l.amount}</>}
					onOpen={() => onSheet({ kind: 'nftDetails', nftContract: l.nftContract, tokenId: l.tokenId })}
					actions={
						mine ? (
							<>
								<button type="button" className="magi-market-submit ghost" disabled={!username}
									onClick={() => onSheet({ kind: 'updateListing', listing: l })}>Edit</button>
								<button type="button" className="magi-market-submit ghost"
									disabled={canceling === `listing:${l.listingId}`}
									onClick={() => onCancel('listing', l.listingId)}>
									{canceling === `listing:${l.listingId}` ? 'Cancelling…' : 'Cancel'}
								</button>
							</>
						) : (
							<>
								<button type="button" className="magi-market-submit" disabled={!username}
									onClick={() => onSheet({ kind: 'buy', listing: l })}>Buy</button>
								<button type="button" className="magi-market-submit ghost" disabled={!username}
									onClick={() => onSheet({ kind: 'offer', listing: l })}>Offer</button>
							</>
						)
					}
				/>
			);
		}

		if (it.kind === 'bundle' && it.bundle) {
			const b = it.bundle;
			const units = b.items.reduce((n, i) => n + i.amount, 0);
			return (
				<MarketTile
					{...common}
					label={`Bundle #${b.bundleId}`}
					subtitle={<>{b.items.length} NFTs{units !== b.items.length ? ` (${units} units)` : ''} · one lot</>}
					price={<>{tokenMeta.format(b.paymentToken, b.price)} {sym}</>}
					// The tile opens the bundle, not one NFT inside it — which
					// item you happen to see is an implementation detail of the
					// thumbnail.
					onOpen={() => onSheet({ kind: 'bundleDetail', bundle: b })}
					actions={
						mine ? (
							<button type="button" className="magi-market-submit ghost"
								disabled={canceling === `bundle:${b.bundleId}`}
								onClick={() => onCancel('bundle', b.bundleId)}>
								{canceling === `bundle:${b.bundleId}` ? 'Cancelling…' : 'Cancel'}
							</button>
						) : (
							<>
								<button type="button" className="magi-market-submit" disabled={!username}
									onClick={() => onSheet({ kind: 'buyBundle', bundle: b })}>Buy</button>
								<button type="button" className="magi-market-submit ghost"
									onClick={() => onSheet({ kind: 'bundleDetail', bundle: b })}>Contents</button>
							</>
						)
					}
				/>
			);
		}

		if (it.kind === 'random' && it.bucket) {
			const b = it.bucket;
			const singles = b.pricePerDraw !== '0' && b.pricePerDraw !== '';
			return (
				<MarketTile
					{...common}
					// The seller's own name if they gave one; the id is a fallback,
					// not a label anybody chose.
					label={b.name?.trim() ? b.name : `Mystery #${b.bucketId}`}
					subtitle={<>{b.unitsStocked} left{b.packSize > 0 ? ` · packs of ${b.packSize}` : ''}</>}
					price={<>{tokenMeta.format(b.paymentToken, it.price)} {sym}<span className="magi-market-tile-per">{singles ? '/draw' : '/pack'}</span></>}
					onOpen={() => onSheet({ kind: 'bucketDetail', bucket: b })}
					actions={
						mine ? (
							<>
								{/* A sale can be topped up after it opens — that is how it
								    gets past the 24 entries one transaction carries. */}
								<button type="button" className="magi-market-submit ghost"
									onClick={() => onSheet({ kind: 'addToBucket', bucket: b })}>
									Add
								</button>
								<button type="button" className="magi-market-submit ghost"
									disabled={canceling === `bucket:${b.bucketId}`}
									onClick={() => onCancel('bucket', b.bucketId)}>
									{canceling === `bucket:${b.bucketId}` ? 'Cancelling…' : 'Cancel'}
								</button>
							</>
						) : (
							<>
								{(() => {
									// This button buys immediately — there is no form in
									// between to catch an empty wallet.
									const cost = singles ? b.pricePerDraw : b.pricePerPack;
									const afford = canAfford(b.paymentToken, cost);
									return (
										<button type="button" className="magi-market-submit"
											disabled={!username || drawing === b.bucketId || b.unitsStocked === 0 || !afford}
											title={afford ? undefined : `Not enough ${tokenMeta.symbol(b.paymentToken)}`}
											onClick={() => onDraw(b, singles ? 'single' : 'pack')}>
											{drawing === b.bucketId ? 'Drawing…' : singles ? 'Draw' : 'Pack'}
										</button>
									);
								})()}
								<button type="button" className="magi-market-submit ghost"
									onClick={() => onSheet({ kind: 'bucketDetail', bucket: b })}>Odds</button>
							</>
						)
					}
				/>
			);
		}

		if (it.kind === 'mint' && it.mintSpot) {
			const m = it.mintSpot;
			return (
				<MarketTile
					{...common}
					subtitle={<>{m.sold}/{m.maxSpots || '∞'} sold</>}
					price={<>{tokenMeta.format(m.paymentToken, m.pricePerSpot)} {sym}</>}
					onOpen={() => onSheet({ kind: 'nftDetails', nftContract: m.nftContract, tokenId: m.tokenId })}
					actions={
						mine ? (
							<button type="button" className="magi-market-submit ghost"
								disabled={canceling === `mintspots:${m.listingId}`}
								onClick={() => onCancel('mintspots', m.listingId)}>
								{canceling === `mintspots:${m.listingId}` ? 'Cancelling…' : 'Cancel'}
							</button>
						) : (
							<button type="button" className="magi-market-submit" disabled={!username}
								onClick={() => onSheet({ kind: 'buyMintSpot', listing: m })}>Mint</button>
						)
					}
				/>
			);
		}
		return null;
}
