import {describe,expect,it} from 'vitest';
import {normalizeSearch} from './api';
describe('normalizeSearch',()=>{it('keeps valid line-numbered evidence and ignores malformed API rows',()=>{expect(normalizeSearch({results:[{path:'src/app.ts',line:12,text:'fetch()'},{path:'README.md',line:'bad'},null]})).toEqual([{path:'src/app.ts',line:12,text:'fetch()'}])});it('normalizes missing payloads to an empty result set',()=>{expect(normalizeSearch(undefined)).toEqual([]);expect(normalizeSearch({})).toEqual([])})});
