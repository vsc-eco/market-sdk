/**
 * Circular indeterminate progress indicator. Reuses the shared
 * `magi-market-spin` keyframe (same one the header refresh icon uses) so
 * the chrome stays consistent. `label` is optional; when set it renders
 * under the ring and is announced to assistive tech.
 */
export function Spinner({ size = 26, label }: { size?: number; label?: string }) {
	return (
		<div className="magi-market-spinner-wrap" role="status" aria-live="polite">
			<svg
				className="magi-market-spinner"
				width={size}
				height={size}
				viewBox="0 0 24 24"
				aria-hidden="true"
			>
				<circle className="magi-market-spinner-track" cx="12" cy="12" r="9" fill="none" strokeWidth="3" />
				<circle
					className="magi-market-spinner-head"
					cx="12"
					cy="12"
					r="9"
					fill="none"
					strokeWidth="3"
					strokeLinecap="round"
				/>
			</svg>
			{label ? <span className="magi-market-spinner-label">{label}</span> : null}
		</div>
	);
}
