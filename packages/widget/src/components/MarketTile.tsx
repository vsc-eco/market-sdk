import { useState, type ReactNode } from 'react';
import magiSvg from '../assets/magi.svg';

/**
 * A single NFT card used by the listings / auctions / mint-spots tabs.
 * Mirrors the tile chrome `NftPicker` uses (`.magi-market-tile-*`) so the
 * panel and picker stay visually consistent. The image area is keyboard-
 * focusable and clickable to open the NFT details popup; everything below
 * the image (price line, action buttons) is freely composable via slots.
 */
export interface MarketTileProps {
	imageUrl: string | null | undefined;
	tokenId: string;
	subtitle?: ReactNode;
	price?: ReactNode;
	/**
	 * What KIND of thing this is — "single", "bundle", "random", "mint".
	 * Carried on the tile because the buy-now tab mixes all four in one grid:
	 * with the formats no longer separated by tab, the tile itself has to say
	 * what you get.
	 */
	badge?: ReactNode;
	/**
	 * Replaces the `#<tokenId>` line. Bundles and buckets are not a single
	 * token, so "#0" would be the bundle's id masquerading as an NFT.
	 */
	label?: ReactNode;
	actions?: ReactNode;
	onOpen: () => void;
}

export function MarketTile({ imageUrl, tokenId, subtitle, price, badge, label, actions, onOpen }: MarketTileProps) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	return (
		<div className="magi-market-tile magi-market-listing-tile">
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
					<img
						src={imageUrl as string}
						alt={`#${tokenId}`}
						loading="lazy"
						decoding="async"
						onError={() => setImgFailed(true)}
					/>
				)}
				{badge && <span className="magi-market-tile-badge">{badge}</span>}
			</div>
			<div className="magi-market-tile-id" title={tokenId}>{label ?? <>#{tokenId}</>}</div>
			{subtitle && <div className="magi-market-tile-sub">{subtitle}</div>}
			{price && <div className="magi-market-tile-price">{price}</div>}
			{actions && <div className="magi-market-tile-actions">{actions}</div>}
		</div>
	);
}
