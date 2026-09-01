import { useEffect, useRef, useState } from 'react';
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
	/** Label for the back control. */
	backLabel?: string;
	onBack: () => void;
	/**
	 * When true (default), leaving after the user has touched anything in the
	 * body asks for confirmation first. Read-only views (NFT details) pass
	 * false — there is nothing to lose, and a prompt for closing something you
	 * only looked at is pure friction.
	 */
	confirmOnLeave?: boolean;
	confirmMessage?: string;
	children: ReactNode;
}

export function PanelView({
	title,
	subtitle,
	backLabel = 'Back to main',
	onBack,
	confirmOnLeave = true,
	confirmMessage = 'Anything you entered here will be lost.',
	children
}: PanelViewProps) {
	const bodyRef = useRef<HTMLDivElement>(null);
	const [asking, setAsking] = useState(false);
	// Whether the user has actually done something in here. A ref, not state:
	// nothing renders from it, and re-rendering the whole form on the first
	// keystroke would be a waste.
	const touched = useRef(false);

	// "Did anything" is taken literally — typing, ticking, picking a tile,
	// stepping the wizard. Listening for real DOM events rather than diffing
	// the inputs against their initial values is what makes it reliable:
	// several of these forms populate fields from an async fetch after mount,
	// and a value diff would read that as the user's work. Browsers only fire
	// these from genuine interaction, so a programmatic update stays quiet.
	useEffect(() => {
		const el = bodyRef.current;
		if (!el || !confirmOnLeave) return;
		const mark = () => {
			touched.current = true;
		};
		for (const ev of ['input', 'change', 'pointerdown'] as const) {
			el.addEventListener(ev, mark, true);
		}
		return () => {
			for (const ev of ['input', 'change', 'pointerdown'] as const) {
				el.removeEventListener(ev, mark, true);
			}
		};
	}, [confirmOnLeave]);

	const requestBack = () => {
		if (confirmOnLeave && touched.current) {
			setAsking(true);
			return;
		}
		onBack();
	};

	return (
		<div className="magi-market-view">
			<div className="magi-market-view-head">
				<button type="button" className="magi-market-view-back" onClick={requestBack}>
					<span aria-hidden="true">←</span> {backLabel}
				</button>
				<div className="magi-market-view-titles">
					<h3 className="magi-market-view-title">{title}</h3>
					{subtitle && <p className="magi-market-view-subtitle">{subtitle}</p>}
				</div>
			</div>
			<div className="magi-market-view-body" ref={bodyRef}>
				{children}
			</div>

			{/* Written out rather than reusing `Modal`, which renders itself as a
			    PanelView while inside the panel — this one genuinely wants to
			    float above the work it is asking about. */}
			{asking && (
				<div
					className="magi-market-modal"
					role="dialog"
					aria-modal="true"
					onClick={() => setAsking(false)}
				>
					<div
						className="magi-market-modal-card magi-market-confirm"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 className="magi-market-modal-title">
							<span>Leave this screen?</span>
						</h3>
						<p className="magi-market-field-hint">{confirmMessage}</p>
						<div className="magi-market-confirm-actions">
							<button
								type="button"
								className="magi-market-submit ghost"
								onClick={() => setAsking(false)}
							>
								Stay here
							</button>
							<button type="button" className="magi-market-submit" onClick={onBack}>
								Leave
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
