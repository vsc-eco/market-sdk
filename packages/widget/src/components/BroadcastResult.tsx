import { useState } from 'react';

interface BroadcastResultProps {
	txId: string;
	/**
	 * Override the explorer base URL. Defaults to vsc.techcoderx.com because
	 * that's the only public Magi block explorer with stable transaction
	 * pages today; pass a different host if you operate your own.
	 */
	explorerBase?: string;
}

/**
 * Shared "broadcast successful" banner with copy-txid and view-on-explorer
 * buttons. Used by every action form (NftTransfer, NftBurn, NftBatch,
 * TokenTransfer, TokenBurn) so the affordances and styling stay
 * identical regardless of which path produced the tx.
 */
export function BroadcastResult({
	txId,
	explorerBase = 'https://vsc.techcoderx.com'
}: BroadcastResultProps) {
	const [copied, setCopied] = useState(false);
	const explorerUrl = `${explorerBase.replace(/\/$/, '')}/tx/${txId}`;
	const shortId = txId.length > 18 ? `${txId.slice(0, 8)}…${txId.slice(-6)}` : txId;

	async function copy() {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(txId);
			} else {
				// Fallback path for older Safari / non-secure contexts. Creates a
				// hidden textarea, selects, and document.execCommand('copy').
				const ta = document.createElement('textarea');
				ta.value = txId;
				ta.style.position = 'fixed';
				ta.style.opacity = '0';
				document.body.appendChild(ta);
				ta.select();
				document.execCommand('copy');
				document.body.removeChild(ta);
			}
			setCopied(true);
			setTimeout(() => setCopied(false), 1600);
		} catch {
			/* clipboard write blocked - leave the button label unchanged */
		}
	}

	return (
		<div className="magi-market-success">
			<span className="magi-market-success-label">Broadcast:</span>
			<code className="magi-market-success-tx" title={txId}>
				{shortId}
			</code>
			<div className="magi-market-success-actions">
				<button
					type="button"
					className="magi-market-icon-btn"
					title={copied ? 'Copied' : 'Copy transaction id'}
					aria-label="Copy transaction id"
					onClick={copy}
				>
					{copied ? <CheckIcon /> : <CopyIcon />}
				</button>
				<a
					className="magi-market-icon-btn"
					href={explorerUrl}
					target="_blank"
					rel="noopener noreferrer"
					title="Open on vsc.techcoderx.com"
					aria-label="Open transaction on the block explorer"
				>
					<LinkIcon />
				</a>
			</div>
		</div>
	);
}

function CopyIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</svg>
	);
}
function CheckIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}
function LinkIcon() {
	return (
		<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
			<polyline points="15 3 21 3 21 9" />
			<line x1="10" y1="14" x2="21" y2="3" />
		</svg>
	);
}
