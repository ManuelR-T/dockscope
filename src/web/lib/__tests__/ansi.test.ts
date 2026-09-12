import { describe, it, expect } from 'vitest';
import { ansiToHtml, highlightLogSearch } from '../ansi';

describe('ansiToHtml', () => {
  it.each([
    [
      '1;2;3;4;31;41',
      '22',
      'color:#ff2b4e;background:#3b0a15;font-style:italic;text-decoration:underline',
    ],
    ['1;3;4;31', '23;24;39', 'font-weight:700'],
    ['31;41', '49', 'color:#ff2b4e'],
    ['38;5;255', '', 'color:#eeeeee'],
    ['48;5;1', '', 'background:#ff2b4e'],
    ['48;2;1;2;3', '', 'background:rgb(1,2,3)'],
    ['38;2;10', '', 'color:rgb(10,0,0)'],
    ['38;5', '', null],
    ['31', '38;5;256', null],
    ['1', '999', 'font-weight:700'],
    ['1;31;41', '0', null],
  ] as const)('applies SGR %s then %s in sequence', (initial, reset, style) => {
    const html = ansiToHtml(`\x1b[${initial}m${reset ? `\x1b[${reset}m` : ''}sample`);
    expect(html).toMatch(
      style
        ? new RegExp(`<span style="${style.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">sample</span>$`)
        : /sample$/,
    );
    if (!style) {
      expect(html).not.toMatch(/<span[^>]*>sample/);
    }
  });

  it('returns empty string for empty input', () => {
    expect(ansiToHtml('')).toBe('');
  });

  it('escapes HTML in plain text', () => {
    expect(ansiToHtml('<script>alert("xss")</script>')).toContain('&lt;script&gt;');
  });

  it('converts red foreground', () => {
    const result = ansiToHtml('\x1b[31mERROR\x1b[0m');
    expect(result).toContain('color:#ff2b4e');
    expect(result).toContain('ERROR');
  });

  it('converts green foreground', () => {
    const result = ansiToHtml('\x1b[32mOK\x1b[0m');
    expect(result).toContain('color:#00ff6a');
  });

  it('handles bold', () => {
    const result = ansiToHtml('\x1b[1mBOLD\x1b[0m');
    expect(result).toContain('font-weight:700');
  });

  it('handles underline', () => {
    const result = ansiToHtml('\x1b[4mUNDER\x1b[0m');
    expect(result).toContain('text-decoration:underline');
  });

  it('handles dim', () => {
    const result = ansiToHtml('\x1b[2mDIM\x1b[0m');
    expect(result).toContain('opacity:0.6');
  });

  it('handles italic', () => {
    const result = ansiToHtml('\x1b[3mITALIC\x1b[0m');
    expect(result).toContain('font-style:italic');
  });

  it('handles background color', () => {
    const result = ansiToHtml('\x1b[41mRED_BG\x1b[0m');
    expect(result).toContain('background:#3b0a15');
  });

  it('handles 256-color mode', () => {
    const result = ansiToHtml('\x1b[38;5;1mCOLOR\x1b[0m');
    expect(result).toContain('color:#ff2b4e');
  });

  it('handles RGB mode', () => {
    const result = ansiToHtml('\x1b[38;2;255;128;0mRGB\x1b[0m');
    expect(result).toContain('color:rgb(255,128,0)');
  });

  it('handles reset code', () => {
    const result = ansiToHtml('\x1b[31mRED\x1b[0m NORMAL');
    expect(result).toContain('</span>');
    expect(result).toContain('NORMAL');
  });

  it('handles combined codes', () => {
    const result = ansiToHtml('\x1b[1;31mBOLD RED\x1b[0m');
    expect(result).toContain('font-weight:700');
    expect(result).toContain('color:#ff2b4e');
  });

  it('shortens Docker timestamps', () => {
    const result = ansiToHtml('2026-03-25T18:43:43.798636408Z some log');
    expect(result).toContain('18:43:43');
    expect(result).not.toContain('2026-03-25');
  });

  it('colors ERROR log levels', () => {
    const result = ansiToHtml('ERROR something went wrong');
    expect(result).toContain('log-level-error');
  });

  it('colors WARN log levels', () => {
    const result = ansiToHtml('WARNING: deprecated');
    expect(result).toContain('log-level-warn');
  });

  it('colors DEBUG log levels', () => {
    const result = ansiToHtml('DEBUG: value=42');
    expect(result).toContain('log-level-debug');
  });

  it('passes through plain text without ANSI codes', () => {
    const result = ansiToHtml('Hello world');
    expect(result).toContain('Hello world');
  });
});

describe('highlightLogSearch', () => {
  it('returns unchanged html with no query', () => {
    const { html, count } = highlightLogSearch('<span>test</span>', '');
    expect(html).toBe('<span>test</span>');
    expect(count).toBe(0);
  });

  it('highlights matches in text content', () => {
    const { html, count } = highlightLogSearch('error in line 5', 'error');
    expect(html).toContain('<mark class="log-highlight">error</mark>');
    expect(count).toBe(1);
  });

  it('counts multiple matches', () => {
    const { count } = highlightLogSearch('error and error again', 'error');
    expect(count).toBe(2);
  });

  it('is case-insensitive', () => {
    const { html, count } = highlightLogSearch('Error ERROR error', 'error');
    expect(count).toBe(3);
    expect(html).toContain('<mark class="log-highlight">Error</mark>');
  });

  it('escapes regex special chars in query', () => {
    const { html } = highlightLogSearch('file.txt', '.');
    expect(html).toContain('<mark class="log-highlight">.</mark>');
  });
});
