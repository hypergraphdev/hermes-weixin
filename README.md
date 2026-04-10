# Hermes WeChat Bridge

WeChat (Weixin) messaging bridge for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Enables Hermes to receive and send WeChat messages via QR code login.

Based on [zylos-weixin](https://github.com/hypergraphdev/zylos-weixin), adapted for Hermes Agent's HTTP bridge architecture.

## Architecture

```
WeChat User ←→ iLink API ←→ hermes-weixin (Node.js)
                                    ↕ HTTP
                             Hermes Gateway (Python)
                                    ↕
                             Hermes Agent (AI)
```

- **Inbound**: WeChat messages → long-poll → HTTP POST to Hermes Gateway webhook
- **Outbound**: Hermes Gateway → HTTP POST to bridge `/send` endpoint → WeChat API

## Features

- QR code login via WeChat iLink Bot API
- Long-poll message receiving with sync buffer persistence
- Text, image, voice, video, file message support
- AES-128-ECB encrypted CDN media upload/download
- Multi-account support
- Message deduplication (30s window)
- Typing indicators
- HTTP bridge server for Hermes Gateway integration

## Quick Start

```bash
# Install
npm install

# Build
npm run build

# Run
HERMES_HOME=/opt/data \
HERMES_GATEWAY_URL=http://localhost:8080 \
WEIXIN_BRIDGE_PORT=9100 \
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HERMES_HOME` | `~` | Hermes data directory |
| `HERMES_GATEWAY_URL` | `http://localhost:8080` | Hermes Gateway webhook URL |
| `WEIXIN_BRIDGE_PORT` | `9100` | HTTP bridge port for outbound messages |
| `WEIXIN_DATA_DIR` | `$HERMES_HOME/components/weixin` | Account data, logs, sync buffers |
| `WEIXIN_MEDIA_DIR` | `$HERMES_HOME/media/weixin` | Downloaded media files |

## HTTP Bridge API

### POST /send — Send message to WeChat user

```json
{
  "to": "<user_id>",
  "content": "Hello from Hermes!",
  "media_path": "/path/to/image.jpg",
  "account_id": "optional-account-id"
}
```

### GET /health — Health check

Returns `{ "ok": true, "accounts": 1 }`

## PM2

```bash
pm2 start ecosystem.config.cjs
pm2 logs hermes-weixin
```

## License

[MIT](LICENSE)
