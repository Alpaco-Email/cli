import { describe, expect, it } from 'vitest';
import { blockFolders, designToFiles, filesToDesign } from '../src/core/files.ts';
import { orderLike, sameJson } from '../src/core/order.ts';
import { sampleDesign } from './fixtures.ts';

const reader = (files: Map<string, string>) => (path: string) => files.get(path);

describe('design ⇄ files', () => {
  it('gives back exactly the pulled JSON, key order included', () => {
    const design = sampleDesign();
    const { design: back } = filesToDesign(reader(designToFiles(design)), design);
    expect(JSON.stringify(back)).toBe(JSON.stringify(design));
  });

  it('lays the design out as editable files', () => {
    const files = designToFiles(sampleDesign());
    expect([...files.keys()].sort()).toEqual([
      'base/code.liquid', 'base/config.json',
      'blocks/footer/code.liquid', 'blocks/footer/config.json',
      'blocks/hero/code.liquid', 'blocks/hero/config.json',
      'template.json', 'vars/global.json',
    ]);
    expect(JSON.parse(files.get('template.json')!).blocks).toEqual(['hero', 'footer']);
    expect(files.get('blocks/hero/config.json')).not.toContain('"code"');
  });

  it('keeps code with and without a final newline', () => {
    const design = sampleDesign();
    const { design: back } = filesToDesign(reader(designToFiles(design)), design);
    expect(back.blocks![0]!.code!.endsWith('</a>')).toBe(true);
    expect(back.blocks![1]!.code).toBe('<p>Bye</p>\n');
  });

  it('ignores the final newline an editor adds', () => {
    const design = sampleDesign();
    const files = designToFiles(design);
    files.set('vars/global.json', files.get('vars/global.json')!); // already ends in \n
    const code = files.get('blocks/hero/code.liquid')!;
    expect(code.endsWith('</a>\n')).toBe(true);
    const { design: back } = filesToDesign(reader(files), design);
    expect(sameJson(back, design)).toBe(true);
  });

  it('follows block order from template.json', () => {
    const design = sampleDesign();
    const files = designToFiles(design);
    files.set('template.json', files.get('template.json')!.replace('"hero",\n    "footer"', '"footer",\n    "hero"'));
    const { design: back, layout } = filesToDesign(reader(files), design);
    expect(back.blocks!.map((b) => b.key)).toEqual(['footer', 'hero']);
    expect(layout.blocks).toEqual(['blocks/footer', 'blocks/hero']);
  });

  it('names folders safely and uniquely', () => {
    expect(blockFolders([{ key: 'hero' }, { key: 'hero' }, { key: 'a/b c' }, {}])).toEqual(['hero', 'hero-2', 'a-b-c', 'block']);
  });

  it('says which file is missing or broken', () => {
    const files = designToFiles(sampleDesign());
    files.delete('blocks/hero/config.json');
    expect(() => filesToDesign(reader(files))).toThrow('blocks/hero/config.json is missing');
    files.set('blocks/hero/config.json', '{ nope');
    expect(() => filesToDesign(reader(files))).toThrow('blocks/hero/config.json is not valid JSON');
  });
});

describe('orderLike', () => {
  it('restores key order and puts new keys last', () => {
    const ordered = orderLike({ b: 1, c: 3, a: 2 }, { a: 0, b: 0 });
    expect(Object.keys(ordered)).toEqual(['a', 'b', 'c']);
  });

  it('matches array items by key, not position', () => {
    const ordered = orderLike([{ y: 1, key: 'b' }, { y: 2, key: 'a' }], [{ key: 'a', y: 0 }, { key: 'b', y: 0 }]);
    expect(ordered.map((o) => Object.keys(o))).toEqual([['key', 'y'], ['key', 'y']]);
  });
});
