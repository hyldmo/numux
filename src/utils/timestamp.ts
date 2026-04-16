/** Default timestamp format */
export const DEFAULT_TIMESTAMP_FORMAT = 'HH:mm:ss.SSS'

/**
 * Format a Date using a simple token-based format string.
 *
 * Supported tokens:
 * - `YYYY` — 4-digit year
 * - `MM` — 2-digit month (01–12)
 * - `DD` — 2-digit day (01–31)
 * - `HH` — 2-digit hours, 24h (00–23)
 * - `hh` — 2-digit hours, 12h (01–12)
 * - `mm` — 2-digit minutes (00–59)
 * - `ss` — 2-digit seconds (00–59)
 * - `SSS` — 3-digit milliseconds (000–999)
 * - `A` — AM/PM
 */
export function formatTimestamp(date: Date, format: string): string {
	const hours24 = date.getHours()
	const hours12 = hours24 % 12 || 12
	return format
		.replace('YYYY', date.getFullYear().toString())
		.replace('MM', (date.getMonth() + 1).toString().padStart(2, '0'))
		.replace('DD', date.getDate().toString().padStart(2, '0'))
		.replace('HH', hours24.toString().padStart(2, '0'))
		.replace('hh', hours12.toString().padStart(2, '0'))
		.replace('mm', date.getMinutes().toString().padStart(2, '0'))
		.replace('SSS', date.getMilliseconds().toString().padStart(3, '0'))
		.replace('ss', date.getSeconds().toString().padStart(2, '0'))
		.replace('A', hours24 < 12 ? 'AM' : 'PM')
}

/** Resolve a timestamps config value to a format string or null. */
export function resolveTimestampFormat(timestamps: boolean | string | undefined): string | null {
	if (!timestamps) return null
	return typeof timestamps === 'string' ? timestamps : DEFAULT_TIMESTAMP_FORMAT
}
