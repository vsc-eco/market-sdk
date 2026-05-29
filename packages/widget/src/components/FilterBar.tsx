import { useMemo } from 'react';
import { Field, TextInput } from './Field.js';
import { SelectPicker, type SelectOption } from './SelectPicker.js';
import type { TokenMeta } from './useTokenMeta.js';

export type DateRange = 'all' | '1d' | '7d' | '30d' | '365d';

export interface FilterState {
	dateRange: DateRange;
	/** Max price the user is willing to pay (human decimal, e.g. "1.000"). */
	maxPrice: string;
	/** Payment token id ("any" or a token id/native). */
	paymentToken: string;
	/** Affordable-only filter: hide items whose price exceeds the user's
	 *  balance for the listing's payment token. This also covers the
	 *  "tokens I don't have" case (zero balance ⇒ any positive price is
	 *  unaffordable), so there's no separate toggle for it. */
	affordableOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
	dateRange: 'all',
	maxPrice: '',
	paymentToken: 'any',
	affordableOnly: false
};

export interface FilterBarProps {
	value: FilterState;
	onChange: (next: FilterState) => void;
	tokenMeta: TokenMeta;
	/** Whether to render the affordability controls — disabled when no
	 *  user is connected (no balances to compare against). */
	hasUser: boolean;
}

const DATE_OPTIONS: SelectOption[] = [
	{ value: 'all', label: 'Any time' },
	{ value: '1d', label: 'Last 24h' },
	{ value: '7d', label: 'Last 7 days' },
	{ value: '30d', label: 'Last 30 days' },
	{ value: '365d', label: 'Last year' }
];

/**
 * Compact filter strip shown above the listings/auctions/mint-spots tabs:
 * date range, payment token, max price, and the affordability toggle. Uses
 * the same `SelectPicker` / `TextInput` chrome the action modals (e.g.
 * "Sell an NFT") use, so dropdown styling is consistent across the widget
 * instead of falling back to unstyled native selects.
 */
export function FilterBar({ value, onChange, tokenMeta, hasUser }: FilterBarProps) {
	const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
		onChange({ ...value, [k]: v });

	const paymentOptions = useMemo<SelectOption[]>(
		() => [
			{ value: 'any', label: 'Any token' },
			{ value: 'hive', label: 'HIVE' },
			{ value: 'hbd', label: 'HBD' },
			...tokenMeta.tokens.map((t) => ({ value: t.id, label: t.symbol, hint: t.name }))
		],
		[tokenMeta]
	);

	return (
		<div className="magi-market-filterbar">
			<SelectPicker
				label="Listed within"
				value={value.dateRange}
				options={DATE_OPTIONS}
				onChange={(v) => set('dateRange', v as DateRange)}
			/>
			<SelectPicker
				label="Payment token"
				value={value.paymentToken}
				options={paymentOptions}
				onChange={(v) => set('paymentToken', v)}
			/>
			<Field
				label={`Max price${value.paymentToken !== 'any' ? ` (${tokenMeta.symbol(value.paymentToken)})` : ''}`}
			>
				<TextInput
					inputMode="decimal"
					value={value.maxPrice}
					placeholder="Any"
					onChange={(v) => set('maxPrice', v)}
				/>
			</Field>

			{hasUser && (
				<div className="magi-market-filter-toggles">
					<label className="magi-market-filter-toggle">
						<input
							type="checkbox"
							checked={value.affordableOnly}
							onChange={(e) => set('affordableOnly', (e.target as HTMLInputElement).checked)}
						/>
						<span>Affordable only</span>
					</label>
				</div>
			)}
		</div>
	);
}
