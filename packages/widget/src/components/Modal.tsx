import type { ReactNode } from 'react';
import { PanelView } from './PanelView';
import { useInPanel } from './PanelSurface';

interface ModalProps {
	title: string;
	subtitle?: string;
	onClose: () => void;
	children: ReactNode;
	/** Render a wider card — used by the NFT details modal for the big image. */
	wide?: boolean;
	/**
	 * When true (default), clicking the backdrop OUTSIDE the card pops a
	 * native confirm so an accidental mis-click can't silently discard a
	 * half-filled form. The ✕ button is an explicit, deliberate close and
	 * is NOT guarded. Read-only / info modals (e.g. NFT details) pass
	 * `confirmOnBackdrop={false}` since there's no input to lose.
	 */
	confirmOnBackdrop?: boolean;
	/** Message shown in the backdrop-close confirm. */
	confirmMessage?: string;
}

/**
 * Inline-positioned modal that overlays its closest `.magi-market` ancestor.
 * Lifted out so every action form (transfer, burn, batch transfer, ...)
 * shares the same chrome. Inputs match the swap widget's modal pattern
 * (`.magi-qs-rc-modal-card` from crosschain-widget) so themes apply
 * consistently across both widgets.
 */
export function Modal({
	title,
	subtitle,
	onClose,
	children,
	wide,
	confirmOnBackdrop = true,
	confirmMessage = 'Close this window? Anything you entered here will be lost.'
}: ModalProps) {
	const inPanel = useInPanel();

	// Inside the market panel the form takes the panel over instead of
	// floating above it — see `PanelSurface`. No backdrop, so nothing to
	// guard: the only way out is the explicit Back control.
	if (inPanel) {
		return (
			<PanelView title={title} subtitle={subtitle} onBack={onClose}>
				{children}
			</PanelView>
		);
	}

	const onBackdropClick = () => {
		if (confirmOnBackdrop && typeof window !== 'undefined' && !window.confirm(confirmMessage)) {
			return;
		}
		onClose();
	};
	return (
		<div className="magi-market-modal" role="dialog" aria-modal="true" onClick={onBackdropClick}>
			<div
				className={`magi-market-modal-card${wide ? ' magi-market-modal-card--wide' : ''}`}
				onClick={(e) => e.stopPropagation()}
			>
				<h3 className="magi-market-modal-title">
					<span>{title}</span>
					<button
						type="button"
						className="magi-market-modal-close"
						onClick={onClose}
						aria-label="Close"
					>
						✕
					</button>
				</h3>
				{subtitle && <p className="magi-market-modal-subtitle">{subtitle}</p>}
				{children}
			</div>
		</div>
	);
}
