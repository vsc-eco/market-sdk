import type { ReactNode } from 'react';

interface FieldProps {
	label: string;
	hint?: string;
	error?: string | null;
	children: ReactNode;
}

/** Labelled wrapper around an input. Mirrors `.magi-qs-receiver` shape. */
export function Field({ label, hint, error, children }: FieldProps) {
	return (
		<div className="magi-market-field">
			<span className="magi-market-field-label">{label}</span>
			{children}
			{error ? (
				<p className="magi-market-status error">{error}</p>
			) : hint ? (
				<p className="magi-market-field-hint">{hint}</p>
			) : null}
		</div>
	);
}

interface TextInputProps {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	error?: boolean;
	disabled?: boolean;
	type?: 'text' | 'number';
	min?: number;
	max?: number;
	step?: string | number;
	inputMode?: 'text' | 'numeric' | 'decimal';
}

export function TextInput(props: TextInputProps) {
	return (
		<div className={`magi-market-input-wrap ${props.error ? 'error' : ''}`}>
			<input
				type={props.type ?? 'text'}
				inputMode={props.inputMode}
				value={props.value}
				onChange={(e) => props.onChange((e.target as HTMLInputElement).value)}
				placeholder={props.placeholder}
				disabled={props.disabled}
				min={props.min}
				max={props.max}
				step={props.step}
				autoComplete="off"
				spellCheck={false}
			/>
		</div>
	);
}
