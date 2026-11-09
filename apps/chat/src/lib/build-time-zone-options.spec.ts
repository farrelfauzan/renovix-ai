/// <reference types="jest" />
import { buildTimeZoneOptions } from './build-time-zone-options';

it('puts WIB, WITA and WIT first with their IANA ids, whatever the list order', () => {
  const options = buildTimeZoneOptions({ current: 'Europe/Berlin', supported: ['Africa/Cairo', 'Asia/Jayapura', 'Asia/Jakarta', 'Asia/Makassar'] });

  expect(options.slice(0, 3)).toEqual([
    { value: 'Asia/Jakarta', label: 'Asia/Jakarta (WIB)' },
    { value: 'Asia/Makassar', label: 'Asia/Makassar (WITA)' },
    { value: 'Asia/Jayapura', label: 'Asia/Jayapura (WIT)' },
  ]);
});

it('keeps the current zone in the list, once, as its IANA id', () => {
  const options = buildTimeZoneOptions({ current: 'Europe/Berlin', supported: ['Europe/Berlin', 'UTC'] });

  expect(options.filter((option) => option.value === 'Europe/Berlin')).toEqual([{ value: 'Europe/Berlin', label: 'Europe/Berlin' }]);
  expect(options.map((option) => option.value)).toEqual(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Europe/Berlin', 'UTC']);
});

it('a zone the browser does not list goes last, so picking one does not reorder the list', () => {
  const options = buildTimeZoneOptions({ current: 'Etc/Odd', supported: ['Africa/Cairo', 'UTC'] });

  expect(options.map((option) => option.value).slice(3)).toEqual(['Africa/Cairo', 'UTC', 'Etc/Odd']);
});

it('an empty current zone adds nothing', () => {
  expect(buildTimeZoneOptions({ current: '', supported: [] })).toHaveLength(3);
});
