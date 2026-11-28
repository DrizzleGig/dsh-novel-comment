// 发布一条龙：自检（失败即拒发）→ 校验 npm 身份 → 发布 → 校 registry。
//
// 用法：
//   node scripts/publish.mjs               # 只跑自检，不发布（默认）
//   node scripts/publish.mjs --publish     # 自检全绿才发布
//
// 自检项（任一失败就停）：
//   1. 版本一致：package.json / CHANGELOG 首条 / README 标注
//   2. 包身份一致：客户端模块 id / remote 契约 package / cordis 补丁 name
//   3. 语法检查 + 构建 + typecheck
//   4. 单元与集成测试（fail 必须为 0）
//   5. 数据目录统一为 .dsh-novel-comment（不再写旧目录）
//   6. 打包清单包含发布必需文件
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const registry = 'https://registry.npmjs.org'
const flags = new Set(process.argv.slice(2))
const publishMode = flags.has('--publish')

const REQUIRED_PACK = [
  'index.js',
  'client.js',
  'lib/reader-core.mjs',
  'lib/remote.js',
  'lib/remote-contract.js',
  'lib/typert-bind.js',
  'cordis.patch.yml',
  'icon.svg',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'docs/DETAIL.md',
]

const failures = []
const fail = (message) => {
  failures.push(message)
  console.error('  ✖ ' + message)
}
const ok = (message) => console.log('  ✓ ' + message)

function section(label) {
  console.log('\n▶ ' + label)
}

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8')
}

function node(args, { allowFail = false, quiet = false } = {}) {
  try {
    const out = execFileSync(process.execPath, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (!quiet) {
      const tail = out.trim().split('\n').slice(-3).join('\n')
      if (tail) console.log(tail)
    }
    return { ok: true, out, code: 0 }
  } catch (error) {
    const combined = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim()
    console.error(combined.split('\n').slice(-8).join('\n'))
    if (!allowFail) process.exitCode = 1
    return { ok: false, out: combined, code: Number.isInteger(error.status) ? error.status : 1 }
  }
}

const localNpmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

function npm(args, { allowFail = false } = {}) {
  const candidates = []
  if (process.env.npm_execpath) candidates.push([process.execPath, [process.env.npm_execpath, ...args]])
  candidates.push([process.execPath, [localNpmCli, ...args]])
  if (process.platform === 'win32') candidates.push([process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args]])
  else candidates.push(['npm', args])

  let last = { ok: false, out: '' }
  for (const [file, argv] of candidates) {
    try {
      const out = execFileSync(file, argv, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { ok: true, out: out.trim() }
    } catch (error) {
      last = { ok: false, out: `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() }
      if (error.code !== 'ENOENT') break
    }
  }
  if (!allowFail) {
    console.error(last.out.split('\n').slice(-8).join('\n'))
    process.exitCode = 1
  }
  return last
}

console.log(`${pkg.name} ${pkg.version} · 发布自检${publishMode ? '（将发布）' : '（只自检）'}`)

// ── 1. 版本一致 ───────────────────────────────────────────────────────────────
section('版本一致')
if (pkg.private === true) fail('package.json 还是 private: true，npm 会拒绝发布')
else ok('不是 private 包')

const changelogVersion = (read('CHANGELOG.md').match(/^##\s+(\d+\.\d+\.\d+)/mu) ?? [])[1] ?? null
if (changelogVersion === pkg.version) ok('CHANGELOG 首条 = ' + pkg.version)
else fail(`CHANGELOG 首条是 ${changelogVersion ?? '(没有)'}，package.json 是 ${pkg.version}`)

if (read('README.md').includes('`' + pkg.version + '`')) ok('README 标注 ' + pkg.version)
else fail('README 里没有 `' + pkg.version + '`：版本号与文档不一致')

// ── 2. 包身份一致 ─────────────────────────────────────────────────────────────
section('包身份一致（客户端 id / remote 契约 / cordis 补丁）')
const identity = [
  ['client.js', `id: "${pkg.name}"`, '客户端模块 id'],
  ['client.js', `package: "${pkg.name}"`, '客户端 remote package'],
  ['client.js', `${pkg.name}#readerPanel/`, '客户端 invocation id'],
  ['lib/remote-contract.js', `${pkg.name}#readerPanel/`, 'Host remote 契约 invocation id'],
  ['lib/remote.js', `package: "${pkg.name}"`, 'Host remote package'],
  ['cordis.patch.yml', `name: '${pkg.name}'`, 'cordis 补丁 name'],
  ['cordis.patch.yml', `name: '${pkg.name}/remote'`, 'cordis 补丁 remote name'],
]
for (const [file, needle, label] of identity) {
  if (read(file).includes(needle)) ok(`${label} = ${pkg.name}`)
  else fail(`${file} 里找不到 ${label}：${needle}`)
}

// ── 3. 数据目录未被误改 ───────────────────────────────────────────────────────
section('数据目录统一')
const DATA_DIR = '.dsh-novel-comment'
const dataFiles = ['src/adapter/storage.ts', 'src/adapter/adapter.ts', 'src/core/domain.ts', 'src/reader/types.ts']
for (const file of dataFiles) {
  if (read(file).includes(DATA_DIR)) ok(`${file} 仍写 ${DATA_DIR}`)
  else fail(`${file} 找不到 ${DATA_DIR}：数据目录不一致会让工具读写不到同一份数据`)
}

// ── 4. 语法 + 构建 + typecheck ────────────────────────────────────────────────
section('语法检查')
const checkTargets = ['index.js', 'client.js', 'lib/remote.js', 'lib/remote-contract.js', 'lib/typert-bind.js']
let syntaxOk = true
for (const file of checkTargets) {
  const result = node(['--check', file], { allowFail: true, quiet: true })
  if (!result.ok) {
    syntaxOk = false
    fail(`${file} 语法检查失败`)
  }
}
if (syntaxOk) ok(`${checkTargets.length} 个入口语法检查通过`)

section('构建')
const build = node(['scripts/build.mjs'], { quiet: true })
if (build.ok && existsSync(path.join(root, 'lib/reader-core.mjs'))) {
  const size = statSync(path.join(root, 'lib/reader-core.mjs')).size
  if (size > 100_000) ok(`lib/reader-core.mjs ${Math.round(size / 1024)} KB`)
  else fail(`lib/reader-core.mjs 只有 ${size} 字节，构建产物可疑`)
} else fail('构建失败或没有生成 lib/reader-core.mjs')

section('typecheck')
const tc = npm(['run', 'typecheck'], { allowFail: true })
if (tc.ok) ok('tsc 通过')
else fail('typecheck 失败')

// ── 5. 测试 ───────────────────────────────────────────────────────────────────
section('测试')
const tests = node(['scripts/test.mjs'], { quiet: true })
const passCount = (tests.out.match(/ℹ pass (\d+)/u) ?? [])[1]
const failCount = (tests.out.match(/ℹ fail (\d+)/u) ?? [])[1]
if (tests.ok && failCount === '0') ok(`测试 ${passCount ?? '?'} 条全过`)
else fail(`测试未全过（pass ${passCount ?? '?'} / fail ${failCount ?? '?'}）`)

// ── 6. 打包清单 ───────────────────────────────────────────────────────────────
section('打包清单')
const pack = npm(['pack', '--dry-run', '--json'], { allowFail: true })
if (!pack.ok) fail('npm pack 不可用或失败')
else {
  let files = []
  try {
    const parsed = JSON.parse(pack.out.slice(pack.out.indexOf('[')))
    files = (parsed[0]?.files ?? []).map((item) => String(item.path).replace(/\\/gu, '/'))
  } catch {
    fail('解析 npm pack 输出失败')
  }
  if (files.length) {
    const missing = REQUIRED_PACK.filter((needle) => !files.includes(needle))
    if (missing.length === 0) ok(`打包 ${files.length} 个文件，必需文件齐全`)
    else fail('打包缺少：' + missing.join(', '))
    const leaked = files.filter((file) => file.startsWith('node_modules/') || file.endsWith('.test.ts'))
    if (leaked.length) fail('打包混入开发文件：' + leaked.slice(0, 5).join(', '))
    else ok('没有 node_modules / 测试文件混入')
  } else fail('npm pack 没有返回文件清单')
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✖ 自检未通过（${failures.length} 项），拒绝发布：`)
  for (const item of failures) console.error('  · ' + item.split('\n')[0])
  process.exit(1)
}

console.log('\n✓ 自检全部通过')
if (!publishMode) {
  console.log('  这是自检模式：加 --publish 才会真正发布。')
  process.exit(0)
}

// ── 7. 发布 ───────────────────────────────────────────────────────────────────
console.log('\n▶ npm whoami')
const who = npm(['whoami', `--registry=${registry}`])
if (!who.ok) {
  console.error('\n✖ npm 未登录。先执行：npm login --registry=' + registry)
  process.exit(1)
}
console.log(who.out)

console.log(`\n▶ npm publish ${pkg.version}`)
try {
  execFileSync(process.execPath, [localNpmCli, 'publish', `--registry=${registry}`, '--access', 'public'], {
    cwd: root,
    stdio: 'inherit',
  })
} catch {
  console.error('\n✖ 发布失败：402/403/404/EOTP 多半是登录态、2FA 或包名占用，处理后重试。')
  process.exit(1)
}

console.log('\n▶ 校验 registry')
const want = `${pkg.name}@${pkg.version}`
let seen = null
for (let attempt = 1; attempt <= 40; attempt += 1) {
  try {
    const res = await fetch(`${registry}/${pkg.name}/${pkg.version}?t=${Date.now()}`, {
      headers: { 'cache-control': 'no-cache' },
    })
    if (res.ok) {
      const doc = await res.json()
      if (doc.version === pkg.version) {
        seen = doc.version
        break
      }
      seen = `文档版本 ${doc.version}`
    } else {
      seen = `HTTP ${res.status}`
    }
  } catch (error) {
    seen = `fetch 失败：${error?.message ?? error}`
  }
  if (attempt % 5 === 0) console.log(`  还在等 registry（${attempt * 6}s）：${seen}`)
  if (attempt < 40) await new Promise((resolve) => setTimeout(resolve, 6000))
}
const tags = npm(['view', pkg.name, 'dist-tags', `--registry=${registry}`, '--prefer-online'], { allowFail: true })
console.log('dist-tags:', tags.ok ? tags.out.replace(/\s+/gu, ' ') : '(查不到)')
if (seen !== pkg.version) {
  console.error(`\n✖ registry 上没有 ${want}（最后一次：${seen}）。发布可能未生效。`)
  process.exit(1)
}
console.log(`${want} ✓`)
console.log(`\n✓ 已发布 ${pkg.name}@${pkg.version}`)
