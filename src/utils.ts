/**
 * 拼接站点基础路径。
 * 当 astro.config.mjs 里 base 为 '/' 时（仓库命名为 <用户名>.github.io），
 * 本函数返回原路径，无需关心。
 */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}${path}`;
}
