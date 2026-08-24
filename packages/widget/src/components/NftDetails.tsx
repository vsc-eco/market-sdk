import { Fragment, useEffect, useMemo, useState } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import {
	createNftClient,
	extractImageUrl,
	buildBaseUriImage,
	type NftCollection,
	type NftMetadata
} from '@vsc.eco/token-sdk';
import { tokenConfigFrom } from './tokenConfig.js';
import { Modal } from './Modal.js';
import { Spinner } from './Spinner.js';
import magiSvg from '../assets/magi.svg';

export interface NftDetailsProps {
	config: MagiConfig;
	nftContract: string;
	tokenId: string;
	onClose: () => void;
}

/** Keys rendered explicitly; everything else in the props blob becomes an
 * "attribute" row so collection-specific metadata still surfaces. */
const CORE_KEYS = new Set(['name', 'description', 'image']);

/**
 * Read-only NFT details popup. Resolves the collection + per-token props
 * via the token-sdk NFT provider (same source the picker uses) and shows
 * the image, names, description, and any extra metadata attributes.
 */
export function NftDetails({ config, nftContract, tokenId, onClose }: NftDetailsProps) {
	const tokenConfig = useMemo(
		() => tokenConfigFrom(config),
		[config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [collection, setCollection] = useState<NftCollection | null>(null);
	const [meta, setMeta] = useState<NftMetadata | null>(null);
	const [image, setImage] = useState<string | null>(null);
	const [imgFailed, setImgFailed] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		// Reuse the same 3-tier image priority the token-sdk provider uses
		// (own props → template props → baseUri+tokenId) instead of
		// re-implementing a subset. We fetch the template link first so we
		// only request template props when there actually is one.
		(async () => {
			const [coll, links] = await Promise.all([
				nft.nft.provider.getCollection(nftContract).catch(() => null),
				nft.nft.provider.getTemplateLinks([nftContract]).catch(() => [])
			]);
			if (cancelled) return;
			const templateId =
				links.find((l) => l.contractId === nftContract && l.tokenId === tokenId)?.templateId ?? null;
			const ids = templateId && templateId !== tokenId ? [tokenId, templateId] : [tokenId];
			const propsMap = await nft.nft.provider
				.getTokenProperties(nftContract, ids)
				.catch(() => new Map<string, NftMetadata>());
			if (cancelled) return;
			const ownMeta = propsMap.get(`${nftContract}:${tokenId}`) ?? null;
			const tplMeta = templateId ? propsMap.get(`${nftContract}:${templateId}`) ?? null : null;
			setCollection(coll);
			setMeta(ownMeta);
			setImage(
				extractImageUrl(ownMeta) ??
					extractImageUrl(tplMeta) ??
					buildBaseUriImage(coll?.baseUri, tokenId)
			);
			setLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [nft, nftContract, tokenId]);

	const collectionName = collection?.name || `${nftContract.slice(0, 10)}…`;
	const attrs = meta
		? Object.entries(meta).filter(([k, v]) => !CORE_KEYS.has(k.toLowerCase()) && v != null && v !== '')
		: [];
	const useFallback = !image || imgFailed;

	return (
		<Modal
			title={meta?.name || `#${tokenId}`}
			subtitle={`${collectionName} · #${tokenId}`}
			onClose={onClose}
			wide
			confirmOnBackdrop={false}
		>
			<div className="magi-market-nftdetails">
				<div className={`magi-market-nftdetails-image ${useFallback ? 'fallback' : ''}`}>
					{useFallback ? (
						<img src={magiSvg} alt={`#${tokenId}`} className="magi-market-tile-fallback-img" />
					) : (
						<img src={image as string} alt={`#${tokenId}`} onError={() => setImgFailed(true)} />
					)}
				</div>

				{loading && <Spinner label="Loading details…" />}

				{meta?.description && <p className="magi-market-nftdetails-desc">{meta.description}</p>}

				<dl className="magi-market-nftdetails-grid">
					<dt>Collection</dt>
					<dd>{collectionName}</dd>
					<dt>Contract</dt>
					<dd><code>{nftContract}</code></dd>
					<dt>Token id</dt>
					<dd><code>{tokenId}</code></dd>
					{collection?.owner && (
						<Fragment>
							<dt>Owner</dt>
							<dd>{collection.owner}</dd>
						</Fragment>
					)}
					{attrs.map(([k, v]) => (
						<Fragment key={k}>
							<dt>{k}</dt>
							<dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
						</Fragment>
					))}
				</dl>
			</div>
		</Modal>
	);
}
