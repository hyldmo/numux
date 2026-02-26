import { describe, expect, test } from 'bun:test'
import { findLinkAtPosition, findLinksInLine } from './url-handler'

describe('findLinksInLine', () => {
	test('finds http URL', () => {
		const links = findLinksInLine('visit http://example.com today')
		expect(links).toEqual([{ url: 'http://example.com', start: 6, end: 24, type: 'url' }])
	})

	test('finds https URL with path and query', () => {
		const links = findLinksInLine('see https://example.com/path?q=1&x=2#frag')
		expect(links).toEqual([
			{
				url: 'https://example.com/path?q=1&x=2#frag',
				start: 4,
				end: 41,
				type: 'url'
			}
		])
	})

	test('strips trailing punctuation from URL', () => {
		const links = findLinksInLine('Go to https://example.com/page.')
		expect(links[0].url).toBe('https://example.com/page')
	})

	test('strips trailing comma', () => {
		const links = findLinksInLine('URLs: https://a.com, https://b.com.')
		expect(links[0].url).toBe('https://a.com')
		expect(links[1].url).toBe('https://b.com')
	})

	test('finds multiple URLs', () => {
		const links = findLinksInLine('http://a.com and http://b.com')
		expect(links).toHaveLength(2)
		expect(links[0].url).toBe('http://a.com')
		expect(links[1].url).toBe('http://b.com')
	})

	test('finds file path with line and column', () => {
		const links = findLinksInLine('error in ./src/foo.ts:10:5')
		expect(links).toEqual([{ url: './src/foo.ts:10:5', start: 9, end: 26, type: 'file' }])
	})

	test('finds absolute file path', () => {
		const links = findLinksInLine('at /Users/me/project/file.ts:42')
		expect(links).toEqual([
			{
				url: '/Users/me/project/file.ts:42',
				start: 3,
				end: 31,
				type: 'file'
			}
		])
	})

	test('finds file path without line info', () => {
		const links = findLinksInLine('created ./output/bundle.js')
		expect(links[0]).toMatchObject({ url: './output/bundle.js', type: 'file' })
	})

	test('finds parent-relative path', () => {
		const links = findLinksInLine('see ../config/setup.ts:3')
		expect(links[0]).toMatchObject({ url: '../config/setup.ts:3', type: 'file' })
	})

	test('URL takes priority over overlapping file path', () => {
		const links = findLinksInLine('http://localhost:3000/api/test')
		expect(links).toHaveLength(1)
		expect(links[0].type).toBe('url')
	})

	test('returns empty array for no links', () => {
		expect(findLinksInLine('just some text')).toEqual([])
	})
})

describe('findLinkAtPosition', () => {
	const line = 'visit http://example.com today'
	//           0123456789...

	test('returns link when cursor is at start', () => {
		const link = findLinkAtPosition(line, 6)
		expect(link).not.toBeNull()
		expect(link!.url).toBe('http://example.com')
	})

	test('returns link when cursor is in middle', () => {
		const link = findLinkAtPosition(line, 15)
		expect(link).not.toBeNull()
		expect(link!.url).toBe('http://example.com')
	})

	test('returns null when cursor is past end', () => {
		expect(findLinkAtPosition(line, 24)).toBeNull()
	})

	test('returns null when cursor is before link', () => {
		expect(findLinkAtPosition(line, 3)).toBeNull()
	})

	test('returns null for empty line', () => {
		expect(findLinkAtPosition('', 0)).toBeNull()
	})

	test('finds correct link among multiple', () => {
		const multi = 'http://a.com and http://b.com'
		const link = findLinkAtPosition(multi, 17)
		expect(link!.url).toBe('http://b.com')
	})
})
