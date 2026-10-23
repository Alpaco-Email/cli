import type { Design } from '../src/core/types.ts';

/** A small design shaped like Alpaco's: keys in the order the designer writes them. */
export function sampleDesign(): Design {
  return {
    vars: { global: '{\n  "brand": "#ff6600"\n}', blocks: [] },
    blocks: [
      {
        name: 'Hero',
        key: 'hero',
        inputGroups: [
          {
            name: 'Content',
            key: 'content',
            repeatable: false,
            inputs: [
              { default: 'Hello', key: 'headline', name: 'Headline', type: 'text' },
              { default: '', key: 'url', name: 'Button URL', type: 'url' },
            ],
          },
        ],
        code: '<h1>{{ content.headline }}</h1>\n<a href="{{ content.url | track }}">Go</a>',
        thumbnail: null,
      },
      {
        name: 'Footer',
        key: 'footer',
        inputGroups: [],
        code: '<p>Bye</p>\n',
        thumbnail: '',
      },
    ],
    base: {
      key: 'base',
      inputGroups: [{ name: 'Colours', key: 'colours', repeatable: false, inputs: [{ key: 'bg', name: 'Background', type: 'color' }] }],
      code: '<html><body>{{ blocks }}</body></html>',
    },
    validationRules: [],
  };
}
