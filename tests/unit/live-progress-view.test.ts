import assert from 'node:assert/strict'
import { test } from 'node:test'
import chalk from 'chalk'
import {
  createLiveProgressView,
  renderGrid,
  type Stage,
  type StageState,
} from '../../src/cli/live-progress-view.js'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '')
}

function queuedState(): Record<Stage, StageState> {
  return { read: { kind: 'queued' }, llm: { kind: 'queued' }, db: { kind: 'queued' } }
}

test('renderGrid prints a header and one row per file, in the given fixed order', () => {
  const state = new Map([
    ['b.pdf', queuedState()],
    ['a.pdf', queuedState()],
  ])

  const output = renderGrid(['b.pdf', 'a.pdf'], state, 0)
  const lines = output.split('\n')

  assert.match(lines[0] ?? '', /FILE/)
  assert.match(lines[0] ?? '', /READ/)
  assert.match(lines[0] ?? '', /LLM/)
  assert.match(lines[0] ?? '', /DB/)
  assert.match(lines[1] ?? '', /^b\.pdf/)
  assert.match(lines[2] ?? '', /^a\.pdf/)
})

test('renderGrid distinguishes queued, running, success, warn, failure, and unreached per stage', () => {
  const state = new Map<string, Record<Stage, StageState>>([
    [
      'doc.pdf',
      {
        read: { kind: 'success' },
        llm: { kind: 'running', attempt: 2, maxAttempts: 3 },
        db: { kind: 'unreached' },
      },
    ],
  ])

  const row = renderGrid(['doc.pdf'], state, 0).split('\n')[1] ?? ''

  assert.match(row, /✔/) // read: success
  assert.match(row, /2\/3/) // llm: running, attempt counter visible
  assert.match(row, /–/) // db: unreached
})

test('renderGrid throws if asked to render a file it has no state for', () => {
  assert.throws(() => renderGrid(['missing.pdf'], new Map(), 0))
})

test('renderGrid keeps columns aligned once color codes are stripped, even with colored cells', () => {
  const originalLevel = chalk.level
  chalk.level = 3 // force ANSI color codes on, regardless of this test run's TTY/CI status
  try {
    const state = new Map<string, Record<Stage, StageState>>([
      [
        'short.pdf',
        {
          read: { kind: 'success' },
          llm: { kind: 'warn' },
          db: { kind: 'failure', error: 'boom' },
        },
      ],
      [
        'a-much-longer-filename.pdf',
        {
          read: { kind: 'queued' },
          llm: { kind: 'running', attempt: 2, maxAttempts: 3 },
          db: { kind: 'unreached' },
        },
      ],
    ])

    const lines = renderGrid(['short.pdf', 'a-much-longer-filename.pdf'], state, 0).split('\n')
    assert.ok(
      lines.some((line) => line.includes('[')),
      'expected color codes to be present',
    )

    const visibleWidths = new Set(lines.map((line) => stripAnsi(line).length))
    assert.equal(
      visibleWidths.size,
      1,
      `expected every row's visible (color-stripped) width to match, got: ${[...visibleWidths]}`,
    )
  } finally {
    chalk.level = originalLevel
  }
})

test('the non-TTY fallback view prints one line per progress event, without a fixed grid', () => {
  const originalIsTTY = process.stdout.isTTY
  Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })

  const logged: string[] = []
  const originalLog = console.log
  console.log = (message: string) => logged.push(message)

  try {
    const view = createLiveProgressView(['a.pdf', 'b.pdf'])
    view.onProgress('a.pdf', 'read', { kind: 'running' })
    view.onProgress('a.pdf', 'read', { kind: 'success' })
    view.onProgress('a.pdf', 'llm', { kind: 'running', attempt: 1, maxAttempts: 3 })
    view.onProgress('a.pdf', 'llm', { kind: 'failure', error: 'boom' })
    view.stop()

    assert.equal(logged.length, 4)
    assert.match(logged[0] ?? '', /a\.pdf.*READ.*running/)
    assert.match(logged[1] ?? '', /a\.pdf.*READ.*ok/)
    assert.match(logged[2] ?? '', /a\.pdf.*LLM.*attempt 1\/3/)
    assert.match(logged[3] ?? '', /a\.pdf.*LLM.*failed: boom/)
  } finally {
    console.log = originalLog
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true })
  }
})
