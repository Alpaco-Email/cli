import { describe, expect, it } from 'vitest';
import { removedKeys } from '../src/core/changes.ts';
import { validateDesign } from '../src/core/validate.ts';
import { sampleDesign } from './fixtures.ts';

const messages = (design = sampleDesign()) => validateDesign(design).map((p) => p.message);

describe('validateDesign', () => {
  it('passes a valid design', () => {
    expect(validateDesign(sampleDesign())).toEqual([]);
  });

  it('wants unique, non-empty block names and keys', () => {
    const d = sampleDesign();
    d.blocks![1]!.name = 'Hero';
    d.blocks![1]!.key = 'hero';
    d.blocks!.push({ inputGroups: [] });
    expect(messages(d)).toEqual(expect.arrayContaining([
      'Duplicate block key "hero".', 'Duplicate block name "Hero".', 'Block has no key.', 'Block has no name.',
    ]));
  });

  it('wants unique, non-empty group and input names and keys', () => {
    const d = sampleDesign();
    const group = d.blocks![0]!.inputGroups![0]!;
    group.inputs!.push({ key: 'headline', name: 'Headline', type: 'text' }, { key: '', name: 'X' });
    d.blocks![0]!.inputGroups!.push({ ...group, inputs: [] });
    expect(messages(d)).toEqual(expect.arrayContaining([
      'Duplicate input key "headline" in "Content".', 'Duplicate input name "Headline" in "Content".',
      'An input in "Content" has no key.', 'Duplicate input group key "content".', 'Duplicate input group name "Content".',
    ]));
  });

  it('only warns about an empty, unnamed input group', () => {
    const d = sampleDesign();
    d.base!.inputGroups!.push({ name: '', key: '', inputs: [] });
    expect(validateDesign(d)).toEqual([
      { level: 'warning', message: 'Empty input group with no name or key: remove it.', file: 'base/config.json' },
    ]);
  });

  it('reports Liquid that does not parse, with file and position', () => {
    const d = sampleDesign();
    d.blocks![0]!.code = '<p>\n  {% if content.headline %}\nHi';
    const [problem] = validateDesign(d, { base: 'base', blocks: ['blocks/hero', 'blocks/footer'] });
    expect(problem).toMatchObject({ level: 'error', file: 'blocks/hero/code.liquid', line: 2, col: 3 });
    expect(problem!.message).toBe('Liquid: tag {% if content.headline %} not closed');
  });

  it('accepts Alpaco filters and raw blocks', () => {
    const d = sampleDesign();
    d.base!.code = '{{ logo | image: 600 }}{% raw %}{{ esp_tag }}{% endraw %}';
    expect(validateDesign(d)).toEqual([]);
  });

  it('wants vars.global to be valid JSON, but allows it empty', () => {
    const d = sampleDesign();
    d.vars!.global = '{\n  "a": 1,\n}';
    expect(validateDesign(d)[0]).toMatchObject({ file: 'vars/global.json', line: 3, col: 1 });
    d.vars!.global = '';
    expect(validateDesign(d)).toEqual([]);
  });
});

describe('removedKeys', () => {
  it('reports removed or renamed blocks, groups and inputs', () => {
    const before = sampleDesign();
    const after = sampleDesign();
    after.blocks![0]!.inputGroups![0]!.inputs![0]!.key = 'title';
    after.blocks!.pop();
    after.base!.inputGroups = [];
    expect(removedKeys(before, after)).toEqual([
      { kind: 'group', path: 'base › colours' },
      { kind: 'input', path: 'hero › content › headline' },
      { kind: 'block', path: 'footer' },
    ]);
  });

  it('ignores additions and moves', () => {
    const after = sampleDesign();
    after.blocks!.reverse();
    after.blocks!.push({ key: 'new', name: 'New', inputGroups: [] });
    expect(removedKeys(sampleDesign(), after)).toEqual([]);
  });
});
