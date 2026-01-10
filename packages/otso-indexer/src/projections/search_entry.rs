use serde::{Deserialize, Serialize};

use crate::event_store::Event;

/// Denormalized entry for search indexing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchEntry {
    pub id: i64,
    pub event_id: String,
    pub source: String,
    pub entry_type: String,
    pub action_type: String,
    pub object_type: String,
    pub title: String,
    pub content: String,
    pub ts: i64,
    pub external_id: Option<String>,
    pub url: Option<String>,
    pub visibility: String,
    pub category: String,
    pub year: i32,
    pub month: String,
}

impl SearchEntry {
    pub fn from_event(event: &Event, id: i64) -> Self {
        let payload = &event.payload;

        SearchEntry {
            id,
            event_id: event.event_id.to_string(),
            source: event.source.clone(),
            entry_type: derive_entry_type(event),
            action_type: event.action_type.clone().unwrap_or_default(),
            object_type: event.object_type.clone().unwrap_or_default(),
            title: extract_title(payload),
            content: extract_content(payload),
            ts: event.occurred_at,
            external_id: Some(event.source_id.clone()),
            url: extract_url(payload),
            visibility: event.visibility.as_str().to_string(),
            category: derive_category(&event.source, &event.action_type),
            year: timestamp_to_year(event.occurred_at),
            month: timestamp_to_month(event.occurred_at),
        }
    }
}

fn timestamp_to_year(ts: i64) -> i32 {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y").to_string().parse().unwrap_or(1970))
        .unwrap_or(1970)
}

fn timestamp_to_month(ts: i64) -> String {
    chrono::DateTime::from_timestamp(ts, 0)
        .map(|dt| dt.format("%Y-%m").to_string())
        .unwrap_or_else(|| "1970-01".to_string())
}

/// Extract title from event payload
fn extract_title(payload: &serde_json::Value) -> String {
    // Try various title fields in order of preference
    let title_fields = [
        "name",
        "title",
        "subject",
        "headline",
        "summary",
        "description",
        "text",
        "content",
        "app_name",
        "artist",
        "track",
    ];

    for field in title_fields {
        if let Some(value) = payload.get(field) {
            if let Some(s) = value.as_str() {
                if !s.is_empty() {
                    return s.to_string();
                }
            }
        }
    }

    // Try nested object field (Schema.org style)
    if let Some(obj) = payload.get("object") {
        for field in &["name", "title", "headline"] {
            if let Some(value) = obj.get(field) {
                if let Some(s) = value.as_str() {
                    if !s.is_empty() {
                        return s.to_string();
                    }
                }
            }
        }
    }

    String::new()
}

/// Extract content/description from event payload
fn extract_content(payload: &serde_json::Value) -> String {
    let content_fields = [
        "description",
        "content",
        "text",
        "body",
        "message",
        "note",
        "extended",
        "project_path",
        "url",
    ];

    let mut parts = Vec::new();

    for field in content_fields {
        if let Some(value) = payload.get(field) {
            if let Some(s) = value.as_str() {
                if !s.is_empty() {
                    parts.push(s.to_string());
                }
            }
        }
    }

    // Try nested object
    if let Some(obj) = payload.get("object") {
        for field in &["description", "text", "articleBody"] {
            if let Some(value) = obj.get(field) {
                if let Some(s) = value.as_str() {
                    if !s.is_empty() && !parts.contains(&s.to_string()) {
                        parts.push(s.to_string());
                    }
                }
            }
        }
    }

    // Include tags if present
    if let Some(tags) = payload.get("tags") {
        if let Some(arr) = tags.as_array() {
            let tag_str: Vec<String> = arr
                .iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
            if !tag_str.is_empty() {
                parts.push(tag_str.join(" "));
            }
        } else if let Some(s) = tags.as_str() {
            parts.push(s.to_string());
        }
    }

    parts.join(" ")
}

/// Extract URL from event payload
fn extract_url(payload: &serde_json::Value) -> Option<String> {
    let url_fields = ["url", "href", "link", "uri", "permalink"];

    for field in url_fields {
        if let Some(value) = payload.get(field) {
            if let Some(s) = value.as_str() {
                if !s.is_empty() && (s.starts_with("http://") || s.starts_with("https://")) {
                    return Some(s.to_string());
                }
            }
        }
    }

    // Try nested object
    if let Some(obj) = payload.get("object") {
        for field in &["url", "href"] {
            if let Some(value) = obj.get(field) {
                if let Some(s) = value.as_str() {
                    if !s.is_empty() && (s.starts_with("http://") || s.starts_with("https://")) {
                        return Some(s.to_string());
                    }
                }
            }
        }
    }

    None
}

/// Derive entry type from event
pub fn derive_entry_type(event: &Event) -> String {
    match event.action_type.as_deref() {
        Some("ListenAction") => "listen".to_string(),
        Some("LikeAction") => "like".to_string(),
        Some("ViewAction") => "visit".to_string(),
        Some("BookmarkAction") => "bookmark".to_string(),
        Some("CommunicateAction") => "message".to_string(),
        Some("CreateAction") => match event.object_type.as_deref() {
            Some("Note") | Some("NoteDigitalDocument") => "note".to_string(),
            Some("Photograph") => "photo".to_string(),
            Some("SocialMediaPosting") => "message".to_string(),
            _ => "create".to_string(),
        },
        Some("CheckInAction") => "checkin".to_string(),
        Some("BuyAction") => "transaction".to_string(),
        Some("SearchAction") => "search".to_string(),
        Some("WatchAction") => "watch".to_string(),
        Some("FollowAction") => "follow".to_string(),
        Some("ShareAction") => "share".to_string(),
        _ => "activity".to_string(),
    }
}

/// Derive category from source and action type
pub fn derive_category(source: &str, _action_type: &Option<String>) -> String {
    match source {
        "spotify" | "lastfm" | "apple-podcasts" | "apple-music" => "music".to_string(),
        "safari" | "chrome" | "atlas" => "browse".to_string(),
        "twitter" | "mastodon" | "bluesky" | "linkedin" => "social".to_string(),
        "imessage" | "email" | "google-chat" | "slack" => "comms".to_string(),
        "pinboard" | "readwise" | "arena" => "reading".to_string(),
        "github" => "code".to_string(),
        "apple-notes" | "notion" => "notes".to_string(),
        "apple-photos" | "youtube" => "media".to_string(),
        "foursquare" => "location".to_string(),
        "things" | "google-calendar" => "tasks".to_string(),
        "timing" => "productivity".to_string(),
        "copilot" | "lunch-money" => "finance".to_string(),
        "claude" => "ai".to_string(),
        "apple-health" => "health".to_string(),
        "shell" => "shell".to_string(),
        "google-search" => "search".to_string(),
        _ => "other".to_string(),
    }
}
