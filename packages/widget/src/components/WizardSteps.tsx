/**
 * A compact step indicator for multi-step forms.
 *
 * Shows where you are and what is left, and lets you jump BACK to a completed
 * step but never forward — skipping ahead would land on a step whose inputs
 * depend on choices not yet made.
 */
export interface WizardStepsProps {
	steps: string[];
	/** Zero-based index of the step being shown. */
	current: number;
	/** Jump to an earlier step. Not called for the current or later steps. */
	onGoTo?: (index: number) => void;
	disabled?: boolean;
}

export function WizardSteps({ steps, current, onGoTo, disabled }: WizardStepsProps) {
	return (
		<ol className="magi-market-wizard-steps" aria-label="Progress">
			{steps.map((label, i) => {
				const state = i === current ? 'current' : i < current ? 'done' : 'todo';
				const canGo = !disabled && state === 'done' && !!onGoTo;
				return (
					<li key={label} className={`magi-market-wizard-step ${state}`}>
						<button
							type="button"
							className="magi-market-wizard-step-btn"
							disabled={!canGo}
							aria-current={state === 'current' ? 'step' : undefined}
							onClick={canGo ? () => onGoTo(i) : undefined}
						>
							<span className="magi-market-wizard-step-dot">{state === 'done' ? '✓' : i + 1}</span>
							<span className="magi-market-wizard-step-label">{label}</span>
						</button>
					</li>
				);
			})}
		</ol>
	);
}
