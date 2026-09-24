# 自动发帖
我自己跟踪的应该是设计到了这两个接口
https://i.instagram.com/rupload_igphoto/fb_uploader_1790236533563
https://www.instagram.com/api/v1/media/configure/
这里不一定对，你可自行修改
## 自动发帖
我的要求就是 ins的自动发帖，我给你素材地址，标题，内容 你帮我自动发帖。是全自动的
素材：图片，视频，要支持多个传入素材地址
标题：文字+表情
内容：文字+表情

## 账号信息
账号=PaulHernandez1675843
密码=a5pqt02peaFqP
2FA=WQ5GYF4CLIUFV56WKC3SQZTE67AOGSMY,调用[totp.py](..%2F..%2F..%2Finstagram%2Ftotp.py)可以后去6位数字的密码

## 测试内容

内容=저는 산과 강도 좋아합니다.
素材=C:\Users\DELL\Pictures\人物\ttt.png

## html 已知的标签
### 创建帖子的标签
<div aria-selected="false" class="x9f619 xxk0z11 xii2z7h x11xpdln x19c4wfv xvy4d1p"><svg aria-label="新帖子" class="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="24" role="img" viewBox="0 0 24 24" width="24"><title>新帖子</title><path d="M21 11h-8V3a1 1 0 1 0-2 0v8H3a1 1 0 1 0 0 2h8v8a1 1 0 1 0 2 0v-8h8a1 1 0 1 0 0-2Z"></path></svg></div>

### 弹窗出现创建新帖子
<div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 x16ye13r xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x1n2onr6 x6ikm8r x10wlt62 x1iyjqo2 x2lwn1j xeuugli xdt5ytf xqjyukv x1qjc9v5 x1oa3qoh x1nhvcw1" style="--x-height: 100%;"><div class="_ap97"><div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 x5lhr3w xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x1n2onr6 x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x1qjc9v5 x1oa3qoh x1nhvcw1" style="--x-width: 100%;"><div class="x1qjc9v5 x78zum5 xdt5ytf"><div class="_ac76 _ar86"><div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 x16ye13r x5lhr3w xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x10l6tqk x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x6s0dn4 x1oa3qoh xl56j7k" style="--x-height: 100%; --x-width: 100%;"><div class="_ac78" dir="auto" style="align-items: center; width: calc(100% + 0px);"><div aria-level="1" class="_ac7a" role="heading">创建新帖子</div></div></div><div class="_ac7b _ac7c"></div><div class="_ac7b _ac7d"></div></div></div></div></div><div class="xdl72j9 x1iyjqo2 xs83m0k x15wfb8v x3aagtl xqbdwvv x6ql1ns x1cwzgcd" style="width: 243px;"><div class="x6s0dn4 x78zum5 x5yr21d xl56j7k x1n2onr6 xh8yej3" style="opacity: 1;"><div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 x16ye13r x5lhr3w xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x1n2onr6 x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x6s0dn4 x1oa3qoh xl56j7k" style="--x-height: 100%; --x-width: 100%;"><div class="html-div xdj266r x14z9mp xat24cr x1lziwak x9f619 x16ye13r x5lhr3w xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x1p5oq8j x64bnmy xwxc41k x13jy36j x1n2onr6 x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x6s0dn4 x1oa3qoh xl56j7k" style="--x-height: 100%; --x-width: 100%;"><svg aria-label="表示图片或视频等素材的图标" class="x1lliihq x1n2onr6 x5n08af" fill="currentColor" height="77" role="img" viewBox="0 0 97.6 77.3" width="96"><title>表示图片或视频等素材的图标</title><path d="M16.3 24h.3c2.8-.2 4.9-2.6 4.8-5.4-.2-2.8-2.6-4.9-5.4-4.8s-4.9 2.6-4.8 5.4c.1 2.7 2.4 4.8 5.1 4.8zm-2.4-7.2c.5-.6 1.3-1 2.1-1h.2c1.7 0 3.1 1.4 3.1 3.1 0 1.7-1.4 3.1-3.1 3.1-1.7 0-3.1-1.4-3.1-3.1 0-.8.3-1.5.8-2.1z" fill="currentColor"></path><path d="M84.7 18.4 58 16.9l-.2-3c-.3-5.7-5.2-10.1-11-9.8L12.9 6c-5.7.3-10.1 5.3-9.8 11L5 51v.8c.7 5.2 5.1 9.1 10.3 9.1h.6l21.7-1.2v.6c-.3 5.7 4 10.7 9.8 11l34 2h.6c5.5 0 10.1-4.3 10.4-9.8l2-34c.4-5.8-4-10.7-9.7-11.1zM7.2 10.8C8.7 9.1 10.8 8.1 13 8l34-1.9c4.6-.3 8.6 3.3 8.9 7.9l.2 2.8-5.3-.3c-5.7-.3-10.7 4-11 9.8l-.6 9.5-9.5 10.7c-.2.3-.6.4-1 .5-.4 0-.7-.1-1-.4l-7.8-7c-1.4-1.3-3.5-1.1-4.8.3L7 49 5.2 17c-.2-2.3.6-4.5 2-6.2zm8.7 48c-4.3.2-8.1-2.8-8.8-7.1l9.4-10.5c.2-.3.6-.4 1-.5.4 0 .7.1 1 .4l7.8 7c.7.6 1.6.9 2.5.9.9 0 1.7-.5 2.3-1.1l7.8-8.8-1.1 18.6-21.9 1.1zm76.5-29.5-2 34c-.3 4.6-4.3 8.2-8.9 7.9l-34-2c-4.6-.3-8.2-4.3-7.9-8.9l2-34c.3-4.4 3.9-7.9 8.4-7.9h.5l34 2c4.7.3 8.2 4.3 7.9 8.9z" fill="currentColor"></path><path d="M78.2 41.6 61.3 30.5c-2.1-1.4-4.9-.8-6.2 1.3-.4.7-.7 1.4-.7 2.2l-1.2 20.1c-.1 2.5 1.7 4.6 4.2 4.8h.3c.7 0 1.4-.2 2-.5l18-9c2.2-1.1 3.1-3.8 2-6-.4-.7-.9-1.3-1.5-1.8zm-1.4 6-18 9c-.4.2-.8.3-1.3.3-.4 0-.9-.2-1.2-.4-.7-.5-1.2-1.3-1.1-2.2l1.2-20.1c.1-.9.6-1.7 1.4-2.1.8-.4 1.7-.3 2.5.1L77 43.3c1.2.8 1.5 2.3.7 3.4-.2.4-.5.7-.9.9z" fill="currentColor"></path></svg><div class="html-div x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw xw7yly9 x1n2onr6 x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x1qjc9v5 x1oa3qoh x1nhvcw1"><h3 class="x1lliihq x1plvlek xryxfnj x1n2onr6 xyejjpt x15dsfln x193iq5w xeuugli x1fj9vlw x13faqbe x1vvkbs x1s928wv xhkezso x1gmr53x x1cpjm7i x1fgarty x1943h6x x1i0vuye x1ms8i2q xo1l8bm x5n08af x2b8uid x4zkp8e xw06pyt x10wh9bi xpm28yp x8viiok x1o7cslx" dir="auto" tabindex="-1" style="--x---base-line-clamp-line-height: 25px; --x-lineHeight: 25px;">把照片和视频拖放到这里</h3></div><div class="html-div x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw xqui205 x1n2onr6 x1plvlek xryxfnj x1c4vz4f x2lah0s x1q0g3np xqjyukv x6s0dn4 x1oa3qoh x1nhvcw1"><div class="html-div xdj266r x14z9mp xat24cr x1lziwak x9f619 xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x1iorvi4 x11lfxj5 xjkvuk6 x135b78x x1n2onr6 x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x1qjc9v5 x1oa3qoh x1nhvcw1"><button class=" _aswp _aswr _aswu _asw_ _asx2" type="button">从电脑中选择</button></div></div></div></div><form enctype="multipart/form-data" method="POST" role="presentation"><input accept="image/avif,image/jpeg,image/png,image/heic,image/heif,video/mp4,video/quicktime" class="x1s85apg" multiple="" type="file"></form></div><div class="xwt6s21 x1t7ytsu xpilrb4 x9f619 x78zum5 x1n2onr6 x1f4304s" style="opacity: 1;"><div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x1n2onr6 x1plvlek xryxfnj x1iyjqo2 x2lwn1j xeuugli xdt5ytf xqjyukv x1qjc9v5 x1oa3qoh x1nhvcw1"><div class="xmz0i5r xh8midk x1rife3k"></div></div></div></div></div>
里面有个从电脑中选择的按钮就是选择素材的

### 上传之后会有一个
<div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 x16ye13r x5lhr3w xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x10l6tqk x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x6s0dn4 x1oa3qoh xl56j7k" style="--x-height: 100%; --x-width: 100%;"><div class="_ac78" dir="auto" style="align-items: center; width: calc(100% - 120px);"><div aria-level="1" class="_ac7a" role="heading">裁剪</div></div></div>
剪辑，继续的按钮
这里选择继续，继续之后还会出现一个编辑，继续，然后选择继续


### 配文
<div class="html-div xdj266r x14z9mp xat24cr x1lziwak xexx8yu xyri2b x18d9i69 x1c1uobl x9f619 x16ye13r x5lhr3w xjbqb8w x78zum5 x15mokao x1ga7v0g x16uus16 xbiv7yw x10l6tqk x1plvlek xryxfnj x1c4vz4f x2lah0s xdt5ytf xqjyukv x6s0dn4 x1oa3qoh xl56j7k" style="--x-height: 100%; --x-width: 100%;"><div class="_ac78" dir="auto" style="align-items: center; width: calc(100% - 120px);"><div aria-level="1" class="_ac7a" role="heading">裁剪</div></div></div>
出现配文字 这里直接输入内容


# 自动获取素材下载到本地
参考：https://github.com/yt-dlp/yt-dlp
把里面自动获取素材的并且下载到本地的内容给移植过来，并且重新创建一个模块
然后下载的时候，下载到指定目录C:\Users\DELL\Pictures\sucai，并且要生成一个xxxx.text 的文件，里面保存标题，内容，以及素材地址。
案例：
标题:xxxxxxxxx
内容:xxxxxxxxxx
素材:C:\Users\DELL\Pictures\人物\ttt.png,C:\Users\DELL\Pictures\人物\ttt2.png
