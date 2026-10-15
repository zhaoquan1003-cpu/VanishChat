# =============================================================================
# VanishChat 镜像：单容器同时承载 API / WebSocket / 前端静态资源
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# 前端体积优化：Vite 构建在容器内完成，无需外部产物
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --no-audit --no-fund

COPY server ./server
COPY web ./web
COPY scripts ./scripts
RUN npm run build:web

ENV NODE_ENV=production \
    PORT=3000 \
    STORE_DRIVER=redis \
    UPLOAD_DIR=/app/storage/uploads

# uploads 建议由编排层挂载为 tmpfs —— 让上传文件也只存在于内存
VOLUME ["/app/storage"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
