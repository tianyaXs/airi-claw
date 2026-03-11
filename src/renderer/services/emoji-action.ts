/**
 * Emoji 动作控制器
 * 将 emoji 表情映射到 Live2D 模型参数，驱动角色表情变化
 *
 * 核心原理：挂载到 internalModel 的 beforeModelUpdate 事件，
 * 在 motion/physics 更新之后、model.update() 之前覆写参数，
 * 确保表情参数不会被 Idle motion 覆盖。
 */

import type { Live2DModel } from 'pixi-live2d-display/cubism4'

/** 表情参数定义（含肢体） */
export interface ExpressionParams {
  // 眼睛
  ParamEyeLOpen?: number
  ParamEyeROpen?: number
  ParamEyeLSmile?: number
  ParamEyeRSmile?: number
  ParamEyeBallX?: number
  ParamEyeBallY?: number
  // 眉毛
  ParamBrowLY?: number
  ParamBrowRY?: number
  ParamBrowLAngle?: number
  ParamBrowRAngle?: number
  ParamBrowLForm?: number
  ParamBrowRForm?: number
  // 嘴巴
  ParamMouthForm?: number
  ParamMouthOpenY?: number
  // 脸
  ParamCheek?: number
  ParamAngleX?: number
  ParamAngleY?: number
  ParamAngleZ?: number
  // 身体
  ParamBodyAngleX?: number
  ParamBodyAngleY?: number
  ParamBodyAngleZ?: number
  ParamBreath?: number
  ParamShoulder?: number
  ParamLeg?: number
  // 手臂
  ParamArmLA?: number
  ParamArmRA?: number
  ParamArmLB?: number
  ParamArmRB?: number
  ParamHandL?: number
  ParamHandR?: number
  ParamHandLB?: number
  ParamHandRB?: number
}

/** 表情定义 */
export interface ExpressionDef {
  name: string
  params: ExpressionParams
  /** 可选：同时触发的动作组名 */
  motion?: string
  /** 动作组内的索引 */
  motionIndex?: number
  /** 表情持续时间(ms)，0 = 持续到下一个表情 */
  duration: number
}

/** 动作标签定义 */
export interface MotionTagDef {
  name: string
  motionGroup: string
  index?: number // 动作组内的索引，undefined 表示随机
  duration: number
  description: string
}

// ============================================================
// Emoji -> 表情映射表
// ============================================================

const EXPRESSION_MAP: Record<string, ExpressionDef> = {
  // 中性/默认 - 待机循环
  neutral: {
    name: 'neutral',
    params: {},
    motion: 'Idle',
    // 不指定 index，让 Idle 循环播放 0,1,2
    duration: 0,
  },
  // 开心/打招呼并微笑 - Idle[4]
  happy: {
    name: 'happy',
    params: {},
    motion: 'Idle',
    motionIndex: 4,
    duration: 3000,
  },
  // 难过 - Idle[8]
  sad: {
    name: 'sad',
    params: {},
    motion: 'Idle',
    motionIndex: 8,
    duration: 3000,
  },
  // 生气/皱眉 - Idle[7]
  angry: {
    name: 'angry',
    params: {},
    motion: 'Idle',
    motionIndex: 7,
    duration: 3000,
  },
  // 思考 - Idle[3]
  think: {
    name: 'think',
    params: {},
    motion: 'Idle',
    motionIndex: 3,
    duration: 3000,
  },
  // 惊讶/吃惊 - Idle[5]
  surprised: {
    name: 'surprised',
    params: {},
    motion: 'Idle',
    motionIndex: 5,
    duration: 3000,
  },
  // 庆祝 - Idle[6]
  awkward: {
    name: 'awkward',
    params: {},
    motion: 'Idle',
    motionIndex: 6,
    duration: 3000,
  },
}

// 支持的7种表情
const EMOJI_TO_EXPRESSION: Record<string, string> = {
  // 开心/打招呼
  '😊': 'happy', '😄': 'happy', '😁': 'happy', '🙂': 'happy',
  '😃': 'happy', '☺️': 'happy', '😀': 'happy', '🥰': 'happy',
  '👋': 'happy', '🙋': 'happy', '🤚': 'happy',
  // 难过
  '😢': 'sad', '😭': 'sad', '😿': 'sad', '🥲': 'sad',
  '😞': 'sad', '😔': 'sad', '😥': 'sad', '☹️': 'sad', '😟': 'sad',
  // 生气/皱眉
  '😠': 'angry', '😡': 'angry', '🤬': 'angry', '💢': 'angry',
  '😒': 'angry',
  // 思考
  '🤔': 'think', '💭': 'think',
  // 惊讶/吃惊
  '😮': 'surprised', '😲': 'surprised', '🤯': 'surprised',
  '😱': 'surprised', '😳': 'surprised', '🫢': 'surprised',
  '😯': 'surprised',
  // 庆祝
  '🎉': 'awkward', '🎊': 'awkward', '🥳': 'awkward', 
  '👏': 'awkward', '🙌': 'awkward', '✨': 'awkward',
  // 中性/待机
  '😐': 'neutral', '😑': 'neutral', '😶': 'neutral',
}

// ============================================================
// 动作标签映射表
// ============================================================

/** 动作标签到动作定义的映射（一对一映射） */
const MOTION_TAG_MAP: Record<string, MotionTagDef> = {
  // 待机动作
  'idle': { name: 'idle', motionGroup: 'Idle', duration: 0, description: '待机动作（随机）' },

  // 点击动作
  'tap': { name: 'tap', motionGroup: 'TapBody', duration: 2000, description: '点击身体动作' },

  // 测试用：逐个测试 Idle 动作
  'test0': { name: 'test0', motionGroup: 'Idle', index: 0, duration: 3000, description: 'Idle[0]' },
  'test1': { name: 'test1', motionGroup: 'Idle', index: 1, duration: 3000, description: 'Idle[1]' },
  'test2': { name: 'test2', motionGroup: 'Idle', index: 2, duration: 3000, description: 'Idle[2]' },
  'test3': { name: 'test3', motionGroup: 'Idle', index: 3, duration: 3000, description: 'Idle[3]' },
  'test4': { name: 'test4', motionGroup: 'Idle', index: 4, duration: 3000, description: 'Idle[4]' },
  'test5': { name: 'test5', motionGroup: 'Idle', index: 5, duration: 3000, description: 'Idle[5]' },
  'test6': { name: 'test6', motionGroup: 'Idle', index: 6, duration: 3000, description: 'Idle[6]' },
  'test7': { name: 'test7', motionGroup: 'Idle', index: 7, duration: 3000, description: 'Idle[7]' },
  'test8': { name: 'test8', motionGroup: 'Idle', index: 8, duration: 3000, description: 'Idle[8]' },
}

/**
 * 弹簧状态：每个参数独立维护位置和速度
 */
interface SpringState {
  pos: number
  vel: number
}

/**
 * 动态轨道：在基础目标值上叠加周期动画，让肢体持续运动
 * target = base + amp * sin(freq * t + phase)
 */
interface DynamicTrack {
  paramId: string
  amplitude: number   // 摆动幅度
  frequency: number   // 频率 Hz
  phase: number       // 相位，让各肢体不同步
}

/**
 * 每种表情的动态轨道配置
 * 这些轨道叠加在静态目标值上，让角色在表情期间持续有肢体动作
 */
const EXPRESSION_TRACKS: Record<string, DynamicTrack[]> = {
  happy: [
    { paramId: 'ParamAngleZ',     amplitude: 1,   frequency: 0.4,  phase: 0 },
  ],
  sad: [
    { paramId: 'ParamAngleZ',     amplitude: 0.5, frequency: 0.15, phase: 0 },
  ],
  angry: [
    { paramId: 'ParamAngleX',     amplitude: 1,   frequency: 0.7,  phase: 0 },
  ],
  think: [
    { paramId: 'ParamAngleX',     amplitude: 0.8, frequency: 0.2,  phase: 0 },
    { paramId: 'ParamEyeBallX',   amplitude: 0.2, frequency: 0.15, phase: 0.2 },
  ],
  surprised: [
    { paramId: 'ParamAngleY',     amplitude: 1.5, frequency: 0.3,  phase: 0 },
  ],
  awkward: [
    { paramId: 'ParamAngleZ',     amplitude: 0.8, frequency: 0.25, phase: 0 },
  ],
  question: [
    { paramId: 'ParamAngleX',     amplitude: 1,   frequency: 0.3,  phase: 0 },
  ],
  curious: [
    { paramId: 'ParamEyeBallX',   amplitude: 0.3, frequency: 0.2,  phase: 0 },
  ],
}

/**
 * Emoji 动作控制器
 *
 * - 弹簧物理过渡：参数变化有弹性感
 * - 动态轨道：每种表情有专属肢体动画，角色在表情期间持续运动不卡死
 * - beforeModelUpdate 钩子：在 motion 之后覆写参数
 */
export class EmojiActionController {
  private model: Live2DModel | null = null
  private internalModel: any = null
  private currentExpression: string = 'neutral'
  private targetParams: ExpressionParams = {}
  private springs: Record<string, SpringState> = {}
  private durationTimer: ReturnType<typeof setTimeout> | null = null
  private active = false
  private lastTime = 0
  private origShouldRequestIdleMotion: (() => boolean) | null = null
  
  // 口型同步
  private lipSyncValue = 0
  private isLipSyncActive = false

  private readonly STIFFNESS = 80
  private readonly DAMPING = 14
  private readonly MASS = 1

  private onBeforeModelUpdate = () => {
    const now = performance.now() / 1000
    const dt = this.lastTime ? Math.min(now - this.lastTime, 0.05) : 0.016
    this.lastTime = now
    this.applyParams(dt, now)
  }

  bind(model: Live2DModel) {
    this.model = model
    this.internalModel = (model as any).internalModel
    if (!this.internalModel) {
      console.warn('[EmojiAction] internalModel not found')
      return
    }
    this.internalModel.on('beforeModelUpdate', this.onBeforeModelUpdate)
    
    // 禁用 Live2D 自身的 Idle 循环，我们手动控制
    const mm = this.internalModel.motionManager
    if (mm?.state) {
      if (!this.origShouldRequestIdleMotion) {
        this.origShouldRequestIdleMotion = mm.state.shouldRequestIdleMotion.bind(mm.state)
      }
      mm.state.shouldRequestIdleMotion = () => false
    }
    
    // 启动手动待机循环（只播放 0,1,2）
    this.startIdleLoop()
  }

  unbind() {
    this.stopIdleLoop()
    if (this.internalModel) {
      this.internalModel.off('beforeModelUpdate', this.onBeforeModelUpdate)
      const mm = this.internalModel.motionManager
      if (mm?.state && this.origShouldRequestIdleMotion) {
        mm.state.shouldRequestIdleMotion = this.origShouldRequestIdleMotion
        this.origShouldRequestIdleMotion = null
      }
      this.internalModel = null
    }
    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }
    if (this.motionTimer) {
      clearTimeout(this.motionTimer)
      this.motionTimer = null
    }
    this.model = null
  }

  triggerFromText(text: string): { type: 'expression' | 'motion'; name: string } | null {
    console.log('[EmojiAction] triggerFromText called with:', text.substring(0, 50))
    
    // 先检查动作标签
    const motionTag = this.extractMotionTag(text)
    console.log('[EmojiAction] motionTag:', motionTag)
    if (motionTag) {
      const success = this.triggerMotionByTag(motionTag)
      if (success) {
        return { type: 'motion', name: motionTag }
      }
    }

    // 再检查表情标签 [表情:xxx]
    const expressionTag = this.extractExpressionTag(text)
    console.log('[EmojiAction] expressionTag:', expressionTag)
    if (expressionTag) {
      console.log('[EmojiAction] Setting expression:', expressionTag)
      this.setExpression(expressionTag)
      return { type: 'expression', name: expressionTag }
    }

    // 最后检查表情 emoji
    const emoji = this.extractEmoji(text)
    console.log('[EmojiAction] emoji:', emoji)
    if (!emoji) return null
    const name = EMOJI_TO_EXPRESSION[emoji]
    if (!name) return null
    this.setExpression(name)
    return { type: 'expression', name }
  }

  /**
   * 从文本中提取动作标签
   * 支持格式：[动作:tagName] 或 [动作:中文名]
   */
  private extractMotionTag(text: string): string | null {
    const match = text.match(/\[动作[:：](\w+)\]/)
    if (match && match[1]) {
      const tag = match[1].toLowerCase()
      return MOTION_TAG_MAP[tag] ? tag : null
    }
    return null
  }

  /**
   * 从文本中提取表情标签
   * 支持格式：[表情:expressionName]
   */
  private extractExpressionTag(text: string): string | null {
    const match = text.match(/\[表情[:：](\w+)\]/)
    if (match && match[1]) {
      const tag = match[1].toLowerCase()
      return EXPRESSION_MAP[tag] ? tag : null
    }
    return null
  }

  // 动作恢复定时器
  private motionTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * 根据动作标签触发动作（公开方法供外部调用）
   */
  triggerMotionByTag(tag: string): boolean {
    const motionDef = MOTION_TAG_MAP[tag]
    if (!motionDef || !this.model) return false

    try {
      // 清除之前的动作定时器
      if (this.motionTimer) {
        clearTimeout(this.motionTimer)
        this.motionTimer = null
      }

      // 停止待机循环
      this.stopIdleLoop()
      
      // 停止当前动作
      const mm = this.internalModel?.motionManager
      if (mm) {
        mm.stopAllMotions()
      }

      // 播放指定动作
      if (motionDef.index !== undefined) {
        // 播放指定索引的动作
        this.model.motion(motionDef.motionGroup, motionDef.index)
      } else {
        // 播放动作组（随机或默认）
        this.model.motion(motionDef.motionGroup)
      }

      console.log('[EmojiAction] Triggered motion:', motionDef.name, '-', motionDef.description)

      // 设置定时器恢复到待机循环
      if (motionDef.duration > 0) {
        this.motionTimer = setTimeout(() => {
          this.startIdleLoop()
          console.log('[EmojiAction] Motion ended, returned to Idle loop')
        }, motionDef.duration)
      }

      return true
    } catch (e) {
      console.warn('[EmojiAction] Failed to trigger motion:', e)
      return false
    }
  }

  // 手动待机循环（只播放索引 0,1,2）
  private idleIndex = 0
  private idleLoopTimer: ReturnType<typeof setTimeout> | null = null

  private startIdleLoop() {
    if (this.idleLoopTimer) {
      clearTimeout(this.idleLoopTimer)
    }
    
    const playNextIdle = () => {
      if (!this.model || this.active) return
      
      try {
        // 只循环播放 0, 1, 2
        this.model.motion('Idle', this.idleIndex)
        this.idleIndex = (this.idleIndex + 1) % 3
        
        // 3秒后播放下一个
        this.idleLoopTimer = setTimeout(playNextIdle, 3000)
      } catch (e) {
        console.warn('[EmojiAction] Idle loop failed:', e)
      }
    }
    
    playNextIdle()
  }

  private stopIdleLoop() {
    if (this.idleLoopTimer) {
      clearTimeout(this.idleLoopTimer)
      this.idleLoopTimer = null
    }
  }

  setExpression(name: string) {
    const expr = EXPRESSION_MAP[name]
    if (!expr) return

    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }
    if (this.motionTimer) {
      clearTimeout(this.motionTimer)
      this.motionTimer = null
    }

    this.currentExpression = name
    this.targetParams = { ...expr.params }
    this.active = name !== 'neutral'

    const mm = this.internalModel?.motionManager

    if (this.active && mm) {
      mm.stopAllMotions()
      this.stopIdleLoop()
    }

    if (expr.motion && this.model) {
      try {
        // 播放指定动作
        if (expr.motionIndex !== undefined) {
          // 表情动作：播放指定索引（3-8），只播放一次
          console.log(`[EmojiAction] Playing motion: ${expr.motion}[${expr.motionIndex}]`)
          this.model.motion(expr.motion, expr.motionIndex)
        } else {
          // neutral：启动手动待机循环（只循环 0,1,2）
          console.log('[EmojiAction] Starting idle loop')
          this.startIdleLoop()
        }
        
        // 表情动作结束后恢复待机循环
        if (this.active && expr.duration > 0) {
          this.motionTimer = setTimeout(() => {
            this.setExpression('neutral')
          }, expr.duration)
        }
      } catch (e) {
        console.warn('[EmojiAction] Motion failed:', e)
      }
    } else {
      console.log('[EmojiAction] No motion to play:', { hasMotion: !!expr.motion, hasModel: !!this.model })
    }

    if (!this.active) {
      this.springs = {}
      // 启动手动待机循环
      this.startIdleLoop()
    }

    console.log('[EmojiAction] setExpression:', name, this.active ? '(active)' : '(idle)')
  }

  reset() { this.setExpression('neutral') }
  getCurrentExpression(): string { return this.currentExpression }
  static getAvailableExpressions(): string[] { return Object.keys(EXPRESSION_MAP) }
  static getSupportedEmojis(): Record<string, string> { return { ...EMOJI_TO_EXPRESSION } }

  // 口型同步：设置口型开合值 (0-1)
  setLipSync(value: number) {
    this.lipSyncValue = Math.max(0, Math.min(1, value))
    this.isLipSyncActive = value > 0.05
    if (this.isLipSyncActive) {
      console.log('[EmojiAction] 口型同步值:', value.toFixed(2))
    }
  }

  private applyParams(dt: number, now: number) {
    if (!this.internalModel) return
    const coreModel = this.internalModel.coreModel
    if (!coreModel) return

    // 1. 口型同步（最高优先级，独立于表情系统）
    if (this.isLipSyncActive) {
      try { coreModel.setParameterValueById('ParamMouthOpenY', this.lipSyncValue) } catch {}
    }

    // 2. 表情动画（只在 active 时执行）
    if (!this.active) return

    // 2.1 弹簧物理
    for (const [key, target] of Object.entries(this.targetParams)) {
      // 口型同步激活时，跳过 ParamMouthOpenY 的弹簧计算（已被口型同步覆盖）
      if (this.isLipSyncActive && key === 'ParamMouthOpenY') continue

      if (!this.springs[key]) {
        this.springs[key] = { pos: this.readParam(coreModel, key), vel: 0 }
      }
      const spring = this.springs[key]
      const accel = (this.STIFFNESS * (target - spring.pos) - this.DAMPING * spring.vel) / this.MASS
      spring.vel += accel * dt
      spring.pos += spring.vel * dt
      if (Math.abs(target - spring.pos) < 0.01 && Math.abs(spring.vel) < 0.01) {
        spring.pos = target
        spring.vel = 0
      }
      try { coreModel.setParameterValueById(key, spring.pos) } catch {}
    }

    // 2.2 动态轨道
    const tracks = EXPRESSION_TRACKS[this.currentExpression]
    if (tracks) {
      for (const track of tracks) {
        // 口型同步激活时，跳过 ParamMouthOpenY 的动态轨道
        if (this.isLipSyncActive && track.paramId === 'ParamMouthOpenY') continue

        const base = this.springs[track.paramId]?.pos
          ?? (this.targetParams as any)[track.paramId]
          ?? 0
        const delta = Math.sin(now * track.frequency * Math.PI * 2 + track.phase) * track.amplitude
        try { coreModel.setParameterValueById(track.paramId, base + delta) } catch {}
      }
    }
  }

  private readParam(coreModel: any, id: string): number {
    try {
      const idx = coreModel.getParameterIndex(id)
      if (idx >= 0) return coreModel.getParameterValueByIndex(idx)
    } catch {}
    return 0
  }

  private extractEmoji(text: string): string | null {
    const re = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{2764}][\u{FE0F}\u{200D}\u{1F600}-\u{1FAFF}]*/gu
    const matches = text.match(re)
    if (!matches) return null
    for (const m of matches) {
      if (EMOJI_TO_EXPRESSION[m]) return m
    }
    return null
  }
}