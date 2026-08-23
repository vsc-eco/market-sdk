import { useEffect, useMemo, useState } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import {
	createNftClient,
	MAINNET_CONFIG as TOKEN_MAINNET,
	TESTNET_CONFIG as TOKEN_TESTNET,
	type NftItem
} from '@vsc.eco/token-sdk';
import { Spinner } from './Spinner.js';
import { useCollectionMeta } from './useCollectionMeta.js';
import { useTemplateLinks } from './useTemplateLinks.js';
import magiSvg from '../assets/magi.svg';

/** One picked entry: `nftContract:tokenId` + the amount the user wants to
 *  bundle (always 1 for unique NFTs; up to `balance` for editioned). */
export interface NftMultiPick {
	nftContract: string;
	tokenId: string;
	amount: number;
}

export interface NftMultiPickerProps {
	config: MagiConfig;
	username?: string;
	value: NftMultiPick[];
	onChange: (v: NftMultiPick[]) => void;
	label?: string;
	/** When set, only NFTs from this contract are clickable; selecting an
	 *  NFT from a different collection while one is already picked clears
	 *  the existing selection. The bundle entrypoint requires a single
	 *  collection so this is set externally by the form. */
	lockCollection?: string;
	/** Optional per-item filter — e.g. hide soulbound. */
	filterItem?: (i: NftItem) => boolean;
	max?: number;
	disabled?: boolean;
	/**
	 * Fold tokens minted from the same template into one tile, and ask how
	 * many to add when one is chosen.
	 *
	 * A mystery sale is stocked by the handful — "20 commons" — not by
	 * hand-picking twenty near-identical editions out of a grid, which is
	 * both tedious and impossible to check afterwards.
	 */
	groupEditions?: boolean;
}

/** A template's worth of tokens, folded into one tile. */
interface EditionGroup {
	/** `contractId:templateId`, or the token key when it stands alone. */
	key: string;
	label: string;
	/** The tile's art and collection come from the first token. */
	lead: NftItem;
	tokens: NftItem[];
	/** Units across every token in the group. */
	available: number;
	/** Units currently picked from this group. */
	picked: number;
}

const tagOf = (i: NftItem) => (i.isUnique ? 'Unique' : i.soulbound ? 'SBT' : 'Editioned');

function MultiTile({
	item,
	imageUrl,
	picked,
	dimmed,
	pickedAmount,
	onToggle,
	onAmountChange
}: {
	item: NftItem;
	imageUrl: string | null;
	picked: boolean;
	dimmed: boolean;
	pickedAmount: number;
	onToggle: () => void;
	onAmountChange: (n: number) => void;
}) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	const editioned = !item.isUnique && item.balance > 1;
	return (
		<div
			className={`magi-market-tile${picked ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
			role="button"
			tabIndex={dimmed ? -1 : 0}
			onClick={(e) => {
				if (dimmed) return;
				// Don't toggle when the user is just adjusting amount inputs.
				const t = e.target as HTMLElement;
				if (t.tagName === 'INPUT' || t.tagName === 'BUTTON') return;
				onToggle();
			}}
			onKeyDown={(e) => {
				if (dimmed) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onToggle();
				}
			}}
			style={dimmed ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
		>
			<div className={`magi-market-tile-image ${useFallback ? 'fallback' : ''}`}>
				{useFallback ? (
					<img src={magiSvg} alt={`#${item.tokenId}`} className="magi-market-tile-fallback-img" />
				) : (
					<img src={imageUrl as string} alt={`#${item.tokenId}`} loading="lazy" decoding="async" onError={() => setImgFailed(true)} />
				)}
				{picked && (
					<span
						aria-hidden="true"
						style={{
							position: 'absolute',
							top: '0.3rem',
							right: '0.3rem',
							width: '1.2rem',
							height: '1.2rem',
							borderRadius: '50%',
							background: 'var(--magi-accent, #6ee7b7)',
							color: '#000',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: '0.85rem',
							fontWeight: 700
						}}
					>✓</span>
				)}
			</div>
			<div className="magi-market-tile-id" title={item.tokenId}>#{item.tokenId}</div>
			<div className="magi-market-tile-row">
				{!item.isUnique && <span className="magi-market-tile-balance">×{item.balance}</span>}
				<span className="magi-market-tile-tag">{tagOf(item)}</span>
			</div>
			{picked && editioned && (
				<div className="magi-market-tile-row" style={{ marginTop: '0.2rem' }}>
					<input
						type="number"
						min={1}
						max={item.balance}
						value={pickedAmount}
						onChange={(e) => {
							const n = Math.max(1, Math.min(item.balance, Number((e.target as HTMLInputElement).value) || 1));
							onAmountChange(n);
						}}
						onClick={(e) => e.stopPropagation()}
						style={{
							width: '4rem',
							padding: '0.15rem 0.3rem',
							fontSize: '0.7rem',
							background: 'var(--magi-field-bg)',
							border: '1px solid var(--magi-field-border)',
							borderRadius: '4px',
							color: 'var(--magi-text)'
						}}
					/>
					<span className="magi-market-tile-supply">/ {item.balance}</span>
				</div>
			)}
		</div>
	);
}

/**
 * Multi-select grid picker for NFTs the connected user owns. Used by
 * `ListBundleForm` to let the seller pick the NFTs to bundle without
 * typing tokenIds. Selecting an NFT from a second collection while one
 * is already picked replaces the entire selection (the bundle entrypoint
 * requires single-collection — the form locks the collection via
 * `lockCollection` so the dimming gives a clear visual cue).
 */
/** One template's editions as a single tile: art, how many exist, how many are in. */
function GroupTile({
	group,
	imageUrl,
	dimmed,
	onPick,
	onClear
}: {
	group: EditionGroup;
	imageUrl: string | null | undefined;
	dimmed: boolean;
	onPick: () => void;
	onClear: () => void;
}) {
	const [imgFailed, setImgFailed] = useState(false);
	const useFallback = !imageUrl || imgFailed;
	const picked = group.picked > 0;
	const many = group.tokens.length > 1 || group.available > 1;
	return (
		<div
			className={`magi-market-tile${picked ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
			role="button"
			tabIndex={dimmed ? -1 : 0}
			onClick={(e) => {
				if (dimmed) return;
				if ((e.target as HTMLElement).tagName === 'BUTTON') return;
				onPick();
			}}
			onKeyDown={(e) => {
				if (dimmed) return;
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onPick();
				}
			}}
			style={dimmed ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
		>
			<div className={`magi-market-tile-image ${useFallback ? 'fallback' : ''}`}>
				{useFallback ? (
					<img src={magiSvg} alt={group.label} className="magi-market-tile-fallback-img" />
				) : (
					<img
						src={imageUrl as string}
						alt={group.label}
						loading="lazy"
						decoding="async"
						onError={() => setImgFailed(true)}
					/>
				)}
				{picked && <span className="magi-market-tile-badge">{group.picked} in</span>}
			</div>
			<div className="magi-market-tile-id" title={group.label}>{group.label}</div>
			<div className="magi-market-tile-row">
				<span className="magi-market-tile-balance">
					{many ? `${group.available} available` : 'one of a kind'}
				</span>
			</div>
			{picked && (
				<div className="magi-market-tile-actions">
					<button type="button" className="magi-market-submit ghost" onClick={onPick}>
						Change
					</button>
					<button type="button" className="magi-market-submit ghost" onClick={onClear}>
						Remove
					</button>
				</div>
			)}
		</div>
	);
}

export function NftMultiPicker({
	config,
	username,
	value,
	onChange,
	label = 'Select NFTs',
	lockCollection,
	filterItem,
	max,
	disabled,
	groupEditions = false
}: NftMultiPickerProps) {
	const tokenConfig = useMemo(
		() => (config.network === 'vsc-testnet' ? TOKEN_TESTNET : TOKEN_MAINNET),
		[config.network]
	);
	const nft = useMemo(() => createNftClient({ config: tokenConfig }), [tokenConfig]);

	const [items, setItems] = useState<NftItem[]>([]);
	const [images, setImages] = useState<Map<string, string | null>>(new Map());
	const collMeta = useCollectionMeta(config);
	const [loading, setLoading] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const [query, setQuery] = useState('');

	const account = useMemo(
		() => (username ? `hive:${username.replace(/^@/, '').replace(/^hive:/, '')}` : undefined),
		[username]
	);

	useEffect(() => {
		if (!account) return;
		let cancelled = false;
		setLoading(true);
		setErr(null);
		nft.nft.provider.getUserNfts(account)
			.then((its) => !cancelled && setItems(its))
			.catch((e) => !cancelled && setErr(e instanceof Error ? e.message : String(e)))
			.finally(() => !cancelled && setLoading(false));
		return () => { cancelled = true; };
	}, [nft, account]);

	const key = (i: NftItem) => `${i.contractId}:${i.tokenId}`;
	const imgFor = (i: NftItem) => images.get(key(i)) ?? i.metadata?.image ?? null;

	const eligible = useMemo(
		() => (filterItem ? items.filter(filterItem) : items),
		[items, filterItem]
	);

	/**
	 * Depend on the CONTENT of `eligible`, not its identity.
	 *
	 * Callers pass `filterItem` as an inline arrow — idiomatic React, and it has
	 * a new identity on every render. That makes `eligible` a new array every
	 * render too, so an effect keyed on it re-ran forever: resolve images →
	 * setImages → re-render → new arrow → new array → resolve again. The symptom
	 * was an NFT picker that never stopped loading.
	 *
	 * Keying on the joined item keys makes the dependency stable by VALUE, so
	 * the effect runs when the set of NFTs actually changes and not before.
	 * Fixed here rather than asking every caller to remember useCallback,
	 * because a component that melts when handed a plain arrow is the thing
	 * that is wrong.
	 */
	const eligibleKey = useMemo(() => eligible.map(key).join('|'), [eligible]);

	useEffect(() => {
		if (!eligible.length) return;
		let cancelled = false;
		nft.nft.provider.resolveNftImages(eligible).then((m) => {
			if (cancelled) return;
			setImages((prev) => {
				const next = new Map(prev);
				for (const [k, v] of m) next.set(k, v);
				return next;
			});
		}).catch(() => {});
		return () => { cancelled = true; };
		// eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by value, see above
	}, [nft, eligibleKey]);

	const pickedKeys = useMemo(() => new Set(value.map((v) => `${v.nftContract}:${v.tokenId}`)), [value]);
	// The collection currently locked-in is either explicit (caller prop)
	// or implicit from the first picked NFT. Once locked, NFTs from other
	// collections are hidden from the grid entirely (the contract requires
	// a single nftContract per bundle, so showing them as dimmed-but-still-
	// in-the-grid is just noise).
	const effectiveLock = lockCollection ?? value[0]?.nftContract ?? undefined;
	const collectionFiltered = useMemo(
		() => (effectiveLock ? eligible.filter((i) => i.contractId === effectiveLock) : eligible),
		[eligible, effectiveLock]
	);

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return collectionFiltered;
		return collectionFiltered.filter(
			(i) =>
				i.tokenId.toLowerCase().includes(q) ||
				i.contractId.toLowerCase().includes(q) ||
				(i.collection?.name ?? '').toLowerCase().includes(q)
		);
	}, [collectionFiltered, query]);

	function toggle(item: NftItem) {
		const k = key(item);
		const alreadyPicked = pickedKeys.has(k);
		if (alreadyPicked) {
			onChange(value.filter((v) => `${v.nftContract}:${v.tokenId}` !== k));
			return;
		}
		// Cross-collection click — replace the whole selection with just this
		// item (single-collection invariant the contract enforces).
		if (effectiveLock && item.contractId !== effectiveLock) {
			onChange([{ nftContract: item.contractId, tokenId: item.tokenId, amount: 1 }]);
			return;
		}
		if (max != null && value.length >= max) return;
		onChange([
			...value,
			{ nftContract: item.contractId, tokenId: item.tokenId, amount: 1 }
		]);
	}

	// ---- edition grouping ----
	const templates = useTemplateLinks(config, groupEditions);

	/** Which group is asking "how many?", if any. */
	const [amountFor, setAmountFor] = useState<EditionGroup | null>(null);
	const [amountText, setAmountText] = useState('1');

	const groups = useMemo<EditionGroup[]>(() => {
		if (!groupEditions) return [];
		const by = new Map<string, EditionGroup>();
		for (const i of filtered) {
			const tpl = templates.templateOf(i.contractId, i.tokenId);
			// A token with no template stands alone — it is its own group, so
			// uniques keep behaving exactly as they did before.
			const k = tpl ? `${i.contractId}:tpl:${tpl}` : key(i);
			const at = by.get(k);
			if (at) {
				at.tokens.push(i);
				at.available += i.balance;
			} else {
				by.set(k, {
					key: k,
					label: tpl ?? `#${i.tokenId}`,
					lead: i,
					tokens: [i],
					available: i.balance,
					picked: 0
				});
			}
		}
		for (const g of by.values()) {
			g.picked = g.tokens.reduce(
				(n, t) => n + (value.find((v) => `${v.nftContract}:${v.tokenId}` === key(t))?.amount ?? 0),
				0
			);
		}
		return Array.from(by.values());
	}, [groupEditions, filtered, templates, value]);

	/**
	 * Spread `n` units across a group's tokens, filling each to its balance
	 * before moving on. One entry per token is what the contract stores, so
	 * the group is purely how the seller thinks about it.
	 */
	function applyGroupAmount(g: EditionGroup, n: number) {
		const without = value.filter(
			(v) => !g.tokens.some((t) => key(t) === `${v.nftContract}:${v.tokenId}`)
		);
		const added: NftMultiPick[] = [];
		let left = Math.max(0, Math.min(n, g.available));
		for (const t of g.tokens) {
			if (left <= 0) break;
			const take = Math.min(left, t.balance);
			added.push({ nftContract: t.contractId, tokenId: t.tokenId, amount: take });
			left -= take;
		}
		const next = [...without, ...added];
		// `max` counts ENTRIES, which is what the contract charges for.
		if (max != null && next.length > max) return;
		onChange(next);
	}

	function setAmount(k: string, n: number) {
		onChange(
			value.map((v) =>
				`${v.nftContract}:${v.tokenId}` === k ? { ...v, amount: n } : v
			)
		);
	}

	return (
		<div className="magi-market-field">
			<span className="magi-market-field-label">
				{label}
				{value.length > 0 && (
					<span className="magi-market-row-sub">
						{' '}— {value.length} selected{max != null ? ` / ${max}` : ''}
						{' · '}
						<button
							type="button"
							onClick={() => onChange([])}
							disabled={disabled}
							style={{
								background: 'none',
								border: 'none',
								padding: 0,
								color: 'var(--magi-accent, #6ee7b7)',
								cursor: 'pointer',
								textDecoration: 'underline',
								font: 'inherit'
							}}
						>
							Clear
						</button>
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
				{!account && <div className="magi-market-state">Connect a wallet to pick NFTs.</div>}
				{account && loading && <Spinner label="Loading your NFTs…" />}
				{account && err && <div className="magi-market-state">{err}</div>}
				{account && !loading && !err && filtered.length === 0 && (
					<div className="magi-market-state">
						{items.length === 0 ? 'No NFTs found.' : 'No matches.'}
					</div>
				)}
				{groupEditions && groups.length > 0 && (
					<div className="magi-market-grid">
						{groups.map((g) => {
							const dimmed = !!effectiveLock && g.lead.contractId !== effectiveLock && g.picked === 0;
							return (
								<GroupTile
									key={g.key}
									group={g}
									imageUrl={imgFor(g.lead)}
									dimmed={dimmed}
									onPick={() => {
										if (dimmed) return;
										// Cross-collection: the contract takes one collection
										// per sale, so choosing another replaces the selection.
										if (effectiveLock && g.lead.contractId !== effectiveLock) {
											onChange([]);
										}
										setAmountText(String(g.picked > 0 ? g.picked : Math.min(1, g.available)));
										setAmountFor(g);
									}}
									onClear={() =>
										onChange(
											value.filter(
												(v) => !g.tokens.some((t) => key(t) === `${v.nftContract}:${v.tokenId}`)
											)
										)
									}
								/>
							);
						})}
					</div>
				)}
				{!groupEditions && filtered.length > 0 && (
					<div className="magi-market-grid">
						{filtered.map((i) => {
							const k = key(i);
							const picked = pickedKeys.has(k);
							const dimmed = !!effectiveLock && i.contractId !== effectiveLock && !picked;
							const pickedAmount = value.find((v) => `${v.nftContract}:${v.tokenId}` === k)?.amount ?? 1;
							return (
								<MultiTile
									key={k}
									item={i}
									imageUrl={imgFor(i)}
									picked={picked}
									dimmed={dimmed}
									pickedAmount={pickedAmount}
									onToggle={() => toggle(i)}
									onAmountChange={(n) => setAmount(k, n)}
								/>
							);
						})}
					</div>
				)}
			</div>
			{amountFor && (
				<div
					className="magi-market-modal"
					role="dialog"
					aria-modal="true"
					onClick={() => setAmountFor(null)}
				>
					<div
						className="magi-market-modal-card magi-market-confirm"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 className="magi-market-modal-title">
							<span>How many {amountFor.label}?</span>
						</h3>
						<p className="magi-market-field-hint">
							{amountFor.available} available across {amountFor.tokens.length} edition
							{amountFor.tokens.length === 1 ? '' : 's'}. More copies of a card means it is
							drawn more often.
						</p>
						<input
							className="magi-market-input"
							type="number"
							min={0}
							max={amountFor.available}
							value={amountText}
							autoFocus
							onChange={(e) => setAmountText((e.target as HTMLInputElement).value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									applyGroupAmount(amountFor, Number(amountText) || 0);
									setAmountFor(null);
								}
							}}
						/>
						<div className="magi-market-confirm-actions">
							<button
								type="button"
								className="magi-market-submit ghost"
								onClick={() => {
									applyGroupAmount(amountFor, amountFor.available);
									setAmountFor(null);
								}}
							>
								All {amountFor.available}
							</button>
							<button
								type="button"
								className="magi-market-submit"
								onClick={() => {
									applyGroupAmount(amountFor, Number(amountText) || 0);
									setAmountFor(null);
								}}
							>
								Add
							</button>
						</div>
					</div>
				</div>
			)}

			{effectiveLock && (
				<span className="magi-market-field-hint">
					Everything must come from one collection. Showing{' '}
					<strong>{collMeta.name(effectiveLock)}</strong> only — clear the selection to switch.
				</span>
			)}
		</div>
	);
}
