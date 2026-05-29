import { useEffect, useRef, useState } from 'react';

export interface SelectOption {
	value: string;
	label: string;
	hint?: string;
}

export interface SelectPickerProps {
	label: string;
	value: string;
	options: SelectOption[];
	onChange: (value: string) => void;
	disabled?: boolean;
}

/**
 * Themed single-select. Same inline-expand chrome as NftPicker /
 * TokenPicker (trigger + in-flow expanding list) so every dropdown in the
 * action modals looks identical and never falls back to the unstyled
 * native `<select>` popup.
 */
export function SelectPicker({ label, value, options, onChange, disabled }: SelectPickerProps) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onDoc = (e: MouseEvent) => {
			if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	}, [open]);

	const selected = options.find((o) => o.value === value);

	return (
		<div className="magi-market-field" ref={wrapRef}>
			<span className="magi-market-field-label">{label}</span>
			<div className="magi-market-nftpicker">
				<button
					type="button"
					className="magi-market-nftpicker-trigger"
					disabled={disabled}
					onClick={() => setOpen((o) => !o)}
				>
					<span className="magi-market-nftpicker-label">
						{selected ? selected.label : <span className="magi-market-row-sub">Select…</span>}
					</span>
					<span className="magi-market-nftpicker-caret">▾</span>
				</button>
				{open && (
					<div className="magi-market-nftpicker-menu">
						<div className="magi-market-tokenlist">
							{options.map((o) => (
								<button
									key={o.value}
									type="button"
									className={`magi-market-tokenrow${value === o.value ? ' active' : ''}`}
									onClick={() => {
										onChange(o.value);
										setOpen(false);
									}}
								>
									<span className="magi-market-token-sym">{o.label}</span>
									{o.hint && <span className="magi-market-row-sub">{o.hint}</span>}
								</button>
							))}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
