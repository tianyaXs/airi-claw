# AIRI Claw

轻量级 AIRI 虚拟形象 + OpenClaw Gateway 集成桌面应用

> 本项目 Live2D 实现参考了 [moeru-ai/airi](https://github.com/moeru-ai/airi.git) 仓库代码

## 功能特性

- 🤖 **Live2D 虚拟形象** - 支持 Live2D Cubism 4 模型渲染
- 💬 **OpenClaw 对话** - 通过 WebSocket 连接 OpenClaw Gateway 进行实时对话
- 🎨 **卡通桌面 UI** - 透明背景 + 木质桌面风格交互界面
- 🖱️ **窗口拖拽** - 拖动连接状态按钮移动窗口位置
- 📚 **聊天记录** - 笔记本风格的翻页聊天历史

## 系统要求

- Node.js >= 18.0.0
- OpenClaw Gateway 运行中 (默认端口 18789)

## 安装

```bash
# 克隆项目
git clone https://github.com/tianyaXs/airi-claw.git
cd airi-claw

# 安装依赖
npm install
```

## 配置

### 1. 环境变量配置

复制环境变量示例文件并修改：

```bash
cp .env.example .env
```

编辑 `.env` 文件：

```env
# 必需配置
VITE_OPENCLAW_URL=ws://127.0.0.1:18789
VITE_OPENCLAW_TOKEN=your_token_here

# 可选配置
VITE_OPENCLAW_AGENT=main
```

### 配置说明

#### VITE_OPENCLAW_TOKEN（认证令牌）

**获取方式：**

OpenClaw Gateway 启动时会生成或显示访问令牌，通常可以从以下位置获取：

1. **Gateway 启动日志**：启动 Gateway 时会在控制台输出 Token
   ```bash
   openclaw gateway start
   # 查看输出中的 token 字段
   ```

2. **Gateway 配置文件**：通常位于 `~/.openclaw/config.yaml` 或项目配置目录
   ```yaml
   # 在配置文件中查找 token 字段
   gateway:
     token: "your_token_here"
   ```

3. **首次连接**：某些版本的 Gateway 支持无 token 首次连接，连接成功后在客户端日志中查看

**注意：** Token 是敏感信息，请勿提交到 Git 仓库。

#### VITE_OPENCLAW_URL

WebSocket 服务地址，默认为 `ws://127.0.0.1:18789`

#### VITE_OPENCLAW_AGENT

Agent ID，用于指定对话的 AI 角色或预设配置：
- 不同的 Agent 可以配置不同的模型、系统提示词、工具等
- 默认值为 `main`，即使用 Gateway 的默认 Agent 配置
- 可以在 Gateway 配置中定义多个 Agent，如 `coder`、`writer` 等

#### VITE_OPENCLAW_SYSTEM_PROMPT

系统提示词，用于自定义 AI 的行为和回复风格：

- 会在每次对话时作为额外的系统提示词发送给 AI
- 可以用来改变 AI 的语气、角色、知识范围等
- 支持多行文本

**示例：**
```env
# 让 AI 用可爱的语气回答
VITE_OPENCLAW_SYSTEM_PROMPT=你是一个可爱的虚拟助手，请用可爱的语气回答用户的问题

# 让 AI 扮演特定角色
VITE_OPENCLAW_SYSTEM_PROMPT=你是一位专业的编程导师，请用简洁清晰的方式解释技术概念

# 多行提示词（换行用 \n）
VITE_OPENCLAW_SYSTEM_PROMPT=你是一个二次元虚拟主播，性格活泼开朗。\n回答问题时请：\n1. 使用颜文字和可爱的语气\n2. 适当加入一些网络流行语\n3. 保持友好和耐心
```

**配置优先级：**
环境变量 > config.json > 默认值


## 使用

### 开发模式

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

构建后的文件位于 `out/` 目录。

## 界面说明

### 主界面

- **中央**：Live2D 虚拟形象
- **右上角**：连接状态指示器（可拖拽移动窗口）
- **底部**：卡通书桌

### 桌面物品

- **钢笔** 📎 - 点击打开输入框发送消息
- **笔记本** 📓 - 查看聊天历史（支持翻页）
- **橡皮擦** 🧹 - 清空聊天记录
- **相框** 🖼️ - 包含最小化和关闭按钮

### 操作说明

1. **发送消息**：点击钢笔图标 → 输入内容 → 点击发送
2. **查看历史**：点击笔记本图标翻页查看聊天记录
3. **移动窗口**：按住右上角的连接状态按钮拖动
4. **窗口控制**：点击相框中的按钮最小化或关闭

## 项目结构

```
airi-claw/
├── config.json              # 应用配置
├── .env.example             # 环境变量示例
├── src/
│   ├── main/
│   │   └── index.ts         # Electron 主进程
│   ├── preload/
│   │   └── index.ts         # 预加载脚本
│   └── renderer/
│       ├── pages/
│       │   └── AvatarViewer.vue   # 主界面
│       ├── components/
│       │   ├── ChatInput.vue      # 聊天输入组件
│       │   └── WindowControls.vue # 窗口控制
│       ├── services/
│       │   └── openclaw.ts        # OpenClaw 客户端
│       └── App.vue
├── public/
│   └── assets/
│       └── live2d/
│           └── models/        # Live2D 模型文件
└── out/                       # 构建输出目录
```

## 技术栈

- **Electron** - 桌面应用框架
- **Vue 3** - 前端框架
- **Vite** - 构建工具
- **TypeScript** - 类型安全
- **PixiJS** - 2D 渲染引擎
- **pixi-live2d-display** - Live2D 渲染
- **tweetnacl** - Ed25519 加密签名

## 致谢

本项目 Live2D 渲染实现参考了以下开源项目：

- **[moeru-ai/airi](https://github.com/moeru-ai/airi.git)** - Live2D 虚拟形象参考实现，提供了优秀的 Live2D 集成方案

## 常见问题

### Q: 连接失败 - "pairing required" 错误

如果看到 `pairing required` 或 `NOT_PAIRED` 错误，说明设备需要与 Gateway 进行配对。

**配对流程：**

1. **首次连接时**，Gateway 会返回配对请求 ID
2. **在终端批准配对**：
   ```bash
   # 查看待批准的配对请求
   openclaw devices list

   # 批准指定请求
   openclaw devices approve <requestId>
   ```

3. **重新启动 AIRI Claw** 应用

**为什么会出现配对？**

- 这是 OpenClaw 的安全机制，每个新设备都需要显式批准
- 设备身份基于 Ed25519 密钥对，存储在浏览器 localStorage
- 清除浏览器数据后需要重新配对

**自动配对（本地连接）：**

如果是本地连接（localhost），某些版本的 Gateway 会自动批准配对。如果不是，请手动执行上述步骤。

### Q: 连接失败 - 其他原因
确保 OpenClaw Gateway 已启动：
```bash
openclaw gateway start
```

### Q: 如何获取 OpenClaw Token？

Token 是连接 OpenClaw Gateway 的认证凭证。根据源码分析，获取方式如下：

**1. 查看已配置的 Token**

Token 存储在配置文件或环境变量中：

```bash
# 方式一：通过 CLI 命令查看
openclaw config get gateway.auth.token

# 方式二：查看配置文件
# 文件位置：~/.openclaw/openclaw.json (Linux/macOS)
cat ~/.openclaw/openclaw.json | grep token
```

配置文件路径：`~/.openclaw/openclaw.json`
```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "3e0a8d53dd9479bf5f27b84a88c65a6f2a79c92c442f68b7"
    }
  }
}
```

**2. 从环境变量获取**

Gateway 支持从环境变量读取 Token：
```bash
# 查看环境变量
echo $OPENCLAW_GATEWAY_TOKEN
# 或
echo $CLAWDBOT_GATEWAY_TOKEN  # 旧版本兼容
```

**3. 生成新的 Token**

如果还没有 Token，可以通过以下方式生成：

```bash
# 方式一：通过 doctor 命令生成并自动配置
openclaw doctor --generate-gateway-token

# 方式二：启动 Gateway 时指定 Token
openclaw gateway --token your_custom_token
```

**Token 生成原理：**
- 使用 `crypto.randomBytes(24)` 生成 24 字节随机数据
- 转换为 48 位十六进制字符串
- 源码位置：`/src/commands/onboard-helpers.ts`

**4. 首次安装向导**

如果是首次运行 OpenClaw，执行安装向导时会显示 Token：
```bash
openclaw onboard
# 向导完成后会显示 Gateway token
```

### Q: Token 无效
- 确保 `.env` 文件中 `VITE_OPENCLAW_TOKEN` 的值正确
- 确保没有多余的空格或换行符
- 确保 Gateway 版本与 Token 格式兼容
- 尝试重启 Gateway 生成新的 Token

### Q: 为什么环境变量要加 VITE_ 前缀？
这是 **Vite 构建工具的安全机制**：
- 只有以 `VITE_` 开头的环境变量才会暴露给客户端代码
- 防止敏感的服务端配置（如数据库密码）意外泄露到前端
- 如果你创建的环境变量不以 `VITE_` 开头，在代码中通过 `import.meta.env` 将无法访问到

### Q: Live2D 模型不显示
检查模型文件是否完整存在于 `public/assets/live2d/models/` 目录。

## 许可证

MIT
