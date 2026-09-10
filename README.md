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
