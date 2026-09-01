import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

/**
 * Marks the subtree as living inside the market panel itself.
 *
 * Every action form here is written against `Modal`, but a floating dialog is
 * the wrong container when the widget already owns a panel: it caps its own
 * height, so grids get squeezed and the buttons fall off the bottom on short
 * screens. Inside the panel there is nothing to float above — the form IS the
 * task — so `Modal` reads this flag and renders a `PanelView` instead, taking
 * the panel over and handing it back on close.
 *
 * Kept as context rather than an `inline` prop on all twenty forms so the
 * decision lives in one place, and so a form used standalone (outside the
 * panel) still gets a real dialog without any change at the call site.
 */
const PanelSurfaceContext = createContext(false);

export function PanelSurface({ children }: { children: ReactNode }) {
	return <PanelSurfaceContext.Provider value={true}>{children}</PanelSurfaceContext.Provider>;
}

export function useInPanel() {
	return useContext(PanelSurfaceContext);
}
