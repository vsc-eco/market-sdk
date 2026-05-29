import { useEffect, useMemo, useState } from 'react';
import type { BundleListing, MarketClient } from '@vsc.eco/market-sdk';
import {
	createNftClient,
	MAINNET_CONFIG as TOKEN_MAINNET,
	TESTNET_CONFIG as TOKEN_TESTNET,
	type NftItem
} from '@vsc.eco/token-sdk';
import { CollectionGroup } from '../components/CollectionGroup.js';
import { Spinner } from '../components/Spinner.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useCollectionMeta } from '../components/useCollectionMeta.js';
import magiSvg from '../assets/magi.svg';

export interface BundleCardProps {
	client: MarketClient;
	bundle: BundleListing;
	/** Is the connected user the bundle's seller. */
	mine: boolean;
	username?: string;
	canceling: boolean;
	onBuy: () => void;
	onCancel: () => void;
	onOpenNft: (nftContract: string, tokenId: string) => void;
}

function Tile({ imageUrl, tokenId, amount, onOpen }: { imageUrl: string | null; tokenId: string; amount: number; onOpen: () => void }) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	return (
		<div className="magi-market-tile">
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
					<img src={magiSvg} alt={`#${tokenId}`} className="magi-market-tile-fallback-img" />
				) : (
					<img src={imageUrl as string} alt={`#${tokenId}`} loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
				)}
			</div>
			<div className="magi-market-tile-id" title={tokenId}>#{tokenId}</div>
			{amount > 1 && (
				<div className="magi-market-tile-row">
					<span className="magi-market-tile-tag">×{amount}</span>
				</div>
			)}
		</div>
	);
}

/**
 * One bundle rendered as a collapsible group: header shows
 * `Bundle #N · collection`, the lot price, and a Buy/Cancel action; the body
 * is a grid of the bundle's NFT tiles (token ids fetched from node state via
 * `provider.getBundleItems`, images resolved like the rest of the widget).
 * Clicking a tile opens that NFT's details.
 */
export function BundleCard({ client, bundle, mine, username, canceling, onBuy, onCancel, onOpenNft }: BundleCardProps) {
	const tokenMeta = useTokenMeta(client.config);
	const collMeta = useCollectionMeta(client.config);
	const tokenConfig = useMemo(
		() => (client.config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET),
		[client.config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [items, setItems] = useState<Array<{ tokenId: string; amount: number }> | null>(null);
	const [nftContract, setNftContract] = useState(bundle.nftContract);
	const [images, setImages] = useState<Map<string, string | null>>(new Map());

	useEffect(() => {
		let cancelled = false;
		(async () => {
			let res: { nftContract: string; items: Array<{ tokenId: string; amount: number }> };
			try {
				res = await client.provider.getBundleItems(bundle.bundleId);
			} catch {
				if (!cancelled) setItems([]);
				return;
			}
			if (cancelled) return;
			const nc = res.nftContract || bundle.nftContract;
			setNftContract(nc);
			setItems(res.items); // commit items first — image resolution must not undo this
			if (!res.items.length) return;
			// Image resolution is best-effort: a failure here (e.g. a collection
			// with no images) must NOT wipe the item list, so it's isolated.
			try {
				const map = await nft.nft.provider.resolveNftImages(
					res.items.map((it) => ({ contractId: nc, tokenId: it.tokenId } as NftItem))
				);
				if (!cancelled) setImages(map);
			} catch {
				/* tiles fall back to the logo */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [client, nft, bundle]);

	const imgFor = (tokenId: string) => images.get(`${nftContract}:${tokenId}`) ?? null;

	const action = (
		<>
			<span className="magi-market-row-price" style={{ fontSize: '0.82rem', marginRight: '0.2rem' }}>
				{tokenMeta.format(bundle.paymentToken, bundle.price)} {tokenMeta.symbol(bundle.paymentToken)}
			</span>
			{mine ? (
				<button type="button" className="magi-market-submit ghost" style={{ width: 'auto', padding: '0.35rem 0.8rem' }} disabled={canceling} onClick={onCancel}>
					{canceling ? 'Cancelling…' : 'Cancel'}
				</button>
			) : (
				<button type="button" className="magi-market-submit" style={{ width: 'auto', padding: '0.35rem 0.8rem' }} disabled={!username} onClick={onBuy}>
					Buy bundle
				</button>
			)}
		</>
	);

	return (
		<CollectionGroup
			collectionName={`Bundle #${bundle.bundleId} · ${collMeta.name(nftContract)}`}
			count={items ? items.length : bundle.items.length}
			action={action}
		>
			{items === null ? (
				<Spinner label="Loading bundle items…" />
			) : (
				items.map((it) => (
					<Tile key={it.tokenId} imageUrl={imgFor(it.tokenId)} tokenId={it.tokenId} amount={it.amount} onOpen={() => onOpenNft(nftContract, it.tokenId)} />
				))
			)}
		</CollectionGroup>
	);
}
