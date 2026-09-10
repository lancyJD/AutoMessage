from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed

from .client import BitBrowserClient


class BrowserService:
    def __init__(self, client: BitBrowserClient):
        self.client = client

    def create(self, payload: dict):
        data = dict(payload)
        data.setdefault("browserFingerPrint", {})
        return self.client.request("/browser/update", data)

    def update_partial(self, ids: list[str], changes: dict):
        return self.client.request("/browser/update/partial", {"ids": ids, **changes, "browserFingerPrint": changes.get("browserFingerPrint", {})})

    def get(self, browser_id: str):
        return self.client.request("/browser/detail", {"id": browser_id})

    def list(self, page=0, page_size=100, **filters):
        return self.client.request("/browser/list", {"page": page, "pageSize": page_size, **filters})

    def open(self, browser_id: str):
        return self.client.request("/browser/open", {"id": browser_id})

    def close(self, browser_id: str):
        return self.client.request("/browser/close", {"id": browser_id})

    def delete(self, browser_id: str):
        return self.client.request("/browser/delete", {"id": browser_id})

    def delete_many(self, ids: list[str]):
        return self.client.request("/browser/delete/ids", {"ids": ids})

    def update_proxy(self, ids: list[str], proxy: dict):
        return self.client.request("/browser/proxy/update", {"ids": ids, "proxyMethod": 2, **proxy})

    def pids(self, ids: list[str]):
        return self.client.request("/browser/pids", {"ids": ids})

    def _batch(self, method, ids, max_workers):
        results = {}
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(method, item): item for item in ids}
            for future in as_completed(futures):
                item = futures[future]
                try:
                    results[item] = {"ok": True, "data": future.result()}
                except Exception as exc:
                    results[item] = {"ok": False, "error": str(exc)}
        return results

    def open_many(self, ids: list[str], max_workers=3):
        return self._batch(self.open, ids, max_workers)

    def close_many(self, ids: list[str], max_workers=3):
        return self._batch(self.close, ids, max_workers)
