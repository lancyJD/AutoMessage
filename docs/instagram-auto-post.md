# Instagram 自动发帖

## 两种发布入口

- `python -m scripts.publish_instagram_post`：直接传入本地素材路径或媒体直链。
- `python -m scripts.download_and_publish_instagram "平台帖子页面URL"`：先通过 yt-dlp 下载或复用素材，生成 `.txt`，然后立即发布，中间不再确认。

新下载记录使用 `.txt`；读取已有记录时兼容旧 `.text`。无论发布成功或失败，下载目录都保留。发布结果为 `unknown` 时禁止自动重试，避免重复发帖。

在项目根目录执行。比特浏览器客户端必须已经启动。

本地素材：

```powershell
python.exe .\scripts\publish_instagram_post.py `
  --media 'C:\path\photo.png' `
  --title '标题 ⛰️' `
  --content '正文'
```

多个本地或网络素材按 `--media` 出现顺序组成轮播：

```powershell
python.exe .\scripts\publish_instagram_post.py `
  --media 'https://example.com/a.jpg' `
  --media 'https://example.com/b.mp4' `
  --content '轮播内容'
```

程序只发布 Feed 帖子，不发布 Reels 或 Story。点击“分享”后不会自动重试；如果返回 `unknown`，请在保持打开的比特浏览器中人工检查主页，避免重复发帖。
