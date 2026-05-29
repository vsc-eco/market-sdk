/**
 * Client-side mirror of the contract's `assertValidTokenId` allowlist
 * (`[a-zA-Z0-9:_.-]`). The contract aborts on invalid characters; this
 * helper lets the widget show an inline form error instead.
 */
export function assertValidTokenIdChars(s: string): boolean {
	if (s === '') return true;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		const isLower = c >= 97 && c <= 122;
		const isUpper = c >= 65 && c <= 90;
		const isDigit = c >= 48 && c <= 57;
		const ch = s[i];
		if (!(isLower || isUpper || isDigit || ch === ':' || ch === '-' || ch === '_' || ch === '.')) {
			return false;
		}
	}
	return true;
}
