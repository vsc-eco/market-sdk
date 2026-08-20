import type { ReactNode } from 'react';

/**
 * A full-panel working surface, used instead of a modal for anything with real
 * work in it.
 *
 * A dialog is the wrong container for a form that contains a picture grid: it
 * is capped so it cannot cover the page, which means the grid is squeezed and
 * the buttons get pushed out of reach on short screens. Nothing about creating
 * a listing needs to float above the panel — it IS the task, so it takes the
 * panel over and hands it back when done.
 *
 * The body sits in a centred column: a panel is wider than a form wants to be,
 * and left-aligning everything leaves a third of it empty.
 */
export interface PanelViewProps {
	title: string;
	subtitle?: string;
	/** Label for the back control. Defaults to "Back". */
	backLabel?: string;
	onBack: () => void;
	children: ReactNode;
}

export function PanelView({ title, subtitle, backLabel = 'Back', onBack, children }: PanelViewProps) {
	return (
		<div className="magi-market-view">
			<div className="magi-market-view-head">
				<button type="button" className="magi-market-view-back" onClick={onBack}>
					<span aria-hidden="true">←</span> {backLabel}
				</button>
				<div className="magi-market-view-titles">
					<h3 className="magi-market-view-title">{title}</h3>
					{subtitle && <p className="magi-market-view-subtitle">{subtitle}</p>}
				</div>
			</div>
			<div className="magi-market-view-body">{children}</div>
		</div>
	);
}
