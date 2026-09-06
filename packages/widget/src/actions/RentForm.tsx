import { useMemo, useState } from 'react';
import type { MarketClient, RentalListing } from '@vsc.eco/market-sdk';
import { BroadcastResult } from '../components/BroadcastResult.js';
import { Field, TextInput } from '../components/Field.js';
import { Modal } from '../components/Modal.js';
import { useTokenMeta } from '../components/useTokenMeta.js';
import { useAffordability } from '../components/useAffordability.js';
import { FundsNote } from '../components/FundsNote.js';

export interface RentFormProps {
	client: MarketClient;
	username: string;
	rental: RentalListing;
	onSuccess?: (txId: string) => void;
	onClose: () => void;
}

const NATIVE_TOKENS = new Set(['hive', 'hbd']);

/**
 * Rent an NFT for N blocks. Total payment = `pricePerBlock * blocks`,
 * pulled up-front and escrowed by the marketplace until `endRental`.
 * Native payment (HIVE/HBD) attaches a `transfer.allow` intent with the
 * total; magi_token payment would need an external `approve(market,total)`
 * step which the host must run before opening this form.
 */
export function RentForm({ client, username, rental, onSuccess, onClose }: RentFormProps) {
	const tokenMeta = useTokenMeta(client.config);
	const paySym = tokenMeta.symbol(rental.paymentToken);
	const ppbHuman = tokenMeta.format(rental.paymentToken, rental.pricePerBlock);
	const isNative = NATIVE_TOKENS.has((rental.paymentToken || '').toLowerCase());

	const [blocks, setBlocks] = useState(String(rental.minBlocks || 1));
	const [submitting, setSubmitting] = useState(false);
	const [txId, setTxId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	const blocksNum = Number(blocks);
	const validBlocks =
		Number.isInteger(blocksNum) &&
		blocksNum >= rental.minBlocks &&
		blocksNum <= rental.maxBlocks &&
		blocksNum > 0;

	const totalMicro = useMemo(() => {
		if (!validBlocks) return null;
		try {
			return (BigInt(rental.pricePerBlock) * BigInt(blocksNum)).toString();
		} catch {
			return null;
		}
	}, [rental.pricePerBlock, blocksNum, validBlocks]);

	const funds = useAffordability(client.config, username, rental.paymentToken, totalMicro);
	const valid = validBlocks && !!totalMicro && funds.ok;

	async function handleSubmit() {
		if (!valid || submitting || !totalMicro) return;
		setSubmitting(true);
		setError(null);
		try {
			const intents = isNative
				? [{ type: 'transfer.allow' as const, args: { limit: totalMicro, token: rental.paymentToken } }]
				: undefined;
			const op = client.ops.rentOp(
				username,
				{ rentalId: rental.rentalId, blocks: blocksNum },
				intents
			);
			const { txId: tx } = await client.broadcast(op);
			setTxId(tx);
			onSuccess?.(tx);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<Modal
			title={`Rent #${rental.tokenId}`}
			subtitle={`${ppbHuman} ${paySym} / block · ${rental.minBlocks}–${rental.maxBlocks} blocks`}
			onClose={onClose}
		>
			{txId ? (
				<>
					<BroadcastResult txId={txId} config={client.config} />
					<button type="button" className="magi-market-submit ghost" onClick={onClose}>Done</button>
				</>
			) : (
				<>
					<Field label="Blocks" hint={`Between ${rental.minBlocks} and ${rental.maxBlocks}.`}>
						<TextInput
							type="number"
							inputMode="numeric"
							min={rental.minBlocks}
							max={rental.maxBlocks}
							value={blocks}
							onChange={setBlocks}
							disabled={submitting}
						/>
					</Field>
					{totalMicro && (
						<p className="magi-market-field-hint">
							Total: {tokenMeta.format(rental.paymentToken, totalMicro)} {paySym}
						</p>
					)}

					<FundsNote funds={funds} paymentToken={rental.paymentToken} tokenMeta={tokenMeta} />
					{error && <p className="magi-market-status error">{error}</p>}

					<button type="button" className="magi-market-submit" disabled={!valid || submitting} onClick={handleSubmit}>
						{submitting ? 'Renting…' : 'Rent'}
					</button>
				</>
			)}
		</Modal>
	);
}
