import { CONFIG } from './config.js';
import { LEVELS } from './levels.js';

// ---------------------------------------------------------------------------
// 开发者数值调试台（两级分类：分类 Category → 分组 Group → 数值项）
// 控件改动直接写入 CONFIG，并回调 game.onConfigChanged(path)，
// 让构造时被缓存的项（NPC cfg / 玩家 maxHealth·maxAnger / 提示牌库存 / 相机距离等）重新同步。
// ---------------------------------------------------------------------------

// 反应类型可选项（对应 config.js 里的字符串枚举）
const REACT = [
  { value: 'comply', label: 'comply 配合' },
  { value: 'ignore', label: 'ignore 无视' },
  { value: 'partial', label: 'partial 部分' },
];

// 分组定义：每个分组是一张可折叠的卡片（key 仅用于标识，fields 为数值项）
const GROUP = {
  camera: {
    key: 'camera', name: '相机 Camera', fields: [
      { path: 'camera.fov', name: '视野 FOV', min: 15, max: 60, step: 1 },
      { path: 'camera.rotY', name: '水平朝向 rotY(弧度)', min: 0, max: 6.28, step: 0.01 },
      { path: 'camera.pitch', name: '俯角 pitch(弧度)', min: 0.3, max: 1.45, step: 0.01 },
      { path: 'camera.lookAtLift', name: '视点抬高', min: -1, max: 2, step: 0.05 },
      { path: 'camera.viewScale', name: '视野缩放 viewScale', min: 0.2, max: 2, step: 0.01 },
      { path: 'camera.follow', name: '跟随玩家', type: 'bool' },
      { path: 'camera.followStrength', name: '跟随强度', min: 0, max: 1, step: 0.05 },
      { path: 'camera.followLerp', name: '跟随平滑', min: 0.5, max: 12, step: 0.1 },
      { path: 'camera.edgePadding', name: '边缘留白', min: 0, max: 2, step: 0.05 },
    ],
  },
  agent: {
    key: 'agent', name: '角色运动 Agent', fields: [
      { path: 'agent.npcSpeed', name: 'NPC 移动速度', min: 0.2, max: 6, step: 0.05 },
      { path: 'agent.walkAnim', name: '行走动画频率', min: 0, max: 20, step: 0.1 },
      { path: 'agent.arriveEpsilon', name: '到达判定误差', min: 0.01, max: 0.5, step: 0.01 },
    ],
  },
  player: {
    key: 'player', name: '玩家 Player', fields: [
      { path: 'player.speed', name: '移动速度', min: 0.5, max: 10, step: 0.1 },
      { path: 'player.radius', name: '碰撞半径', min: 0.05, max: 1, step: 0.01 },
      { path: 'player.maxHealth', name: '最大健康值', min: 10, max: 300, step: 5 },
      { path: 'player.interactRange', name: '交互距离', min: 0.5, max: 5, step: 0.1 },
      { path: 'player.operateTime', name: '通用操作耗时', min: 0, max: 5, step: 0.1 },
    ],
  },
  health: {
    key: 'health', name: '健康与烟雾伤害 Health', fields: [
      { path: 'health.smokeDamage', name: '烟雾伤害/秒(浓度1)', min: 0, max: 60, step: 1 },
      { path: 'health.exposurePosFactor', name: '位置影响系数', min: 0, max: 3, step: 0.05 },
      { path: 'health.ventRecover', name: '通风区恢复/秒', min: 0, max: 60, step: 1 },
      { path: 'health.cleanRecover', name: '洁净空气恢复/秒', min: 0, max: 20, step: 0.1 },
      { path: 'health.cleanThreshold', name: '洁净浓度阈值', min: 0, max: 1, step: 0.01 },
      { path: 'health.warnHealth', name: '血条变黄/开始震动值', min: 0, max: 100, step: 1 },
      { path: 'health.lowHealthWarn', name: '血条变红/震动加剧值', min: 0, max: 100, step: 1 },
      { path: 'health.ventSafeField', name: '有效安全区阈值', min: 0, max: 1, step: 0.01 },
    ],
  },
  shake: {
    key: 'shake', name: '低血量震动 Shake', fields: [
      { path: 'health.shake.warnAmp', name: '画面抖动幅度·黄', min: 0, max: 0.5, step: 0.005 },
      { path: 'health.shake.dangerAmp', name: '画面抖动幅度·红', min: 0, max: 1, step: 0.005 },
      { path: 'health.shake.warnFreq', name: '画面抖动频率·黄', min: 0, max: 60, step: 1 },
      { path: 'health.shake.dangerFreq', name: '画面抖动频率·红', min: 0, max: 60, step: 1 },
      { path: 'health.shake.warnRot', name: '画面倾斜幅度·黄(弧度)', min: 0, max: 0.1, step: 0.001 },
      { path: 'health.shake.dangerRot', name: '画面倾斜幅度·红(弧度)', min: 0, max: 0.1, step: 0.001 },
      { path: 'health.shake.barWarnAmp', name: '血条抖动幅度·黄(px)', min: 0, max: 20, step: 0.5 },
      { path: 'health.shake.barDangerAmp', name: '血条抖动幅度·红(px)', min: 0, max: 30, step: 0.5 },
      { path: 'health.shake.barWarnFreq', name: '血条抖动频率·黄', min: 0, max: 60, step: 1 },
      { path: 'health.shake.barDangerFreq', name: '血条抖动频率·红', min: 0, max: 60, step: 1 },
      { path: 'health.shake.coughWarnInterval', name: '咳嗽间隔·黄(Cough1)', min: 0.2, max: 6, step: 0.1 },
      { path: 'health.shake.coughDangerInterval', name: '咳嗽间隔·红(Cough2)', min: 0.2, max: 6, step: 0.1 },
    ],
  },
  smoke: {
    key: 'smoke', name: '烟雾网格 Smoke', fields: [
      { path: 'smoke.max', name: '浓度上限', min: 0.2, max: 3, step: 0.05 },
      { path: 'smoke.diffusion', name: '扩散速率(0~0.25)', min: 0, max: 0.25, step: 0.005 },
      { path: 'smoke.decay', name: '自然消散/秒', min: 0, max: 0.5, step: 0.005 },
      { path: 'smoke.ventRemoval', name: '通风清除系数', min: 0, max: 10, step: 0.1 },
      { path: 'smoke.ventRadius', name: '通风影响半径(格)', min: 1, max: 12, step: 0.1 },
      { path: 'smoke.emitHeight', name: '释放高度', min: 0, max: 3, step: 0.05 },
      { path: 'smoke.renderThreshold', name: '显示阈值', min: 0, max: 0.3, step: 0.005 },
      { path: 'smoke.puffRadius', name: '烟团半径', min: 0.05, max: 1.5, step: 0.01 },
      { path: 'smoke.puffOpacity', name: '烟团不透明度', min: 0, max: 1, step: 0.02 },
    ],
  },
  vent: {
    key: 'vent', name: '通风设备 Vent', fields: [
      { path: 'vent.operateTime', name: '开关操作耗时', min: 0, max: 5, step: 0.1 },
      { path: 'vent.startupDelay', name: '开启生效延迟', min: 0, max: 5, step: 0.1 },
    ],
  },
  npc1: {
    key: 'npc1', name: 'NPC · 一级（配合型）', fields: [
      { path: 'npc.1.emission', name: '烟雾释放速率', min: 0, max: 1, step: 0.01 },
      { path: 'npc.1.smokingDuration', name: '吸烟时长', min: 1, max: 120, step: 1 },
      { path: 'npc.1.remindReaction', name: '普通提醒反应', type: 'select', options: REACT },
      { path: 'npc.1.managerReaction', name: '管理介入反应', type: 'select', options: REACT },
      { path: 'npc.1.signReaction', name: '会看提示牌', type: 'bool' },
      { path: 'npc.1.signReactDelay', name: '看到提示牌后延迟', min: 0, max: 15, step: 0.5 },
    ],
  },
  npc2: {
    key: 'npc2', name: 'NPC · 二级（无视型）', fields: [
      { path: 'npc.2.emission', name: '烟雾释放速率', min: 0, max: 1, step: 0.01 },
      { path: 'npc.2.smokingDuration', name: '吸烟时长', min: 1, max: 120, step: 1 },
      { path: 'npc.2.remindReaction', name: '普通提醒反应', type: 'select', options: REACT },
      { path: 'npc.2.managerReaction', name: '管理介入反应', type: 'select', options: REACT },
      { path: 'npc.2.signReaction', name: '会看提示牌', type: 'bool' },
      { path: 'npc.2.relocateChance', name: '被提醒后换位概率', min: 0, max: 1, step: 0.05 },
    ],
  },
  npc3: {
    key: 'npc3', name: 'NPC · 三级（顽固型）', fields: [
      { path: 'npc.3.emission', name: '烟雾释放速率', min: 0, max: 1, step: 0.01 },
      { path: 'npc.3.smokingDuration', name: '吸烟时长', min: 1, max: 120, step: 1 },
      { path: 'npc.3.remindReaction', name: '普通提醒反应', type: 'select', options: REACT },
      { path: 'npc.3.managerReaction', name: '管理介入反应', type: 'select', options: REACT },
      { path: 'npc.3.signReaction', name: '会看提示牌', type: 'bool' },
      { path: 'npc.3.fakeCompliesFirst', name: '前 N 次假意配合', min: 0, max: 5, step: 1 },
      { path: 'npc.3.deceptionChance', name: '假意配合概率', min: 0, max: 1, step: 0.05 },
      { path: 'npc.3.negotiateNeed', name: '所需配合点数', min: 1, max: 8, step: 1 },
    ],
  },
  negotiate: {
    key: 'negotiate', name: '交涉 Negotiate', fields: [
      { path: 'negotiate.range', name: '交涉距离', min: 0.5, max: 5, step: 0.1 },
      { path: 'negotiate.optionTime', name: '每次选择耗时', min: 0, max: 4, step: 0.1 },
      { path: 'negotiate.wrongPenalty', name: '选错配合度变化', min: -5, max: 1, step: 0.5 },
      { path: 'negotiate.clueDelay', name: '露出线索延迟', min: 0, max: 6, step: 0.1 },
    ],
  },
  // --- V0.4 三级 NPC-2 与话术对辩 ---
  npcArgue: {
    key: 'npcArgue', name: 'NPC · 三级-2（争论型）', fields: [
      { path: 'npc.argue.emission', name: '烟雾释放速率', min: 0, max: 1, step: 0.01 },
      { path: 'npc.argue.managerReaction', name: '管理介入反应', type: 'select', options: [...REACT, { value: 'refuse', label: 'refuse 完全无效' }] },
      { path: 'npc.argue.triggerRemind', name: '触发对辩的提醒次数', min: 0, max: 6, step: 1 },
      { path: 'npc.argue.cooldown', name: '输掉后冷却(秒)', min: 0, max: 90, step: 1 },
    ],
  },
  argue: {
    key: 'argue', name: '话术对辩 Argue（21）', fields: [
      { path: 'argue.handSize', name: '每回合手牌数量', min: 1, max: 6, step: 1 },
      { path: 'argue.roundTime', name: '每回合限时(秒)', min: 1, max: 30, step: 0.5 },
      { path: 'argue.timeLimit', name: '整场限时(秒)', min: 5, max: 300, step: 5 },
      { path: 'argue.meterStart', name: '气势条起始值', min: 0, max: 100, step: 1 },
      { path: 'argue.meterMax', name: '气势条上限', min: 20, max: 200, step: 5 },
      { path: 'argue.advantageDelta', name: '克制 +值', min: 0, max: 40, step: 1 },
      { path: 'argue.neutralDelta', name: '同属性 +值', min: -20, max: 20, step: 1 },
      { path: 'argue.disadvantageDelta', name: '被克 −值', min: 0, max: 40, step: 1 },
      { path: 'argue.timeoutPenalty', name: '超时被抢白 −值', min: 0, max: 40, step: 1 },
      { path: 'argue.lockPenalty', name: '连出同属性被看穿 −值', min: 0, max: 40, step: 1 },
      { path: 'argue.repeatAttributeLock', name: '启用连出同属性被看穿', type: 'bool' },
      { path: 'argue.loseAnger', name: '输掉时愤怒上升', min: 0, max: 60, step: 1 },
    ],
  },
  guide: {
    key: 'guide', name: '新手引导 Guide（21.7）', fields: [
      { path: 'guide.nonBlockingFromLevel', name: '第几关起改为非阻塞引导', min: 1, max: 12, step: 1 },
    ],
  },
  sign: {
    key: 'sign', name: '提示牌 Sign', fields: [
      { path: 'sign.effectRadius', name: '生效半径(格)', min: 1, max: 15, step: 0.1 },
      { path: 'sign.occlusion', name: '启用遮挡判定', type: 'bool' },
      { path: 'sign.turnStep', name: '旋转步长(弧度)', min: 0.1, max: 3.14, step: 0.01 },
    ],
  },
  manager: {
    key: 'manager', name: '管理人员 Manager', fields: [
      { path: 'manager.speed', name: '移动速度', min: 0.5, max: 8, step: 0.1 },
      { path: 'manager.interveneTime', name: '介入耗时', min: 0, max: 5, step: 0.1 },
      { path: 'manager.requestRange', name: '申请介入距离', min: 0.5, max: 6, step: 0.1 },
    ],
  },
  pedestrian: {
    key: 'pedestrian', name: '路人 Pedestrian', fields: [
      { path: 'pedestrian.speed', name: '移动速度', min: 0.3, max: 5, step: 0.1 },
      { path: 'pedestrian.smokeAvoid', name: '避烟浓度阈值(前方有烟)', min: 0, max: 1, step: 0.01 },
      { path: 'pedestrian.blockSmoke', name: '浓烟停下阈值(自身)', min: 0, max: 1, step: 0.01 },
      { path: 'pedestrian.startDelay', name: '开局驻足(秒)', min: 0, max: 30, step: 0.5 },
      { path: 'pedestrian.affectedWait', name: '受影响等待时间', min: 0, max: 10, step: 0.2 },
      { path: 'pedestrian.followSpeed', name: '跟随速度', min: 0.5, max: 6, step: 0.1 },
      { path: 'pedestrian.guideRange', name: '引导距离', min: 0.5, max: 6, step: 0.1 },
      { path: 'pedestrian.complainSmoke', name: '开始抱怨的烟雾浓度', min: 0, max: 1, step: 0.01 },
      { path: 'pedestrian.complainInterval', name: '抱怨间隔(秒)', min: 0.5, max: 30, step: 0.5 },
      { path: 'pedestrian.complainBubbleTime', name: '抱怨气泡显示时长(秒)', min: 1, max: 15, step: 0.5 },
      { path: 'pedestrian.angerExposureTime', name: '愤怒所需暴露时长(秒)', min: 1, max: 90, step: 1 },
      { path: 'pedestrian.angerCalmTime', name: '离开烟雾后平复(秒,0=不平复)', min: 0, max: 60, step: 1 },
    ],
  },

  // --- V0.3 情绪与调查 ---
  anger: {
    key: 'anger', name: '愤怒值 Anger（13）', fields: [
      { path: 'anger.max', name: '愤怒值上限', min: 10, max: 300, step: 5 },
      { path: 'anger.start', name: '开局愤怒值', min: 0, max: 200, step: 5 },
      { path: 'anger.riseIgnore', name: '被无视时上升', min: 0, max: 60, step: 1 },
      { path: 'anger.riseFake', name: '被假意配合时上升', min: 0, max: 80, step: 1 },
      { path: 'anger.riseExposure', name: '暴露时每秒上升', min: 0, max: 30, step: 0.2 },
      { path: 'anger.exposureMin', name: '触发暴露愤怒浓度', min: 0, max: 1, step: 0.01 },
      { path: 'anger.fallSafe', name: '安全区每秒下降', min: 0, max: 60, step: 1 },
      { path: 'anger.fallSolved', name: '解决反复违规时下降', min: 0, max: 80, step: 1 },
      { path: 'anger.fallInvestigate', name: '调查时每秒下降', min: 0, max: 40, step: 0.2 },
      { path: 'anger.calmBelow', name: '「冷静」上限', min: 0, max: 100, step: 1 },
      { path: 'anger.brinkAbove', name: '「濒临失控」下限', min: 0, max: 200, step: 1 },
      { path: 'anger.brinkFailChance', name: '失控时交涉恶化概率', min: 0, max: 1, step: 0.05 },
      { path: 'anger.brinkMissChance', name: '失控时操作失误概率', min: 0, max: 1, step: 0.05 },
    ],
  },
  record: {
    key: 'record', name: '记录设备 Record（12.2）', fields: [
      { path: 'record.range', name: '记录距离(格)', min: 0.5, max: 6, step: 0.1 },
      { path: 'record.time', name: '单次记录耗时(秒)', min: 0, max: 6, step: 0.1 },
      { path: 'record.need', name: '管理介入所需证据数', min: 1, max: 6, step: 1 },
    ],
  },
  investigate: {
    key: 'investigate', name: '根源调查 Investigate（14）', fields: [
      { path: 'investigate.range', name: '调查距离(格)', min: 0.5, max: 8, step: 0.1 },
      { path: 'investigate.time', name: '单次调查耗时(秒)', min: 0, max: 8, step: 0.1 },
      { path: 'investigate.repeatThreshold', name: '反复违规次数阈值', min: 1, max: 8, step: 1 },
    ],
  },

  // --- V0.3 评分与积分 ---
  score: {
    key: 'score', name: '关卡评分 Score（15.1）', fields: [
      { path: 'score.goalWeight', name: '目标完成度权重', min: 0, max: 1, step: 0.05 },
      { path: 'score.healthWeight', name: '健康保护权重', min: 0, max: 1, step: 0.05 },
      { path: 'score.publicWeight', name: '公共安全权重', min: 0, max: 1, step: 0.05 },
      { path: 'score.strategyWeight', name: '策略与调查权重', min: 0, max: 1, step: 0.05 },
      { path: 'score.star2', name: '二星分数阈值', min: 0, max: 1, step: 0.05 },
      { path: 'score.star3', name: '三星分数阈值', min: 0, max: 1, step: 0.05 },
      { path: 'score.parTimePerLevel', name: '各关基准时间(秒)', type: 'list', labels: ['第1关', '第2关', '第3关', '第4关'], min: 0, max: 900, step: 5 },
      { path: 'score.angryPenalty1Ratio', name: '愤怒扣1星比例阈值', min: 0, max: 1, step: 0.01 },
      { path: 'score.angryPenalty2Ratio', name: '愤怒扣2星比例阈值', min: 0, max: 1, step: 0.01 },
      { path: 'score.angryPenalty1Stars', name: '第一档扣星数', min: 0, max: 3, step: 1 },
      { path: 'score.angryPenalty2Stars', name: '第二档扣星数', min: 0, max: 3, step: 1 },
    ],
  },
  economy: {
    key: 'economy', name: '积分经济 Economy（15.2）', fields: [
      { path: 'economy.startPoints', name: '初始积分', min: 0, max: 500, step: 5 },
      { path: 'economy.starPoints', name: '星级积分奖励', type: 'list', labels: ['未通关', '一星', '二星', '三星'], min: 0, max: 500, step: 5 },
    ],
  },
  shop: {
    key: 'shop', name: '商店价格 Shop（15.3）', fields: [
      { path: 'shopItems', name: '各条目价格(积分)', type: 'shop', min: 0, max: 999, step: 5 },
    ],
  },

  // --- V0.3 辅助装备 ---
  equip: {
    key: 'equip', name: '辅助装备 Equip（12.3）', fields: [
      { path: 'equip.purifier.radius', name: '净化器半径(格)', min: 1, max: 10, step: 0.1 },
      { path: 'equip.purifier.strength', name: '净化器强度', min: 0, max: 2, step: 0.05 },
      { path: 'equip.purifier.power', name: '净化器电力(秒)', min: 0, max: 300, step: 5 },
      { path: 'equip.purifier.deployTime', name: '净化器部署耗时', min: 0, max: 5, step: 0.1 },
      { path: 'equip.fan.radius', name: '风扇半径(格)', min: 1, max: 10, step: 0.1 },
      { path: 'equip.fan.push', name: '风扇推送力', min: 0, max: 6, step: 0.02 },
      { path: 'equip.fan.power', name: '风扇电力(秒)', min: 0, max: 300, step: 5 },
      { path: 'equip.fan.deployTime', name: '风扇部署耗时', min: 0, max: 5, step: 0.1 },
      { path: 'equip.barrier.block', name: '挡板阻断范围(曼哈顿)', min: 0, max: 3, step: 1 },
      { path: 'equip.barrier.power', name: '挡板耐久', min: 1, max: 9999, step: 1 },
      { path: 'equip.barrier.deployTime', name: '挡板部署耗时', min: 0, max: 5, step: 0.1 },
    ],
  },

  // --- V0.4 棒球棍道具 ---
  bat: {
    key: 'bat', name: '棒球棍 Bat（右键攻击）', fields: [
      { path: 'bat.range', name: '攻击距离(格)', min: 0.5, max: 5, step: 0.5 },
      { path: 'bat.push', name: '击退格数', min: 0, max: 6, step: 1 },
      { path: 'bat.stopSmoke', name: '停止吸烟(秒)', min: 0, max: 30, step: 1 },
      { path: 'bat.escapeTime', name: '被抓住时限(秒)', min: 0.5, max: 15, step: 0.5 },
      { path: 'bat.dangerRadius', name: '危险半径(格)', min: 0.5, max: 10, step: 0.5 },
      { path: 'bat.smokeClearRadius', name: '烟雾加速消散半径(格)', min: 0.5, max: 10, step: 0.2 },
      { path: 'bat.smokeClearRate', name: '烟雾消散速率', min: 0, max: 6, step: 0.1 },
      { path: 'bat.pubPenaltyPerAngry', name: '每名愤怒NPC扣公共安全', min: 0, max: 1, step: 0.05 },
    ],
  },

  // --- 关卡调试（非数值：直接调用 game 的关卡方法） ---
  levelDebug: {
    key: 'levelDebug', name: '关卡调试 Level', type: 'actions',
  },

  // --- 音频（背景音乐 / 音效音量） ---
  audio: {
    key: 'audio', name: '音频 Audio', fields: [
      { path: 'audio.bgmVolume', name: '背景音乐音量', min: 0, max: 1, step: 0.01 },
      { path: 'audio.sfxVolume', name: '音效总音量', min: 0, max: 1, step: 0.01 },
    ],
  },

  // --- 界面布局（非 CONFIG：由 uitune 模块保存到独立的 localStorage 键） ---
  uiTune: {
    key: 'uiTune', name: '界面布局 UI（可拖动）', type: 'ui',
  },
};

// 分类定义：分类 → 分组（用来把几十项数值分层收纳，便于查找）
const CATEGORIES = [
  { name: '界面调试', groups: ['uiTune'] },
  { name: '音频调试', groups: ['audio'] },
  { name: '关卡调试', groups: ['levelDebug'] },
  { name: '镜头与运动', groups: ['camera', 'agent'] },
  { name: '玩家与健康', groups: ['player', 'health', 'shake'] },
  { name: '烟雾与通风', groups: ['smoke', 'vent'] },
  { name: 'NPC 与交涉', groups: ['npc1', 'npc2', 'npc3', 'npcArgue', 'negotiate'] },
  { name: '话术对辩（V0.4）', groups: ['argue', 'guide'] },
  { name: '核心工具', groups: ['sign', 'manager', 'pedestrian'] },
  { name: '情绪与调查（V0.3）', groups: ['anger', 'record', 'investigate'] },
  { name: '评分与积分（V0.3）', groups: ['score', 'economy', 'shop'] },
  { name: '辅助装备（V0.3）', groups: ['equip', 'bat'] },
];

export function createDevPanel(game) {
  const toggle = document.getElementById('btn-dev');
  const panel = document.getElementById('dev-panel');
  const body = document.getElementById('dev-body');

  const defaults = JSON.parse(JSON.stringify(CONFIG));
  const controls = []; // { path, refresh }
  const actionSyncs = []; // 非数值分组的刷新回调（如关卡状态）

  // --- 调试改动的持久化 ---
  // 把与默认值不同的项存到 localStorage，刷新页面后仍保留（复位按钮可清空）
  const OVERRIDE_KEY = 'nsa_config_overrides_v1';
  const readFrom = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  const loadOverrides = () => {
    try { return JSON.parse(localStorage.getItem(OVERRIDE_KEY)) || {}; } catch { return {}; }
  };
  const clearOverrides = () => { try { localStorage.removeItem(OVERRIDE_KEY); } catch { /* 忽略 */ } };
  let persistOverrides = true;      // 复位过程中暂停回写
  const pendingOverrides = {};      // 拖滑块时高频改动先攒着，再统一落盘
  let saveTimer = 0;

  function flushOverrides() {
    const o = loadOverrides();
    for (const [p, v] of Object.entries(pendingOverrides)) {
      const def = readFrom(defaults, p);
      if (JSON.stringify(v) === JSON.stringify(def)) delete o[p];   // 改回默认值就不必存
      else o[p] = v;
    }
    for (const k of Object.keys(pendingOverrides)) delete pendingOverrides[k];
    try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(o)); } catch { /* 忽略隐私模式等 */ }
  }

  function saveOverride(path, val) {
    if (!persistOverrides) return;
    pendingOverrides[path] = val;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushOverrides, 250);
  }

  const readPath = (path) => path.split('.').reduce((o, k) => o[k], CONFIG);
  const writePath = (path, val) => {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], CONFIG)[last] = val;
  };

  // 构建 UI 之前，先把上次保存的覆盖值写回 CONFIG
  const restoredPaths = [];
  for (const [p, v] of Object.entries(loadOverrides())) {
    try { writePath(p, v); restoredPaths.push(p); } catch { /* 路径失效则忽略 */ }
  }

  const apply = (path) => {
    saveOverride(path, readPath(path));
    if (game.onConfigChanged) game.onConfigChanged(path);
  };

  // --- 数值行（滑块 + 数字框） ---
  function numRow(field) {
    const row = document.createElement('div');
    row.className = 'dev-row';
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const step = field.step ?? 0.01;

    row.innerHTML = `<div class="top"><span class="nm">${field.name}</span><span class="pth">${field.path}</span></div>`;
    const ctrl = document.createElement('div');
    ctrl.className = 'dev-ctrl';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min; slider.max = max; slider.step = step;

    const num = document.createElement('input');
    num.type = 'number';
    num.min = min; num.max = max; num.step = step;

    const sync = (v, fromSlider) => {
      const val = parseFloat(v);
      if (Number.isNaN(val)) return;
      writePath(field.path, val);
      if (!fromSlider) slider.value = val;
      else num.value = val;
      apply(field.path);
    };
    slider.addEventListener('input', () => sync(slider.value, true));
    num.addEventListener('input', () => { sync(num.value, false); });
    num.addEventListener('change', () => sync(num.value, false));

    ctrl.append(slider, num);
    row.appendChild(ctrl);

    controls.push({
      path: field.path,
      refresh: () => { const v = readPath(field.path); slider.value = v; num.value = v; },
    });
    return row;
  }

  // --- 布尔行 ---
  function boolRow(field) {
    const row = document.createElement('div');
    row.className = 'dev-row';
    row.innerHTML = `<div class="top"><span class="nm">${field.name}</span><span class="pth">${field.path}</span></div>`;
    const ctrl = document.createElement('div');
    ctrl.className = 'dev-ctrl';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => { writePath(field.path, box.checked); apply(field.path); });
    ctrl.append(box);
    row.appendChild(ctrl);
    controls.push({ path: field.path, refresh: () => { box.checked = !!readPath(field.path); } });
    return row;
  }

  // --- 下拉行 ---
  function selectRow(field) {
    const row = document.createElement('div');
    row.className = 'dev-row';
    row.innerHTML = `<div class="top"><span class="nm">${field.name}</span><span class="pth">${field.path}</span></div>`;
    const ctrl = document.createElement('div');
    ctrl.className = 'dev-ctrl';
    const sel = document.createElement('select');
    field.options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => { writePath(field.path, sel.value); apply(field.path); });
    ctrl.append(sel);
    row.appendChild(ctrl);
    controls.push({ path: field.path, refresh: () => { sel.value = readPath(field.path); } });
    return row;
  }

  // --- 数组行（如各关基准时间 / 星级积分） ---
  function listRow(field) {
    const row = document.createElement('div');
    row.className = 'dev-row';
    row.innerHTML = `<div class="top"><span class="nm">${field.name}</span><span class="pth">${field.path}</span></div>`;
    const cur = readPath(field.path) || [];
    const wrap = document.createElement('div');
    wrap.className = 'dev-list';
    const inputs = [];
    const count = field.labels ? field.labels.length : cur.length;
    for (let i = 0; i < count; i++) {
      const lab = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = (field.labels && field.labels[i]) || `#${i}`;
      const num = document.createElement('input');
      num.type = 'number';
      num.min = field.min ?? 0; num.max = field.max ?? 999; num.step = field.step ?? 1;
      num.addEventListener('input', () => {
        const arr = readPath(field.path);
        const v = parseFloat(num.value);
        if (!Number.isNaN(v)) { arr[i] = v; apply(field.path); }
      });
      inputs.push(num);
      lab.append(span, num);
      wrap.appendChild(lab);
    }
    row.appendChild(wrap);
    controls.push({
      path: field.path,
      refresh: () => {
        const arr = readPath(field.path) || [];
        inputs.forEach((inp, i) => { inp.value = arr[i] ?? 0; });
      },
    });
    return row;
  }

  // --- 商店行（CONFIG.shopItems[i].price） ---
  function shopRow(field) {
    const row = document.createElement('div');
    row.className = 'dev-row';
    row.innerHTML = `<div class="top"><span class="nm">${field.name}</span><span class="pth">shopItems[].price</span></div>`;
    const wrap = document.createElement('div');
    wrap.className = 'dev-list';
    const inputs = [];
    CONFIG.shopItems.forEach((item, i) => {
      const lab = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = item.name;
      const num = document.createElement('input');
      num.type = 'number';
      num.min = field.min ?? 0; num.max = field.max ?? 9999; num.step = field.step ?? 5;
      num.addEventListener('input', () => {
        const v = parseFloat(num.value);
        if (!Number.isNaN(v)) { CONFIG.shopItems[i].price = v; apply('shopItems'); }
      });
      inputs.push(num);
      lab.append(span, num);
      wrap.appendChild(lab);
    });
    row.appendChild(wrap);
    controls.push({
      path: 'shopItems',
      refresh: () => { CONFIG.shopItems.forEach((it, i) => { if (inputs[i]) inputs[i].value = it.price; }); },
    });
    return row;
  }

  // --- 关卡调试分组（动作按钮，不写入 CONFIG） ---
  const STATE_LABEL = { playing: '进行中', loadout: '出击准备', won: '已通关', lost: '失败' };

  function renderActionsGroup(g) {
    const sec = document.createElement('section');
    sec.className = 'dev-group';           // 默认展开，便于快速切关
    const h = document.createElement('h4');
    const title = document.createElement('span');
    title.textContent = g.name;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    h.append(title, cnt);
    h.addEventListener('click', () => sec.classList.toggle('collapsed'));
    const rows = document.createElement('div');
    rows.className = 'dev-rows';

    const mkBtn = (wrap, label, fn) => {
      const b = document.createElement('div');
      b.className = 'dev-btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      wrap.appendChild(b);
      return b;
    };

    // 跳转到关卡
    const jumpRow = document.createElement('div');
    jumpRow.className = 'dev-row';
    jumpRow.innerHTML = '<div class="top"><span class="nm">跳转到关卡</span><span class="pth">loadLevel(i)</span></div>';
    const jumpWrap = document.createElement('div');
    jumpWrap.className = 'dev-actions';
    const levelBtns = LEVELS.map((lv, i) => {
      const b = mkBtn(jumpWrap, `第${lv.id}关`, () => { game.loadLevel(i); sync(); });
      b.title = lv.title;
      return { b, i };
    });
    jumpRow.appendChild(jumpWrap);

    // 关卡操作
    const opRow = document.createElement('div');
    opRow.className = 'dev-row';
    opRow.innerHTML = '<div class="top"><span class="nm">操作</span><span class="pth">level</span></div>';
    const opWrap = document.createElement('div');
    opWrap.className = 'dev-actions';
    mkBtn(opWrap, '◀ 上一关', () => { game.loadLevel((game.levelIndex - 1 + LEVELS.length) % LEVELS.length); sync(); });
    mkBtn(opWrap, '重开本关', () => { game.loadLevel(game.levelIndex); sync(); });
    mkBtn(opWrap, '下一关 ▶', () => { game.loadLevel((game.levelIndex + 1) % LEVELS.length); sync(); });
    mkBtn(opWrap, '直接通关本关', () => {
      game.__devSkipSave = true;           // 测试通关不写积分/存档
      game.endLevel(true);
      game.__devSkipSave = false;
      sync();
    });
    opRow.appendChild(opWrap);

    // 状态信息
    const infoRow = document.createElement('div');
    infoRow.className = 'dev-row';
    infoRow.innerHTML = '<div class="top"><span class="nm">状态</span><span class="pth">info</span></div>';
    const info = document.createElement('div');
    info.className = 'dev-info';
    infoRow.appendChild(info);

    rows.append(jumpRow, opRow, infoRow);
    sec.append(h, rows);

    function sync() {
      cnt.textContent = `当前：第 ${game.level.id} 关`;
      levelBtns.forEach(({ b, i }) => b.classList.toggle('cur', i === game.levelIndex));
      info.textContent = `${game.level.title} ｜ 状态 ${STATE_LABEL[game.state] || game.state}`
        + ` ｜ 已通关 ${game.clearedLevels.length}/${LEVELS.filter((lv) => !lv.walkTutorial).length} ｜ 积分 ${Math.round(game.points)}`;
    }
    sync();
    actionSyncs.push(sync);
    return sec;
  }

  // --- 界面布局分组（非 CONFIG：读写 uitune 模块的存储值） ---
  function renderUIGroup(g) {
    const uiTune = game.uiTune;
    const sec = document.createElement('section');
    sec.className = 'dev-group';           // 默认展开，便于直接拖
    const h = document.createElement('h4');
    const title = document.createElement('span');
    title.textContent = g.name;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    h.append(title, cnt);
    h.addEventListener('click', () => sec.classList.toggle('collapsed'));
    const rows = document.createElement('div');
    rows.className = 'dev-rows';

    if (!uiTune) {
      const warn = document.createElement('div');
      warn.className = 'dev-info';
      warn.textContent = '界面调试模块未加载。';
      rows.appendChild(warn);
      sec.append(h, rows);
      return sec;
    }

    const refreshers = [];
    cnt.textContent = `${uiTune.targets.length} 个元素`;

    const mkBtn = (wrap, label, fn) => {
      const b = document.createElement('div');
      b.className = 'dev-btn';
      b.textContent = label;
      b.addEventListener('click', fn);
      wrap.appendChild(b);
      return b;
    };

    // 拖动模式 / 复位
    const opRow = document.createElement('div');
    opRow.className = 'dev-row';
    opRow.innerHTML = '<div class="top"><span class="nm">拖动模式</span><span class="pth">ui</span></div>';
    const opWrap = document.createElement('div');
    opWrap.className = 'dev-actions';
    const editBtn = mkBtn(opWrap, '开启拖动模式', () => {
      const on = !uiTune.isEditing();
      uiTune.setEdit(on);
      editBtn.textContent = on ? '● 拖动中（点此关闭）' : '开启拖动模式';
      editBtn.classList.toggle('cur', on);
    });
    mkBtn(opWrap, '全部复位', () => uiTune.resetAll());
    mkBtn(opWrap, '标签字号复位', () => uiTune.resetLabels());
    opRow.appendChild(opWrap);
    rows.appendChild(opRow);

    // 每个 UI 元素一行：X / Y / 大小 + 显隐 + 单项复位
    uiTune.targets.forEach((tg) => {
      const row = document.createElement('div');
      row.className = 'dev-row';
      row.innerHTML = `<div class="top"><span class="nm">${tg.name}</span><span class="pth">${tg.sel}</span></div>`;
      const stack = document.createElement('div');
      stack.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

      const addSlider = (label, min, max, step, get, set) => {
        const ctrl = document.createElement('div');
        ctrl.className = 'dev-ctrl';
        const nm = document.createElement('span');
        nm.textContent = label;
        nm.style.cssText = 'min-width:34px;font-size:11px;color:var(--ink-soft);';
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step;
        const num = document.createElement('input');
        num.type = 'number'; num.min = min; num.max = max; num.step = step;
        const sync = (v, fromSlider) => {
          const val = parseFloat(v);
          if (Number.isNaN(val)) return;
          set(val);
          if (fromSlider) num.value = val; else slider.value = val;
        };
        slider.addEventListener('input', () => sync(slider.value, true));
        num.addEventListener('input', () => sync(num.value, false));
        ctrl.append(nm, slider, num);
        stack.appendChild(ctrl);
        refreshers.push(() => {
          const v = get();
          slider.value = v;
          num.value = Math.round(v * 100) / 100;
        });
      };

      addSlider('X', -1200, 1200, 1, () => uiTune.get(tg.id).x, (v) => uiTune.set(tg.id, 'x', v));
      addSlider('Y', -1200, 1200, 1, () => uiTune.get(tg.id).y, (v) => uiTune.set(tg.id, 'y', v));
      addSlider('大小', uiTune.scaleMin, uiTune.scaleMax, 0.05, () => uiTune.get(tg.id).scale, (v) => uiTune.set(tg.id, 'scale', v));

      const last = document.createElement('div');
      last.className = 'dev-ctrl';
      const lab = document.createElement('label');
      lab.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--ink-soft);';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.addEventListener('change', () => uiTune.set(tg.id, 'visible', box.checked));
      lab.append(box, document.createTextNode('显示'));
      const one = document.createElement('div');
      one.className = 'dev-btn';
      one.textContent = '复位此项';
      one.style.marginLeft = 'auto';
      one.addEventListener('click', () => uiTune.resetOne(tg.id));
      last.append(lab, one);
      stack.appendChild(last);
      refreshers.push(() => { box.checked = uiTune.get(tg.id).visible !== false; });

      row.appendChild(stack);
      rows.appendChild(row);
    });

    // 头顶世界标签：只能整体调字号（3D 投影定位，无法拖动）
    const labRow = document.createElement('div');
    labRow.className = 'dev-row';
    labRow.innerHTML = '<div class="top"><span class="nm">头顶标签字号</span><span class="pth">--ui-label-scale</span></div>';
    const labCtrl = document.createElement('div');
    labCtrl.className = 'dev-ctrl';
    const lSlider = document.createElement('input');
    lSlider.type = 'range'; lSlider.min = 0.5; lSlider.max = 2; lSlider.step = 0.05;
    const lNum = document.createElement('input');
    lNum.type = 'number'; lNum.min = 0.5; lNum.max = 2; lNum.step = 0.05;
    const lSync = (v, fromSlider) => {
      const val = parseFloat(v);
      if (Number.isNaN(val)) return;
      uiTune.setLabelScale(val);
      if (fromSlider) lNum.value = val; else lSlider.value = val;
    };
    lSlider.addEventListener('input', () => lSync(lSlider.value, true));
    lNum.addEventListener('input', () => lSync(lNum.value, false));
    labCtrl.append(lSlider, lNum);
    labRow.appendChild(labCtrl);
    refreshers.push(() => { const v = uiTune.getLabelScale(); lSlider.value = v; lNum.value = v; });
    rows.appendChild(labRow);

    const info = document.createElement('div');
    info.className = 'dev-info';
    info.textContent = '拖动模式：直接在画面上拖拽各块 UI；头顶标签由 3D 投影每帧定位，只能整体调字号。改动自动保存。';
    rows.appendChild(info);

    const refresh = () => refreshers.forEach((fn) => fn());
    refresh();
    uiTune.onChange(refresh);      // 拖动 / 复位后回填面板数值
    actionSyncs.push(refresh);     // 面板打开时同步一次
    sec.append(h, rows);
    return sec;
  }

  // --- 渲染一个分组卡片 ---
  function renderGroup(g) {
    if (g.type === 'actions') return renderActionsGroup(g);
    if (g.type === 'ui') return renderUIGroup(g);
    const sec = document.createElement('section');
    sec.className = 'dev-group collapsed';
    const h = document.createElement('h4');
    const title = document.createElement('span');
    title.textContent = g.name;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = `${g.fields.length} 项`;
    h.append(title, cnt);
    h.addEventListener('click', () => sec.classList.toggle('collapsed'));
    const rows = document.createElement('div');
    rows.className = 'dev-rows';
    g.fields.forEach((f) => {
      if (f.type === 'bool') rows.appendChild(boolRow(f));
      else if (f.type === 'select') rows.appendChild(selectRow(f));
      else if (f.type === 'list') rows.appendChild(listRow(f));
      else if (f.type === 'shop') rows.appendChild(shopRow(f));
      else rows.appendChild(numRow(f));
    });
    sec.append(h, rows);
    return sec;
  }

  // --- 渲染整个面板（分类 → 分组 → 数值项） ---
  CATEGORIES.forEach((cat) => {
    const wrap = document.createElement('section');
    wrap.className = 'dev-cat-sec';
    const head = document.createElement('h3');
    head.className = 'dev-cat';
    const title = document.createElement('span');
    title.textContent = cat.name;
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = `${cat.groups.length} 组`;
    head.append(title, cnt);
    head.addEventListener('click', () => wrap.classList.toggle('collapsed'));
    const inner = document.createElement('div');
    inner.className = 'dev-cat-body';
    cat.groups.forEach((k) => { if (GROUP[k]) inner.appendChild(renderGroup(GROUP[k])); });
    wrap.append(head, inner);
    body.appendChild(wrap);
  });

  // 复位到初始 CONFIG
  document.getElementById('dev-reset').onclick = () => {
    for (const k of Object.keys(defaults)) {
      const d = defaults[k];
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        for (const kk of Object.keys(d)) CONFIG[k][kk] = JSON.parse(JSON.stringify(d[kk]));
      } else {
        CONFIG[k] = JSON.parse(JSON.stringify(d));
      }
    }
    clearOverrides();              // 复位同时清空持久化的调试改动
    persistOverrides = false;      // 复位过程不回写
    controls.forEach((c) => c.refresh());
    controls.forEach((c) => apply(c.path));
    persistOverrides = true;
  };

  // 开合
  const refreshAll = () => {
    controls.forEach((c) => c.refresh());
    actionSyncs.forEach((fn) => fn());
  };
  const open = (on) => {
    panel.classList.toggle('show', on);
    toggle.classList.toggle('active', on);
    if (on) refreshAll();   // 打开时刷新关卡状态等信息
  };
  toggle.addEventListener('click', () => open(!panel.classList.contains('show')));
  document.getElementById('dev-close').addEventListener('click', () => open(false));

  refreshAll();

  // 载入的覆盖值需要让 game 重新同步「构造时已缓存」的项（NPC cfg / maxHealth / 横幅库存等）
  if (game.onConfigChanged) restoredPaths.forEach((p) => game.onConfigChanged(p));

  return { open, refresh: refreshAll };
}