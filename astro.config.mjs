// @ts-check
import { defineConfig } from 'astro/config';

// ==================== 上线前必看 ====================
// 场景 A（推荐）：GitHub 仓库命名为 <你的用户名>.github.io
//   → site 改成 https://<你的用户名>.github.io，base 保持 '/'
//
// 场景 B：仓库是其他名字（如 game-guide-site）
//   → site 保持 https://<你的用户名>.github.io
//   → base 改成 '/game-guide-site'（即 '/仓库名'）
// ====================================================

// markdown 图片处理：给所有 <img> 自动加 loading="lazy" + decoding="async"
// 注：不做 figcaption 转换——语雀 markdown 里的 alt 大多是「屏幕截图 XXX.png」这种
// 默认文件名，不是真正的图注；真正的图注是用户在图下单独写的段落，会保留
// 原生的 style（颜色、居中）输出，和语雀文档视觉一致
function rehypeImages() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type === 'element' && node.tagName === 'img') {
        const props = node.properties || (node.properties = {});
        if (props.loading == null) props.loading = 'lazy';
        if (props.decoding == null) props.decoding = 'async';
      }
    });
  };
}

function visit(node, fn) {
  fn(node);
  if (node.children && Array.isArray(node.children)) {
    for (const c of node.children) visit(c, fn);
  }
}

export default defineConfig({
  site: 'https://accaller.github.io',
  base: '/',
  markdown: {
    rehypePlugins: [rehypeImages],
  },
});
