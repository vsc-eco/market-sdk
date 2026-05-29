import { useEffect, useMemo, useState } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import {
	createNftClient,
	MAINNET_CONFIG as TOKEN_MAINNET,
	TESTNET_CONFIG as TOKEN_TESTNET,
	type NftItem
} from '@vsc.eco/token-sdk';
import { Spinner } from './Spinner.js';
import magiSvg from '../assets/magi.svg';
import type { TransferableToken } from './useCollectionTokens.js';

/** Sentinel for the "any NFT in this collection" (collection-wide) choice. */
export const ANY_TOKEN = '__any__';

export interface CollectionNftPickerProps {
	config: MagiConfig;
	/** The collection being browsed (NFTs aren't from the user's wallet). */
	nftContract: string;
	/** Transferable tokens to show (from `useCollectionTokens`). */
	tokens: TransferableToken[];
	loading?: boolean;
	/** '' = nothing picked; ANY_TOKEN = collection-wide; else a tokenId. */
	value: string;
	onChange: (tokenId: string) => void;
	label?: string;
	disabled?: boolean;
}

function Tile({
	imageUrl,
	tokenId,
	tag,
	selected,
	onPick
}: {
	imageUrl: string | null;
	tokenId: string;
	tag?: string;
	selected: boolean;
	onPick: () => void;
}) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	return (
		<div
			className={`magi-market-tile${selected ? ' selected' : ''}`}
			role="button"
			tabIndex={0}
			onClick={onPick}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onPick();
				}
			}}
		>
			<div className={`magi-market-tile-image ${useFallback ? 'fallback' : ''}`}>
				{useFallback ? (
					<img src={magiSvg} alt={`#${tokenId}`} className="magi-market-tile-fallback-img" />
				) : (
					<img src={imageUrl as string} alt={`#${tokenId}`} loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
				)}
			</div>
			<div className="magi-market-tile-id" title={tokenId}>#{tokenId}</div>
			{tag && (
				<div className="magi-market-tile-row">
					<span className="magi-market-tile-tag">{tag}</span>
				</div>
			)}
		</div>
	);
}

/**
 * Visual single-select grid of the transferable NFTs in a collection —
 * the same tile chrome as `NftPicker`, but the items come from a
 * collection enumeration (the buyer doesn't own them) rather than the
 * connected wallet. Includes a leading "Any NFT" tile that maps to a
 * collection-wide offer.
 */
export function CollectionNftPicker({
	config,
	nftContract,
	tokens,
	loading,
	value,
	onChange,
	label = 'NFT to offer on',
	disabled
}: CollectionNftPickerProps) {
	const tokenConfig = useMemo(
		() => (config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET),
		[config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [images, setImages] = useState<Map<string, string | null>>(new Map());
	const [query, setQuery] = useState('');

	// Resolve images for the transferable token set (one getStateByKeys per
	// contract under the hood).
	useEffect(() => {
		if (!nftContract || tokens.length === 0) return;
		let cancelled = false;
		const items = tokens.map((t) => ({ contractId: nftContract, tokenId: t.tokenId } as NftItem));
		nft.nft.provider.resolveNftImages(items).then((m) => {
			if (cancelled) return;
			setImages((prev) => {
				const next = new Map(prev);
				for (const [k, v] of m) next.set(k, v);
				return next;
			});
		}).catch(() => {});
		return () => { cancelled = true; };
	}, [nft, nftContract, tokens]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return tokens;
		return tokens.filter((t) => t.tokenId.toLowerCase().includes(q));
	}, [tokens, query]);

	const imgFor = (tokenId: string) => images.get(`${nftContract}:${tokenId}`) ?? null;

	return (
		<div className="magi-market-field">
			<span className="magi-market-field-label">
				{label}
				{value && value !== ANY_TOKEN && <span className="magi-market-row-sub"> — #{value}</span>}
				{value === ANY_TOKEN && <span className="magi-market-row-sub"> — any NFT (collection-wide)</span>}
			</span>
			<div className="magi-market-nftpicker-inline">
				<div className="magi-market-search" style={{ margin: '0 0 0.6rem' }}>
					<svg className="magi-market-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
						<circle cx="11" cy="11" r="8" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
					<input
						value={query}
						onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
						placeholder="Search by token id…"
						autoComplete="off"
						spellCheck={false}
						disabled={disabled}
					/>
				</div>
				{loading && <Spinner label="Loading transferable NFTs…" />}
				{!loading && (
					<div className="magi-market-grid">
						{/* Collection-wide "any NFT" choice always first. */}
						<div
							className={`magi-market-tile${value === ANY_TOKEN ? ' selected' : ''}`}
							role="button"
							tabIndex={0}
							onClick={() => onChange(ANY_TOKEN)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onChange(ANY_TOKEN);
								}
							}}
						>
							<div className="magi-market-tile-image fallback">
								<img src={magiSvg} alt="Any NFT" className="magi-market-tile-fallback-img" />
							</div>
							<div className="magi-market-tile-id">Any NFT</div>
							<div className="magi-market-tile-row">
								<span className="magi-market-tile-tag">collection-wide</span>
							</div>
						</div>
						{filtered.map((t) => (
							<Tile
								key={t.tokenId}
								imageUrl={imgFor(t.tokenId)}
								tokenId={t.tokenId}
								tag={t.soulbound ? 'SBT (owner)' : undefined}
								selected={value === t.tokenId}
								onPick={() => onChange(t.tokenId)}
							/>
						))}
					</div>
				)}
				{!loading && tokens.length === 0 && (
					<div className="magi-market-state">
						No transferable NFTs in this collection — you can still make a collection-wide offer above.
					</div>
				)}
			</div>
		</div>
	);
}
