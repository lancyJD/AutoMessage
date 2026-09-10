import uuid

from .exceptions import ProxyBindingError, TransportError


class BitBrowserManager:
    def __init__(self, storage, proxy_pool, browsers, groups=None):
        self.storage = storage
        self.proxy_pool = proxy_pool
        self.browsers = browsers
        self.groups = groups

    def create_browser(self, name, group_id, allocation_mode, proxy_id=None, fingerprint=None, remark=""):
        browser_key = f"pending:{uuid.uuid4().hex}"
        binding = self.proxy_pool.allocate(group_id, browser_key, allocation_mode, proxy_id)
        proxy = self.storage.get_proxy(binding.proxy_id)
        payload = {"name": name, "remark": remark, "groupId": group_id or "",
                   "browserFingerPrint": fingerprint or {}}
        payload.update(self.proxy_pool.to_bitbrowser_payload(proxy))
        try:
            result = self.browsers.create(payload)
            browser_id = result["id"]
        except TransportError:
            self.storage.mark_binding_uncertain(browser_key)
            raise
        except Exception:
            self.storage.release_binding(browser_key)
            raise
        self.storage.confirm_binding(browser_key, browser_id)
        return result

    def open_browser(self, browser_id):
        binding = self.storage.get_binding(browser_id)
        if binding.status != "active":
            raise ProxyBindingError(f"Browser {browser_id} binding requires reconciliation")
        proxy = self.storage.get_proxy(binding.proxy_id)
        if not proxy.enabled:
            raise ProxyBindingError(f"Browser {browser_id} uses a disabled proxy")
        self.proxy_pool.validate(proxy.id)
        return self.browsers.open(browser_id)

    def close_browser(self, browser_id):
        self.storage.get_binding(browser_id)
        return self.browsers.close(browser_id)

    def delete_browser(self, browser_id):
        result = self.browsers.delete(browser_id)
        self.storage.release_binding(browser_id)
        return result

    def move_browser(self, browser_id, target_group_id):
        if self.groups is None:
            raise ProxyBindingError("GroupService is required to move browsers")
        self.storage.ensure_group_available(browser_id, target_group_id)
        result = self.groups.move_browsers(target_group_id or "", [browser_id])
        self.storage.move_binding(browser_id, target_group_id)
        return result

    def replace_proxy(self, browser_id, allocation_mode, proxy_id=None):
        if self.browsers.pids([browser_id]):
            raise ProxyBindingError("Close the browser before replacing its proxy")
        old_proxy_id, proxy = self.storage.reassign_proxy(browser_id, allocation_mode, proxy_id)
        try:
            return self.browsers.update_proxy([browser_id], self.proxy_pool.to_bitbrowser_payload(proxy))
        except TransportError:
            self.storage.mark_binding_uncertain(browser_id)
            raise
        except Exception:
            self.storage.restore_proxy(browser_id, old_proxy_id)
            raise
