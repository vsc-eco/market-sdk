import { useEffect, useState, type RefObject } from 'react';

/**
 * Track an element's own width via ResizeObserver.
 *
 * Used instead of a viewport media query because the panel is embeddable: a
 * 1440px desktop can still hand it a 380px column, and a media query would
 * happily give that column a two-pane master/detail layout. What matters is
 * the space the panel actually has.
 *
 * Returns 0 until the first observation, so callers should treat 0 as
 * "unknown" and fall back to the narrow layout — the stacked design works at
 * every width, the split one doesn't.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		// SSR / jsdom: no ResizeObserver. Fall back to one static read rather
		// than throwing — a server-rendered panel gets the narrow layout.
		if (typeof ResizeObserver === 'undefined') {
			setWidth(el.getBoundingClientRect().width);
			return;
		}
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) {
				const w = e.contentRect?.width ?? e.target.getBoundingClientRect().width;
				// Round to whole pixels: sub-pixel jitter during a CSS transition
				// would otherwise re-render on every frame.
				setWidth((prev) => (Math.abs(prev - w) >= 1 ? Math.round(w) : prev));
			}
		});
		ro.observe(el);
		setWidth(Math.round(el.getBoundingClientRect().width));
		return () => ro.disconnect();
	}, [ref]);

	return width;
}
