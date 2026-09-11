from instagram.followers import Follower, format_follower, followers_next_url, is_follower_entry, is_followers_api_url, unique_followers


def test_unique_followers_outputs_each_profile_once():
    followers = unique_followers([
        Follower("alice", "Alice", "https://www.instagram.com/alice/"),
        Follower("alice_2", "Alice Again", "https://www.instagram.com/alice/"),
        Follower("bob", "Bob", "https://www.instagram.com/bob/"),
    ])
    assert followers == [
        Follower("alice", "Alice", "https://www.instagram.com/alice/"),
        Follower("bob", "Bob", "https://www.instagram.com/bob/"),
    ]
    assert format_follower(2, followers[1]) == "[粉丝 002] 用户名：bob | 名称：Bob | 主页：https://www.instagram.com/bob/"


def test_hash_link_with_follower_count_is_a_follower_entry():
    assert is_follower_entry("#", "261粉丝")


def test_format_follower_includes_username_and_full_name():
    follower = Follower(
        username="alice_handle",
        full_name="Alice Example",
        profile_url="https://www.instagram.com/alice_handle/",
    )
    assert format_follower(1, follower) == (
        "[粉丝 001] 用户名：alice_handle | 名称：Alice Example | "
        "主页：https://www.instagram.com/alice_handle/"
    )


def test_identifies_instagram_followers_api_url():
    assert is_followers_api_url("https://www.instagram.com/api/v1/friendships/61992006537/followers/?count=12")


def test_replaces_followers_api_cursor():
    assert followers_next_url(
        "https://www.instagram.com/api/v1/friendships/61992006537/followers/?count=12&max_id=12",
        "abc",
    ).endswith("count=12&max_id=abc")
