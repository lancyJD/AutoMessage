from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


@dataclass(frozen=True)
class Follower:
    username: str
    full_name: str
    profile_url: str


def unique_followers(items):
    seen, result = set(), []
    for item in items:
        if item.profile_url not in seen:
            seen.add(item.profile_url)
            result.append(item)
    return result


def format_follower(index, follower):
    return f"[粉丝 {index:03d}] id：{follower.username} | 名称：{follower.full_name} | 主页：{follower.profile_url}"


def is_follower_entry(href: str | None, text: str) -> bool:
    normalized = "".join(text.split()).lower()
    return href == "#" and any(label in normalized for label in ("粉丝", "followers", "팔로워"))


def is_followers_api_url(url: str) -> bool:
    return "/api/v1/friendships/" in url and "/followers/" in url


def followers_next_url(url: str, max_id: str) -> str:
    parts = urlsplit(url)
    query = [(key, max_id if key == "max_id" else value) for key, value in parse_qsl(parts.query, keep_blank_values=True)]
    if not any(key == "max_id" for key, _ in query):
        query.append(("max_id", max_id))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


async def _fetch_api_page(page, url, headers):
    return await page.evaluate(
        """async ({url, headers}) => {
            const response = await fetch(url, {credentials: 'include', headers});
            const payload = await response.json().catch(() => null);
            return {status: response.status, payload};
        }""",
        {"url": url, "headers": headers},
    )


async def _log_follower_api_responses(responses, log):
    for response in responses:
        if not is_followers_api_url(response.url):
            continue
        try:
            payload = await response.json()
        except Exception:
            log(f"[接口] 粉丝请求返回 HTTP {response.status}，响应无法解析为 JSON")
            continue
        users = payload.get("users", [])
        log(
            "[接口] 粉丝响应 "
            f"HTTP {response.status} | users={len(users)} | "
            f"next_max_id={payload.get('next_max_id')} | big_list={payload.get('big_list')}"
        )


async def _followers_link(page):
    direct_link = page.locator('a[href$="/followers/"]').first
    if await direct_link.count():
        return direct_link
    links = page.locator("a")
    for index in range(await links.count()):
        link = links.nth(index)
        if is_follower_entry(await link.get_attribute("href"), (await link.inner_text()).strip()):
            return link
    raise RuntimeError("未找到博主主页的粉丝入口")


async def collect_followers(page, reel_url, log=print, idle_rounds=3):
    api_responses = []
    page.on("response", lambda response: api_responses.append(response))
    log("[步骤 1/5] 打开 Reels")
    await page.goto(reel_url, wait_until="domcontentloaded")
    log("[步骤 2/5] 进入博主主页")
    author_link = page.locator('a[href$="/reels/"]:not([href="/reels/"])').first
    await author_link.click()
    await page.wait_for_timeout(1500)
    log(f"[页面] 当前主页：{page.url}")
    if page.url.rstrip("/").endswith("/reels"):
        await page.goto(page.url.rsplit("/reels", 1)[0] + "/", wait_until="domcontentloaded")
        await page.wait_for_timeout(1500)
        log(f"[页面] 切换博主主页：{page.url}")
    log("[步骤 3/5] 打开粉丝列表")
    followers_link = await _followers_link(page)
    await followers_link.click()
    dialog = page.get_by_role("dialog").filter(has=page.get_by_role("heading", name="粉丝"))
    await dialog.wait_for(state="visible", timeout=10000)
    await page.wait_for_timeout(1000)
    await _log_follower_api_responses(api_responses, log)
    log("[步骤 4/5] 粉丝弹窗已打开，开始滚动采集")
    seen, idle = set(), 0
    while idle < idle_rounds:
        if not await dialog.is_visible():
            raise RuntimeError("粉丝弹窗已关闭，采集停止")
        links = dialog.locator('a[href^="/"][role="link"]')
        before = len(seen)
        for index in range(await links.count()):
            link = links.nth(index)
            href = await link.get_attribute("href")
            name = (await link.inner_text()).strip()
            if href and name and href != "/" and href not in seen:
                seen.add(href)
                username = href.strip("/")
                follower = Follower(username, name, f"https://www.instagram.com{href}")
                log(format_follower(len(seen), follower))
        added = len(seen) - before
        log(f"[滚动] 本轮新增 {added} 位，累计 {len(seen)} 位")
        idle = idle + 1 if added == 0 else 0
        await page.mouse.wheel(0, 900)
        await page.wait_for_timeout(1000)

    api_response = next((response for response in api_responses if is_followers_api_url(response.url)), None)
    if not api_response:
        return len(seen)
    first_payload = await api_response.json()
    next_max_id = first_payload.get("next_max_id")
    headers = {
        key: value
        for key, value in (await api_response.request.all_headers()).items()
        if key.lower().startswith("x-")
    }
    while next_max_id:
        result = await _fetch_api_page(page, followers_next_url(api_response.url, str(next_max_id)), headers)
        payload = result.get("payload") or {}
        users = payload.get("users", [])
        log(f"[接口分页] HTTP {result['status']} | users={len(users)} | next_max_id={payload.get('next_max_id')}")
        if result["status"] != 200 or not users:
            break
        for user in users:
            username = user.get("username")
            if not username:
                continue
            href = f"/{username}/"
            if href in seen:
                continue
            seen.add(href)
            follower = Follower(username, user.get("full_name") or username, f"https://www.instagram.com{href}")
            log(format_follower(len(seen), follower))
        next_max_id = payload.get("next_max_id")
    return len(seen)
