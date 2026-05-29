import { useEffect, useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { Field, TextInput } from './Field.js';

/**
 * Inputs for a wall-clock duration (days / hours / minutes) which the form
 * then resolves to an absolute VSC block height. The VSC chain the
 * contract sees is the Hive-anchored chain — verified at exactly 3.0s per
 * block (1200/h, 20/min). Used for every "Block" field the contract
 * expects (auction endBlock, listing/offer expirationBlock, …) so users
 * never have to guess block numbers.
 *
 * `value` is the resolved absolute block (or `null` when the duration is
 * zero / unset). `onChange` fires whenever the resolved block changes.
 * When `allowEmpty` is true, zero duration is a valid "no expiration"
 * state and emits `null`; when false, the parent should gate Submit on a
 * non-null value.
 *
 * In `relative` mode the resolved value is the duration as a block COUNT
 * (not an absolute height) — used for rental `minBlocks`/`maxBlocks`, which
 * the contract treats as relative spans. The chain head isn't needed there.
 */
export interface BlockDurationInputProps {
	client: MarketClient;
	value: number | null;
	onChange: (block: number | null) => void;
	label?: string;
	hint?: string;
	allowEmpty?: boolean;
	/** Emit the duration as a relative block count instead of an absolute height. */
	relative?: boolean;
	defaultDays?: string;
	defaultHours?: string;
	defaultMinutes?: string;
	disabled?: boolean;
}

const SECONDS_PER_BLOCK = 3;

export function BlockDurationInput({
	client,
	value,
	onChange,
	label = 'Duration',
	hint,
	allowEmpty,
	relative,
	defaultDays = '0',
	defaultHours = '0',
	defaultMinutes = '0',
	disabled
}: BlockDurationInputProps) {
	const [days, setDays] = useState(defaultDays);
	const [hours, setHours] = useState(defaultHours);
	const [minutes, setMinutes] = useState(defaultMinutes);
	const [curBlock, setCurBlock] = useState<number | null>(null);

	useEffect(() => {
		// Relative durations are a block COUNT — no chain head needed.
		if (relative) return;
		let cancelled = false;
		client.provider
			.getBlockHeight()
			.then((h) => !cancelled && setCurBlock(h))
			.catch(() => !cancelled && setCurBlock(null));
		return () => {
			cancelled = true;
		};
	}, [client, relative]);

	const totalSeconds =
		(Number(days) || 0) * 86400 + (Number(hours) || 0) * 3600 + (Number(minutes) || 0) * 60;
	const durBlocks = Math.floor(totalSeconds / SECONDS_PER_BLOCK);
	const resolved = relative
		? durBlocks > 0
			? durBlocks
			: null
		: durBlocks > 0 && curBlock !== null
			? curBlock + durBlocks
			: null;

	// Push the resolved block up whenever the inputs or chain head change.
	useEffect(() => {
		if (resolved !== value) onChange(resolved);
	}, [resolved]); // eslint-disable-line react-hooks/exhaustive-deps

	const computedHint = relative
		? durBlocks === 0
			? allowEmpty
				? 'Leave at 0 for no limit.'
				: 'Enter a duration greater than zero.'
			: `≈ ${durBlocks} blocks (3s/block)`
		: curBlock === null
			? 'Fetching current block height…'
			: durBlocks === 0
				? allowEmpty
					? 'Leave at 0 for no expiration.'
					: 'Enter a duration greater than zero.'
				: `≈ ${durBlocks} blocks (3s/block) · current ${curBlock} → ${resolved}`;

	return (
		<Field label={label} hint={hint ? `${computedHint} · ${hint}` : computedHint}>
			<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
				<div style={{ width: '25%', minWidth: 56 }}>
					<TextInput type="number" inputMode="numeric" min={0} value={days} onChange={setDays} placeholder="0" disabled={disabled} />
				</div>
				<span className="magi-market-field-hint">d</span>
				<div style={{ width: '25%', minWidth: 56 }}>
					<TextInput type="number" inputMode="numeric" min={0} value={hours} onChange={setHours} placeholder="0" disabled={disabled} />
				</div>
				<span className="magi-market-field-hint">h</span>
				<div style={{ width: '25%', minWidth: 56 }}>
					<TextInput type="number" inputMode="numeric" min={0} value={minutes} onChange={setMinutes} placeholder="0" disabled={disabled} />
				</div>
				<span className="magi-market-field-hint">m</span>
			</div>
		</Field>
	);
}
