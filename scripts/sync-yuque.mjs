#!/usr/bin/env node
/**
 * 语雀自动同步脚本（主要在 GitHub Actions 里运行，也可本地手动跑）
 *
 * 用法：
 *   YUQUE_TOKEN=xxx node scripts/sync-yuque.mjs
 *
 * 流程：
 *   1. 读取 yuque.config.json 里的知识库列表（每个 repo 对应一个 category）
 *   2. 下载 yuque-exporter
 *   3. 逐库导出 Markdown 到 .yuque-cache/
 *   4. 以 --update 模式导入（保留已有 frontmatter，只刷新正文）
 *   5. **每个库单独跑 --prune**：语雀里已删除的文档自动从 guides 中删除
 *   6. 若有文件变动，交给 git 判断（workflow 里检测并提交）
 *
 * 环境变量：
 *   YUQUE_TOKEN        必填
 *   YUQUE_EXPORTER_BIN 可选
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, 'yuque.config.json');
const CACHE_DIR = join(ROOT, '.yuque-cache');
const EXPORTER_PATH = join(CACHE_DIR, 'yuque-exporter');

const EXPORTER_URL =
  'https://github.com/bkm016/yuque-exporter/releases/latest/download/yuque-exporter-linux-amd64';

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function main() {
  const token = process.env.YUQUE_TOKEN;
  if (!token) {
    fail(
      '缺少 YUQUE_TOKEN 环境变量。\n' +
        '  · GitHub 上：仓库 Settings → Secrets and variables → Actions → New repository secret，名称 YUQUE_TOKEN\n' +
        '  · 本地跑：YUQUE_TOKEN=你的token node scripts/sync-yuque.mjs\n' +
        '  · Token 获取：https://www.yuque.com/settings/tokens'
    );
  }

  if (!existsSync(CONFIG_PATH)) {
    fail('找不到 yuque.config.json');
  }

  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  if (!config.user || !Array.isArray(config.repos) || config.repos.length === 0) {
    fail('yuque.config.json 配置不完整：需要 user 和 repos');
  }
  if (config.user === '你的语雀用户名' || config.user === 'yuqueyonghu-gwdsm5') {
    fail('yuque.config.json 还是示例 user，请改成你的真实语雀用户名。');
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const exporterBin = process.env.YUQUE_EXPORTER_BIN || ensureExporter();

  for (const { repo, category } of config.repos) {
    if (!repo || !category) fail('yuque.config.json 中每条 repos 需要 repo 和 category 两个字段。');

    console.log(`\n========== 同步知识库：${category}（${repo}）==========`);

    const outDir = join(CACHE_DIR, repo);
    mkdirSync(outDir, { recursive: true });

    execSync(`${exporterBin} -token ${token} -user ${config.user} -repo ${repo} -output ${outDir} -format markdown`, {
      stdio: 'inherit',
    });

    // 关键：每导完一个库就立刻 import + prune（带 --update --prune）
    execSync(`node scripts/import-yuque.mjs ${outDir} ${category} --update --prune`, {
      stdio: 'inherit',
      cwd: ROOT,
    });
  }

  console.log('\n✅ 全部知识库同步完成（含删除）。查看 git status 确认变动。');
}

function ensureExporter() {
  if (existsSync(EXPORTER_PATH)) return EXPORTER_PATH;

  console.log('⬇️  下载 yuque-exporter ...');
  mkdirSync(CACHE_DIR, { recursive: true });
  execSync(`curl -fL --retry 3 -o ${EXPORTER_PATH} ${EXPORTER_URL}`, { stdio: 'inherit' });
  execSync(`chmod +x ${EXPORTER_PATH}`);
  return EXPORTER_PATH;
}

main();
