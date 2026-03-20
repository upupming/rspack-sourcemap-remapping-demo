const path = require('path')
const remapping = require('@ampproject/remapping')
const MagicString = require('magic-string')
const { rspack } = require('@rspack/core')

const BANNER_LINES = {
  before: '// injected before DEV_TOOLING',
  afterGood: '// injected after DEV_TOOLING with remapping',
  afterBad: '// injected after DEV_TOOLING without remapping',
}

class BeforeDevToolingBannerPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('BeforeDevToolingBannerPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'BeforeDevToolingBannerPlugin',
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        () => {
          for (const asset of compilation.getAssets()) {
            if (asset.name !== 'bundle.js') {
              continue
            }

            compilation.updateAsset(
              asset.name,
              new rspack.sources.ConcatSource(`${BANNER_LINES.before}\n`, asset.source),
              asset.info,
            )
          }
        },
      )
    })
  }
}

class BeforeDevToolingSourceMapSourcePlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('BeforeDevToolingSourceMapSourcePlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'BeforeDevToolingSourceMapSourcePlugin',
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        () => {
          for (const asset of compilation.getAssets()) {
            if (asset.name !== 'bundle.js') {
              continue
            }

            const result = asset.source.sourceAndMap
              ? asset.source.sourceAndMap()
              : { source: asset.source.source(), map: asset.source.map() }
            const jsCode = result.source.toString()
            const originalMap = result.map
            const magic = new MagicString(jsCode)
            magic.prepend('// injected before DEV_TOOLING with SourceMapSource\n')

            const transformMap = magic.generateMap({
              file: asset.name,
              source: asset.name,
              includeContent: true,
              hires: true,
            })

            compilation.updateAsset(
              asset.name,
              new rspack.sources.SourceMapSource(
                magic.toString(),
                asset.name,
                transformMap.toString(),
                jsCode,
                originalMap,
                true,
              ),
              asset.info,
            )
          }
        },
      )
    })
  }
}

class AfterDevToolingBannerPlugin {
  constructor({ updateMap }) {
    this.updateMap = updateMap
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap('AfterDevToolingBannerPlugin', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: `AfterDevToolingBannerPlugin:${this.updateMap ? 'good' : 'bad'}`,
          stage: rspack.Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        () => {
          for (const asset of compilation.getAssets()) {
            if (asset.name !== 'bundle.js') {
              continue
            }

            const mapFile = asset.info.related && asset.info.related.sourceMap
            if (!mapFile) {
              throw new Error(`No sourcemap file found for ${asset.name}`)
            }

            const mapAsset = compilation.getAsset(mapFile)
            if (!mapAsset) {
              throw new Error(`Cannot locate sourcemap asset ${mapFile}`)
            }

            const jsCode = asset.source.source().toString()
            const newCode = `${this.updateMap ? BANNER_LINES.afterGood : BANNER_LINES.afterBad}\n${jsCode}`

            compilation.updateAsset(
              asset.name,
              new rspack.sources.RawSource(newCode),
              asset.info,
            )

            if (!this.updateMap) {
              continue
            }

            const originalMap = JSON.parse(mapAsset.source.source().toString())
            const magic = new MagicString(jsCode)
            magic.prepend(`${BANNER_LINES.afterGood}\n`)

            const transformMap = magic.generateMap({
              file: asset.name,
              source: asset.name,
              includeContent: true,
              hires: true,
            })

            const finalMap = remapping([transformMap.toString(), originalMap], () => null)

            compilation.updateAsset(
              mapFile,
              new rspack.sources.RawSource(JSON.stringify(finalMap)),
              mapAsset.info,
            )
          }
        },
      )
    })
  }
}

module.exports = (env = {}) => {
  const variant = env.variant || 'baseline'
  const plugins = []

  if (variant === 'before') {
    plugins.push(new BeforeDevToolingBannerPlugin())
  }

  if (variant === 'before-sms') {
    plugins.push(new BeforeDevToolingSourceMapSourcePlugin())
  }

  if (variant === 'after-good') {
    plugins.push(new AfterDevToolingBannerPlugin({ updateMap: true }))
  }

  if (variant === 'after-bad') {
    plugins.push(new AfterDevToolingBannerPlugin({ updateMap: false }))
  }

  return {
    mode: 'development',
    context: __dirname,
    devtool: 'source-map',
    entry: './src/index.js',
    output: {
      path: path.join(__dirname, 'dist', variant),
      filename: 'bundle.js',
      clean: false,
    },
    plugins,
  }
}
