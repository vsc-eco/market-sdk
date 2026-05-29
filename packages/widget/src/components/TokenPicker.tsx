import { useEffect, useMemo, useRef, useState } from 'react';
import type { MagiConfig } from '@vsc.eco/market-sdk';
import { Spinner } from './Spinner.js';
import { useTokenMeta } from './useTokenMeta.js';
import hiveSvg from '../assets/hive.svg';
import hbdSvg from '../assets/hbd.svg';

/** Real HBD/HIVE logos (copied from altera-app) for the native options;
 * other tokens fall back to an initials badge. */
const NATIVE_ICON: Record<string, string> = { hive: hiveSvg, hbd: hbdSvg };

function TokenIcon({ id, symbol }: { id: string; symbol: string }) {
	const icon = NATIVE_ICON[id];
	if (icon) {
		return <img className="magi-market-token-iconimg" src={icon} alt={symbol} />;
	}
	return <span className="magi-market-token-icon">{symbol.slice(0, 3).toUpperCase()}</span>;
}

export interface TokenOption {
	/** The id the contract expects as `paymentToken` — `hbd`/`hive` or a vsc1… id. */
	id: string;
	symbol: string;
	name: string;
	native?: boolean;
}

export interface TokenPickerProps {
	config: MagiConfig;
	value: string;
	onChange: (id: string) => void;
	label?: string;
	disabled?: boolean;
	/** Omit native HBD/HIVE — used when the value must be a token CONTRACT
	 * (e.g. the sellable asset in a token-for-token sale). */
	excludeNative?: boolean;
}

/** Native assets are always offered; the contract takes them via a
 * `transfer.allow` intent (token `hbd`/`hive`). */
const NATIVE: TokenOption[] = [
	{ id: 'hbd', symbol: 'HBD', name: 'Hive Dollar (native)', native: true },
	{ id: 'hive', symbol: 'HIVE', name: 'Hive (native)', native: true }
];

/**
 * Payment-token picker. Lists the marketplace's payment-token WHITELIST
 * (the `magi_market_payment_tokens` view, via useTokenMeta) plus native
 * HBD/HIVE — so the user can only pick tokens the contract will accept. No
 * manual contract entry. Inline-expand (same pattern as NftPicker) so it
 * works inside the scrollable action modal.
 */
export function TokenPicker({ config, value, onChange, label = 'Payment token', disabled, excludeNative }: TokenPickerProps) {
	// Share the `magi_token_overview` fetch with the rest of the widget
	// (row labels in MarketPanel, buy-modal subtitles, …) — one request per
	// indexer-url set instead of one per consumer.
	const meta = useTokenMeta(config);
	const tokens: TokenOption[] = meta.tokens;
	const loading = !meta.ready;
	const err: string | null = null;
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDoc = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [open]);

	const all = useMemo(() => (excludeNative ? tokens : [...NATIVE, ...tokens]), [tokens, excludeNative]);
	const selected = all.find((t) => t.id === value);

	return (
		<div className="magi-market-field" ref={wrapRef}>
			<span className="magi-market-field-label">{label}</span>
			<div className="magi-market-nftpicker">
				<button
					type="button"
					className="magi-market-nftpicker-trigger"
					disabled={disabled}
					onClick={() => setOpen((o) => !o)}
				>
					{selected ? (
						<>
							<TokenIcon id={selected.id} symbol={selected.symbol} />
							<span className="magi-market-nftpicker-label">
								<span className="magi-market-token-symbol">{selected.symbol}</span>
								<span className="magi-market-row-sub"> · {selected.name}</span>
							</span>
						</>
					) : (
						<span className="magi-market-row-sub">
							{loading ? 'Loading tokens…' : 'Select a payment token…'}
						</span>
					)}
					<span className="magi-market-nftpicker-caret">▾</span>
				</button>
				{open && (
					<div className="magi-market-nftpicker-menu">
						{loading && <Spinner label="Loading…" />}
						{err && <div className="magi-market-state">{err}</div>}
						<div className="magi-market-tokenlist">
							{all.map((t) => (
								<button
									key={t.id}
									type="button"
									className={`magi-market-tokenrow${value === t.id ? ' active' : ''}`}
									onClick={() => {
										onChange(t.id);
										setOpen(false);
									}}
								>
									<TokenIcon id={t.id} symbol={t.symbol} />
									<span className="magi-market-token-symbol">{t.symbol}</span>
									<span className="magi-market-row-sub">{t.name}</span>
									{t.native && <span className="magi-market-token-tag">native</span>}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
