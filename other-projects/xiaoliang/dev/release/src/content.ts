/**
 * Marketing copy for the landing page, kept in one place so it can be edited
 * without touching layout. Wording follows the product site at
 * `my-projects/xiaoliangweb-main`; anything derived from the billing backend
 * lives in `billing-api.ts` / `credits.ts` instead and must not be duplicated
 * here, or the two will drift.
 */
import agentConstruction from './assets/generated/agent-construction.webp'
import agentCost from './assets/generated/agent-cost.webp'
import agentQuantity from './assets/generated/agent-quantity.webp'
import agentReview from './assets/generated/agent-review.webp'
import type { GlyphName } from './icons'

export interface AgentFeature {
  title: string
  desc: string
}

export interface Agent {
  id: string
  title: string
  titleEn: string
  desc: string
  image: string
  alt: string
  /** Per-agent accent, used for the badge, check dots and panel wash. */
  color: string
  colorLight: string
  features: AgentFeature[]
  scenarios: string
}

export const AGENTS: Agent[] = [
  {
    id: '01',
    title: 'AI工程量计算助手',
    titleEn: 'Quantity Intelligence Agent',
    desc: '工程师查看 CAD 图纸，AI 自动识别构件并生成工程量清单，准确率超过 95%。',
    image: agentQuantity,
    alt: '工程师在屏幕上查看带构件识别框的建筑平面图',
    color: '#3B82F6',
    colorLight: '#EFF6FF',
    features: [
      { title: '智能识别', desc: '自动识别图纸构件，精准计算工程量' },
      { title: '多专业协同', desc: '土建、安装、装饰全覆盖' },
      { title: '智能套价', desc: '匹配定额，快速生成清单' },
      { title: '持续优化', desc: '历史数据学习，计算精度不断提升' },
    ],
    scenarios: '投标报价 · 进度款申报 · 结算审核',
  },
  {
    id: '02',
    title: 'AI造价分析助手',
    titleEn: 'Cost Intelligence Agent',
    desc: '造价工程师分析预算、成本和投资指标，AI 提供实时数据支持和智能建议。',
    image: agentCost,
    alt: '造价分析界面，展示成本构成与投资指标面板',
    color: '#10B981',
    colorLight: '#ECFDF5',
    features: [
      { title: '多维分析', desc: '人工、材料、机械成本一目了然' },
      { title: '实时监控', desc: '市场价格动态跟踪，调整造价估算' },
      { title: '智能比价', desc: '快速筛选最优方案' },
      { title: '数据报表', desc: '可视化报表，决策依据更清晰' },
    ],
    scenarios: '成本管控 · 投资估算 · 价值工程',
  },
  {
    id: '03',
    title: 'AI图纸审查助手',
    titleEn: 'Design Review Agent',
    desc: 'AI 自动发现规范问题和风险点，提升设计质量，减少返工成本。',
    image: agentReview,
    alt: '审图助手在图纸上标出规范问题',
    color: '#F59E0B',
    colorLight: '#FFFBEB',
    features: [
      { title: '规范检查', desc: '自动检查设计规范，识别违规项' },
      { title: '碰撞检测', desc: '提前发现施工冲突' },
      { title: '一致性校验', desc: '图纸信息完整性自动验证' },
      { title: '智能标注', desc: '精准标注问题，提升设计质量' },
    ],
    scenarios: '设计审查 · 施工前校核 · 质量管控',
  },
  {
    id: '04',
    title: 'AI施工管理助手',
    titleEn: 'Construction Management Agent',
    desc: '项目经理查看进度、风险预测和施工方案，实现智能化项目管理。',
    image: agentConstruction,
    alt: '施工管理场景中的进度与方案讨论界面',
    color: '#8B5CF6',
    colorLight: '#F5F3FF',
    features: [
      { title: '智能排程', desc: '动态调整施工计划' },
      { title: '资源优化', desc: '降低窝工浪费' },
      { title: '风险预警', desc: '提前识别延期隐患' },
      { title: '实时监控', desc: '现场数据采集，掌控施工状态' },
    ],
    scenarios: '项目管理 · 进度控制 · 现场协调',
  },
]

export const HERO_STATS = [
  { value: '10万+', label: '工程图纸学习' },
  { value: '100万+', label: '规范条目' },
  { value: '500万+', label: '工程参数解析' },
  { value: '100B+', label: '训练 Token' },
] as const

export interface InnovationCard {
  title: string
  titleEn: string
  desc: string
  accent: string
}

export const INNOVATION_CARDS: InnovationCard[] = [
  {
    title: '前沿算法联合研发',
    titleEn: 'Joint Algorithm R&D',
    desc: '与顶尖高校联合攻关行业大模型核心算法',
    accent: '#2563EB',
  },
  {
    title: '真实工程场景验证',
    titleEn: 'Real-World Validation',
    desc: '基于海量真实工程项目打磨，确保复杂场景精准度',
    accent: '#059669',
  },
  {
    title: '企业级生产力转化',
    titleEn: 'Enterprise Deployment',
    desc: '成熟的 API 与私有化方案，快速赋能业务系统',
    accent: '#7C3AED',
  },
]

export interface PhilosophyCard {
  icon: 'platform' | 'capability' | 'credits'
  title: string
  desc: string
}

export const PHILOSOPHY: PhilosophyCard[] = [
  {
    icon: 'platform',
    title: 'One Platform',
    desc: '所有用户使用同一套工程 AI 平台——CAD、BIM、Agent、Skill、工程数据库，全部开放。',
  },
  {
    icon: 'capability',
    title: 'Full Capability',
    desc: '没有 VIP、没有 Pro、没有功能限制。所有 AI 能力对所有用户全部开放，不因身份而异。',
  },
  {
    icon: 'credits',
    title: 'AI Credits',
    desc: '你购买的是 AI 计算资源，不是会员、软件或功能。用多少算多少，充值越多单位成本越低。',
  },
]

export interface EnterprisePlan {
  id: string
  name: string
  seats: string
  price: string
  credits: string
  seatExtension: string
  features: string[]
  popular: boolean
}

/**
 * Enterprise tiers are display-only. The backend has no seat, shared-pool or
 * admin-console model yet, so these cards route to sales rather than to the
 * desktop checkout, which would otherwise create orders nobody can fulfil.
 */
export const ENTERPRISE_PLANS: EnterprisePlan[] = [
  {
    id: 'team',
    name: 'Team 部门版',
    seats: '5 席位以内',
    price: '3,800',
    credits: '250,000',
    seatExtension: '¥400/席位/年（上限 15 席）',
    features: [
      'Cloud Workspace 工程 AI 云工作空间',
      '个人 / 团队 Skill 储存与管理',
      '企业项目与文档隔离管理',
      '团队 Skill / Agent 共享中心',
      '企业共享算力池控制台',
      '基础管理员权限',
    ],
    popular: true,
  },
  {
    id: 'business',
    name: 'Business 企业版',
    seats: '20 席位以内',
    price: '12,800',
    credits: '1,000,000',
    seatExtension: '¥350/席位/年（上限 50 席）',
    features: [
      'Team 全部功能',
      'Open API / Webhook 接口集成',
      '每年 1 次线上专属技术培训',
      '3 个管理员控制台',
      '1V1 专属客户成功经理（CSM）',
    ],
    popular: false,
  },
  {
    id: 'private',
    name: 'Private 私有定制版',
    seats: '不限席位',
    price: '商务定制',
    credits: '按需分配',
    seatExtension: '不限',
    features: [
      'Business 全部功能',
      '私有化局域网 / 混合云部署',
      '专属 Agent 深度定制开发',
      '国产化芯片与操作系统适配',
      '局域网数据隔离与审计日志',
      '专属技术支持',
    ],
    popular: false,
  },
]

export interface CreditPack {
  credits: string
  price: string
  unit: string
  desc: string
  popular: boolean
}

export const ENTERPRISE_CREDIT_PACKS: CreditPack[] = [
  { credits: '100,000', price: '¥800', unit: '¥0.0080/Credit', desc: '轻量补充包', popular: false },
  { credits: '500,000', price: '¥3,910', unit: '¥0.0078/Credit', desc: '进阶算力包', popular: true },
  { credits: '1,000,000', price: '¥7,570', unit: '¥0.0076/Credit', desc: '海量算力包', popular: false },
]

export interface PlatformCard {
  name: string
  requirements: string
  status: 'available' | 'planned'
  accent: string
  icon: 'windows' | 'macos' | 'linux'
}

export const PLATFORMS: PlatformCard[] = [
  { name: 'macOS', requirements: 'macOS 11.0+', status: 'planned', accent: '#35B878', icon: 'macos' },
  { name: 'Windows', requirements: 'Windows 10/11 (64-bit)', status: 'available', accent: '#1677FF', icon: 'windows' },
  { name: 'Linux', requirements: 'Ubuntu 20.04+', status: 'planned', accent: '#F59E0B', icon: 'linux' },
]

/**
 * The product site also lists "离线使用", which contradicts its own "保持网络
 * 连接" note below — every agent turn calls the hosted model. Reworded to the
 * local-client benefits that do hold.
 */
export const CLIENT_ADVANTAGES = [
  { title: '本地读图', desc: '图纸在本机解析，不必先上传整套图档' },
  { title: '本地存储', desc: '项目文件留在自己的电脑上，安全可控' },
  { title: '快速启动', desc: '本地客户端启动更快，响应更及时' },
  { title: '直连 CAD', desc: '与本机 CAD 软件配合，边看图边提问' },
] as const

export interface Prerequisite {
  icon: GlyphName
  title: string
  desc: string
}

export const PREREQUISITES: Prerequisite[] = [
  { icon: 'account', title: '注册账号', desc: '首次使用需要注册并登录晓量 AI 账号' },
  { icon: 'credits', title: '获取 Credits', desc: '注册即赠送 Credits，用完后在客户端内充值' },
  { icon: 'cad', title: '安装 CAD 软件', desc: '需要同时安装 CAD 软件配合使用' },
  { icon: 'network', title: '保持网络连接', desc: '使用期间电脑需要保持联网状态' },
]

export interface FaqItem {
  q: string
  a: string
}

/**
 * The first eight mirror the product site. The last three cover mechanics that
 * only exist because of how billing was actually built, and that a user hits
 * within the first session.
 */
export const FAQS: FaqItem[] = [
  {
    q: '为什么所有 AI 能力都开放？',
    a: '晓量 AI 采用「平台 + 算力」模式，而非传统 SaaS 的功能分级。我们相信工程师需要完整的工具链，而不是被套餐限制。你购买的只是 AI 计算资源（Credits），所有 CAD、BIM、Agent、Skill 等能力对所有用户全部开放。',
  },
  {
    q: '为什么晓量 AI 没有会员？',
    a: '会员制意味着功能分级和限制，这与我们的理念相悖。晓量 AI 让所有用户使用同一套完整的 AI 能力，收费的唯一依据是 AI 计算资源的消耗量（Credits），而不是身份或套餐等级。',
  },
  {
    q: 'AI Credits 是什么？',
    a: 'Credits 是晓量 AI 平台的 AI 计算资源计量单位。每次 AI 处理文件（如分析 CAD 图纸、解析 BIM 模型、阅读 PDF 规范）都会消耗一定数量的 Credits。消耗量取决于文件大小、复杂度、AI 推理深度和输出内容规模。',
  },
  {
    q: 'Credits 有效期多久？',
    a: '个人版 Credits 自购买之日起 12 个月内有效。企业版共享算力池中的 Credits 随企业年费绑定，有效期 1 年。到期后未使用的 Credits 将自动失效；同时持有多个算力包时，先扣最快到期的那一份。',
  },
  {
    q: 'Credits 不足怎么办？',
    a: '直接购买补充包即可，无需升级任何套餐。晓量 AI 没有 VIP、没有 Pro、没有功能限制——你只需要充值 Credits 就能继续使用全部 AI 能力。',
  },
  {
    q: '企业为什么需要平台授权？',
    a: '企业购买平台授权，获得的是组织能力——Cloud Workspace 工程 AI 云工作空间、多人协同的项目管理、沉淀最佳实践的 Skill / Agent 共享中心、统一采购分配的共享 Credits 算力池。AI 能力本身对所有用户都开放，企业授权提供的是团队协作和管理能力。Team 版起步价 ¥3,800/年，含 5 席位和 250,000 Credits。',
  },
  {
    q: '企业席位如何扩展？',
    a: 'Team 版默认 5 席位，可按 ¥400/席位/年 扩展（上限 15 席）；Business 版默认 20 席位，可按 ¥350/席位/年 扩展（上限 50 席）；Private 版不限席位。席位扩展费用与企业年费同步结算。',
  },
  {
    q: '企业算力池如何补充？',
    a: '企业共享算力池支持弹性充值：轻量补充包 ¥800/10 万 Credits、进阶算力包 ¥3,910/50 万 Credits、海量算力包 ¥7,570/100 万 Credits。充值越多单位成本越低，适合项目突发高峰或全员高频使用场景。',
  },
  {
    q: 'Credits 具体怎么扣？调用失败收费吗？',
    a: '调用前只检查余额是否为正，调用结束后按模型实际回传的 Token 结算。失败或拿不到用量的调用不计费。单次任务允许把余额扣成负数，下一次调用才会被拦住，避免一张图做到一半被掐断。',
  },
  {
    q: '在哪里付费？网页上能买吗？',
    a: '网页不收款。下载不需要注册，付费在桌面客户端内微信扫码完成。官网展示的价格与客户端读的是同一个接口，不会出现两边对不上的情况。',
  },
  {
    q: '企业版能在客户端里直接下单吗？',
    a: '暂时不能。个人三档现在就能自助购买；企业的席位、共享算力池、管理员控制台和 Open API 走商务洽谈，由人工确认后开通，避免产生无法履约的订单。',
  },
]
