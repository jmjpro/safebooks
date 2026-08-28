import chalk from 'chalk'
import logUpdate from 'log-update'

// The three stages a single file's pipeline moves through, in display order. See issue 10
// (.scratch/document-extraction-pipeline/issues).
export const STAGES = ['read', 'llm', 'db'] as const
export type Stage = (typeof STAGES)[number]

export type StageState =
  | { kind: 'queued' }
  | { kind: 'running'; attempt?: number; maxAttempts?: number }
  | { kind: 'success' }
  // LLM stage only: the document was classified/extracted but needs a human look
  // (needs_review field errors, or a genuine 'Unclassified' verdict) — distinct from a clean
  // pass, per issue 08.
  | { kind: 'warn' }
  | { kind: 'failure'; error: string }
  // A later stage that never ran because an earlier stage in the same file failed.
  | { kind: 'unreached' }

export type ProgressListener = (filename: string, stage: Stage, state: StageState) => void

export interface LiveProgressView {
  readonly onProgress: ProgressListener
  stop(): void
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80

const STAGE_LABELS: Record<Stage, string> = { read: 'READ', llm: 'LLM', db: 'DB' }

// chalk auto-detects color support per stream (respects NO_COLOR, strips codes on a non-TTY),
// so nothing extra is needed to keep the non-TTY fallback's output plain.
const STATE_COLOR: Record<StageState['kind'], (text: string) => string> = {
  queued: chalk.dim,
  running: chalk.cyan,
  success: chalk.green,
  warn: chalk.yellow,
  failure: chalk.red,
  unreached: chalk.dim,
}

function describeState(state: StageState): string {
  const text = (() => {
    switch (state.kind) {
      case 'queued':
        return 'queued'
      case 'running':
        return state.attempt && state.maxAttempts
          ? `running (attempt ${state.attempt}/${state.maxAttempts})`
          : 'running'
      case 'success':
        return 'ok'
      case 'warn':
        return 'needs review'
      case 'failure':
        return `failed: ${state.error}`
      case 'unreached':
        return 'skipped'
    }
  })()
  return STATE_COLOR[state.kind](text)
}

// Non-TTY fallback (piped/redirected output, CI logs): cursor-repositioning escape codes
// corrupt anything that isn't a real terminal, so print one flat line per stage transition
// instead of redrawing a fixed grid in place.
function createFlatProgressView(): LiveProgressView {
  return {
    onProgress: (filename, stage, state) => {
      console.log(`${filename} [${STAGE_LABELS[stage]}] ${describeState(state)}`)
    },
    stop: () => {},
  }
}

function plainCellText(state: StageState, frame: number): string {
  if (state.kind === 'running') {
    const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
    const suffix =
      state.attempt && state.maxAttempts ? ` ${state.attempt}/${state.maxAttempts}` : ''
    return `${spinner}${suffix}`
  }
  const icons: Record<Exclude<StageState['kind'], 'running'>, string> = {
    queued: '·',
    success: '✔',
    warn: '⚠',
    failure: '✘',
    unreached: '–',
  }
  return icons[state.kind]
}

// Pad on the plain text first, then color the whole (already correctly-widthed) cell — coloring
// before padding would make chalk's ANSI codes count toward padEnd's length and break alignment.
function renderCell(state: StageState, frame: number, columnWidth: number): string {
  return STATE_COLOR[state.kind](plainCellText(state, frame).padEnd(columnWidth))
}

// Pure render of the fixed grid: one row per file (in the given, fixed order), one column
// per stage, a header naming the columns. Kept side-effect-free and exported so it's testable
// without a TTY or log-update's write behavior. See issue 10.
export function renderGrid(
  filenames: readonly string[],
  state: ReadonlyMap<string, Record<Stage, StageState>>,
  frame: number,
): string {
  const nameWidth = Math.max(...filenames.map((f) => f.length), 'FILE'.length)
  const columnWidth = Math.max(
    ...Object.values(STAGE_LABELS).map((l) => l.length),
    'attempt 3/3'.length,
  )

  const header = `${'FILE'.padEnd(nameWidth)}  ${STAGES.map((s) => STAGE_LABELS[s].padEnd(columnWidth)).join('  ')}`
  const rows = filenames.map((filename) => {
    const fileState = state.get(filename)
    if (!fileState) throw new Error(`unknown file in progress view: ${filename}`)
    const cells = STAGES.map((stage) => renderCell(fileState[stage], frame, columnWidth))
    return `${filename.padEnd(nameWidth)}  ${cells.join('  ')}`
  })
  return [header, ...rows].join('\n')
}

// Fixed-position, redrawn-in-place grid: one row per file (reserved upfront, in
// file-discovery order, never reordered), one column per stage. See issue 10.
function createGridProgressView(filenames: string[]): LiveProgressView {
  const state = new Map<string, Record<Stage, StageState>>(
    filenames.map((filename) => [
      filename,
      { read: { kind: 'queued' }, llm: { kind: 'queued' }, db: { kind: 'queued' } },
    ]),
  )

  let frame = 0

  const interval = setInterval(() => {
    frame++
    logUpdate(renderGrid(filenames, state, frame))
  }, SPINNER_INTERVAL_MS)

  return {
    onProgress: (filename, stage, stageState) => {
      const fileState = state.get(filename)
      if (!fileState) throw new Error(`unknown file in progress view: ${filename}`)
      fileState[stage] = stageState
      logUpdate(renderGrid(filenames, state, frame))
    },
    stop: () => {
      clearInterval(interval)
      logUpdate(renderGrid(filenames, state, frame))
      logUpdate.done()
    },
  }
}

// A TTY that reports zero rows/columns (seen under some non-interactive pty wrappers) can't
// actually display an in-place redraw either — log-update silently produces no output at all
// in that case — so treat it the same as a non-TTY and fall back to flat logging.
function canRedrawInPlace(): boolean {
  return (
    Boolean(process.stdout.isTTY) &&
    (process.stdout.columns ?? 0) > 0 &&
    (process.stdout.rows ?? 0) > 0
  )
}

export function createLiveProgressView(filenames: string[]): LiveProgressView {
  return canRedrawInPlace() ? createGridProgressView(filenames) : createFlatProgressView()
}
