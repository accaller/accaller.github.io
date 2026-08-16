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

// 给 markdown 渲染出的 <img> 自动加 loading="lazy" 和 decoding="async"
// 让图片进入视口前不加载，大幅减少首屏请求与流量
function rehypeLazyImages() {
  return (tree) => {
    visit(tree, (node) => {
      if (node.type === 'element' && node.tagName === 'img') {
        const props = node.properties || (node.properties = {});
        // 只补默认值，不覆盖作者显式写明的属性
        if (props.loading == null) props.loading = 'lazy';
        if (props.decoding == null) props.decoding = 'async';
      }
    });
  };
}

function visit(node, fn) {
  fn(node);
  if (node.children) {
    for (const c of node.children) visit(c, fn);
  }
}

export default defineConfig({
  site: 'https://accaller.github.io',
  base: '/',
  markdown: {
    rehypePlugins: [rehypeLazyImages],
  },
});
