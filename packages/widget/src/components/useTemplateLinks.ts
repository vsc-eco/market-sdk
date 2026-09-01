import { useEffect, useMemo, useState } from 'react';
import { resolveIndexerUrls, type MagiConfig } from '@vsc.eco/market-sdk';
import { gqlFetchAllPages } from './gqlPaged.js';

interface TemplateRow {
	contract_id: string;
	token_id: string;
	template_id: string;
}

export interface TemplateLinks {
	/** The template a token was minted from, or null if it stands alone. */
	templateOf: (nftContract: string, tokenId: string) => string | null;
	ready: boolean;
}

const Q = `query TL($limit:Int!,$offset:Int!){
	magi_nft_template_tokens(
		order_by:{contract_id:asc, template_id:asc, token_id:asc}
		limit:$limit offset:$offset
	){ contract_id token_id template_id }
}`;

/**
 * Map every token to the template (mintSeries) it was minted from, so
 * near-identical editions can be folded into one sub-group instead of
 * filling a grid with a hundred visually identical tiles.
 *
 * Read straight from `magi_nft_template_tokens` and **paged** rather than
 * via token-sdk's `getTemplateLinks`, which issues one un-paged query and
 * would therefore see only the first 100 of the ~1037 links on testnet —
 * the same 100-row cap that hid most of the offer picker's tokens.
 *
 * `enabled` gates the read so it only runs for the view that groups by
 * template.
 */
export function useTemplateLinks(config: MagiConfig, enabled: boolean): TemplateLinks {
	const urls = useMemo(() => resolveIndexerUrls(config), [config]);
	const [map, setMap] = useState<Map<string, string>>(new Map());
	const [ready, setReady] = useState(false);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		setReady(false);
		gqlFetchAllPages<TemplateRow>(
			urls,
			Q,
			(d) => (d as { magi_nft_template_tokens?: TemplateRow[] }).magi_nft_template_tokens
		)
			.then(({ rows }) => {
				if (cancelled) return;
				const m = new Map<string, string>();
				for (const r of rows) m.set(`${r.contract_id}:${r.token_id}`, r.template_id);
				setMap(m);
			})
			.catch(() => {
				// Grouping is a presentation nicety — on failure every token
				// simply renders ungrouped rather than the view erroring out.
				if (!cancelled) setMap(new Map());
			})
			.finally(() => !cancelled && setReady(true));
		return () => {
			cancelled = true;
		};
	}, [urls, enabled]);

	return useMemo(
		() => ({
			templateOf: (nftContract: string, tokenId: string) =>
				map.get(`${nftContract}:${tokenId}`) ?? null,
			ready
		}),
		[map, ready]
	);
}
