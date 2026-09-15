# promptary-api

Promptary 的内置额度代理服务。

它存在的唯一理由：让用户装上扩展就能用，不必先去注册一个模型服务、充值、再填 Key。
代价是模型服务的 API Key 落在服务端，所以这里做的每一件事都围绕**成本可控**。

## 它做什么

```
扩展 ──► 本服务（鉴权 + 配额 + 熔断）──► api.deepseek.com
```

端点刻意做成 OpenAI 兼容的 `POST /v1/chat/completions`，扩展侧只要把 `baseUrl`
指过来就能用，现有的调用与解析逻辑一行都不用改。配额信息走响应头
（`X-Quota-Used` / `X-Quota-Limit` / `X-Quota-Reset`），不污染 body 形状。

## 四道防线

成本失控不是「单价高」，而是「没有上限」。按从外到内：

| 防线 | 挡住什么 | 挡不住什么 |
| --- | --- | --- |
| `Origin` 只放行 `chrome-extension://` | 写个网页直接调接口 | 自己写个扩展来调 |
| 速率限制（每 IP 每分钟 30 次，仅内存） | 脚本狂刷把当天预算几分钟烧光 | 换 IP |
| 设备配额（每天 3 次） | 普通用户反复用 | 重装扩展换个设备 id |
| **全局预算熔断（每天 5000 次）** | **前三条全被绕过时的最终兜底** | 无 |

**关键认知：设备 id 由客户端生成，重装扩展就能换一个。** 所以前三条都只是提高门槛，
真正把最坏情况锁死的是最后一条——它会整体停服，而不是让账单继续涨。
**如果只保留一道防线，保留它。**

请求体还会被强制覆盖 `model`、`max_tokens`、`temperature`，并校验「必须带图片」，
目的是堵住把它当免费 LLM 网关用这条最省事的滥用路径。

## 本地开发

需要 **Node 22.9+**（`node:sqlite` 自 22.5 内置，`--env-file-if-exists` 自 22.9 支持）。
建议直接用 24 LTS。

```bash
cp .env.example .env      # 填上 UPSTREAM_API_KEY
pnpm install
pnpm dev                  # 监听 http://127.0.0.1:8787
```

启动时会看到一条 `ExperimentalWarning: SQLite is an experimental feature` ——
这是 `node:sqlite` 自带的提示，不是错误。想让它闭嘴就在启动命令后加
`--disable-warning=ExperimentalWarning`（该模块的 API 目前很稳定，且这里只用到
最基础的 prepare/run/get）。

### 测试

```bash
pnpm test        # 21 个用例,不需要真实 API Key
pnpm typecheck
```

测试分两层：`quota.test.ts` 钉住配额扣减、退还、熔断和东八区日界；
`app.test.ts` 用本地 mock 上游跑完整的 HTTP 链路（含「上游失败要退还额度」
和「网页来源要拒绝」这类只有真实请求才会暴露的路径）。

### 手工冒烟

```bash
curl http://127.0.0.1:8787/healthz

curl -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'X-Device-Id: 11111111-1111-4111-8111-111111111111' \
  -d '{
    "messages": [
      {"role":"system","content":"You are a senior AI art prompt engineer."},
      {"role":"user","content":[
        {"type":"text","text":"reverse-engineer this"},
        {"type":"image_url","image_url":{"url":"https://example.com/a.jpg"}}
      ]}
    ]
  }'
```

把 `DAILY_DEVICE_LIMIT` 改成 1 再连发两次，第二次应当返回 `429 quota_exceeded`。

## 部署

服务器上没装 pnpm、内存也只有 1.6G，所以**构建在本地做**，只把产物传上去，
服务器用 npm 装两个生产依赖即可。日常更新一条命令：

```powershell
pwsh server/deploy/deploy.ps1        # 测试 → 构建 → 上传 → 重装依赖 → 重启 → 健康检查
```

`-SkipTest` 只在应急回滚时用。脚本刻意**不传 `.env`**——它只在首次部署时手工放一次，
之后由服务器保管；每次覆盖的话，线上配置迟早会被本地那份冲掉。

### 首次部署（已完成的步骤，供换机器时参考）

```bash
# 服务器上：装 Node 22.9+（这次是 22.22.1）
node -v

# 专用系统用户,无登录 shell —— 这个服务只需要往外出网
useradd -r -s /usr/sbin/nologin promptary
mkdir -p /srv/promptary-api/data
chown -R promptary:promptary /srv/promptary-api

# 本地：上传产物与配置
scp -r server/dist             aliyun:/srv/promptary-api/
scp server/package.json        aliyun:/srv/promptary-api/
scp server/.env                aliyun:/srv/promptary-api/     # 含真实 Key，只此一次
scp server/deploy/promptary-api.service aliyun:/tmp/

# 服务器上：装依赖、装服务
cd /srv/promptary-api
npm install --omit=dev --registry=https://registry.npmmirror.com
chown -R promptary:promptary /srv/promptary-api
chmod 600 .env
cp /tmp/promptary-api.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now promptary-api
```

### Nginx

线上**不是**用 `deploy/nginx.conf.example` 那套独立 server 块，而是复用已有的
`img.aidingge.top` 站点，在它的配置里加一段 location：

```nginx
location /promptary/ {
    proxy_pass http://127.0.0.1:8788/;   # 末尾斜杠把前缀替换掉
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;             # 反推要等视觉模型,默认 60s 会截成 504
    proxy_send_timeout 120s;
}
```

改任何 Nginx 配置前先 `cp -a` 备份，改完 `nginx -t` 通过再 `reload`——
这台机器上还跑着其他生产服务。

### 两个踩过的坑

- **端口别用 8787**。同机器上的 oncall 服务已经占了它，重复占用会让服务以
  `EADDRINUSE` 反复重启。当前用 8788。改端口前先 `ss -tln | grep :8788`。
- **服务只监听 `127.0.0.1`**，由 Nginx 反代，外面进不来。**不要改成 `0.0.0.0`**——
  那会让 `X-Forwarded-For` 变成可伪造的，速率限制随之失效。

## 运维

```bash
# 今日全局用量（也是健康检查）
curl https://api.example.com/healthz

# 调预算：改 .env 后重启即可，不用改代码
sudo systemctl restart promptary-api
```

**建议加一条预算告警**：`/healthz` 返回的 `global.used` 除以 `limit` 超过 80% 时
给自己发个通知。熔断是兜底，但它触发时用户已经在吃 503 了——早点发现才能及时调额度。

配额表只留 7 天，启动时自动清理（`quota.ts` 的 `pruneOldDays`）。

## 隐私

- **不存储 IP**。速率计数只在内存里，进程重启即清空。
- **不存储图片**。请求转发完即丢；走 URL 直传时图片根本不经过本服务，
  只有图片地址经过。
- 只持久化 `(自然日, 设备 id, 已用次数)` 三列，用于配额扣减。设备 id 是扩展生成的
  随机 UUID，与用户身份无关。

这些是产品对外的承诺（见 `docs/PRIVACY.md`），改代码时别破坏它们。

## 已知的取舍

- **没有账号体系**。设备 id 可以被重装绕过，这是为了「装上就能用」付出的代价。
  真要防刷得加登录层，那会牺牲零门槛——目前认为不划算。
- **没做结果缓存**。同一张图被多人反推时要重复调用上游。加缓存能省钱，
  但会让服务端留存「谁在看什么图」的痕迹，与上面的隐私承诺冲突。
