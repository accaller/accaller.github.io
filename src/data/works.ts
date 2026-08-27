/**
 * 作品数据：要新增/修改作品，只需在这个数组里加/改一条数据
 * 建议图片放 public/images/ 下，image 填 /images/文件名.jpg
 * 没有图片时填 gradient 渐变色作为占位
 */
export interface Work {
  title: string;        // 作品名称
  description: string;  // 一句话介绍
  category: string;     // 一级分类：CS / 缺氧 / 星露谷
  image?: string;       // 封面图路径（可选）
  gradient?: string;    // 无图时的渐变占位色（可选）
  link?: string;        // 外链（可选）：视频、网盘、其他页面
  date: string;         // 完成日期
  tags: string[];       // 标签
}

// 分类顺序：新增作品时 category 填这三个之一
export const workCategories = ['CS', '缺氧', '星露谷'] as const;

export const works: Work[] = [
  {
    title: 'CS2 残局 1v4 集锦',
    description: '示例作品：替换成你的高光剪辑视频，link 填 B 站/YouTube 地址。',
    category: 'CS',
    gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    date: '2026-08-01',
    tags: ['CS2', '剪辑'],
  },
  {
    title: 'Dust2 道具点位合集图',
    description: '示例作品：可以是自制教学图、数据表、MOD 等任何你想展示的东西。',
    category: 'CS',
    gradient: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
    date: '2026-06-20',
    tags: ['CS2', '教学'],
  },
  {
    title: '缺氧 500 周期永动基地',
    description: '示例作品：替换成你的基地截图或存档分享，图片放 public/images/ 后填 image 字段。',
    category: '缺氧',
    gradient: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
    date: '2026-07-15',
    tags: ['缺氧', '存档'],
  },
];
