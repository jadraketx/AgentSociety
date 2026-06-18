---
name: social-media
description: 社交媒体互动：发帖 / 转发 / 评论 / 点赞 / 关注、刷新 Feed 推荐流、搜索话题贴文。必须通过 ask_env 调用 SocialMediaSpace 工具。
---

# Social Media

SocialMediaSpace 是一个微博 / Twitter 风格的社交媒体环境。**所有操作必须通过 `ask_env` 自然语言指令执行**，环境路由器会自动将指令转换为 SocialMediaSpace 工具调用。

## 环境概念

### 用户与 agent 的对应关系

默认约定 **agent_id === user_id === person_id**：你（agent）在社交媒体中的身份 id 就是你的 agent id。因此：

- `ask_env(instruction="<observe>", ctx={"id": <your_id>})` 会以你自己的身份观察。
- 凡是 `author_id` / `user_id` / `follower_id` 这类“自己”的参数，直接填 `ctx.id`。
- 对其他用户发起动作（如关注）时，把对方 id 作为 `followee_id` 传入。

### 帖子（Post）

每条帖子有 `post_id`（环境分配的整数）、`author_id`、`content`、`tags`（话题标签列表）、`post_type`（`original` / `repost` / `comment`）、以及 `likes_count` / `comments_count` / `reposts_count` / `view_count` 等计数。

### Feed 推荐流

`refresh_feed` 返回按算法排序的贴文流。可选算法：

| 算法 | 含义 |
|------|------|
| `chronological` | 时间倒序（默认） |
| `reddit_hot` | 综合热度排序 |
| `twitter_ranking` | 综合社交关系排序 |
| `random` | 随机推荐 |
| `mf` / `model` | 预训练推荐模型（需构造时配置） |

> 注意：这是**贴文流推荐**（Timeline），不是电商物品推荐。

## 可用工具

所有操作通过 `ask_env` 调用：

```
ask_env(instruction="<自然语言指令>", ctx={"id": <your_id>})
```

### observe_user（只读，observe）

以当前身份观察自己的社交媒体状态。返回：个人资料（粉丝/关注/发帖数）、最近 Feed（5 条）、收到的互动（别人对你的点赞/评论/转发）、你近期的活动、社交关系变动、可用行为列表。

```
ask_env(instruction="<observe>", ctx={"id": <your_id>})
```

每个 step 应先 observe，再决定发什么内容、关注谁、回复什么。

### create_post（非只读）

发布一条原创帖子。参数：`author_id`（你的 id）、`content`（正文）、`tags`（话题标签列表，如 `["guncontrol", "politics"]`，可选）。返回新 `post_id`。

### like_post / unlike_post（非只读）

点赞 / 取消点赞。参数：`user_id`（你的 id）、`post_id`。重复点赞会报错，需先 observe 确认状态。

### follow_user / unfollow_user（非只读）

关注 / 取消关注。参数：`follower_id`（你的 id）、`followee_id`（对方 id）。不能关注自己；重复关注会报错。

### view_post（非只读）

查看帖子详情（会增加浏览数）。参数：`user_id`（你的 id）、`post_id`。返回完整帖子信息（含计数、标签、话题分类），用于判断是否要互动。

### comment_on_post（非只读）

评论帖子。参数：`user_id`（你的 id）、`post_id`、`content`。返回 `comment_id` 与更新后的评论数。

### repost（非只读）

转发帖子（可附评论）。参数：`user_id`（你的 id）、`post_id`、`comment`（可选，留空则内容为 `repost <post_id>`）。会生成一条新帖子（`post_type=repost`）并使原帖转发数 +1。

### refresh_feed（只读）

刷新推荐流。参数：`user_id`（你的 id）、`algorithm`（见上表，默认 `chronological`）、`limit`（默认 20）。返回帖子列表，用于浏览内容、寻找互动对象。

### search_posts（只读）

搜索贴文。参数：`keyword`（在 `content` 与 `tags` 中匹配）、`tags`（标签过滤）、`limit`（默认 20）、`sort_by`（`time` / `relevance` / `popularity`，默认 `time`）。用于按话题找到相关帖子。

## 示例

### 观察自己的状态

```
ask_env(instruction="<observe>", ctx={"id": 0})
→ 粉丝数 12、关注数 5、收到 2 条点赞、Feed 有 5 条帖子
```

### 发布带话题的帖子

```
ask_env(instruction="Create a post as user 0 with content '支持更严格的背景审查' and tags ['guncontrol','policy']", ctx={"id": 0})
→ post_id=3
```

### 刷新 Feed 并点赞感兴趣的帖子

```
ask_env(instruction="Refresh feed for user 0 with algorithm twitter_ranking, limit 10. Then like the post about gun control.", ctx={"id": 0})
```

### 关注作者

```
ask_env(instruction="User 0 follows user 7", ctx={"id": 0})
```

### 搜索话题并评论

```
ask_env(instruction="Search posts with keyword 'guncontrol' sorted by popularity, limit 5. Comment on the top post as user 0.", ctx={"id": 0})
```

## 约束

1. **所有操作通过 `ask_env`**。不能直接调用 `create_post`、`like_post` 等函数。
2. **每个 step 先 observe**。`<observe>` 返回最新 Feed、收到的互动和社交关系变动，是后续决策的基础。
3. **注意幂等性**。重复点赞、重复关注、关注自己都会报错——不确定时先 observe 或 view_post 检查当前状态。
4. **`ctx.id` 就是你自己**。`author_id` / `user_id` / `follower_id` 默认填 `ctx.id`；只有对他人发起动作时才用对方的 id。
5. **转发 / 评论需先 view_post**。确认目标帖子存在并了解其内容与立场后再互动。
