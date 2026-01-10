#!/usr/bin/env python3
"""
Generate mock Chronicle databases for testing Otso indexer.
All data is completely anonymized and synthetic.
"""

import sqlite3
import json
import random
import os
from datetime import datetime, timedelta

# Seed for reproducibility
random.seed(42)

FIXTURES_DIR = os.path.dirname(os.path.abspath(__file__))

# Fake data generators
FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery", "Drew", "Jamie"]
LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez"]
DOMAINS = ["example.com", "test.org", "sample.net", "demo.io", "mock.dev"]
WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do",
         "eiusmod", "tempor", "incididunt", "labore", "dolore", "magna", "aliqua", "enim", "minim", "veniam"]
ARTISTS = ["The Mock Band", "Synthetic Orchestra", "Test Ensemble", "Demo Collective", "Fixture Five"]
ALBUMS = ["Greatest Hits Vol. 1", "Test Album", "Mock Sessions", "Synthetic Dreams", "Demo Tracks"]
SONGS = ["Test Song", "Mock Melody", "Sample Sound", "Fixture Funk", "Demo Ditty"]
APPS = ["Safari", "Chrome", "VS Code", "Terminal", "Slack", "Zoom", "Notes", "Calendar"]
PROJECTS = ["Project Alpha", "Project Beta", "Project Gamma", "Project Delta", "Side Project"]

def random_name():
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"

def random_email():
    return f"user{random.randint(1, 999)}@{random.choice(DOMAINS)}"

def random_url():
    path = "/".join(random.choices(WORDS, k=random.randint(1, 3)))
    return f"https://{random.choice(DOMAINS)}/{path}"

def random_text(min_words=5, max_words=50):
    return " ".join(random.choices(WORDS, k=random.randint(min_words, max_words))).capitalize() + "."

def random_timestamp(start_year=2020, end_year=2024):
    start = datetime(start_year, 1, 1)
    end = datetime(end_year, 12, 31)
    delta = end - start
    random_days = random.randint(0, delta.days)
    dt = start + timedelta(days=random_days, seconds=random.randint(0, 86400))
    return dt

def iso_timestamp(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def twitter_timestamp(dt):
    return dt.strftime("%a %b %d %H:%M:%S +0000 %Y")

def unix_timestamp(dt):
    return str(int(dt.timestamp()))


def create_chronicle_events_db(db_path, source_type, num_records=50):
    """Create a Chronicle-format events table."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS events (
            agent TEXT,
            end_time TEXT,
            object TEXT,
            source TEXT,
            source_id TEXT,
            type TEXT,
            result TEXT,
            startTime TEXT,
            name TEXT,
            description TEXT,
            text TEXT,
            date_created TEXT,
            dateCreated TEXT,
            contentLocation TEXT,
            additionalType TEXT,
            actionStatus TEXT,
            endTime TEXT
        )
    """)

    records = []
    for i in range(num_records):
        dt = random_timestamp()

        if source_type == "bookmark":
            records.append({
                "source_id": f"bookmark-{i}",
                "type": "BookmarkAction",
                "end_time": iso_timestamp(dt),
                "object": json.dumps({
                    "name": f"Bookmark: {random_text(3, 8)}",
                    "description": random_text(10, 30),
                    "url": random_url()
                }),
                "result": json.dumps({"name": random.choice(["read", "reference", "later"])})
            })
        elif source_type == "listen":
            records.append({
                "source_id": f"listen-{i}",
                "type": "ListenAction",
                "startTime": iso_timestamp(dt),
                "object": json.dumps({
                    "name": f"{random.choice(SONGS)} {i}",
                    "byArtist": [{"name": random.choice(ARTISTS)}],
                    "inAlbum": {"name": random.choice(ALBUMS)},
                    "url": random_url()
                })
            })
        elif source_type == "message":
            records.append({
                "source_id": f"msg-{i}",
                "type": "SendAction",
                "end_time": iso_timestamp(dt),
                "agent": json.dumps({"name": random_name()}),
                "object": json.dumps({"text": random_text(5, 100)})
            })
        elif source_type == "task":
            status = random.choice(["pending", "completed", "completed"])
            records.append({
                "source_id": f"task-{i}",
                "type": "CreateAction",
                "name": f"Task: {random_text(3, 8)}",
                "description": random_text(10, 50),
                "startTime": iso_timestamp(dt),
                "endTime": iso_timestamp(dt + timedelta(days=random.randint(1, 30))) if status == "completed" else None,
                "actionStatus": status
            })
        elif source_type == "visit":
            records.append({
                "source_id": f"visit-{i}",
                "type": "ViewAction",
                "end_time": iso_timestamp(dt),
                "object": json.dumps({
                    "name": f"Page: {random_text(3, 8)}",
                    "url": random_url()
                })
            })
        elif source_type == "note":
            records.append({
                "source_id": f"note-{i}",
                "type": "CreateAction",
                "name": f"Note: {random_text(2, 5)}",
                "text": random_text(20, 200),
                "date_created": iso_timestamp(dt)
            })
        elif source_type == "photo":
            records.append({
                "source_id": f"photo-{i}",
                "type": "Photograph",
                "name": f"IMG_{random.randint(1000, 9999)}.jpg",
                "description": random_text(5, 20) if random.random() > 0.5 else "",
                "dateCreated": iso_timestamp(dt),
                "contentLocation": json.dumps({"name": f"{random.choice(['New York', 'San Francisco', 'Chicago', 'Austin', 'Seattle'])}"}) if random.random() > 0.3 else None
            })
        elif source_type == "activity":
            records.append({
                "source_id": f"activity-{i}",
                "type": "UseAction",
                "startTime": iso_timestamp(dt),
                "agent": json.dumps({"name": random.choice(APPS)}),
                "object": json.dumps({"name": random.choice(PROJECTS)}),
                "result": json.dumps({"name": random_text(2, 5)})
            })
        elif source_type == "checkin":
            records.append({
                "source_id": f"checkin-{i}",
                "type": "CheckInAction",
                "end_time": iso_timestamp(dt),
                "object": json.dumps({
                    "name": f"{random.choice(['Cafe', 'Restaurant', 'Park', 'Office', 'Gym'])} {random_text(1, 2)}",
                    "address": {
                        "streetAddress": f"{random.randint(1, 999)} Mock Street",
                        "addressLocality": random.choice(["New York", "San Francisco", "Chicago"])
                    },
                    "url": random_url()
                })
            })
        elif source_type == "event":
            records.append({
                "source_id": f"event-{i}",
                "type": "OrganizeAction",
                "startTime": iso_timestamp(dt),
                "additionalType": random.choice(["PushEvent", "PullRequestEvent", "IssueCommentEvent", "WatchEvent"]),
                "description": random_text(5, 30),
                "object": json.dumps({
                    "name": f"repo-{random.choice(WORDS)}-{random.choice(WORDS)}",
                    "url": random_url()
                })
            })
        elif source_type == "highlight":
            records.append({
                "source_id": f"highlight-{i}",
                "type": "HighlightAction",
                "startTime": iso_timestamp(dt),
                "object": json.dumps({
                    "name": random_text(10, 50),
                    "url": random_url()
                }),
                "result": json.dumps({"name": f"Book: {random_text(3, 6)}"})
            })

    for r in records:
        cols = ", ".join(f'"{k}"' for k in r.keys())
        placeholders = ", ".join("?" for _ in r)
        c.execute(f"INSERT INTO events ({cols}) VALUES ({placeholders})", list(r.values()))

    conn.commit()
    conn.close()
    print(f"  Created {db_path} with {num_records} {source_type} records")


def create_twitter_db(db_path, account_name, num_tweets=50, num_likes=30):
    """Create a Twitter archive format database."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS tweets (
            id TEXT PRIMARY KEY,
            created_at TEXT,
            full_text TEXT,
            in_reply_to_status_id TEXT,
            in_reply_to_user_id TEXT,
            in_reply_to_screen_name TEXT,
            retweet_count TEXT,
            favorite_count TEXT,
            lang TEXT,
            source TEXT,
            urls TEXT,
            media TEXT,
            hashtags TEXT,
            user_mentions TEXT
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS likes (
            tweet_id TEXT PRIMARY KEY,
            full_text TEXT,
            expanded_url TEXT
        )
    """)

    # Generate tweets
    for i in range(num_tweets):
        dt = random_timestamp()
        tweet_id = str(random.randint(1000000000000000000, 1999999999999999999))
        c.execute("""
            INSERT INTO tweets (id, created_at, full_text, retweet_count, favorite_count, lang, source)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            tweet_id,
            twitter_timestamp(dt),
            random_text(5, 50),
            str(random.randint(0, 100)),
            str(random.randint(0, 500)),
            "en",
            "Twitter Web App"
        ))

    # Generate likes
    for i in range(num_likes):
        tweet_id = str(random.randint(1000000000000000000, 1999999999999999999))
        c.execute("""
            INSERT INTO likes (tweet_id, full_text, expanded_url)
            VALUES (?, ?, ?)
        """, (
            tweet_id,
            random_text(5, 50),
            random_url()
        ))

    conn.commit()
    conn.close()
    print(f"  Created {db_path} with {num_tweets} tweets and {num_likes} likes")


def create_custom_schema_db(db_path, table_name, schema, generator, num_records=50):
    """Create a database with a custom schema."""
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path)
    c = conn.cursor()

    c.execute(f"CREATE TABLE IF NOT EXISTS {table_name} ({schema})")

    for i in range(num_records):
        record = generator(i)
        cols = ", ".join(f'"{k}"' for k in record.keys())
        placeholders = ", ".join("?" for _ in record)
        c.execute(f"INSERT INTO {table_name} ({cols}) VALUES ({placeholders})", list(record.values()))

    conn.commit()
    conn.close()
    print(f"  Created {db_path} with {num_records} records")


def main():
    print("Generating mock Chronicle databases for Otso testing...\n")

    # Chronicle-format sources (using events table)
    chronicle_sources = [
        ("pinboard", "bookmark", 50),
        ("spotify", "listen", 100),
        ("lastfm", "listen", 100),
        ("imessage", "message", 50),
        ("things", "task", 40),
        ("safari", "visit", 80),
        ("apple-notes", "note", 30),
        ("apple-photos", "photo", 60),
        ("timing", "activity", 100),
        ("foursquare", "checkin", 30),
        ("github", "event", 50),
        ("readwise", "highlight", 40),
        ("apple-podcasts", "listen", 50),
    ]

    print("Creating Chronicle-format sources:")
    for name, source_type, count in chronicle_sources:
        db_path = os.path.join(FIXTURES_DIR, name, "chronicle", "chronicle.db")
        create_chronicle_events_db(db_path, source_type, count)

    # Twitter archives (raw format)
    print("\nCreating Twitter archives:")
    create_twitter_db(
        os.path.join(FIXTURES_DIR, "twitter-mockuser", "chronicle", "chronicle.db"),
        "mockuser", num_tweets=80, num_likes=40
    )
    create_twitter_db(
        os.path.join(FIXTURES_DIR, "twitter-testaccount", "chronicle", "chronicle.db"),
        "testaccount", num_tweets=30, num_likes=20
    )

    # Google Takeout (multiple tables in one DB)
    print("\nCreating Google Takeout database:")
    google_db = os.path.join(FIXTURES_DIR, "google-takeout", "chronicle", "chronicle.db")
    os.makedirs(os.path.dirname(google_db), exist_ok=True)
    conn = sqlite3.connect(google_db)
    c = conn.cursor()

    # Google Search
    c.execute("CREATE TABLE google_search (source_id TEXT, query TEXT, startTime TEXT)")
    for i in range(50):
        dt = random_timestamp()
        c.execute("INSERT INTO google_search VALUES (?, ?, ?)",
                  (f"search-{i}", f"{random.choice(WORDS)} {random.choice(WORDS)}", iso_timestamp(dt)))

    # Chrome History
    c.execute("CREATE TABLE chrome_history (source_id TEXT, object TEXT, startTime TEXT)")
    for i in range(80):
        dt = random_timestamp()
        c.execute("INSERT INTO chrome_history VALUES (?, ?, ?)",
                  (f"chrome-{i}", json.dumps({"name": random_text(3, 8), "url": random_url()}), iso_timestamp(dt)))

    # YouTube
    c.execute("CREATE TABLE youtube_watch (source_id TEXT, object TEXT, startTime TEXT)")
    for i in range(60):
        dt = random_timestamp()
        c.execute("INSERT INTO youtube_watch VALUES (?, ?, ?)",
                  (f"yt-{i}", json.dumps({"name": f"Video: {random_text(3, 10)}", "url": f"https://youtube.com/watch?v=mock{i}"}), iso_timestamp(dt)))

    # Calendar
    c.execute("CREATE TABLE calendar (source_id TEXT, name TEXT, description TEXT, location TEXT, startDate TEXT)")
    for i in range(40):
        dt = random_timestamp()
        c.execute("INSERT INTO calendar VALUES (?, ?, ?, ?, ?)",
                  (f"cal-{i}", f"Meeting: {random_text(2, 5)}", random_text(5, 20),
                   random.choice(["Conference Room A", "Zoom", "Office", ""]), iso_timestamp(dt)))

    conn.commit()
    conn.close()
    print(f"  Created {google_db} with google_search, chrome_history, youtube_watch, calendar tables")

    # Custom schema sources
    print("\nCreating custom schema sources:")

    # Claude conversations
    def claude_generator(i):
        dt = random_timestamp()
        return {
            "uuid": f"conv-{i:04d}-mock",
            "name": f"Conversation about {random_text(2, 5)}" if random.random() > 0.3 else None,
            "summary": random_text(20, 100) if random.random() > 0.5 else None,
            "created_at": iso_timestamp(dt)
        }
    create_custom_schema_db(
        os.path.join(FIXTURES_DIR, "claude", "chronicle", "chronicle.db"),
        "conversations",
        "uuid TEXT, name TEXT, summary TEXT, created_at TEXT",
        claude_generator, 30
    )

    # LinkedIn messages
    def linkedin_generator(i):
        dt = random_timestamp()
        return {
            "FROM": random_name(),
            "CONTENT": random_text(10, 100),
            "DATE": iso_timestamp(dt)
        }
    create_custom_schema_db(
        os.path.join(FIXTURES_DIR, "linkedin", "chronicle", "chronicle.db"),
        "messages",
        '"FROM" TEXT, "CONTENT" TEXT, "DATE" TEXT',
        linkedin_generator, 40
    )

    # Notion pages
    def notion_generator(i):
        dt = random_timestamp()
        return {
            "id": f"notion-page-{i:04d}",
            "title": f"Page: {random_text(2, 6)}",
            "content": random_text(50, 300),
            "created_time": iso_timestamp(dt),
            "url": f"https://notion.so/mock-page-{i}"
        }
    create_custom_schema_db(
        os.path.join(FIXTURES_DIR, "notion", "chronicle", "chronicle.db"),
        "pages",
        "id TEXT, title TEXT, content TEXT, created_time TEXT, url TEXT",
        notion_generator, 25
    )

    # Arena blocks
    arena_db = os.path.join(FIXTURES_DIR, "arena", "chronicle", "chronicle.db")
    os.makedirs(os.path.dirname(arena_db), exist_ok=True)
    conn = sqlite3.connect(arena_db)
    c = conn.cursor()

    c.execute("CREATE TABLE channels (id TEXT, title TEXT, metadata TEXT, created_at TEXT, slug TEXT)")
    for i in range(10):
        dt = random_timestamp()
        slug = f"mock-channel-{i}"
        c.execute("INSERT INTO channels VALUES (?, ?, ?, ?, ?)",
                  (f"chan-{i}", f"Channel: {random_text(2, 4)}", random_text(10, 30), iso_timestamp(dt), slug))

    c.execute("CREATE TABLE blocks (id TEXT, title TEXT, content TEXT, description TEXT, created_at TEXT, source_url TEXT)")
    for i in range(50):
        dt = random_timestamp()
        c.execute("INSERT INTO blocks VALUES (?, ?, ?, ?, ?, ?)",
                  (f"block-{i}", random_text(2, 6) if random.random() > 0.3 else "",
                   random_text(20, 100), random_text(5, 20) if random.random() > 0.5 else "",
                   iso_timestamp(dt), random_url() if random.random() > 0.3 else None))

    conn.commit()
    conn.close()
    print(f"  Created {arena_db} with channels and blocks tables")

    print("\n✓ Mock data generation complete!")
    print(f"  Fixtures created in: {FIXTURES_DIR}")


if __name__ == "__main__":
    main()
