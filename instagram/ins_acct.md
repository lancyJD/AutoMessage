# Instagram 账号文件字段说明

## 文件结构

`.ins_env` 不是常规的 `KEY=VALUE` 环境变量文件，而是使用 **Tab（制表符）** 分隔的账号数据表。

- 当前记录数：20 行
- 每行字段数：12 列
- 第 4、5、6 列在当前文件中全部为空
- 字段编号从 1 开始

## 字段表

| 字段编号 | 建议字段名 | 示例类型 | 含义 | 确定程度 | 敏感级别 |
|---:|---|---|---|---|---|
| 1 | `account_status` | 文本 | 账号状态或数据来源标签。当前值 `Wall Live` 可能表示主页/账号检测为存活，但它不是 Instagram 官方字段。 | 推测 | 低 |
| 2 | `username` | 文本 | Instagram 登录用户名。 | 确定 | 高 |
| 3 | `password` | 文本 | Instagram 登录密码。 | 基本确定 | 极高 |
| 4 | `email` | 文本或空值 | 可能是账号绑定邮箱。当前 20 行全部为空。 | 推测 | 高 |
| 5 | `email_password` | 文本或空值 | 可能是绑定邮箱的密码。当前 20 行全部为空。 | 推测 | 极高 |
| 6 | `two_factor_secret` | 文本或空值 | 可能是双重验证 TOTP 密钥、恢复码或其他验证信息。当前 20 行全部为空。 | 推测 | 极高 |
| 7 | `media_count` | 整数 | 账号发布的帖子、图片或 Reels 等媒体数量。 | 高概率 | 低 |
| 8 | `follower_count` | 整数 | 粉丝数量。 | 高概率 | 低 |
| 9 | `following_count` | 整数 | 账号正在关注的用户数量。 | 高概率 | 低 |
| 10 | `full_name` | 文本 | Instagram 个人资料中的显示名称。 | 确定 | 中 |
| 11 | `user_agent` | 文本 | 获取或使用该账号 Cookie 时对应的浏览器 User-Agent。恢复会话时应尽量保持一致。 | 确定 | 中 |
| 12 | `cookie` | Cookie 字符串 | Instagram 登录 Cookie，目前包含 `mid`、`ds_user_id` 和 `sessionid`。 | 确定 | 极高 |

## Cookie 子字段

| Cookie 名称 | 含义 | 用途 | 敏感级别 |
|---|---|---|---|
| `mid` | Instagram 分配的浏览器或设备标识 | 帮助 Instagram 识别浏览器会话和设备 | 高 |
| `ds_user_id` | 当前 Instagram 账号的数字用户 ID | 标识 Cookie 所属账号 | 高 |
| `sessionid` | 已认证的登录会话凭证 | 可以用于恢复登录状态 | 极高 |

## 建议的数据模型

```python
InstagramAccount(
    account_status: str,
    username: str,
    password: str,
    email: str | None,
    email_password: str | None,
    two_factor_secret: str | None,
    media_count: int,
    follower_count: int,
    following_count: int,
    full_name: str,
    user_agent: str,
    cookie: str,
)
```

## 使用注意事项

1. User-Agent 和 Cookie 应作为同一套登录环境保存并配套使用。
2. 每个 Instagram 账号应固定绑定一个比特浏览器窗口和代理 IP。
3. 不要把密码、邮箱密码、2FA 密钥、`sessionid` 或完整 Cookie 写入日志。
4. `.ins_env`、数据库和其他账号文件应加入 `.gitignore`，不能提交到 Git。
5. 第 4～6 列缺少生成脚本或原始格式说明，因此目前只能作为推测字段；接入自动化前应向数据提供方确认。


cookie username password

### Instagram 账号数据

> 数据直接由 `.ins_env` 转换。原文件没有字段表头，因此此表使用 Excel 列位置 `A`～`L`，并保留原始列顺序。

| account_status | username | password | email | email_password | two_factor_secret | media_count | follower_count | following_count | full_name | user_agent | cookie |
|---|---|---|---|---|---|---:|---:|---:|---|---|---|
| Wall Live | flame.finatce | 1rohaniHoheto |  |  |  | 0 | 0 | 1 | Alexander Arnt | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.1641.226 Safari/537.36 | mid=aos3yAABAAHcttpgbVNn8CX1EoTD;ds_user_id=49208576618;sessionid=49208576618%3AE8dFNbsbajIU5Q%3A16%3AAYiGMckDR_KtTzXdrrmiriLomeSvnXamzLztz5AH2Q |
| Wall Live | basic_newsr1eader | Yuumn0130 |  |  |  | 0 | 0 | 0 | 경린이의 경제공부 \| 경제툰 | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.3227.184 Safari/537.36 | mid=aotGWQABAAGcftq9xSVmuImAOZPH;ds_user_id=43545033229;sessionid=43545033229%3ARfFHsrqwyjFPwG%3A0%3AAYhFedpIYmz1z0mfctNKO9MPyy6af6-XqFhuSBaNIQ |
| Wall Live | rab1bit._.habbit | Sa19790903 |  |  |  | 0 | 0 | 0 | 래빗해빛 \| 재테크 • 부동산 • 자기계발 | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.3952.164 Safari/537.36 | mid=aos7eAABAAE_Msg6h223PL7i2E4y;ds_user_id=63150818262;sessionid=63150818262%3ASzMJNDBBW1099g%3A5%3AAYhOVREqpWjDHk06m7aqdKKv69M6oJ1yPlvp7tHicw |
| Wall Live | kimzaaandee_ | k10040312 |  |  |  | 0 | 0 | 0 | 김쟌디 \| 자기계발•사업•재테크 | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.3469.294 Safari/537.36 | mid=aoskagABAAGSZ_rl3t6wWKesPrzK;ds_user_id=48401276709;sessionid=48401276709%3Ak0ViP7Ysgz1hNS%3A22%3AAYgO-02QgLr3SkR4KgoH3Ifxtn9Pl-QL35_2arMQog |
| Wall Live | baullstorya1 | Hatori399 |  |  |  | 0 | 0 | 1 | 머니한줄 l 한줄로보는 트렌드 | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.1193.377 Safari/537.36 | mid=aotI2AABAAEH8rR2BV-b_--_j4RM;ds_user_id=52833297782;sessionid=52833297782%3AaxRYDBMdmJgMiR%3A23%3AAYjTWkBaL-6Zg-tQmdanMZVB4KcXIaCgp9Qb1apo0g |
| Wall Live | herbstoack | fy934726 |  |  |  | 0 | 1 | 1 | 머니센서 | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.1357.238 Safari/537.36 | mid=aotbYQABAAH9pKPdLQmfJVRdUAce;ds_user_id=71711589970;sessionid=71711589970%3A7U3eUVvk9Jr7fy%3A23%3AAYgULBEhpWk1gDQm9O7k-y7PlHNRH_1oe9JgoxsKyA |
| Wall Live | fsc.go.kra1 | otomosho0917 |  |  |  | 13 | 0 | 1 | 금융위 | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.2152.189 Safari/537.36 | mid=aotFkAABAAFGXEj3I4fG39o8uLCu;ds_user_id=59379512435;sessionid=59379512435%3A2njyPlYFVChiiR%3A18%3AAYg0L73aVlYt4rUtpXkcU4J84hJfLgsWLsxfJdAwFA |
| Wall Live | fsc.go.kra | tomomi1031 |  |  |  | 3 | 0 | 0 | 금융위 | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.2184.107 Safari/537.36 | mid=aosrYgABAAGFCSVSxSOIjPQYSlq8;ds_user_id=55136084555;sessionid=55136084555%3AOEZ76BPMFRlrHf%3A22%3AAYheH9fmY3yTyJMhiZwI4dDyJK4WiOlb0HP-1T2SMw |
| Wall Live | reika_omi | ohana087 |  |  |  | 143 | 61 | 22 | 시즈더타임 \| 자기계발•갓생•재테크 | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.1718.314 Safari/537.36 | mid=aotQlgABAAFoLdtwBlw2W4XfQaVl;ds_user_id=704199704;sessionid=704199704%3AT7skUPIX5TjKyS%3A18%3AAYhSY3w1hxwv06X0vmuvns11kSjd7Q513txXBgUE1Q |
| Wall Live | bean_researcss | owoa1216k |  |  |  | 0 | 1 | 0 | BeanResearch | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.3219.368 Safari/537.36 | mid=aotX6AABAAHGtkLBacMqI-sYe_FE;ds_user_id=68253152053;sessionid=68253152053%3AlCoj34U95ddp2y%3A12%3AAYj00XsSp6FI-BoJsTfGOOGFBRYoD8RTZZzpge9AXw |
| Wall Live | bean_researce | Aya0817ken |  |  |  | 23 | 5 | 0 | BeanResearch | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.1134.345 Safari/537.36 | mid=aotmcQABAAGQme5vlm8gqgQi-ZAb;ds_user_id=3946207311;sessionid=3946207311%3Adbk7nZh1k66AHo%3A27%3AAYijUFlmCDx2WQ0qaNLr_mWgeA7XmOOzp0RIWIOx7A |
| Wall Live | bean.researc | xephy5755 |  |  |  | 19 | 9 | 18 | BeanResearch | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.1360.237 Safari/537.36 | mid=aos8AQABAAHTYQASi6NTdc0sxH-_;ds_user_id=10711710563;sessionid=10711710563%3AFNLx8WdPbmAa6T%3A13%3AAYiY_Vhe4v20ai59Z5GSOik4fwR87EHTUhaoSTmaUg |
| Wall Live | investwithemilis | 12345678ay |  |  |  | 22 | 48 | 19 | Emilie Rose • Real Estate | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.1715.201 Safari/537.36 | mid=aosobQABAAFYqf4ni7qHF-zKUZX2;ds_user_id=33873637284;sessionid=33873637284%3AAX60KxwtLiozWY%3A8%3AAYhZAf7ZXVUSJtISMaHNJZs7T5DTIq8g93uELKowUQ |
| Wall Live | caspse_smc | nimari300219 |  |  |  | 122 | 18 | 18 | Jesse Rogers | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.2697.144 Safari/537.36 | mid=aotf0AABAAGsbztsao8XMoSgZuwC;ds_user_id=8717706538;sessionid=8717706538%3AOPO58FC1Nmg03c%3A20%3AAYgqgfVVSbdqCzicNikaHMHGAUlNhQgKXkjGfBlvQw |
| Wall Live | tradinglabofflicial | misimachan0127 |  |  |  | 0 | 26 | 5 | Stocks \| Crypto \| Investing | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.1563.209 Safari/537.36 | mid=aotqSQABAAGP_1q270TQEolv6TWH;ds_user_id=46923801421;sessionid=46923801421%3A5di2FYLcIZovEX%3A26%3AAYg9miRd7L9Q-jkG6B-X5vPrHXBDNOVIKWqs5GOVgw |
| Wall Live | tradilnglabofficial | moeka1010 |  |  |  | 1 | 14 | 14 | Stocks \| Crypto \| Investing | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.1948.341 Safari/537.36 | mid=aosrdAABAAHoWrQ88cDEVl0QCe5t;ds_user_id=8045905623;sessionid=8045905623%3Ar2B5k23CaBzkDk%3A9%3AAYitGzMXQYE3GtbPc9dB-ZTFJyQzeTJHPe0TMhCyTA |
| Wall Live | tradiinglaboffiicial | daimoe |  |  |  | 0 | 0 | 1 | Stocks \| Crypto \| Investing | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3599.112 Safari/537.36 | mid=aot8FQABAAHLrSD2k8jkkPDKbbi4;ds_user_id=46529323657;sessionid=46529323657%3AT7mrQLpBZmIKLU%3A21%3AAYgswC6NB0uoZ0Hy-WcvZ16FcxkEGxkFpK8EDhUv8w |
| Wall Live | flame.fieance | Mako1972 |  |  |  | 0 | 333 | 24 | Alexander Arnt | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.2946.218 Safari/537.36 | mid=aotThgABAAFZBEMh_HNH-xhWKLKk;ds_user_id=267578475;sessionid=267578475%3AKIf0rBogd8lCac%3A23%3AAYga0ovWGE28xd0gf35zLeVHxxtyl2FsiyUwSS3RWw |
| Wall Live | flame.fitance | BanTanSonyondan |  |  |  | 0 | 230 | 16 | Alexander Arnt | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.3173.109 Safari/537.36 | mid=aoslAgABAAGdxrS6XV6MhIDA-rYD;ds_user_id=6853486712;sessionid=6853486712%3A1TK3rBHUQZuYR5%3A20%3AAYhNB_RikCU8T6Fmve0tvp3rd8o3W-NxQsCbK2657w |
| Wall Live | flime.finance | Mie19770117 |  |  |  | 0 | 46 | 5 | Alexander Arnt | Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.2973.243 Safari/537.36 | mid=aostsgABAAEFuLCCviQ5uFqBFEcY;ds_user_id=48866367502;sessionid=48866367502%3ApXCHk7weSHMrJn%3A18%3AAYh8xZ1p_IgeaDELQRQYSSVTYHrufmZdzYf1nPbzXw |



