/**
 * 学习区 · 小程序数据
 * 页面：/learning/ 与 /learning/[slug]
 * 加新小程序：在此数组末尾加一条，仿照第一条金价油价示例。
 * 压缩包放 public/downloads/，运行截图放 public/images/learning/。
 */
export interface DownloadItem {
  label: string;   // 按钮文字，如 '下载 exe 程序包'
  url: string;     // 下载地址：站内 /downloads/xxx.zip 或网盘外链 https://
  size?: string;   // 大小说明，如 '51 MB'（可选）
  external?: boolean; // true=网盘外链新窗口打开；false=站内直接下载
  disabled?: boolean; // true=占位按钮（灰色不可点击，如"即将上线"）
}

export interface LearningItem {
  slug: string;          // 详情页地址标识（英文小写，如 'gold-oil-monitor'）
  title: string;         // 小程序名称
  version: string;       // 版本号，如 'v1.0'
  description: string;   // 一句话简介（卡片 + SEO）
  lang: string;          // 技术栈/语言
  stack: string[];       // 依赖/技术标签
  platform: string;      // 运行平台
  date: string;          // 发布日期
  image?: string;        // 卡片/详情主图（可选）
  gradient?: string;     // 无图时的占位渐变
  // 下载入口：可多个（如 exe 程序包 + 源码包）
  downloads: DownloadItem[];
  // 兼容单文件（有 download 则忽略下方 file/fileSize）
  file?: string;
  fileSize?: string;
  detail: {
    intro?: string;      // 一句话功能概述
    features?: string[]; // 功能列表
    requirements?: string; // 运行环境要求
  };
}

export const learning: LearningItem[] = [
  {
    slug: 'gold-oil-monitor',
    title: '金价油价查询小程序',
    version: 'v1.0',
    description: '人民币/美元汇率换算 · 国际金价 · 国内油价 一站查。',
    lang: 'Python',
    stack: ['tkinter', 'PyInstaller'],
    platform: 'Windows · 免安装',
    date: '2026-09-06',
    gradient: 'linear-gradient(135deg, #E6F1FB, #B5D4F4)',
    // 注意：exe(51MB) 建议放网盘外链，避免塞进 GitHub 仓库导致臃肿。
    // 拿到网盘链接后，把下面 exe 那条 url 改成网盘链接并加 external:true。
    downloads: [
      {
        label: '下载 exe 程序包',
        url: '#',                  // 上传网盘后改这里为网盘链接，并加 external:true
        size: '即将上线 · 51 MB',   // 占位文案
        external: false,
        disabled: true,            // 详情页渲染为灰色不可点击
      },
      {
        label: '下载源码',
        url: '/downloads/gold-oil-monitor-src.zip',
        size: '179 KB',
        external: false,
      },
    ],
    detail: {
      intro: '国际金价是按美元计价的，所以小程序同时拉取实时汇率，把金价自动换算成人民币展示，一并查询国内成品油价格。',
      features: [
        '国际金价（伦敦金，美元/盎司）实时查询',
        '实时人民币/美元汇率换算，金价自动转人民币',
        '查询国内 92# / 95# / 0# 柴油零售价',
        '简单图形界面，一键刷新',
      ],
      requirements: 'exe 程序包：Windows 免安装，解压后双击「金价油价查询.exe」即可运行，无需安装 Python。想改代码的可下载源码（需 Python + 依赖，见源码包内 README）。',
    },
  },
];