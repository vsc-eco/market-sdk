import { useState } from 'react';
import type { MarketClient } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';

export interface AdminPanelProps {
	client: MarketClient;
	username: string;
	/** The collection these settings apply to (the user owns it). */
	nftContract?: string;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

/**
 * Collection-owner settings, opened from a collection's group header (only
 * shown to the collection owner). Scoped to a single NFT collection and
 * limited to the entrypoints the *collection owner* can call —
 * `setRoyalty` and `setRoyaltySplits`. Market-owner-only config (fee,
 * pause, payment-token whitelist, denylist, ownership, emergency withdraw)
 * is intentionally NOT surfaced anywhere in the widget.
 */
export function AdminPanel({ client, username, nftContract, onSuccess, onClose }: AdminPanelProps) {
	const [busy, setBusy] = useState(false);
	const [lastTx, setLastTx] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const [royaltyBps, setRoyaltyBps] = useState('500');
	const [royaltyRecip, setRoyaltyRecip] = useState('');
	// "hive:alice:300,hive:bob:200" → [{recipient,bps},…]
	const [splitsRaw, setSplitsRaw] = useState('');

	const ops = client.ops;
	const u = username;
	const nc = nftContract ?? '';

	async function run(opBuilder: () => ReturnType<MarketClient['ops']['delistOp']>) {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const { txId } = await client.broadcast(opBuilder());
			setLastTx(txId);
			onSuccess?.(txId);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	function parseSplits(raw: string): { recipient: string; bps: number }[] {
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
			.map((s) => {
				// recipient may itself contain colons (e.g. hive:foo); the last
				// colon-separated piece is the bps. Use lastIndexOf.
				const i = s.lastIndexOf(':');
				if (i < 0) return { recipient: s, bps: 0 };
				return { recipient: s.slice(0, i), bps: Number(s.slice(i + 1)) };
			});
	}

	return (
		<Modal
			title="Collection settings"
			subtitle={`Royalty for ${nc || 'this collection'} — applies to every sale. Only you, the collection owner, can change it.`}
			onClose={onClose}
		>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
				<details open>
					<summary>Royalty</summary>
					<Field label="Royalty bps (100 = 1%, ≤5000)">
						<TextInput inputMode="numeric" value={royaltyBps} onChange={setRoyaltyBps} disabled={busy} />
					</Field>
					<Field label="Royalty recipient">
						<TextInput value={royaltyRecip} onChange={setRoyaltyRecip} disabled={busy} placeholder="hive:creator" />
					</Field>
					<button
						type="button"
						className="magi-market-submit ghost"
						disabled={busy || !nc}
						onClick={() => run(() => ops.setRoyaltyOp(u, { nftContract: nc, royaltyBps: Number(royaltyBps), royaltyRecipient: royaltyRecip }))}
					>
						Set royalty
					</button>
				</details>

				<details>
					<summary>Royalty splits (multiple recipients)</summary>
					<Field
						label="Splits (comma-separated `recipient:bps`)"
						hint='e.g. "hive:alice:300,hive:bob:200" — each entry pairs a recipient with its bps share (sum ≤5000). Overrides the single recipient above.'
					>
						<TextInput value={splitsRaw} onChange={setSplitsRaw} disabled={busy} placeholder="hive:alice:300,hive:bob:200" />
					</Field>
					<button
						type="button"
						className="magi-market-submit ghost"
						disabled={busy || !nc}
						onClick={() => run(() => ops.setRoyaltySplitsOp(u, { nftContract: nc, splits: parseSplits(splitsRaw) }))}
					>
						Set splits
					</button>
				</details>

				{lastTx && <BroadcastResult txId={lastTx} />}
				{error && <p className="magi-market-status error">{error}</p>}

				<div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end' }}>
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Close</button>
				</div>
			</div>
		</Modal>
	);
}
