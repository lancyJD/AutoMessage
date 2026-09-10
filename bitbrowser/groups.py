from __future__ import annotations

from .client import BitBrowserClient


class GroupService:
    def __init__(self, client: BitBrowserClient):
        self.client = client

    def create(self, name: str):
        return self.client.request("/group/add", {"groupName": name})

    def update(self, group_id: str, name: str):
        return self.client.request("/group/edit", {"id": group_id, "groupName": name})

    def delete(self, group_id: str):
        return self.client.request("/group/delete", {"id": group_id})

    def list(self, page=0, page_size=100):
        return self.client.request("/group/list", {"page": page, "pageSize": page_size})

    def move_browsers(self, group_id: str, browser_ids: list[str]):
        return self.client.request("/browser/group/update", {"groupId": group_id, "browserIds": browser_ids})
