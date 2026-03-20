const fs = require('fs')
const path = require('path')
const { SourceMapConsumer } = require('source-map')

const projectRoot = path.join(__dirname, '..')
const variants = ['baseline', 'before', 'before-replace', 'before-sms', 'after-good', 'after-bad']
const checks = [
  { label: 'total assignment', originalLine: 12, snippet: 'const total = add(20, 22)' },
  { label: 'console log', originalLine: 14, snippet: "console.log('computed value', doubled)" },
]

function getArtifacts(variant) {
  const dir = path.join(projectRoot, 'dist', variant)
  const code = fs.readFileSync(path.join(dir, 'bundle.js'), 'utf8')
  const map = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.js.map'), 'utf8'))
  return { code, map }
}

function findCodeLine(code, snippet) {
  const lines = code.split('\n')
  const index = lines.findIndex((line) => line.includes(snippet))

  if (index === -1) {
    throw new Error(`Cannot find snippet "${snippet}" in bundle output`)
  }

  return {
    lineNumber: index + 1,
    lineText: lines[index],
    column: lines[index].indexOf(snippet),
  }
}

async function inspectVariant(variant) {
  const { code, map } = getArtifacts(variant)

  return SourceMapConsumer.with(map, null, (consumer) => {
    return checks.map((check) => {
      const generated = findCodeLine(code, check.snippet)
      const original = consumer.originalPositionFor({
        line: generated.lineNumber,
        column: generated.column,
        bias: SourceMapConsumer.GREATEST_LOWER_BOUND,
      })

      return {
        ...check,
        generatedLine: generated.lineNumber,
        generatedColumn: generated.column,
        actualLine: generated.lineText.trim(),
        originalLineFromMap: original.line,
        originalColumnFromMap: original.column,
        originalSourceFromMap: original.source,
      }
    })
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const results = {}

  for (const variant of variants) {
    results[variant] = await inspectVariant(variant)
  }

  for (let i = 0; i < checks.length; i++) {
    const baseline = results.baseline[i]
    const before = results.before[i]
    const beforeReplace = results['before-replace'][i]
    const beforeSms = results['before-sms'][i]
    const afterGood = results['after-good'][i]
    const afterBad = results['after-bad'][i]

    assert(before.generatedLine === baseline.generatedLine + 1, `${before.label}: before build should shift generated line by 1`)
    assert(beforeReplace.generatedLine === baseline.generatedLine + 1, `${beforeReplace.label}: before-replace build should shift generated line by 1`)
    assert(beforeSms.generatedLine === baseline.generatedLine + 1, `${beforeSms.label}: before-sms build should shift generated line by 1`)
    assert(afterGood.generatedLine === baseline.generatedLine + 1, `${afterGood.label}: after-good build should shift generated line by 1`)
    assert(afterBad.generatedLine === baseline.generatedLine + 1, `${afterBad.label}: after-bad output should also shift generated line by 1`)
    assert(before.originalLineFromMap === before.originalLine, `${before.label}: before build should map back to the original source line`)
    assert(beforeReplace.originalLineFromMap === beforeReplace.originalLine, `${beforeReplace.label}: before-replace build should map back to the original source line`)
    assert(beforeSms.originalLineFromMap === beforeSms.originalLine, `${beforeSms.label}: before-sms build should map back to the original source line`)
    assert(afterGood.originalLineFromMap === afterGood.originalLine, `${afterGood.label}: after-good build should map back to the original source line`)
    assert(afterBad.originalLineFromMap !== afterBad.originalLine, `${afterBad.label}: after-bad build should expose a stale mapping`)
  }

  for (const variant of variants) {
    console.log(`\n[${variant}]`)
    for (const entry of results[variant]) {
      console.log(
        `${entry.label}: generated ${entry.generatedLine}:${entry.generatedColumn} -> original ${entry.originalLineFromMap}:${entry.originalColumnFromMap} | ${entry.actualLine}`,
      )
    }
  }

  console.log('\nVerification passed.')
}

main().catch((error) => {
  console.error(error.stack || error.message)
  process.exit(1)
})
