/**
 * What a stack IS, in terms of how the contract draws from it.
 *
 * Stacks carry no name on chain — `listBucket` sends entries keyed by stack
 * INDEX and nothing else, so the wizard's "Commons"/"Rares" labels never leave
 * the seller's browser. What CAN be stated is the thing that actually matters,
 * and it is derivable from the listing: singles always come from stack 0, and a
 * pack takes `packDraws[i]` from stack i (the contract's draw plan builds
 * exactly that). So a stack is described by the slots it fills rather than by a
 * name nobody stored.
 *
 * Shared by the buyer's view of a sale and the seller's restock form so the two
 * cannot drift into describing the same stack differently.
 */
export function stackRole(
	stack: number,
	packDraws: number[],
	singlesOn: boolean,
	packsOn: boolean
): string[] {
	const lines: string[] = [];
	const per = packsOn ? (packDraws[stack] ?? 0) : 0;
	if (per > 0) lines.push(`${per} guaranteed per pack`);
	if (stack === 0 && singlesOn) lines.push('every single draw comes from here');
	if (lines.length === 0) {
		// Dead stock: no pack slot names it and singles cannot reach it. A buyer
		// should know the odds on those tiles describe a draw that never
		// happens; a seller should know before adding more to it.
		lines.push('not reachable by any current draw');
	}
	return lines;
}
