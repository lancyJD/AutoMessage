# BitBrowser Platform

Python 管理层，用于管理比特浏览器分组、浏览器窗口和代理 IP 池。

```python
from bitbrowser import AllocationMode, BitBrowserClient, BrowserService
from bitbrowser import BitBrowserManager, ProxyPool, Storage

# checker 需要实现 check(endpoint) 并返回代理的真实出口 IP。
storage = Storage("bitbrowser.db")
pool = ProxyPool(storage, checker)
pool.import_lines(["http://user:password@127.0.0.1:8000"])

browsers = BrowserService(BitBrowserClient())
manager = BitBrowserManager(storage, pool, browsers)

# 自动顺序分配；也可用 AllocationMode.RANDOM。
profile = manager.create_browser("facebook-001", "facebook-group-id", AllocationMode.SEQUENTIAL)

# 手动指定代理池 ID。
profile = manager.create_browser("instagram-001", "instagram-group-id", AllocationMode.MANUAL, proxy_id=1)
```

同一分组内真实出口 IP 不重复；不同分组可以复用。随机分配结果会持久保存，重启窗口不会重新随机。`facebook` 和 `instagram` 目前仅建立独立包边界，账号 Cookie 与自动化将在后续阶段实现。

## 自动素材下载

安装 `yt-dlp` 后，素材默认保存到 `C:\Users\DELL\Pictures\sucai`：

```powershell
python -m pip install yt-dlp
python -m scripts.download_material url "帖子链接"
python -m scripts.download_material batch "links.txt"
python -m scripts.download_material search "旅行风景"
python -m scripts.download_material search "旅行风景" --count 5
```

YouTube 支持关键词搜索；TikTok 和 Instagram 需要提供具体帖子链接。部分视频格式需要系统已经安装 FFmpeg。

### 下载后立即发布 Instagram

```powershell
D:\soft\anaconda\envs\bitbrowser_platform\python.exe -m scripts.download_and_publish_instagram "素材页面地址"
```

程序会下载或复用 `C:\Users\DELL\Pictures\sucai` 中的素材，生成 `.txt` 后立即发布，不会再次询问。发布成功或失败后，本地素材和元数据都会保留。新记录使用 `.txt`，已有 `.text` 仍可兼容读取。
