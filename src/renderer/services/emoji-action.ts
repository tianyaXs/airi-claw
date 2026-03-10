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
  /** 表情持续时间(ms)，0 = 持续到下一个表情 */
  duration: number
}

// ============================================================
// Emoji -> 表情映射表
// ============================================================

const EXPRESSION_MAP: Record<string, ExpressionDef> = {
  // 开心微笑 - 身体微微前倾，双臂自然放松
  happy: {
    name: 'happy',
    params: {
      ParamEyeLSmile: 1, ParamEyeRSmile: 1,
      ParamMouthForm: 8, ParamMouthOpenY: 1,
      ParamBrowLY: 2, ParamBrowRY: 2,
      ParamAngleZ: 5, ParamBodyAngleZ: 3,
      ParamArmLA: 3, ParamArmRA: 3,
    },
    duration: 0,
  },
  // 大笑 - 身体前倾，双臂张开，头仰起
  laugh: {
    name: 'laugh',
    params: {
      ParamEyeLSmile: 1, ParamEyeRSmile: 1,
      ParamEyeLOpen: 1, ParamEyeROpen: 1,
      ParamMouthForm: 8, ParamMouthOpenY: 5,
      ParamBrowLY: 3, ParamBrowRY: 3,
      ParamAngleY: 10, ParamAngleZ: 8,
      ParamBodyAngleY: 8, ParamBodyAngleZ: 5,
      ParamArmLA: 6, ParamArmRA: 6,
      ParamShoulder: 3,
    },
    motion: 'TapBody',
    duration: 3000,
  },
  // 难过 - 头低垂，身体缩起，手臂内收
  sad: {
    name: 'sad',
    params: {
      ParamEyeLOpen: 2, ParamEyeROpen: 2,
      ParamBrowLY: -0.4, ParamBrowRY: -0.4,
      ParamBrowLAngle: -0.8, ParamBrowRAngle: -0.8,
      ParamMouthForm: -2,
      ParamAngleY: -15, ParamAngleZ: -8,
      ParamBodyAngleX: -5, ParamBodyAngleY: -5,
      ParamArmLA: -5, ParamArmRA: -5,
      ParamShoulder: -0.5,
    },
    duration: 0,
  },
  // 生气 - 身体前倾，双臂叉腰，眉头紧皱
  angry: {
    name: 'angry',
    params: {
      ParamEyeLOpen: 5, ParamEyeROpen: 5,
      ParamBrowLY: -0.4, ParamBrowRY: -0.4,
      ParamBrowLAngle: -1, ParamBrowRAngle: -1,
      ParamMouthForm: -2, ParamMouthOpenY: 1,
      ParamAngleX: -10, ParamAngleY: -5,
      ParamBodyAngleX: -8, ParamBodyAngleZ: -5,
      ParamArmLA: -8, ParamArmRA: -8,
      ParamShoulder: 5,
    },
    duration: 0,
  },
  // 惊讶 - 身体后仰，双臂张开，嘴巴大开
  surprised: {
    name: 'surprised',
    params: {
      ParamEyeLOpen: 7, ParamEyeROpen: 7,
      ParamBrowLY: 4, ParamBrowRY: 4,
      ParamMouthOpenY: 6, ParamMouthForm: 0,
      ParamAngleY: 15, ParamAngleZ: 5,
      ParamBodyAngleY: 8,
      ParamArmLA: 5, ParamArmRA: 5,
      ParamShoulder: 6,
    },
    duration: 3000,
  },
  // 害羞脸红 - 头低垂偏转，双手捂脸，身体缩起
  shy: {
    name: 'shy',
    params: {
      ParamCheek: 8,
      ParamEyeLOpen: 2, ParamEyeROpen: 2,
      ParamEyeLSmile: 1, ParamEyeRSmile: 1,
      ParamMouthForm: 3,
      ParamAngleX: -5, ParamAngleY: -15, ParamAngleZ: -8,
      ParamBodyAngleX: -5, ParamBodyAngleZ: -5,
      ParamArmLA: -3, ParamArmRA: -3,
      ParamHandL: 3, ParamHandR: 3,
    },
    duration: 0,
  },
  // 困倦 - 头歪，身体松垮，手臂下垂
  sleepy: {
    name: 'sleepy',
    params: {
      ParamEyeLOpen: 0.5, ParamEyeROpen: 0.5,
      ParamBrowLY: -0.3, ParamBrowRY: -0.3,
      ParamMouthOpenY: 3, ParamMouthForm: 0,
      ParamAngleY: -10, ParamAngleZ: -15,
      ParamBodyAngleX: -3, ParamBodyAngleZ: -8,
      ParamArmLA: -8, ParamArmRA: -8,
      ParamShoulder: -0.8,
    },
    duration: 0,
  },
  // 思考 - 头侧倾，一手托腮，眼神偏移
  thinking: {
    name: 'thinking',
    params: {
      ParamEyeBallX: -0.5, ParamEyeBallY: 0.5,
      ParamBrowLY: 2, ParamBrowRY: -0.2,
      ParamBrowLAngle: 0.3, ParamBrowRAngle: -0.3,
      ParamMouthForm: -1,
      ParamAngleX: 8, ParamAngleY: 8, ParamAngleZ: 5,
      ParamBodyAngleX: 3, ParamBodyAngleZ: 3,
      ParamArmLA: -5, ParamArmRA: 4,
      ParamHandR: 4,
    },
    duration: 0,
  },
  // 得意坏笑 - 身体后仰，一臂叉腰，头微扬
  smirk: {
    name: 'smirk',
    params: {
      ParamEyeLSmile: 1, ParamEyeRSmile: 0.3,
      ParamEyeLOpen: 3, ParamEyeROpen: 5,
      ParamMouthForm: 6,
      ParamBrowLY: 1, ParamBrowRY: 3,
      ParamAngleY: 8, ParamAngleZ: 5,
      ParamBodyAngleY: 5, ParamBodyAngleZ: 3,
      ParamArmLA: -6, ParamArmRA: 5,
      ParamShoulder: 3,
    },
    duration: 0,
  },
  // 心动喜爱 - 身体前倾，双臂抱胸，脸红
  love: {
    name: 'love',
    params: {
      ParamCheek: 6,
      ParamEyeLSmile: 1, ParamEyeRSmile: 1,
      ParamEyeLOpen: 3, ParamEyeROpen: 3,
      ParamMouthForm: 8, ParamMouthOpenY: 1,
      ParamAngleZ: 8, ParamAngleY: 5,
      ParamBodyAngleY: 5, ParamBodyAngleZ: 5,
      ParamArmLA: 4, ParamArmRA: 4,
      ParamHandL: 4, ParamHandR: 4,
    },
    duration: 0,
  },
  // 打招呼 - 一臂高举挥手，身体微倾
  wave: {
    name: 'wave',
    params: {
      ParamEyeLSmile: 1, ParamEyeRSmile: 1,
      ParamMouthForm: 8, ParamMouthOpenY: 1,
      ParamBrowLY: 2, ParamBrowRY: 2,
      ParamAngleZ: 5, ParamBodyAngleZ: 3,
      ParamArmLA: 7, ParamArmRA: -3,
      ParamHandL: 5,
    },
    duration: 4000,
  },
  // 点头赞同 - 身体前倾，双臂自然，表情认真
  nod: {
    name: 'nod',
    params: {
      ParamEyeLOpen: 5, ParamEyeROpen: 5,
      ParamMouthForm: 3,
      ParamBrowLY: 1, ParamBrowRY: 1,
      ParamAngleY: -8, ParamBodyAngleY: -5,
      ParamArmLA: 2, ParamArmRA: 2,
    },
    duration: 2000,
  },
  // 中性/默认
  neutral: {
    name: 'neutral',
    params: {},
    duration: 0,
  },
}

const EMOJI_TO_EXPRESSION: Record<string, string> = {
  '😊': 'happy', '😄': 'happy', '😁': 'happy', '🙂': 'happy',
  '😃': 'happy', '☺️': 'happy', '😀': 'happy',
  '😂': 'laugh', '🤣': 'laugh', '😆': 'laugh', '😹': 'laugh',
  '😢': 'sad', '😭': 'sad', '😿': 'sad', '🥲': 'sad',
  '😞': 'sad', '😔': 'sad', '😥': 'sad', '☹️': 'sad',
  '😠': 'angry', '😡': 'angry', '🤬': 'angry', '💢': 'angry', '😤': 'angry',
  '😮': 'surprised', '😲': 'surprised', '🤯': 'surprised',
  '😱': 'surprised', '😳': 'surprised', '🫢': 'surprised',
  '🥺': 'shy', '😚': 'shy', '☺': 'shy',
  '😴': 'sleepy', '💤': 'sleepy', '🥱': 'sleepy', '😪': 'sleepy',
  '🤔': 'thinking', '🧐': 'thinking', '💭': 'thinking',
  '😏': 'smirk', '😼': 'smirk', '😎': 'smirk', '🤭': 'smirk',
  '😍': 'love', '❤️': 'love', '💕': 'love', '💖': 'love',
  '🥰': 'love', '💗': 'love', '😘': 'love',
  '👋': 'wave', '🙋': 'wave', '🤚': 'wave',
  '👍': 'nod', '✅': 'nod', '👌': 'nod',
  '😐': 'neutral', '😑': 'neutral', '😶': 'neutral',
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
    { paramId: 'ParamAngleZ',     amplitude: 2,   frequency: 0.4,  phase: 0 },
    { paramId: 'ParamBodyAngleZ', amplitude: 1.2, frequency: 0.35, phase: 0.8 },
    { paramId: 'ParamArmLA',      amplitude: 1.5, frequency: 0.5,  phase: 0.3 },
    { paramId: 'ParamArmRA',      amplitude: 1.5, frequency: 0.5,  phase: 1.5 },
  ],
  laugh: [
    { paramId: 'ParamAngleY',     amplitude: 5,   frequency: 0.8,  phase: 0 },
    { paramId: 'ParamBodyAngleY', amplitude: 3,   frequency: 0.8,  phase: 0.2 },
    { paramId: 'ParamAngleZ',     amplitude: 3,   frequency: 0.6,  phase: 0.5 },
    { paramId: 'ParamArmLA',      amplitude: 3,   frequency: 0.9,  phase: 0 },
    { paramId: 'ParamArmRA',      amplitude: 3,   frequency: 0.9,  phase: 0.4 },
    { paramId: 'ParamShoulder',   amplitude: 1.5, frequency: 0.8,  phase: 0.1 },
  ],
  sad: [
    { paramId: 'ParamAngleZ',     amplitude: 1,   frequency: 0.15, phase: 0 },
    { paramId: 'ParamBodyAngleZ', amplitude: 0.6, frequency: 0.12, phase: 1 },
    { paramId: 'ParamArmLA',      amplitude: 0.8, frequency: 0.18, phase: 0.5 },
    { paramId: 'ParamArmRA',      amplitude: 0.8, frequency: 0.18, phase: 1.8 },
  ],
  angry: [
    { paramId: 'ParamAngleX',     amplitude: 2,   frequency: 0.7,  phase: 0 },
    { paramId: 'ParamBodyAngleX', amplitude: 1.5, frequency: 0.7,  phase: 0.1 },
    { paramId: 'ParamAngleZ',     amplitude: 1.5, frequency: 0.6,  phase: 0.3 },
    { paramId: 'ParamShoulder',   amplitude: 1.5, frequency: 0.5,  phase: 0 },
  ],
  surprised: [
    { paramId: 'ParamAngleY',     amplitude: 3,   frequency: 0.3,  phase: 0 },
    { paramId: 'ParamBodyAngleY', amplitude: 2,   frequency: 0.25, phase: 0.5 },
    { paramId: 'ParamArmLA',      amplitude: 2,   frequency: 0.35, phase: 0.2 },
    { paramId: 'ParamArmRA',      amplitude: 2,   frequency: 0.35, phase: 1.2 },
  ],
  shy: [
    { paramId: 'ParamAngleZ',     amplitude: 1.5, frequency: 0.25, phase: 0 },
    { paramId: 'ParamBodyAngleZ', amplitude: 0.8, frequency: 0.2,  phase: 0.7 },
    { paramId: 'ParamArmLA',      amplitude: 0.8, frequency: 0.3,  phase: 0.4 },
    { paramId: 'ParamArmRA',      amplitude: 0.8, frequency: 0.3,  phase: 1.6 },
    { paramId: 'ParamHandL',      amplitude: 0.5, frequency: 0.4,  phase: 0.2 },
    { paramId: 'ParamHandR',      amplitude: 0.5, frequency: 0.4,  phase: 1.0 },
  ],
  sleepy: [
    { paramId: 'ParamAngleZ',     amplitude: 3,   frequency: 0.1,  phase: 0 },
    { paramId: 'ParamBodyAngleZ', amplitude: 2,   frequency: 0.08, phase: 0.5 },
    { paramId: 'ParamAngleY',     amplitude: 1.5, frequency: 0.12, phase: 1.0 },
    { paramId: 'ParamArmLA',      amplitude: 1,   frequency: 0.1,  phase: 0.3 },
    { paramId: 'ParamArmRA',      amplitude: 1,   frequency: 0.1,  phase: 1.5 },
  ],
  thinking: [
    { paramId: 'ParamAngleX',     amplitude: 1.5, frequency: 0.2,  phase: 0 },
    { paramId: 'ParamAngleZ',     amplitude: 1,   frequency: 0.18, phase: 0.6 },
    { paramId: 'ParamEyeBallX',   amplitude: 0.3, frequency: 0.15, phase: 0.2 },
    { paramId: 'ParamArmRA',      amplitude: 0.8, frequency: 0.25, phase: 0 },
  ],
  smirk: [
    { paramId: 'ParamAngleZ',     amplitude: 1.5, frequency: 0.3,  phase: 0 },
    { paramId: 'ParamBodyAngleY', amplitude: 1.5, frequency: 0.25, phase: 0.4 },
    { paramId: 'ParamArmLA',      amplitude: 1,   frequency: 0.35, phase: 0.8 },
  ],
  love: [
    { paramId: 'ParamAngleZ',     amplitude: 2.5, frequency: 0.35, phase: 0 },
    { paramId: 'ParamBodyAngleZ', amplitude: 1.5, frequency: 0.3,  phase: 0.6 },
    { paramId: 'ParamArmLA',      amplitude: 1.5, frequency: 0.4,  phase: 0.3 },
    { paramId: 'ParamArmRA',      amplitude: 1.5, frequency: 0.4,  phase: 1.4 },
    { paramId: 'ParamHandL',      amplitude: 0.8, frequency: 0.5,  phase: 0.1 },
    { paramId: 'ParamHandR',      amplitude: 0.8, frequency: 0.5,  phase: 1.2 },
  ],
  wave: [
    { paramId: 'ParamArmLA',      amplitude: 4,   frequency: 1.2,  phase: 0 },
    { paramId: 'ParamHandL',      amplitude: 2,   frequency: 1.2,  phase: 0.3 },
    { paramId: 'ParamAngleZ',     amplitude: 2,   frequency: 0.6,  phase: 0.5 },
    { paramId: 'ParamBodyAngleZ', amplitude: 1.2, frequency: 0.6,  phase: 0.8 },
  ],
  nod: [
    { paramId: 'ParamAngleY',     amplitude: 4,   frequency: 0.8,  phase: 0 },
    { paramId: 'ParamBodyAngleY', amplitude: 2.5, frequency: 0.8,  phase: 0.1 },
    { paramId: 'ParamAngleZ',     amplitude: 0.8, frequency: 0.4,  phase: 0.3 },
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
  }

  unbind() {
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
    this.model = null
  }

  triggerFromText(text: string): string | null {
    const emoji = this.extractEmoji(text)
    if (!emoji) return null
    const name = EMOJI_TO_EXPRESSION[emoji]
    if (!name) return null
    this.setExpression(name)
    return name
  }

  setExpression(name: string) {
    const expr = EXPRESSION_MAP[name]
    if (!expr) return

    if (this.durationTimer) {
      clearTimeout(this.durationTimer)
      this.durationTimer = null
    }

    this.currentExpression = name
    this.targetParams = { ...expr.params }
    this.active = name !== 'neutral'

    const mm = this.internalModel?.motionManager

    if (this.active && mm) {
      mm.stopAllMotions()
      if (!this.origShouldRequestIdleMotion && mm.state) {
        this.origShouldRequestIdleMotion = mm.state.shouldRequestIdleMotion.bind(mm.state)
        mm.state.shouldRequestIdleMotion = () => false
      }
    }

    if (expr.motion && this.model) {
      try { this.model.motion(expr.motion) } catch (e) {
        console.warn('[EmojiAction] Motion failed:', e)
      }
    }

    if (!this.active) {
      this.springs = {}
      if (mm?.state && this.origShouldRequestIdleMotion) {
        mm.state.shouldRequestIdleMotion = this.origShouldRequestIdleMotion
        this.origShouldRequestIdleMotion = null
      }
      try { this.model?.motion('Idle') } catch {}
    }

    if (expr.duration > 0) {
      this.durationTimer = setTimeout(() => this.setExpression('neutral'), expr.duration)
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