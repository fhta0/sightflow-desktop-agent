# Resources Directory

Binary resources bundled into the SightFlow installer.

## Required Files (before `npm run build:win`)

- `wx-cli/wx.exe` — wx-cli binary (`cargo build --release --target x86_64-pc-windows-gnu`)
- `glue-layer/glue-layer.exe` — glue-layer binary (PyInstaller, see `scripts/build-glue-layer.sh`)
- `wechat/WeChatWin_4.1.9.exe` — WeChat installer (copy from repo root)

## Build Scripts

See `scripts/` directory for automated build scripts.
