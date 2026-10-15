const LEVEL_COLOR = {
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  debug: '\x1b[90m',
}
const RESET = '\x1b[0m'

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

const emit = (level, args) => {
  const tag = `${LEVEL_COLOR[level] || ''}[${level.toUpperCase()}]${RESET}`
  const line = `${stamp()} ${tag}`
  if (level === 'error') console.error(line, ...args)
  else if (level === 'warn') console.warn(line, ...args)
  else console.log(line, ...args)
}

export const logger = {
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  debug: (...args) => {
    if (process.env.DEBUG) emit('debug', args)
  },
}

export default logger
