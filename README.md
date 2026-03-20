# Rspack Sourcemap Remapping Demo

这个项目用一个最小 Rspack 例子验证了 4 种 sourcemap 处理方式：

- `baseline`：不修改 bundle
- `before`：在 `DEV_TOOLING` 之前用 `ConcatSource` prepend 一行
- `before-replace`：在 `DEV_TOOLING` 之前用 `ReplaceSource` 插入一行
- `before-sms`：在 `DEV_TOOLING` 之前先生成 transform map，再用 `SourceMapSource`
- `after-good`：在 `DEV_TOOLING` 之后先生成 transform map，再用 `@ampproject/remapping`
- `after-bad`：在 `DEV_TOOLING` 之后只改 JS，不更新 map

结论是：

- `DEV_TOOLING` 之前修改，优先复用 `Source` 链条
- `DEV_TOOLING` 之后修改，如果会改变代码位置，必须先生成一层新的 transform map，再和原始 map remap
- `SourceMapSource` 适合“我已经有 `newCode + transformMap`，现在要把它作为一个带 map 的 `Source` 交回给 bundler”

## Demo 索引

- `before`：`ConcatSource` demo
- `before-replace`：`ReplaceSource` demo
- `before-sms`：`SourceMapSource` demo
- `after-good`：`@ampproject/remapping` demo
- `after-bad`：错误示例，对照组

## 安装与运行

```bash
pnpm install
pnpm run build:baseline
pnpm run build:before
pnpm run build:before-replace
pnpm run build:before-sms
pnpm run build:after-good
pnpm run build:after-bad
pnpm run verify
```

## `processAssets` 阶段顺序

```text
ADDITIONAL
PRE_PROCESS
DERIVED
ADDITIONS
OPTIMIZE
OPTIMIZE_SIZE
DEV_TOOLING
OPTIMIZE_INLINE
SUMMARIZE
REPORT
```

`DEV_TOOLING` 更适合作为“最终 sourcemap 基本可消费”的经验边界，而不是“此前绝对没有 map，此后才突然有 map”的硬边界。

## 什么时候用 `ConcatSource`

适合简单拼接，比如前面或后面加一小段固定文本。

优点：

- 写法简单
- 在 `DEV_TOOLING` 之前使用时，Rspack/Webpack 能继续维护 `Source` 链条
- 不需要你自己去读写 `.map`

示例见 [rspack.config.js](/Users/bytedance/projects/rspack-sourcemap-remapping-demo/rspack.config.js#L12) 里的 `BeforeDevToolingBannerPlugin`。

## 什么时候用 `ReplaceSource`

适合“我已经有一个现成的 `Source`，现在只想按 generated code 的位置做局部插入、替换或删除”。

它比 `ConcatSource` 更灵活，比 `SourceMapSource` 更省事，尤其适合：

- 给最终 bundle 某个位置插入一段小代码
- 替换固定区间的文案、包装代码或尾注
- 在 `DEV_TOOLING` 之前做小范围编辑，并继续复用 bundler 的 `Source` 链条

最常见的写法是：

```js
const source = new rspack.sources.ReplaceSource(asset.source, asset.name)
source.insert(0, '// injected before DEV_TOOLING with ReplaceSource\n')

compilation.updateAsset(asset.name, source, asset.info)
```

实现见 [rspack.config.js](/Users/bytedance/projects/rspack-sourcemap-remapping-demo/rspack.config.js#L80)。

这个项目里的 `before-replace` 变体已经验证过：在 `PROCESS_ASSETS_STAGE_OPTIMIZE` 阶段用 `ReplaceSource#insert` prepend 一行后，生成代码整体下移 1 行，但 sourcemap 仍然能映回源码第 12 / 14 行。

经验上可以这么选：

- 简单前后拼接：`ConcatSource`
- 按区间插入/替换/删除：`ReplaceSource`
- 已有 `newCode + transformMap`：`SourceMapSource`

## 什么时候用 `SourceMapSource`

适合这个场景：

- 你已经做了一次代码变换
- 你手里已经有 `newCode`
- 你也已经有“这次变换对应的新 map”，也就是 `newCode -> oldCode`
- 你希望把这个结果重新包装成一个带 sourcemap 的 `Source`

一句话说，`SourceMapSource` 适合“承接已有 map”，不适合“假装 bundler 会替你自动生成 map”。

### 正确思路

如果你在 `DEV_TOOLING` 之前做变换，推荐链路是：

```text
oldCode --(你的变换器)--> newCode
          产出 transformMap: newCode -> oldCode
```

然后把这组结果交给 `SourceMapSource`：

```js
new sources.SourceMapSource(
  newCode,
  asset.name,
  transformMap,
  oldCode,
  oldMap,
  true,
)
```

这样 bundler 还能继续沿着 `Source` 链条处理后续 sourcemap。

### 验证示例

这个项目里的 `before-sms` 变体会在 `PROCESS_ASSETS_STAGE_OPTIMIZE` 阶段：

1. 读取当前资产的 `code + map`
2. 用 `MagicString` prepend 一行，并生成 transform map
3. 用 `SourceMapSource` 把 `newCode + transformMap + oldCode + oldMap` 重新交给 Rspack

实现见 [rspack.config.js](/Users/bytedance/projects/rspack-sourcemap-remapping-demo/rspack.config.js#L38)。

核心代码是：

```js
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
```

### 什么时候不该用

下面这种思路是错的：

- 代码改了
- 但你没有生成新的 transform map
- 然后把旧 map 塞进 `SourceMapSource`

这和“只改 JS 不改 map”本质上是同一个问题，映射关系还是会漂。

## 什么时候用 `@ampproject/remapping`

这个 demo 没有删，仓库里保留的就是 `after-good` 这个变体。

适合在 `DEV_TOOLING` 之后修改最终产物时使用。

这里最容易写错的地方是：`remapping` 不会根据“改前代码/改后代码”自动推导出新 map。它只会合并你已经有的多层 map。

正确链路是：

```text
newCode -> oldCode -> originalSource
```

也就是：

1. 先通过 `MagicString`、Babel、SWC、esbuild 等工具拿到一层 `transformMap`
2. 再执行 `remapping([transformMap, originalMap], () => null)`

实现见 [rspack.config.js](/Users/bytedance/projects/rspack-sourcemap-remapping-demo/rspack.config.js#L124)。

直接运行这组 demo：

```bash
pnpm run build:after-good
```

它会在 `PROCESS_ASSETS_STAGE_SUMMARIZE` 阶段：

1. 读取最终 `bundle.js` 和 `bundle.js.map`
2. 用 `MagicString` 生成一层 `newCode -> oldCode` 的 transform map
3. 执行 `remapping([transformMap, originalMap], () => null)`
4. 回写新的 JS 和新的 `.map`

## 实测结果

验证脚本见 [verify.js](/Users/bytedance/projects/rspack-sourcemap-remapping-demo/scripts/verify.js#L1)。

脚本会直接在生成代码里找到目标语句，再反查 sourcemap，看它到底映回源码哪一行。

实测结果：

```text
[baseline]
total assignment: generated 45:2 -> original 12:0
console log: generated 47:2 -> original 14:0

[before]
total assignment: generated 46:2 -> original 12:0
console log: generated 48:2 -> original 14:0

[before-replace]
total assignment: generated 46:2 -> original 12:0
console log: generated 48:2 -> original 14:0

[before-sms]
total assignment: generated 46:2 -> original 12:2
console log: generated 48:2 -> original 14:2

[after-good]
total assignment: generated 46:2 -> original 12:0
console log: generated 48:2 -> original 14:0

[after-bad]
total assignment: generated 46:2 -> original 13:0
console log: generated 48:2 -> original 15:0
```

可以看到：

- `before` 成功
- `before-replace` 也成功
- `before-sms` 也成功，仍然映回源码第 12 / 14 行
- `after-good` 成功
- `after-bad` 失败，行号漂到了 13 / 15

## 最后的经验法则

- 简单拼接：优先 `ConcatSource`
- 按位置做小范围编辑：优先 `ReplaceSource`
- 已有 `newCode + transformMap`：用 `SourceMapSource`
- 最终产物后处理：先生成 transform map，再用 `@ampproject/remapping`
- 只有 `newCode` 没有新 map：不要指望 `SourceMapSource` 或 `remapping` 自动替你修复 sourcemap
