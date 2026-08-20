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

export interface NftSelection {
	nftContract: string;
	tokenId: string;
}

export interface NftPickerProps {
	/** Market config — its `network` selects the token-sdk indexer. */
	config: MagiConfig;
	/** Connected account whose NFTs to list. */
	username?: string;
	value: NftSelection | null;
	onChange: (v: NftSelection) => void;
	label?: string;
	disabled?: boolean;
	/**
	 * Optional eligibility predicate. Items failing it are hidden from the
	 * grid (and excluded from search). Used e.g. by the mint-spots form to
	 * only show editions the user can actually sell spots for.
	 */
	filterItem?: (i: NftItem) => boolean;
	/** Message shown when the user has NFTs but none pass `filterItem`. */
	emptyHint?: string;
}

const tagOf = (i: NftItem) => (i.isUnique ? 'Unique' : i.soulbound ? 'SBT' : 'Editioned');

/**
 * One NFT tile — identical markup/classes to token-widget's NftPanel tile,
 * including the per-tile broken-image fallback to the Magi logo.
 */
function NftTile({
	item,
	imageUrl,
	selected,
	onPick
}: {
	item: NftItem;
	imageUrl: string | null;
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
					<img src={magiSvg} alt={`#${item.tokenId}`} className="magi-market-tile-fallback-img" />
				) : (
					<img src={imageUrl as string} alt={`#${item.tokenId}`} loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
				)}
			</div>
			<div className="magi-market-tile-id" title={item.tokenId}>
				#{item.tokenId}
			</div>
			<div className="magi-market-tile-row">
				{!item.isUnique && <span className="magi-market-tile-balance">×{item.balance}</span>}
				{!item.isUnique && item.maxSupply > 0 && (
					<span
						className="magi-market-tile-supply"
						title={`Editions minted / max supply`}
					>
						{item.currentSupply ?? '?'}/{item.maxSupply}
					</span>
				)}
				<span className="magi-market-tile-tag">{tagOf(item)}</span>
			</div>
		</div>
	);
}

/**
 * Owned-NFT picker: an always-visible inline grid (NOT a dropdown) with a
 * search box. Reuses @vsc.eco/token-sdk's NFT provider (same indexed
 * inventory + image resolution as the token-sdk panels) and token-widget's
 * tile chrome. The selected tile stays highlighted; selection persists in
 * the parent form, so navigating away and back keeps it. No manual
 * contract/id entry — selection is always from the connected wallet.
 */
export function NftPicker({ config, username, value, onChange, label = 'NFT', disabled, filterItem, emptyHint }: NftPickerProps) {
	const tokenConfig = useMemo(
		() => (config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET),
		[config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [items, setItems] = useState<NftItem[]>([]);
	const [images, setImages] = useState<Map<string, string | null>>(new Map());
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [query, setQuery] = useState('');

	// The indexer stores accounts WITH the `hive:` prefix
	// (`magi_nft_balances.account = "hive:tibfox"`), so the bare username
	// must be normalized or every lookup returns zero rows.
	const account = useMemo(
		() => (username ? `hive:${username.replace(/^@/, '').replace(/^hive:/, '')}` : undefined),
		[username]
	);

	useEffect(() => {
		if (!account) return;
		let cancelled = false;
		setLoading(true);
		setErr(null);
		nft.nft.provider
			.getUserNfts(account)
			.then((its) => {
				if (cancelled) return;
				setItems(its);
			})
			.catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)))
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [nft, account]);

	const key = (i: NftItem) => `${i.contractId}:${i.tokenId}`;
	const imgFor = (i: NftItem) => images.get(key(i)) ?? i.metadata?.image ?? null;
	const selected = value
		? items.find((i) => i.contractId === value.nftContract && i.tokenId === value.tokenId)
		: undefined;

	const eligible = useMemo(
		() => (filterItem ? items.filter(filterItem) : items),
		[items, filterItem]
	);

	/**
	 * Keyed by the eligible set's CONTENT, not its identity: `filterItem` is
	 * typically an inline arrow, so `eligible` is a fresh array every render and
	 * an identity-keyed effect re-runs forever (resolve → setImages → render →
	 * resolve). Same fix as NftMultiPicker.
	 */
	const eligibleKey = useMemo(
		() => eligible.map((i) => `${i.contractId}:${i.tokenId}`).join('|'),
		[eligible]
	);

	// Resolve images ONLY for the items actually shown (the eligible set).
	// `resolveNftImages` fetches per-token props via one `getStateByKeys`
	// per contract — resolving the full wallet (which can be 1000+ tokens
	// in one collection) makes an oversized request the node rejects, so
	// every tile would fall back to the logo. The picker only ever renders
	// `eligible`, so that's all we need.
	useEffect(() => {
		if (!eligible.length) return;
		let cancelled = false;
		nft.nft.provider
			.resolveNftImages(eligible)
			.then((m) => {
				if (cancelled) return;
				setImages((prev) => {
					const next = new Map(prev);
					for (const [k, v] of m) next.set(k, v);
					return next;
				});
			})
			.catch(() => {
				/* best-effort — tiles fall back to the Magi logo */
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, see above
	}, [nft, eligibleKey]);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return eligible;
		return eligible.filter(
			(i) =>
				i.tokenId.toLowerCase().includes(q) ||
				i.contractId.toLowerCase().includes(q) ||
				(i.collection?.name ?? '').toLowerCase().includes(q)
		);
	}, [eligible, query]);

	return (
		<div className="magi-market-field">
			<span className="magi-market-field-label">
				{label}
				{selected && (
					<span className="magi-market-row-sub">
						{' '}— selected #{selected.tokenId} · {selected.collection?.name ?? selected.contractId}
					</span>
				)}
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
						placeholder="Search by id or collection…"
						autoComplete="off"
						spellCheck={false}
						disabled={disabled}
					/>
				</div>
				{!account && <div className="magi-market-state">Connect a wallet to pick an NFT.</div>}
				{account && loading && <Spinner label="Loading your NFTs…" />}
				{account && err && <div className="magi-market-state">{err}</div>}
				{account && !loading && !err && filtered.length === 0 && (
					<div className="magi-market-state">
						{items.length === 0
							? 'No NFTs found.'
							: eligible.length === 0
								? emptyHint ?? 'No eligible NFTs.'
								: 'No matches.'}
					</div>
				)}
				{filtered.length > 0 && (
					<div className="magi-market-grid">
						{filtered.map((i) => (
							<NftTile
								key={key(i)}
								item={i}
								imageUrl={imgFor(i)}
								selected={!!selected && key(selected) === key(i)}
								onPick={() => onChange({ nftContract: i.contractId, tokenId: i.tokenId })}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
