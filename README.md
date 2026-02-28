# 🔑 ChatGPT API Key Validator

**快速验证 OpenAI / ChatGPT API Key 的工具，支持检查可用模型并导出验证结果。**

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20.0.0-brightgreen)
![React](https://img.shields.io/badge/React-19-blue)
![Vite](https://img.shields.io/badge/Vite-6-purple)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-4-38bdf8)
![License](https://img.shields.io/github/license/PYJUU/chatgpt-api-key-validator)

---

## ✨ 功能亮点

- ✅ 快速检测Chatgpt API Key 是否有效  
- 📋 列出该 Key 可访问的模型（model list）  
- 📤 导出验证结果（TXT）  
- 🎨 简洁现代的 UI（TailwindCSS + Framer Motion）  
- ⚡ 基于 Vite，开发体验流畅

---

## 🔍 在线预览（上线）

```sh
https://gptapi.newinte.top/
```
运行时会使用本地浏览器，数据均在本地

---

## 🛠️ 快速开始

### 系统要求

- Node.js >= 20.0.0  
- npm >= 8.0.0

### 快速安装
- 克隆仓库

```bash
git clone https://github.com/PYJUU/chatgpt-api-key-validator.git
cd chatgpt-api-key-validator.git
```

- 安装依赖

```sh
npm install
```

- 启动开发服务器

```sh
npm run dev
```

打开浏览器访问： http://localhost:3000
                http://127.0.0.1:3000


支持将验证结果文件导出（界面上有导出按钮）。

导出文件会保存在浏览器默认下载目录。

### 🧩 项目结构（简要）

```bash
/src             # 源代码（React + Vite）
/public          # 静态资源
/.env.example    # gemini ai修改后的副产品，想删就删不影响使用
/package.json
```

### 📝 贡献 & 许可证

- 欢迎提交 请遵循项目的代码风格与提交规范。
- 本项目采用 GPLv3 许可证，详见 LICENSE 文件。


如需帮助或定制功能，可在仓库 Issues 中联系或使用 Pull Request。
