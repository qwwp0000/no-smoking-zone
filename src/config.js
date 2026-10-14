// ---------------------------------------------------------------------------
// 集中配置：所有数值均为待试玩调整的参数（对应策划案 0.3 / 11.9）
// 修改本文件即可平衡游戏，不需要动核心逻辑。
// ---------------------------------------------------------------------------

export const CONFIG = {
  // 世界基准
  tile: 1,

  // 相机：高角度等距视角，参考图的立体模型感
  camera: {
    fov: 30,
    rotY: Math.PI * 0.25,      // 4 个方向里的 45°，标准等距朝向
    pitch: 0.92,               // 俯角（弧度），越大越接近俯视
    lookAtLift: 0.4,           // 视点抬高，避免地面被压扁
    viewScale: 0.62,           // 视野缩放：1=完整框住玩家可活动区域，越小镜头越近
    follow: true,              // 是否跟随玩家
    followStrength: 1,         // 跟随程度：0=固定居中于活动区，1=始终以玩家为中心
    followLerp: 3.6,
    edgePadding: 0.55,         // 距离边缘留白系数
  },

  // 通用角色运动
  agent: {
    npcSpeed: 1.75,
    walkAnim: 7.5,
    arriveEpsilon: 0.09,
  },

  // 玩家
  player: {
    speed: 3.6,
    radius: 0.34,
    maxHealth: 100,
    interactRange: 1.9,        // 与实体交互的最大距离（格）
    operateTime: 1.4,          // 通用操作耗时（秒）
  },

  // 健康与烟雾伤害
  health: {
    smokeDamage: 21,           // 浓度=1 时每秒伤害
    exposurePosFactor: 1.0,    // 位置影响系数
    ventRecover: 17,           // 有效通风安全区每秒恢复
    cleanRecover: 1.0,         // 洁净空气（无通风）每秒缓慢恢复
    // 视为“洁净空气”的浓度阈值：浓度 ≥ 此值即判定为暴露，禁止任何回血。
    // 必须 ≤ smoke.renderThreshold，否则肉眼可见的烟雾里还会回血（旧 bug）。
    cleanThreshold: 0.018,
    warnHealth: 65,            // 血条变黄阈值（开始震动提示）
    lowHealthWarn: 35,         // 血条变红阈值（震动加剧）
    ventSafeField: 0.32,       // 通风场高于该值才算“有效安全区”

    // 低血量震动反馈：黄条区间轻微抖动提示，红条区间剧烈抖动
    // 画面（相机）与血条（HUD）使用同一套判定逻辑，仅幅度/频率参数分开
    shake: {
      // —— 画面抖动（相机位置 + 镜头微倾斜，世界单位）——
      warnAmp: 0.06,           // 黄条区间相机抖动幅度（已按反馈调低）
      dangerAmp: 0.15,         // 红条区间相机抖动幅度
      warnFreq: 20,            // 黄条区间抖动频率
      dangerFreq: 32,          // 红条区间抖动频率
      warnRot: 0.005,          // 黄条区间镜头旋转幅度（弧度）
      dangerRot: 0.015,        // 红条区间镜头旋转幅度
      // —— 血条抖动（HUD 元素位移，单位：像素）——
      barWarnAmp: 3,           // 黄条区间血条抖动幅度(px)
      barDangerAmp: 8,         // 红条区间血条抖动幅度(px)
      barWarnFreq: 18,         // 黄条区间血条抖动频率
      barDangerFreq: 30,       // 红条区间血条抖动频率
      // —— 震动时的咳嗽音效（使用「音效」目录中的 Cough1 / Cough2）——
      coughWarnInterval: 1.8,  // 黄条区间咳嗽(Cough1)重复间隔（秒）
      coughDangerInterval: 1.0,// 红条区间咳嗽(Cough2)重复间隔（秒）
    },
  },

  // 烟雾网格模拟
  smoke: {
    max: 1.0,                  // 浓度上限（归一化）
    diffusion: 0.24,           // 扩散速率（0~0.25 稳定）
    decay: 0.055,              // 自然消散 / 秒
    ventRemoval: 1.8,          // 通风区域额外清除系数 / 秒
    ventRadius: 4.6,           // 通风影响半径（格）
    emitHeight: 0.85,
    renderThreshold: 0.018,    // 低于此浓度不再显示烟团（调低让稀薄烟雾也可见）
    puffRadius: 0.54,          // 烟团基础半径
    puffOpacity: 0.62,         // 烟团不透明度（提高以突出白色烟雾）
  },

  // 通风设备
  vent: {
    operateTime: 1.6,          // 开关操作耗时
    startupDelay: 1.2,         // 开启后生效延迟（教学用：先看到积累）
  },

  // 窗户（第 2~4 关的墙壁装饰）：在相对的两面墙里随机选一对各开一扇，
  // 每扇窗占墙 span 格，窗户正前方的 span×depth 格成为「无烟安全区」。
  window: {
    fromLevel: 2,              // 生效起始关卡 id（含）；第 1 关不开窗
    toLevel: 4,                // 生效结束关卡 id（含）
    count: 2,                  // 每关开几扇窗（分别落在相对的两面墙上，避免两扇挤在一起）
    span: 2,                   // 每扇窗占用墙格数（横向）
    depth: 2,                  // 窗户前方洁净区深度（格）；span×depth = 4 格
    clearRate: 3.2,            // 洁净区额外烟雾清除系数 / 秒
    safeCap: 0.004,            // 洁净区烟雾浓度上限（低于可见阈值 → 肉眼无烟）
    safeField: 1,              // 洁净区对玩家的安全区强度（> health.ventSafeField 即回血）
    npcAvoidRadius: 2,         // NPC 不在窗户（含洁净区）该切比雪夫半径内抽烟
    seed: 20261014,            // 随机种子（同关卡窗户位置稳定，便于试玩与复现）
  },

  // NPC 分级行为参数（对应策划案 3.5）
  npc: {
    1: {                       // 一级：配合型
      emission: 0.55,
      smokingDuration: 26,
      remindReaction: 'comply',
      managerReaction: 'comply',
      signReaction: true,
      signReactDelay: 3.0,     // 看到正确提示牌后自行离开的延迟
    },
    2: {                       // 二级：无视型
      emission: 0.7,
      smokingDuration: 38,
      remindReaction: 'ignore',   // 普通提醒无效
      managerReaction: 'comply',  // 管理介入才有效
      signReaction: false,
      relocateChance: 0.6,        // 被提醒后换个位置继续抽（行为线索）
    },
    3: {                       // 三级：顽固型
      emission: 0.85,
      smokingDuration: 52,
      remindReaction: 'ignore',
      managerReaction: 'partial', // 管理介入只提高配合度，不直接解决
      signReaction: false,
      fakeCompliesFirst: 1,       // 前 1 次“答应”必定是假意配合（可被观察、可学习）
      deceptionChance: 0.45,      // 之后假意配合的概率
      negotiateNeed: 2,           // 需要累计的配合点数
    },
    // 三级 NPC-2：争论型（对应策划案 3.7 / 21，代码标记为 A）
    argue: {
      variant: 'argue',
      emission: 0.9,
      smokingDuration: 9999,      // 永不自然熄灭：提醒和管理介入都不动
      remindReaction: 'ignore',
      managerReaction: 'refuse',  // 管理介入完全无效（权威对这类人没用）
      signReaction: false,
      triggerRemind: 2,           // 第 2 次提醒时触发话术对辩（可调）
      cooldown: 12,               // 输掉/退出后的冷却秒数，冷却内无法再次触发
      negotiateNeed: 999,         // 争论型不走普通交涉
    },
  },

  // 话术对辩（对应策划案 21.2～21.6：属性克制 · 气势条 · 限时 · 强反馈）
  argue: {
    handSize: 3,                 // 每回合可选的玩家话术牌数量
    roundTime: 6,                // 每回合出牌限时（秒），超时=被抢白
    timeLimit: 40,               // 整场限时（秒），耗尽=输
    meterStart: 50,              // 气势条起始值
    meterMax: 100,               // 气势条上限（满=赢）
    advantageDelta: 16,          // 克制：+16
    neutralDelta: 4,             // 同属性：+4
    disadvantageDelta: 14,       // 被克：−14
    timeoutPenalty: 14,          // 超时未出牌：按被克结算
    lockPenalty: 14,             // 连续同属性被看穿：按被克结算
    repeatAttributeLock: true,   // 是否启用“连续同属性被看穿”
    loseAnger: 10,               // 输掉时愤怒值上升
    respawnDelay: 220,           // 结束后结算展示时长（毫秒）
    // 玩家劝说话术牌（属性：理/情/势，对应克制环 理克情→情克势→势克理）
    deck: [
      { id: 'li1', attr: 'li', text: '「这里是非吸烟区，吸烟区在那边——牌子上写着。」' },
      { id: 'li2', attr: 'li', text: '「别讲感觉：通风再强，也压不住二手烟颗粒。」' },
      { id: 'li3', attr: 'li', text: '「烟头随手一摁，地毯起火算谁的？这是安全问题。」' },
      { id: 'qing1', attr: 'qing', text: '「我懂你压力大，可旁边那位孕妇一直捂着鼻子。」' },
      { id: 'qing2', attr: 'qing', text: '「一根烟一时爽，孩子回家闻到的是你一身烟味。」' },
      { id: 'qing3', attr: 'qing', text: '「你要真出点毛病，最担心的是你家里人。」' },
      { id: 'shi1', attr: 'shi', text: '「你看这一屋子人的眼神，你要当那个让大家躲着走的人吗？」' },
      { id: 'shi2', attr: 'shi', text: '「大家不吭声不是没意见，是不想跟你吵。」' },
      { id: 'shi3', attr: 'shi', text: '「管理员就在那边，你要闹到全车人都知道？」' },
    ],
    // NPC 抗拒台词（属性对玩家可见）
    npcLines: [
      { attr: 'li', text: '「我就抽一根，碍着谁了？」' },
      { attr: 'li', text: '「又不是我一个人抽，凭啥盯着我？」' },
      { attr: 'qing', text: '「我加班到半夜，就靠这一口撑口气。」' },
      { attr: 'qing', text: '「就这一根，抽完我就走，别逼我。」' },
      { attr: 'shi', text: '「你算老几？管这么宽？」' },
      { attr: 'shi', text: '「我在这儿抽了好几年，轮得到你说？」' },
    ],
    opening: '他一把掐了半截烟：「来，你今天把我说服了，我就走。」',
    winLine: '他沉默了半晌，把烟摁灭：「……行，我说不过你。」',
    loseLine: '他嗤笑一声：「就这？那我还是接着抽。」',

    // 首次进入话术对辩的「聚焦式」手把手教学（只在完整跑完一次后不再触发）
    // 形式：被教的区域「亮起来」并出现箭头，其余区域变灰且不可点击；
    //       read 步骤必须点「下一步」，play 步骤必须点高亮的那张牌，才继续。
    tutorial: {
      enabled: true,
      startMeter: 60,        // 教学局气势起点：高于正常 50，留出试错空间
      roundTime: 120,        // 教学局每回合限时（教学期间计时冻结，这里给个宽松值）
      timeLimit: 120,        // 教学局整场限时
      healthFloor: 45,       // 教学期间健康下限：读教学较慢但主循环仍在扣血，设下限避免被熏死
                             // （红条仍会实时下降，让「对辩时在掉血」这一课成立）
      spotPad: 8,            // 聚光灯比目标元素外扩的像素
      // 教学用固定 NPC 出牌顺序（属性固定，方便逐张讲克制：势 → 情）
      npcCards: [
        { attr: 'shi', text: '「你们就是看我不顺眼。我抽我的，碍着谁了？」' },
        { attr: 'qing', text: '「我加了一整天班，就靠这一口缓缓，你也要来管我？」' },
      ],
      // 教学用固定玩家手牌属性序列（每回合一组，保证每回合都有关键的克制牌）
      hands: [
        ['qing', 'li', 'shi'],   // 对「势」→ 情可克制
        ['li', 'qing', 'shi'],   // 对「情」→ 理可克制
      ],
      // 教学脚本：按规则顺序推进
      // 出牌位置 → 话术位置 → 气势条 → 属性克制 → 看穿 → 限时 → 掉血 → 退出
      // target = 聚光灯指向的界面区域（play 步骤固定指向「推荐出的那张牌」）
      // mode='play' 时需要玩家点高亮牌才继续，其余步骤点「下一步」继续
      steps: [
        { id: 'intro',  target: 'hand',   text: '<b>手把手带你打一场</b>。下面三张是你的话术牌，点它打出。' },
        { id: 'npc',    target: 'npc',    text: '<b>左上角</b>：他甩出的歪理，每句都标了属性。' },
        { id: 'me',     target: 'me',     text: '<b>右上角</b>：你还击打出的牌显示在这。' },
        { id: 'meter',  target: 'meter',  text: '中间是<b>气势条</b>：<b>满 100 赢，掉到 0 输</b>。' },
        { id: 'attr',   target: 'hand',   mode: 'play', text: '先看属性：<b>理克情、情克势、势克理</b>。已逐张算好，<b>点高亮那张</b>。' },
        { id: 'after1', target: 'meter',  text: '看到没？气势条动了。克制 <b>+16</b>、同属性 <b>+4</b>、被克 <b>−14</b>。' },
        { id: 'reveal', target: 'hand',   mode: 'play', text: '他换了新话。注意：<b>连出同一属性会被看穿扣分</b>，换着打，<b>点高亮那张</b>。' },
        { id: 'time',   target: 'times',  text: '规则一：<b>每回合限 6 秒、整场限 40 秒</b>，超时会被抢白。' },
        { id: 'health', target: 'health', text: '规则二：你一直站在烟雾里，<b>健康会持续下降</b>，速战速决。' },
        { id: 'exit',   target: 'exit',   text: '撑不住按 <b>Esc</b> 或点「退出」中止，<b>不受惩罚</b>。' },
        { id: 'final',  target: null,     text: '教学结束。接下来<b>自己打赢他</b>：气势保留、限时正常。' },
      ],
      tipNext: '下一步 ▸',
      tipStart: '开始吧 ▸',
    },
  },

  // 交涉（对应策划案 3.4）
  negotiate: {
    range: 1.7,
    optionTime: 1.1,           // 每次选择消耗的时间表现
    wrongPenalty: -1,          // 选错时的配合度变化
    clueDelay: 1.6,            // 假意配合后多久露出线索
  },

  // 提示牌（对应策划案 6）
  sign: {
    effectRadius: 5.4,
    occlusion: true,           // 是否做遮挡判定
    maxCarry: 2,               // 玩家可携带数量
    turnStep: Math.PI / 2,
  },

  // 管理人员（对应策划案 5 / 3.2）
  manager: {
    speed: 3.0,
    interveneTime: 1.2,        // 抵达后介入耗时
    requestRange: 2.2,         // 在管理亭申请的最大距离
  },

  // 路人（对应策划案 7）
  pedestrian: {
    speed: 1.5,
    // 前方格子高于该浓度即视为危险：路人会退避并重新规划路线。
    // 注意烟雾场衰减快，浓烟基本只集中在烟雾源周围 1~2 格，
    // 阈值设太高（旧值 0.3）会导致路人永远“看”不到烟、直接走到出口。
    smokeAvoid: 0.06,
    // 自身所处浓度 ≥ 该值 → 直接停下不走（站在浓烟里迈不动腿）
    blockSmoke: 0.12,
    startDelay: 6,             // 开局现在原地驻足多少秒（给烟雾积累留时间）
    affectedWait: 2.4,         // 受烟雾影响后的等待/重规划时间
    followSpeed: 1.9,
    guideRange: 2.0,

    // 身处烟雾中的抱怨 / 愤怒（对应“路人在烟雾里会抗议”）：均为可调数值
    complainSmoke: 0.08,       // 所处浓度 ≥ 该值即视为“在烟雾中”，开始抱怨
    complainInterval: 5,       // 抱怨的重复间隔（秒）
    complainBubbleTime: 3,     // 头顶说话气泡的显示时长（秒）
    angerExposureTime: 10,     // 连续处于烟雾中超过该秒数 → 愤怒（头顶冒火）
    angerCalmTime: 8,          // 愤怒后脱离烟雾多少秒平复（0 = 不再平复）
    // 抱怨台词（随机取一条）
    complaints: [
      '咳…这烟味也太重了吧！',
      '谁在这儿抽烟？喘不过气了。',
      '麻烦把烟灭了好吗，这里是公共区域。',
      '孩子还小，呛得直咳嗽。',
      '再这么抽下去我要叫管理员了。',
    ],
  },

  // ---------------------------------------------------------------------------
  // V0.3 新增系统（对应策划案 12～15）
  // ---------------------------------------------------------------------------

  // 愤怒值：改变决策成本，不直接决定输赢（对应策划案 13）
  anger: {
    max: 100,
    start: 0,
    riseIgnore: 6,          // NPC 无视提醒时上升
    riseFake: 14,           // NPC 当面答应却改道时上升
    riseExposure: 3.2,      // 二手烟暴露时每秒上升
    exposureMin: 0.15,      // 触发暴露愤怒的浓度阈值
    fallSafe: 9,            // 安全区休整时每秒下降
    fallSolved: 18,         // 成功解决反复违规时下降
    fallInvestigate: 2.2,   // 调查推进时每秒下降
    calmBelow: 34,          // 低于此为「冷静」
    brinkAbove: 72,         // 高于此为「濒临失控」
    brinkFailChance: 0.45,  // 濒临失控时交涉恶化的概率
    brinkMissChance: 0.3,   // 濒临失控时误放提示牌 / 装备的概率
  },

  // 记录设备（第 2 关解锁，对应策划案 12.2）
  record: {
    range: 1.9,
    time: 1.6,              // 单次记录耗时（秒）
    need: 2,                // 二级 NPC 管理介入生效所需证据数
  },

  // 问题根源调查（第 3 关解锁，对应策划案 14）
  investigate: {
    range: 2.4,
    time: 2.0,              // 完成一次调查耗时
    repeatThreshold: 2,     // 同一位置反复违规的次数阈值
  },

  // 关卡评分：四维（对应策划案 15.1）
  score: {
    goalWeight: 0.4,        // 目标完成度（必要条件，权重最高）
    healthWeight: 0.25,     // 健康保护
    publicWeight: 0.2,      // 公共安全（路人）
    strategyWeight: 0.15,   // 策略与调查
    star2: 0.6,             // 达到二星的总分阈值
    star3: 0.85,            // 达到三星的总分阈值
    parTimePerLevel: [0, 90, 200, 330, 380],  // 各关基准时间（秒）

    // 路人愤怒扣星：按“愤怒路人 / 本关路人总数”的比例扣减星级
    angryPenalty1Ratio: 0.333, // 达到该比例（约 1/3）扣第一档
    angryPenalty2Ratio: 0.5,   // 达到该比例（1/2 及以上）扣第二档
    angryPenalty1Stars: 1,     // 第一档扣星数
    angryPenalty2Stars: 2,     // 第二档扣星数
  },

  // 积分经济（对应策划案 15.2）
  economy: {
    startPoints: 0,                 // 初始积分
    starPoints: [0, 50, 75, 100],   // 一星 / 二星 / 三星 的积分奖励
  },

  // 商店条目：price 为可调数值，kind 决定购买后的归类
  // carry  : 是否为「可携带道具」（每关最多携带 maxCarry 个，从底部物品栏拖拽到地面放置）
  //          每个道具只能买一次；若本关实际使用（部署）了它，下关需重新购买
  // consume: 购买即消耗（如备用电池），不进携带槽，下关需重新购买
  shopItems: [
    { id: 'fan', name: '便携风扇', price: 60, kind: 'equip', carry: true },
    { id: 'purifier', name: '空气净化器', price: 100, kind: 'equip', carry: true },
    { id: 'battery', name: '备用电池', price: 40, kind: 'consumable', consume: true },
    { id: 'signPro', name: '加强型提示牌', price: 75, kind: 'upgrade' },
    { id: 'barrier', name: '临时隔离挡板', price: 90, kind: 'equip', carry: true },
    // 棒球棍：可携带但不落地（kind 非 equip），携带后按右键攻击吸烟者
    { id: 'bat', name: '棒球棍', price: 100, kind: 'tool', carry: true },
  ],

  // 出击准备（对应策划案 15.3）：第 4 关起开局弹出商店，购买并选择携带道具后再进入关卡
  loadout: {
    maxCarry: 2,               // 每关最多携带的道具数量
    openFromLevel: 4,          // 从第几关开始，开局弹出「出击准备」商店
  },

  // 辅助装备效果（对应策划案 12.3）
  equip: {
    // 道具放置：从下方物品栏拖拽到地面放置，且只能放在玩家周围 placeRange 格内
    placeRange: 3,
    purifier: { radius: 3.6, strength: 0.9, power: 60, deployTime: 1.2 },
    // 风扇实际推流系数 = push × 0.3 = 1.2/秒（对流输运：烟沿朝向以约 1.2 格/秒穿过风扇区）
    fan: { radius: 3.4, push: 4.0, power: 90, deployTime: 1.0 },
    // 挡板阻断范围：曼哈顿距离 ≤ block 的格子都拒绝烟雾流入（1 = 自身 + 上下左右，共 5 格）
    barrier: { block: 1, power: 9999, deployTime: 1.0 },
  },

  // 视觉引导光效（加强关键区域的引导，全部为可调数值）
  highlight: {
    smokingAreaRingOpacity: 0.5,   // 吸烟区地面绿圈不透明度
    smokingAreaFillOpacity: 0.2,   // 吸烟区地面绿色填充不透明度
    smokingAreaPulse: 0.12,        // 绿光呼吸幅度（0 = 不呼吸）
    footGlowRadius: 0.5,           // 吸烟 NPC 脚下红色光圈半径（格，0.5 ≈ 占一格）
    footGlowOpacity: 0.55,         // 红色光圈不透明度
    footGlowPulse: 0.18,           // 红色光圈呼吸幅度
  },

  // 棒球棍道具（携带后鼠标右键攻击吸烟 NPC，均为可调数值）
  bat: {
    range: 1,                 // 可攻击距离（格）：离吸烟 NPC 一格内
    push: 2,                  // 击退格数（沿「玩家→NPC」方向）
    stopSmoke: 5,             // 被打后停止吸烟的秒数
    escapeTime: 3,            // 打完后须在多少秒内离开危险半径（在半径内累计）
    dangerRadius: 3,          // 危险半径（格）：停留超时会被抓住 = 被赶出去
    smokeClearRadius: 2.6,    // 被打者身边烟雾加速消散半径（格）
    smokeClearRate: 1.6,      // 加速消散速率 / 秒（越大消散越快）
    pubPenaltyPerAngry: 0.25, // 每名被激怒的 NPC 扣减的公共安全评分（0~1）
    react1: '疑惑',           // 第 1 次被打的反应
    react2: '微微生气',       // 第 2 次被打的反应
    react3: '愤怒',           // 第 3 次（及以上）被彻底激怒
  },

  // 新手引导（对应策划案 21.7 / 决策 4）
  guide: {
    // 第 5 关起取消“点击才继续”的模态引导，改为非阻塞、自动消失的提示
    // （模态会暂停主循环，会冻结对辩计时与掉血，必须避免）
    nonBlockingFromLevel: 5,
  },

  // 音频（背景音乐 / 音效音量，调试台可实时调整，均为 0~1）
  audio: {
    bgmVolume: 0.5,   // 背景音乐音量
    sfxVolume: 1,     // 音效总音量：统一缩放所有音效（含咳嗽 / 按键 / 打击 / 通关）
  },

  // 调试
  debug: {
    showSmokeNumbers: false,
  },
};

// 参考图配色：暖陶土 / 琥珀 + 奶油地砖 + 暗棕背景
export const PALETTE = {
  bg: 0x17110e,
  fog: 0x1d1511,

  // 地板：中等偏深暖棕，与白色烟雾形成强对比（烟雾为白色，地板不能太浅）
  floorA: 0x6d5945,
  floorB: 0x604e3b,
  floorOut: 0x4c3d2e,
  floorSmoking: 0x5a523d,
  floorEdge: 0x35291e,

  wall: 0xe7d9c4,
  wallTop: 0xd8c5a8,
  wallOuter: 0x8c7a63,

  amber: 0xe39a4f,
  amberLight: 0xf1c583,
  amberDeep: 0xc8792f,

  teal: 0x6c9b95,
  blue: 0x4a7fa5,
  red: 0xcf5540,

  wood: 0xa9713f,
  woodDark: 0x7d5230,
  metal: 0xb5b2ab,
  metalDark: 0x8b8880,

  greenA: 0x8a9b6e,
  greenB: 0x6c8455,
  greenDark: 0x4e6b4a,
  paper: 0xc05b45,

  skin: 0xe8b48c,
  skinDark: 0xd39a70,
  hairDark: 0x4a3628,
  cloth: [0x8fa9a3, 0xd9a05f, 0x9aa7bd, 0xc98d72, 0x88a06e, 0xb08fae],
  clothGray: 0x6f665f,

  // 角色服装固定配色：按角色区分身份
  playerCloth: 0x3f9e5c,     // 玩家：绿色
  npcCloth: 0xd23b30,        // 吸烟 NPC：红色
  managerCloth: 0x2f6fce,    // 管理人员：蓝色
  pedCloth: 0x9c968d,        // 可引导路人：灰色

  smoke: 0xf7f4ec,
  smokeDark: 0xbdb7ae,
};