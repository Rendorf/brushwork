import { ADJUST } from './defs/adjust';
import { ARTISTIC } from './defs/artistic';
import { BLUR } from './defs/blur';
import { DISTORT } from './defs/distort';
import { GENERATE } from './defs/generate';
import { LIGHT } from './defs/light';
import type { FilterDef } from './types';

export const FILTERS: FilterDef[] = [...ADJUST, ...BLUR, ...LIGHT, ...ARTISTIC, ...DISTORT, ...GENERATE];

export const FILTER_MAP = new Map(FILTERS.map((f) => [f.id, f]));
