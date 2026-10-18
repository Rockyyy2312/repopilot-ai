import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'

test('built entry loads the design CSS and preserves computed desktop layouts', () => {
  const index = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8')
  const cssPath = index.match(/href="(\/assets\/[^\"]+\.css)"/)
  assert.ok(cssPath, 'production index must link to a generated stylesheet')
  const css = readFileSync(new URL(`../dist${cssPath[1]}`, import.meta.url), 'utf8')
  // External fonts are not needed to verify layout and must not trigger network I/O.
  const parsed = postcss.parse(css)
  parsed.walkAtRules('import', rule => rule.remove())
  const localCSS = parsed.toString()
  const dom = new JSDOM(`<style>${localCSS}</style><header><div class="brand"></div></header><main class="shell"><aside></aside><section class="content"><div class="import-grid"><div class="card"></div></div><div class="overview-grid"></div><button class="outline"></button></section></main>`)
  const style = (selector) => dom.window.getComputedStyle(dom.window.document.querySelector(selector))
  assert.equal(style('.shell').display, 'flex')
  assert.equal(style('header').display, 'flex')
  assert.equal(style('.brand').display, 'flex')
  assert.equal(style('aside').width, '255px')
  assert.equal(style('.import-grid').display, 'grid')
  assert.equal(style('.overview-grid').display, 'grid')
  assert.equal(style('.card').backgroundColor, 'rgb(14, 22, 35)')
  assert.equal(style('.card').borderRadius, '9px')
  assert.equal(style('.content').minWidth, '0')
  assert.equal(style('.outline').outlineStyle, 'none')
  // JSDOM does not evaluate responsive layout. Verify the emitted mobile overrides.
  const root = postcss.parse(css)
  const mobileRules = []
  root.walkAtRules('media', (rule) => {
    if (/max-width:\s*800px/.test(rule.params)) mobileRules.push(rule.toString())
  })
  assert.ok(mobileRules.some(rule => /\.shell\{display:block/.test(rule)))
  assert.ok(mobileRules.some(rule => /grid-template-columns:1fr/.test(rule)))
  dom.window.close()
})
