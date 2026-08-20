export type ExploreListed = 'any' | 'listed' | 'unlisted';
export type ExploreHolding = 'any' | 'mine' | 'others';
export type ExploreSoulbound = 'any' | 'only' | 'hide';
export type ExploreSort = 'id' | 'holders' | 'units';

export interface ExploreFilterState {
	listed: ExploreListed;
	holding: ExploreHolding;
	soulbound: ExploreSoulbound;
	sort: ExploreSort;
}

export const DEFAULT_EXPLORE_FILTERS: ExploreFilterState = {
	listed: 'any',
	holding: 'any',
	soulbound: 'any',
	sort: 'id'
};

/**
 * Explore's own filters.
 *
 * The market filter bar is about money — price bounds, payment token,
 * affordability — and none of that applies here: Explore shows every NFT on
 * the network, most of which is not for sale. What a browser wants to narrow
 * by instead is availability ("what could I make an offer on?"), ownership,
 * and whether a token can move at all.
 */
export function ExploreFilterBar({
	value,
	onChange,
	onReset
}: {
	value: ExploreFilterState;
	onChange: (v: ExploreFilterState) => void;
	onReset: () => void;
}) {
	const group = <K extends keyof ExploreFilterState>(
		label: string,
		key: K,
		options: Array<{ id: ExploreFilterState[K]; label: string }>
	) => (
		<div className="magi-market-xfilter-group">
			<span className="magi-market-field-label">{label}</span>
			<div className="magi-market-xfilter-chips">
				{options.map((o) => (
					<button
						key={String(o.id)}
						type="button"
						className={`magi-market-kindchip${value[key] === o.id ? ' active' : ''}`}
						onClick={() => onChange({ ...value, [key]: o.id })}
					>
						{o.label}
					</button>
				))}
			</div>
		</div>
	);

	return (
		<div className="magi-market-xfilters">
			{group('Availability', 'listed', [
				{ id: 'any', label: 'Any' },
				{ id: 'listed', label: 'For sale' },
				{ id: 'unlisted', label: 'Not for sale' }
			])}
			{group('Held by', 'holding', [
				{ id: 'any', label: 'Anyone' },
				{ id: 'mine', label: 'You' },
				{ id: 'others', label: 'Others' }
			])}
			{group('Soulbound', 'soulbound', [
				{ id: 'any', label: 'Any' },
				{ id: 'hide', label: 'Transferable only' },
				{ id: 'only', label: 'Soulbound only' }
			])}
			{group('Sort', 'sort', [
				{ id: 'id', label: 'Token id' },
				{ id: 'holders', label: 'Most holders' },
				{ id: 'units', label: 'Most units' }
			])}
			<button type="button" className="magi-market-submit ghost magi-market-xfilter-reset" onClick={onReset}>
				Reset
			</button>
		</div>
	);
}
