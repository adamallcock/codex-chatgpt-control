import {describe,it,expect} from 'vitest';
import {composerTextbox} from '../../src/dom/selectors.js';
import {classifyVisibleText} from '../../src/safety/blockers.js';
import {composeMessage} from '../../src/commands/messages.js';
import type {PageLike,LocatorLike} from '../../src/types.js';

describe('project composer and visible error regression',()=>{
 it('matches a project-specific accessible label without matching arbitrary textboxes',()=>{
  let name: RegExp | string | undefined;
  const locator:LocatorLike={count:async()=>1};
  composerTextbox({getByRole:(_role,options)=>{name=options?.name as RegExp | string | undefined;return locator;}} as PageLike);
  expect(name).toBeInstanceOf(RegExp);
  expect('New chat in Synthetic Project').toMatch(name as RegExp);
  expect('New chat in 合成项目').toMatch(name as RegExp);
  expect('Ask ChatGPT').toMatch(name as RegExp);
  expect('Search projects').not.toMatch(name as RegExp);
 });
 it('does not classify an accession or large number as a 404 page',()=>{
  expect(classifyVisibleText('Review GSE240401 JSON')).toBeUndefined();
  expect(classifyVisibleText('404 Not Found')?.kind).toBe('not_found');
  expect(classifyVisibleText('Page not found')?.kind).toBe('not_found');
 });
 it('rejects a lost fill even when the composer becomes empty',async()=>{
  const locator:LocatorLike={count:async()=>1,click:async()=>{},fill:async()=>{},innerText:async()=>''};
  const page:PageLike={getByRole:()=>locator,url:()=> 'https://chatgpt.com/',content:async()=>'<main></main>'};
  const result=await composeMessage({page},{text:'synthetic prompt'});
  expect(result.ok).toBe(false);
  expect(result.error?.name).toBe('ComposerVerificationError');
 });
});
