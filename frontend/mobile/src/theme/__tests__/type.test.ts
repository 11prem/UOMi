import fs from 'fs';
import path from 'path';
import { fonts, type } from '../type';

const fontDir = path.resolve(__dirname, '../../../assets/fonts');

describe('type scale', () => {
  it('ships exactly the five static Fraunces instances', () => {
    const files = fs.readdirSync(fontDir).filter((f) => f.endsWith('.ttf')).sort();
    expect(files).toEqual(Object.values(fonts).map((name) => `${name}.ttf`).sort());
  });

  it('only uses those families, and never sets fontWeight (the weight is in the file)', () => {
    const families = new Set<string>(Object.values(fonts));
    for (const style of Object.values(type)) {
      expect(families.has(style.fontFamily as string)).toBe(true);
      expect(style).not.toHaveProperty('fontWeight');
    }
  });

  it('uses Display cuts only at 28 px and up', () => {
    for (const style of Object.values(type)) {
      if ((style.fontFamily as string).includes('Display')) expect(style.fontSize!).toBeGreaterThanOrEqual(28);
    }
  });
});
