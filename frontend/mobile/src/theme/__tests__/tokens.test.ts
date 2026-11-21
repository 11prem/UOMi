import fs from 'fs';
import path from 'path';
import { tokens } from '../tokens';

const camel = (name: string) =>
  name.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

// Colour-valued custom properties per theme: `:root` is light, `:root[data-theme="dark"]` is dark.
function readCssColours() {
  const css = fs
    .readFileSync(path.resolve(__dirname, '../../../../prototype/css/tokens.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const found: { theme: 'light' | 'dark'; key: string; value: string }[] = [];
  for (const block of css.matchAll(/(:root(?:\[data-theme="dark"\])?)\s*\{([^}]*)\}/g)) {
    const theme = block[1] === ':root' ? 'light' : 'dark';
    for (const decl of block[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      const value = decl[2].trim();
      if (/^(#|rgba?\()/.test(value)) found.push({ theme, key: camel(decl[1]), value });
    }
  }
  return found;
}

describe('colour tokens', () => {
  it('light and dark define the same keys', () => {
    expect(Object.keys(tokens.dark).sort()).toEqual(Object.keys(tokens.light).sort());
  });

  it('carbon is #23308A light and #A9BCFF dark', () => {
    expect(tokens.light.carbon).toBe('#23308A');
    expect(tokens.dark.carbon).toBe('#A9BCFF');
  });

  it('every colour token in tokens.css is present', () => {
    const found = readCssColours();
    expect(found.length).toBeGreaterThan(60); // light + dark; guards against a parser that matches nothing
    for (const { theme, key, value } of found) {
      expect(tokens.light).toHaveProperty(key);
      expect(tokens.dark).toHaveProperty(key);
      expect({ theme, key, value: tokens[theme][key as keyof typeof tokens.light] }).toEqual({ theme, key, value });
    }
  });
});
